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
	"context"
	"encoding/hex"
	"io"
	"net/netip"
	"sync/atomic"
	"testing"
	"time"

	"golang.getoutline.org/sdk/network/lwip2transport"
	"golang.getoutline.org/sdk/network/packetrelay"
	"golang.getoutline.org/sdk/transport"
)

type unusedDialer struct{}

func (unusedDialer) DialStream(context.Context, string) (transport.StreamConn, error) {
	return nil, io.ErrUnexpectedEOF
}

// Exercise the real lwIP input path, not just the queue. No interfaces,
// routes, remote connections or system VPN changes are used by this test.
func TestQueuedRelayRealStackContinuesDuringStalledSend(t *testing.T) {
	first := make(chan struct{})
	stalled := make(chan struct{})
	f := &fakeAssociation{done: make(chan struct{})}
	var calls atomic.Int32
	f.send = func([]byte, netip.AddrPort) error {
		if calls.Add(1) == 1 {
			close(first)
			return nil
		}
		select {
		case <-stalled:
		default:
			close(stalled)
		}
		<-f.done
		return io.EOF
	}
	r := newQueuedPacketRelay(fakeRelay{func() (packetrelay.PacketSender, packetrelay.PacketReceiver, error) { return f, f, nil }}, time.Second)
	dev, err := lwip2transport.ConfigureDeviceWithRelay(unusedDialer{}, r)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { r.close(); dev.Close() }()
	packet, err := hex.DecodeString("45b8004c72e94000401125a2646a4100d8ef2304007b007b0038a1a7230209e8000003620000072ed8ef230ce10ff888c730e992e10ffbdbc742a583e10ffbdbcaa4151ae10ffde6c3cf01e3")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = dev.Write(packet); err != nil {
		t.Fatal(err)
	}
	waitFor(t, first)
	if _, err = dev.Write(packet); err != nil {
		t.Fatal(err)
	}
	waitFor(t, stalled)
	// With a synchronous relay this next Write waits for the stalled send,
	// holding up all further packet input. With the guard it just enqueues.
	finished := make(chan struct{})
	go func() { _, _ = dev.Write(append([]byte(nil), packet...)); close(finished) }()
	select {
	case <-finished:
	case <-time.After(150 * time.Millisecond):
		t.Fatal("lwIP packet input blocked behind UDP transport")
	}
}
