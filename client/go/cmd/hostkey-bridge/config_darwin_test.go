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
	"golang.getoutline.org/sdk/transport"
	"localhost/client/go/outline/configregistry"
	"testing"
)

func TestEndpointRestrictions(t *testing.T) {
	for _, u := range []string{"http://82.38.68.250.sslip.io:8443/path", "wss://other.example:8443/path", "wss://82.38.68.250.sslip.io.evil:8443/path", "wss://user:pass@82.38.68.250.sslip.io:8443/path", "wss://82.38.68.250.sslip.io:9999/path"} {
		if _, e := endpointURL(u); e == nil {
			t.Fatalf("unsafe endpoint accepted: %s", u)
		}
	}
	if _, e := endpointURL("https://82.38.68.250.sslip.io:8443/test"); e != nil {
		t.Fatal(e)
	}
}

func TestAccessKeyAcceptedByOutlineParser(t *testing.T) {
	p := profile{cipher: "chacha20-ietf-poly1305", secret: "test-only-not-a-real-key"}
	parser := configregistry.NewDefaultTransportProvider(&transport.TCPDialer{}, &transport.UDPDialer{})
	pair, err := parser.Parse(context.Background(), p.accessKey("127.0.0.1:17843"))
	if err != nil {
		t.Fatal(err)
	}
	if pair.StreamDialer.FirstHop != "127.0.0.1:17843" {
		t.Fatal("unexpected first hop")
	}
}
