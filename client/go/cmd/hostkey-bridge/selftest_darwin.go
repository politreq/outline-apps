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
	"crypto/rand"
	"encoding/binary"
	"fmt"
	"io"
	"net"
	"net/http"
	"strings"
	"time"

	"golang.getoutline.org/sdk/transport"
	"golang.getoutline.org/sdk/transport/shadowsocks"
)

func runSelfTest(ctx context.Context, p profile, address string, rounds int, interval time.Duration, output io.Writer) bool {
	key, err := shadowsocks.NewEncryptionKey(p.cipher, p.secret)
	if err != nil {
		fmt.Fprintln(output, "unsupported cipher")
		return false
	}
	sd, err := shadowsocks.NewStreamDialer(&transport.TCPEndpoint{Address: address}, key)
	if err != nil {
		return false
	}
	pl, err := shadowsocks.NewPacketListener(transport.UDPEndpoint{Address: address}, key)
	if err != nil {
		return false
	}
	tr := &http.Transport{Proxy: nil, DisableKeepAlives: true, TLSHandshakeTimeout: 10 * time.Second, DialContext: func(ctx context.Context, _, a string) (net.Conn, error) { return sd.DialStream(ctx, a) }}
	defer tr.CloseIdleConnections()
	client := &http.Client{Transport: tr, Timeout: 18 * time.Second}
	passed, total := 0, 0
	var udpConn net.PacketConn
	defer func() {
		if udpConn != nil {
			udpConn.Close()
		}
	}()
	for round := 1; round <= rounds; round++ {
		for i, target := range []string{"https://1.1.1.1/cdn-cgi/trace", "https://example.com/", "https://www.apple.com/library/test/success.html"} {
			start := time.Now()
			req, _ := http.NewRequestWithContext(ctx, http.MethodGet, target, nil)
			response, e := client.Do(req)
			ok := false
			if e == nil {
				body, re := io.ReadAll(io.LimitReader(response.Body, 65536))
				response.Body.Close()
				ok = re == nil && response.StatusCode == 200
				if i == 0 {
					ok = ok && strings.Contains(string(body), "ip="+hostkeyIP+"\n")
				}
			}
			total++
			if ok {
				passed++
			}
			fmt.Fprintf(output, "round=%d https_target=%d ok=%t seconds=%.2f\n", round, i, ok, time.Since(start).Seconds())
		}
		if udpConn == nil {
			udpConn, _ = pl.ListenPacket(ctx)
		}
		ok := udpConn != nil && bridgeDNSConn(udpConn)
		if !ok && udpConn != nil {
			udpConn.Close()
			udpConn = nil
		}
		total++
		if ok {
			passed++
		}
		fmt.Fprintf(output, "round=%d udp_dns=%t\n", round, ok)
		if ctx.Err() != nil {
			return false
		}
		if round < rounds {
			select {
			case <-ctx.Done():
				return false
			case <-time.After(interval):
			}
		}
	}
	fmt.Fprintf(output, "SUMMARY passed=%d total=%d\n", passed, total)
	return passed == total
}

func bridgeDNSConn(c net.PacketConn) bool {
	c.SetDeadline(time.Now().Add(10 * time.Second))
	q := []byte{0x6a, 0x19, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 7, 'e', 'x', 'a', 'm', 'p', 'l', 'e', 3, 'c', 'o', 'm', 0, 0, 1, 0, 1}
	if _, err := rand.Read(q[:2]); err != nil {
		return false
	}
	if _, err := c.WriteTo(q, &net.UDPAddr{IP: net.ParseIP("1.1.1.1"), Port: 53}); err != nil {
		return false
	}
	r := make([]byte, 4096)
	n, from, err := c.ReadFrom(r)
	return err == nil && from.String() == "1.1.1.1:53" && n >= 12 && r[0] == q[0] && r[1] == q[1] && r[2]&0x80 != 0 && r[3]&15 == 0 && binary.BigEndian.Uint16(r[6:8]) > 0
}
