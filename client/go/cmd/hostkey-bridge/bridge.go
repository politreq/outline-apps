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
//
//go:build darwin && !ios

package main

import (
	"context"
	"errors"
	"io"
	"net"
	"net/netip"
	"sync"
	"sync/atomic"
	"time"

	"github.com/gorilla/websocket"
)

type wsDial func(context.Context, bool) (*websocket.Conn, error)

type bridge struct {
	ctx                                 context.Context
	cancel                              context.CancelFunc
	tcp                                 *net.TCPListener
	udp                                 *net.UDPConn
	dial                                wsDial
	wg                                  sync.WaitGroup
	mu                                  sync.Mutex
	peers                               map[netip.AddrPort]*udpPeer
	streams                             chan struct{}
	tcpCount, udpCount, drops, failures atomic.Uint64
}

func startBridge(parent context.Context, address string, dial wsDial) (*bridge, error) {
	a, err := net.ResolveTCPAddr("tcp4", address)
	if err != nil || !a.IP.Equal(net.IPv4(127, 0, 0, 1)) {
		return nil, errors.New("only 127.0.0.1 listeners are allowed")
	}
	tcp, err := net.ListenTCP("tcp4", a)
	if err != nil {
		return nil, err
	}
	udp, err := net.ListenUDP("udp4", &net.UDPAddr{IP: net.IPv4(127, 0, 0, 1), Port: tcp.Addr().(*net.TCPAddr).Port})
	if err != nil {
		tcp.Close()
		return nil, err
	}
	ctx, cancel := context.WithCancel(parent)
	b := &bridge{ctx: ctx, cancel: cancel, tcp: tcp, udp: udp, dial: dial, peers: make(map[netip.AddrPort]*udpPeer), streams: make(chan struct{}, 128)}
	b.wg.Add(2)
	go b.acceptTCP()
	go b.acceptUDP()
	return b, nil
}

func (b *bridge) close() { b.cancel(); b.tcp.Close(); b.udp.Close(); b.wg.Wait() }

func (b *bridge) acceptTCP() {
	defer b.wg.Done()
	for {
		c, err := b.tcp.AcceptTCP()
		if err != nil {
			return
		}
		if b.ctx.Err() != nil {
			c.Close()
			return
		}
		select {
		case b.streams <- struct{}{}:
		case <-b.ctx.Done():
			c.Close()
			return
		default:
			c.Close()
			b.drops.Add(1)
			continue
		}
		b.wg.Add(1)
		go func() { defer b.wg.Done(); defer func() { <-b.streams }(); b.handleTCP(c) }()
	}
}

func (b *bridge) handleTCP(local *net.TCPConn) {
	defer local.Close()
	stop := context.AfterFunc(b.ctx, func() { local.Close() })
	defer stop()
	ctx, cancel := context.WithTimeout(b.ctx, 8*time.Second)
	remote, err := b.dial(ctx, false)
	cancel()
	if err != nil {
		b.failures.Add(1)
		return
	}
	defer remote.Close()
	b.tcpCount.Add(1)
	stopRemote := context.AfterFunc(b.ctx, func() { remote.Close() })
	defer stopRemote()
	remote.SetReadLimit(1024 * 1024)
	_ = remote.SetReadDeadline(time.Now().Add(75 * time.Second))
	remote.SetPongHandler(func(string) error { return remote.SetReadDeadline(time.Now().Add(75 * time.Second)) })
	done := make(chan struct{})
	var workers sync.WaitGroup
	workers.Add(2)
	defer func() { close(done); local.Close(); remote.Close(); workers.Wait() }()
	go func() {
		defer workers.Done()
		buffer := make([]byte, 32768)
		for {
			n, e := local.Read(buffer)
			if n > 0 {
				_ = remote.SetWriteDeadline(time.Now().Add(8 * time.Second))
				if we := remote.WriteMessage(websocket.BinaryMessage, buffer[:n]); we != nil {
					remote.Close()
					return
				}
			}
			if e != nil {
				if errors.Is(e, io.EOF) {
					_ = remote.WriteControl(websocket.CloseMessage, websocket.FormatCloseMessage(websocket.CloseNormalClosure, ""), time.Now().Add(time.Second))
					select {
					case <-done:
					case <-b.ctx.Done():
					case <-time.After(10 * time.Second):
						remote.Close()
					}
				} else {
					remote.Close()
				}
				return
			}
		}
	}()
	go func() {
		defer workers.Done()
		ticker := time.NewTicker(20 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-done:
				return
			case <-b.ctx.Done():
				remote.Close()
				return
			case <-ticker.C:
				if remote.WriteControl(websocket.PingMessage, nil, time.Now().Add(5*time.Second)) != nil {
					remote.Close()
					return
				}
			}
		}
	}()
	// One WS reader and one data writer; control writes and Close are safe
	// concurrently. Only the reader changes read deadlines.
	for {
		kind, data, e := remote.ReadMessage()
		if e != nil {
			break
		}
		if kind != websocket.BinaryMessage {
			break
		}
		_ = remote.SetReadDeadline(time.Now().Add(75 * time.Second))
		_ = local.SetWriteDeadline(time.Now().Add(8 * time.Second))
		if _, e = local.Write(data); e != nil {
			break
		}
	}
}

type udpPeer struct {
	queue chan []byte
	last  atomic.Int64
	done  chan struct{}
}

func (b *bridge) acceptUDP() {
	defer b.wg.Done()
	buffer := make([]byte, 65535)
	for {
		n, from, err := b.udp.ReadFromUDPAddrPort(buffer)
		if err != nil {
			return
		}
		if b.ctx.Err() != nil {
			return
		}
		if !from.Addr().IsLoopback() {
			continue
		}
		b.mu.Lock()
		p := b.peers[from]
		if p == nil {
			if len(b.peers) >= 64 {
				b.mu.Unlock()
				b.drops.Add(1)
				continue
			}
			p = &udpPeer{queue: make(chan []byte, 8), done: make(chan struct{})}
			p.last.Store(time.Now().UnixNano())
			b.peers[from] = p
			b.wg.Add(1)
			go b.handleUDP(from, p)
		}
		select {
		case p.queue <- append([]byte(nil), buffer[:n]...):
		case <-p.done:
		default:
			b.drops.Add(1)
		}
		b.mu.Unlock()
	}
}

func (b *bridge) handleUDP(from netip.AddrPort, p *udpPeer) {
	defer b.wg.Done()
	defer func() { b.mu.Lock(); delete(b.peers, from); close(p.done); b.mu.Unlock() }()
	ctx, cancel := context.WithTimeout(b.ctx, 8*time.Second)
	remote, err := b.dial(ctx, true)
	cancel()
	if err != nil {
		b.failures.Add(1)
		return
	}
	defer remote.Close()
	remote.SetReadLimit(65535)
	b.udpCount.Add(1)
	stop := context.AfterFunc(b.ctx, func() { remote.Close() })
	defer stop()
	readDone := make(chan struct{})
	go func() {
		defer close(readDone)
		for {
			kind, data, e := remote.ReadMessage()
			if e != nil || kind != websocket.BinaryMessage {
				return
			}
			p.last.Store(time.Now().UnixNano())
			if _, e = b.udp.WriteToUDPAddrPort(data, from); e != nil {
				return
			}
		}
	}()
	defer func() { remote.Close(); <-readDone }()
	ticker := time.NewTicker(10 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-b.ctx.Done():
			return
		case <-readDone:
			return
		case <-ticker.C:
			if time.Since(time.Unix(0, p.last.Load())) > 60*time.Second {
				return
			}
		case data := <-p.queue:
			p.last.Store(time.Now().UnixNano())
			_ = remote.SetWriteDeadline(time.Now().Add(5 * time.Second))
			if remote.WriteMessage(websocket.BinaryMessage, data) != nil {
				b.failures.Add(1)
				return
			}
		}
	}
}
