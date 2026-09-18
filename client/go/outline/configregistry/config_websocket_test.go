// Copyright 2026 The Outline Authors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

package configregistry

import (
	"context"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"github.com/stretchr/testify/require"
	"golang.getoutline.org/sdk/transport"
	"localhost/client/go/configyaml"
)

func TestWebsocketConnectDeadline(t *testing.T) {
	parent := context.Background()
	c := boundedWebsocketConnect(func(ctx context.Context) (int, error) {
		deadline, ok := ctx.Deadline()
		require.True(t, ok)
		require.InDelta(t, websocketConnectTimeout.Seconds(), time.Until(deadline).Seconds(), 1)
		return 7, nil
	})
	got, err := c(parent)
	require.NoError(t, err)
	require.Equal(t, 7, got)

	ctx, cancel := context.WithTimeout(parent, 25*time.Millisecond)
	defer cancel()
	c = boundedWebsocketConnect(func(ctx context.Context) (int, error) { <-ctx.Done(); return 0, ctx.Err() })
	_, err = c(ctx)
	require.ErrorIs(t, err, context.DeadlineExceeded)
	cancelled, stop := context.WithCancel(parent)
	stop()
	_, err = c(cancelled)
	require.ErrorIs(t, err, context.Canceled)
}

func websocketTestEndpoint(t *testing.T, raw string) *Endpoint[transport.StreamConn] {
	t.Helper()
	parse := func(_ context.Context, _ configyaml.ConfigNode) (*Endpoint[transport.StreamConn], error) {
		ep := &transport.TCPEndpoint{Address: strings.TrimPrefix(strings.TrimPrefix(raw, "http://"), "https://")}
		return &Endpoint[transport.StreamConn]{Connect: ep.ConnectStream}, nil
	}
	ep, err := NewWebsocketStreamEndpointSubParser(parse)(context.Background(), map[string]any{"url": strings.Replace(raw, "http", "ws", 1)})
	require.NoError(t, err)
	return ep
}

func TestWebsocketUpgradeTimeoutAndRecovery(t *testing.T) {
	release := make(chan struct{})
	entered := make(chan struct{}, 1)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("stall") == "yes" {
			entered <- struct{}{}
			select {
			case <-release:
			case <-r.Context().Done():
			}
			return
		}
		u := websocket.Upgrader{}
		c, err := u.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		defer c.Close()
		for {
			kind, b, e := c.ReadMessage()
			if e != nil {
				return
			}
			if c.WriteMessage(kind, b) != nil {
				return
			}
		}
	}))
	defer srv.Close()
	defer close(release)
	ep := websocketTestEndpoint(t, srv.URL)
	// Use the same endpoint parser with a stalled upgrade path.
	parse := func(_ context.Context, _ configyaml.ConfigNode) (*Endpoint[transport.StreamConn], error) {
		tcp := &transport.TCPEndpoint{Address: strings.TrimPrefix(srv.URL, "http://")}
		return &Endpoint[transport.StreamConn]{Connect: tcp.ConnectStream}, nil
	}
	stuck, err := NewWebsocketStreamEndpointSubParser(parse)(context.Background(), map[string]any{"url": strings.Replace(srv.URL, "http", "ws", 1) + "?stall=yes"})
	require.NoError(t, err)
	ctx, cancel := context.WithTimeout(context.Background(), 80*time.Millisecond)
	defer cancel()
	started := time.Now()
	_, err = stuck.Connect(ctx)
	require.Error(t, err)
	require.Less(t, time.Since(started), 2*time.Second)
	select {
	case <-entered:
	default:
		t.Fatal("upgrade request never reached server")
	}

	// Cancelling the dial context must not kill an established connection.
	ctx, cancel2 := context.WithCancel(context.Background())
	conn, err := ep.Connect(ctx)
	require.NoError(t, err)
	cancel2()
	defer conn.Close()
	require.NoError(t, conn.SetDeadline(time.Now().Add(time.Second)))
	_, err = conn.Write([]byte("still connected"))
	require.NoError(t, err)
	b := make([]byte, len("still connected"))
	_, err = io.ReadFull(conn, b)
	require.NoError(t, err)
	require.Equal(t, "still connected", string(b))
}

func TestWebsocketRejectsUntrustedTLS(t *testing.T) {
	srv := httptest.NewTLSServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
	defer srv.Close()
	ep := websocketTestEndpoint(t, srv.URL)
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	c, err := ep.Connect(ctx)
	if c != nil {
		c.Close()
	}
	require.Error(t, err)
}

func TestWebsocketTLSHandshakeTimeout(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	require.NoError(t, err)
	defer listener.Close()
	done := make(chan struct{})
	go func() {
		defer close(done)
		c, err := listener.Accept()
		if err != nil {
			return
		}
		defer c.Close()
		c.SetDeadline(time.Now().Add(2 * time.Second))
		io.Copy(io.Discard, c) // Accept ClientHello but never reply.
	}()
	ep := websocketTestEndpoint(t, "https://"+listener.Addr().String())
	ctx, cancel := context.WithTimeout(context.Background(), 80*time.Millisecond)
	defer cancel()
	start := time.Now()
	_, err = ep.Connect(ctx)
	require.Error(t, err)
	require.Less(t, time.Since(start), time.Second)
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("TLS connection leaked after timeout")
	}
}
