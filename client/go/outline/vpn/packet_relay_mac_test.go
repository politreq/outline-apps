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
	"errors"
	"io"
	"net/netip"
	"sync"
	"testing"
	"time"

	"golang.getoutline.org/sdk/network/packetrelay"
)

type fakeAssociation struct {
	done chan struct{}
	once sync.Once
	send func([]byte, netip.AddrPort) error
}

func (f *fakeAssociation) SendPacket(p []byte, d netip.AddrPort) error    { return f.send(p, d) }
func (f *fakeAssociation) Close() error                                   { f.once.Do(func() { close(f.done) }); return nil }
func (f *fakeAssociation) ReceivePackets(packetrelay.PacketHandler) error { <-f.done; return io.EOF }

type fakeRelay struct {
	create func() (packetrelay.PacketSender, packetrelay.PacketReceiver, error)
}

func (r fakeRelay) NewAssociation() (packetrelay.PacketSender, packetrelay.PacketReceiver, error) {
	return r.create()
}
func testRelay(t *testing.T, f *fakeAssociation, timeout time.Duration) (*queuedPacketRelay, *queuedAssociation) {
	t.Helper()
	r := newQueuedPacketRelay(fakeRelay{func() (packetrelay.PacketSender, packetrelay.PacketReceiver, error) { return f, f, nil }}, timeout)
	t.Cleanup(r.close)
	s, _, err := r.NewAssociation()
	if err != nil {
		t.Fatal(err)
	}
	return r, s.(*queuedAssociation)
}
func waitFor(t *testing.T, c <-chan struct{}) {
	t.Helper()
	select {
	case <-c:
	case <-time.After(2 * time.Second):
		t.Fatal("operation did not finish")
	}
}

var testDestination = netip.MustParseAddrPort("192.0.2.1:53")

func TestQueuedRelayStallDoesNotBlockProducerAndTimesOut(t *testing.T) {
	entered := make(chan struct{})
	f := &fakeAssociation{done: make(chan struct{})}
	f.send = func([]byte, netip.AddrPort) error { close(entered); <-f.done; return io.EOF }
	_, s := testRelay(t, f, 40*time.Millisecond)
	if err := s.SendPacket([]byte("first"), testDestination); err != nil {
		t.Fatal(err)
	}
	waitFor(t, entered)
	producer := make(chan struct{})
	go func() {
		for range 10000 {
			_ = s.SendPacket([]byte("next"), testDestination)
		}
		close(producer)
	}()
	waitFor(t, producer)
	waitFor(t, s.exited)
	if !errors.Is(s.SendPacket(nil, testDestination), packetrelay.ErrClosed) {
		t.Fatal("closed sender accepted data")
	}
}

func TestQueuedRelayCopiesPayloadAndPreservesOrder(t *testing.T) {
	entered := make(chan struct{})
	release := make(chan struct{})
	got := make(chan queuedPacket, 4)
	f := &fakeAssociation{done: make(chan struct{})}
	first := true
	f.send = func(p []byte, d netip.AddrPort) error {
		if first {
			first = false
			close(entered)
			select {
			case <-release:
			case <-f.done:
				return io.EOF
			}
		}
		got <- queuedPacket{append([]byte(nil), p...), d}
		return nil
	}
	_, s := testRelay(t, f, time.Second)
	_ = s.SendPacket([]byte("first"), testDestination)
	waitFor(t, entered)
	p := []byte("second")
	_ = s.SendPacket(p, testDestination)
	p[0] = 'X'
	_ = s.SendPacket([]byte("third"), testDestination)
	close(release)
	for _, want := range []string{"first", "second", "third"} {
		select {
		case packet := <-got:
			if string(packet.data) != want || packet.destination != testDestination {
				t.Fatalf("unexpected packet: %q", packet.data)
			}
		case <-time.After(time.Second):
			t.Fatal("packet missing")
		}
	}
}

func TestQueuedRelayQueueIsBounded(t *testing.T) {
	entered := make(chan struct{})
	f := &fakeAssociation{done: make(chan struct{})}
	f.send = func([]byte, netip.AddrPort) error { close(entered); <-f.done; return io.EOF }
	_, s := testRelay(t, f, time.Second)
	_ = s.SendPacket([]byte("first"), testDestination)
	waitFor(t, entered)
	for range 1000 {
		_ = s.SendPacket(make([]byte, 2048), testDestination)
	}
	s.mu.Lock()
	size, bytes := len(s.queue), s.bytes
	s.mu.Unlock()
	if size > packetQueueSize || bytes > packetQueueBytes || bytes != packetQueueBytes {
		t.Fatalf("unbounded or unexpected queue: %d/%d", size, bytes)
	}
	_ = s.Close()
	waitFor(t, s.exited)
	s.mu.Lock()
	bytes = s.bytes
	s.mu.Unlock()
	if bytes != 0 {
		t.Fatalf("queued bytes retained: %d", bytes)
	}
}

func TestQueuedRelayDeviceCloseInterruptsReadAndWrite(t *testing.T) {
	entered := make(chan struct{})
	f := &fakeAssociation{done: make(chan struct{})}
	f.send = func([]byte, netip.AddrPort) error { close(entered); <-f.done; return io.EOF }
	r, s := testRelay(t, f, time.Second)
	readDone := make(chan struct{})
	go func() { _ = s.ReceivePackets(nil); close(readDone) }()
	_ = s.SendPacket([]byte("first"), testDestination)
	waitFor(t, entered)
	r.close()
	r.close()
	waitFor(t, s.exited)
	waitFor(t, readDone)
	if _, _, err := r.NewAssociation(); !errors.Is(err, packetrelay.ErrClosed) {
		t.Fatalf("new session after close: %v", err)
	}
}

func TestQueuedRelayCloseDuringAssociationCreation(t *testing.T) {
	entered := make(chan struct{})
	release := make(chan struct{})
	f := &fakeAssociation{done: make(chan struct{})}
	r := newQueuedPacketRelay(fakeRelay{func() (packetrelay.PacketSender, packetrelay.PacketReceiver, error) {
		close(entered)
		<-release
		return f, f, nil
	}}, time.Second)
	finished := make(chan struct{})
	go func() {
		defer close(finished)
		if _, _, err := r.NewAssociation(); !errors.Is(err, packetrelay.ErrClosed) {
			t.Errorf("unexpected error: %v", err)
		}
	}()
	waitFor(t, entered)
	r.close()
	close(release)
	waitFor(t, finished)
	waitFor(t, f.done)
}

func TestQueuedRelayConcurrentCloseAndSend(t *testing.T) {
	f := &fakeAssociation{done: make(chan struct{}), send: func([]byte, netip.AddrPort) error { return nil }}
	r, s := testRelay(t, f, time.Second)
	var wg sync.WaitGroup
	for range 8 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for range 1000 {
				_ = s.SendPacket([]byte("data"), testDestination)
			}
		}()
	}
	r.close()
	wg.Wait()
	waitFor(t, s.exited)
}

func TestQueuedRelaySendErrorClosesAssociation(t *testing.T) {
	f := &fakeAssociation{done: make(chan struct{}), send: func([]byte, netip.AddrPort) error { return io.ErrUnexpectedEOF }}
	_, s := testRelay(t, f, time.Second)
	_ = s.SendPacket([]byte("data"), testDestination)
	waitFor(t, s.exited)
	waitFor(t, f.done)
}

func TestQueuedRelayOtherAssociationSurvivesStall(t *testing.T) {
	stalled := make(chan struct{})
	delivered := make(chan struct{})
	blocked := &fakeAssociation{done: make(chan struct{})}
	blocked.send = func([]byte, netip.AddrPort) error { close(stalled); <-blocked.done; return io.EOF }
	healthy := &fakeAssociation{done: make(chan struct{}), send: func([]byte, netip.AddrPort) error { close(delivered); return nil }}
	next := blocked
	r := newQueuedPacketRelay(fakeRelay{func() (packetrelay.PacketSender, packetrelay.PacketReceiver, error) {
		f := next
		next = healthy
		return f, f, nil
	}}, time.Second)
	defer r.close()
	a, _, err := r.NewAssociation()
	if err != nil {
		t.Fatal(err)
	}
	b, _, err := r.NewAssociation()
	if err != nil {
		t.Fatal(err)
	}
	_ = a.SendPacket([]byte("stall"), testDestination)
	waitFor(t, stalled)
	_ = b.SendPacket([]byte("healthy"), testDestination)
	waitFor(t, delivered)
	_ = a.Close()
	select {
	case <-healthy.done:
		t.Fatal("closing one association affected another")
	default:
	}
}
