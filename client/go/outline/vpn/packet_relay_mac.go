// Copyright 2026 The Outline Authors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//      http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

//go:build (darwin && !ios) || maccatalyst

package vpn

import (
	"io"
	"net/netip"
	"sync"
	"time"

	"golang.getoutline.org/sdk/network/packetrelay"
)

// lwIP invokes SendPacket while holding its global packet-processing mutex.
// Never perform transport I/O on that callback: one stalled WebSocket write
// otherwise stops unrelated TCP, DNS and lwIP timers as well.
const (
	packetQueueSize   = 64
	packetQueueBytes  = 64 * 1024
	packetSendTimeout = 5 * time.Second
)

func devicePacketRelay(pr packetrelay.PacketRelay) (packetrelay.PacketRelay, func()) {
	r := newQueuedPacketRelay(pr, packetSendTimeout)
	return r, r.close
}

type queuedPacketRelay struct {
	base     packetrelay.PacketRelay
	timeout  time.Duration
	mu       sync.Mutex
	closed   bool
	sessions map[*queuedAssociation]struct{}
}

func newQueuedPacketRelay(base packetrelay.PacketRelay, timeout time.Duration) *queuedPacketRelay {
	return &queuedPacketRelay{base: base, timeout: timeout, sessions: make(map[*queuedAssociation]struct{})}
}

func (r *queuedPacketRelay) NewAssociation() (packetrelay.PacketSender, packetrelay.PacketReceiver, error) {
	r.mu.Lock()
	closed := r.closed
	r.mu.Unlock()
	if closed {
		return nil, nil, packetrelay.ErrClosed
	}
	sender, receiver, err := r.base.NewAssociation()
	if err != nil {
		return nil, nil, err
	}
	s := &queuedAssociation{owner: r, sender: sender, receiver: receiver,
		queue: make(chan queuedPacket, packetQueueSize), done: make(chan struct{}), exited: make(chan struct{})}
	r.mu.Lock()
	if r.closed {
		r.mu.Unlock()
		_ = sender.Close()
		return nil, nil, packetrelay.ErrClosed
	}
	r.sessions[s] = struct{}{}
	r.mu.Unlock()
	go s.run()
	return s, s, nil
}

func (r *queuedPacketRelay) close() {
	r.mu.Lock()
	r.closed = true
	sessions := make([]*queuedAssociation, 0, len(r.sessions))
	for s := range r.sessions {
		sessions = append(sessions, s)
	}
	r.mu.Unlock()
	for _, s := range sessions {
		_ = s.Close()
	}
}

type queuedPacket struct {
	data        []byte
	destination netip.AddrPort
}

type queuedAssociation struct {
	owner    *queuedPacketRelay
	sender   packetrelay.PacketSender
	receiver packetrelay.PacketReceiver
	queue    chan queuedPacket
	done     chan struct{}
	exited   chan struct{}
	mu       sync.Mutex
	closed   bool
	bytes    int
}

func (s *queuedAssociation) SendPacket(data []byte, destination netip.AddrPort) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return packetrelay.ErrClosed
	}
	// UDP may drop under backpressure. Bound memory and latency instead of
	// blocking lwIP or starting an unbounded goroutine for every datagram.
	if len(data) > packetQueueBytes-s.bytes || len(s.queue) == cap(s.queue) {
		return nil
	}
	p := queuedPacket{data: append([]byte(nil), data...), destination: destination}
	s.bytes += len(p.data)
	s.queue <- p // Only producers hold mu; the capacity check makes this nonblocking.
	return nil
}

func (s *queuedAssociation) run() {
	defer close(s.exited)
	defer s.Close()
	for {
		select {
		case <-s.done:
			return
		case p := <-s.queue:
			s.mu.Lock()
			s.bytes -= len(p.data)
			closed := s.closed
			s.mu.Unlock()
			if closed {
				return
			}
			// PacketSender.Close must interrupt the underlying transport. Do not
			// mutate its deadlines concurrently with SDK/Gorilla write operations.
			timer := time.AfterFunc(s.owner.timeout, func() { _ = s.Close() })
			err := s.sender.SendPacket(p.data, p.destination)
			timer.Stop()
			if err != nil {
				return
			}
		}
	}
}

func (s *queuedAssociation) Close() error {
	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		return packetrelay.ErrClosed
	}
	s.closed = true
	close(s.done)
	// Release queued payloads even if a broken transport ignores Close.
Drain:
	for {
		select {
		case p := <-s.queue:
			s.bytes -= len(p.data)
		default:
			break Drain
		}
	}
	s.mu.Unlock()
	s.owner.mu.Lock()
	delete(s.owner.sessions, s)
	s.owner.mu.Unlock()
	return s.sender.Close()
}

func (s *queuedAssociation) ReceivePackets(handler packetrelay.PacketHandler) error {
	defer s.Close()
	select {
	case <-s.done:
		return io.EOF
	default:
	}
	return s.receiver.ReceivePackets(handler)
}
