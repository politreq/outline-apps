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
	"bytes"
	"context"
	"errors"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

func echoDial(t *testing.T) wsDial {
	t.Helper()
	up := websocket.Upgrader{}
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		c, e := up.Upgrade(w, r, nil)
		if e != nil {
			return
		}
		defer c.Close()
		for {
			k, data, e := c.ReadMessage()
			if e != nil {
				return
			}
			if c.WriteMessage(k, data) != nil {
				return
			}
		}
	}))
	t.Cleanup(s.Close)
	return func(ctx context.Context, _ bool) (*websocket.Conn, error) {
		c, _, e := websocket.DefaultDialer.DialContext(ctx, "ws"+strings.TrimPrefix(s.URL, "http"), nil)
		return c, e
	}
}

func TestLoopbackOnly(t *testing.T) {
	for _, a := range []string{"0.0.0.0:0", "192.0.2.1:0", "[::]:0"} {
		if b, e := startBridge(context.Background(), a, nil); e == nil {
			b.close()
			t.Fatalf("unsafe listener accepted: %s", a)
		}
	}
}

func TestTCPBytesAndRepeatedConnections(t *testing.T) {
	b, e := startBridge(context.Background(), "127.0.0.1:0", echoDial(t))
	if e != nil {
		t.Fatal(e)
	}
	defer b.close()
	for i := 0; i < 5; i++ {
		c, e := net.DialTimeout("tcp", b.tcp.Addr().String(), time.Second)
		if e != nil {
			t.Fatal(e)
		}
		c.SetDeadline(time.Now().Add(3 * time.Second))
		payload := bytes.Repeat([]byte{0, 1, 255, 2, 3, 4}, 20000)
		done := make(chan error, 1)
		go func() { _, e := c.Write(payload); done <- e }()
		out := make([]byte, len(payload))
		_, e = io.ReadFull(c, out)
		if e != nil {
			c.Close()
			t.Fatal(e)
		}
		if !bytes.Equal(out, payload) {
			t.Fatal("encrypted stream bytes changed")
		}
		if e = <-done; e != nil {
			t.Fatal(e)
		}
		c.Close()
	}
}

func TestUDPDatagramBoundaries(t *testing.T) {
	b, e := startBridge(context.Background(), "127.0.0.1:0", echoDial(t))
	if e != nil {
		t.Fatal(e)
	}
	defer b.close()
	c, e := net.Dial("udp4", b.udp.LocalAddr().String())
	if e != nil {
		t.Fatal(e)
	}
	defer c.Close()
	c.SetDeadline(time.Now().Add(3 * time.Second))
	for _, size := range []int{1, 128, 1500, 4000, 8000} {
		p := bytes.Repeat([]byte{17}, size)
		if _, e = c.Write(p); e != nil {
			t.Fatal(e)
		}
		out := make([]byte, 65535)
		n, e := c.Read(out)
		if e != nil {
			t.Fatal(e)
		}
		if !bytes.Equal(out[:n], p) {
			t.Fatalf("datagram changed: %d != %d", n, len(p))
		}
	}
}

func TestShutdownCancelsBlockedDials(t *testing.T) {
	var started atomic.Int32
	dial := func(ctx context.Context, _ bool) (*websocket.Conn, error) {
		started.Add(1)
		<-ctx.Done()
		return nil, ctx.Err()
	}
	b, e := startBridge(context.Background(), "127.0.0.1:0", dial)
	if e != nil {
		t.Fatal(e)
	}
	tcp, e := net.Dial("tcp4", b.tcp.Addr().String())
	if e != nil {
		t.Fatal(e)
	}
	defer tcp.Close()
	udp, e := net.Dial("udp4", b.udp.LocalAddr().String())
	if e != nil {
		t.Fatal(e)
	}
	defer udp.Close()
	udp.Write([]byte("test"))
	deadline := time.Now().Add(time.Second)
	for started.Load() < 2 && time.Now().Before(deadline) {
		time.Sleep(time.Millisecond)
	}
	closed := make(chan struct{})
	go func() { b.close(); close(closed) }()
	select {
	case <-closed:
	case <-time.After(time.Second):
		t.Fatal("shutdown stuck in dial")
	}
}

func TestUDPQueueBoundedWhileDialStalls(t *testing.T) {
	entered := make(chan struct{})
	var once sync.Once
	b, e := startBridge(context.Background(), "127.0.0.1:0", func(ctx context.Context, _ bool) (*websocket.Conn, error) {
		once.Do(func() { close(entered) })
		<-ctx.Done()
		return nil, ctx.Err()
	})
	if e != nil {
		t.Fatal(e)
	}
	defer b.close()
	c, e := net.Dial("udp4", b.udp.LocalAddr().String())
	if e != nil {
		t.Fatal(e)
	}
	defer c.Close()
	c.Write([]byte("first"))
	select {
	case <-entered:
	case <-time.After(time.Second):
		t.Fatal("dial did not start")
	}
	for range 100 {
		c.Write([]byte("packet"))
	}
	deadline := time.Now().Add(time.Second)
	for b.drops.Load() == 0 && time.Now().Before(deadline) {
		time.Sleep(time.Millisecond)
	}
	if b.drops.Load() == 0 {
		t.Fatal("backpressure not applied")
	}
	b.mu.Lock()
	defer b.mu.Unlock()
	for _, p := range b.peers {
		if len(p.queue) > 8 {
			t.Fatal("queue exceeded limit")
		}
	}
}

func TestFailedDialDoesNotPoisonNextConnection(t *testing.T) {
	good := echoDial(t)
	var calls atomic.Int32
	b, e := startBridge(context.Background(), "127.0.0.1:0", func(ctx context.Context, u bool) (*websocket.Conn, error) {
		if calls.Add(1) == 1 {
			return nil, errors.New("injected")
		}
		return good(ctx, u)
	})
	if e != nil {
		t.Fatal(e)
	}
	defer b.close()
	c, e := net.Dial("tcp", b.tcp.Addr().String())
	if e != nil {
		t.Fatal(e)
	}
	c.SetDeadline(time.Now().Add(time.Second))
	_, e = c.Read(make([]byte, 1))
	c.Close()
	if e == nil {
		t.Fatal("failed upstream stayed open")
	}
	c, e = net.Dial("tcp", b.tcp.Addr().String())
	if e != nil {
		t.Fatal(e)
	}
	defer c.Close()
	c.SetDeadline(time.Now().Add(time.Second))
	c.Write([]byte("ok"))
	out := make([]byte, 2)
	if _, e = io.ReadFull(c, out); e != nil || string(out) != "ok" {
		t.Fatal("fresh connection did not recover")
	}
}
