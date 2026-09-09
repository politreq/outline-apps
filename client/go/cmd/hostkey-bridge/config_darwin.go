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
	"encoding/base64"
	"errors"
	"io"
	"net"
	"net/http"
	"net/url"
	"os/exec"
	"strings"
	"syscall"
	"time"

	"github.com/gorilla/websocket"
	"gopkg.in/yaml.v3"
)

const hostkeyIP = "82.38.68.250"
const keychainProfile = "codex-vpn-profile:hostkey-us-vmnano-250-jazz"

type profile struct{ tcpURL, udpURL, cipher, secret string }

// Resolve the physical interface afresh for every dial. Never fall back to
// the system VPN route, a direct destination, or another server on failure.
func physicalDial(ctx context.Context, network, address string) (net.Conn, error) {
	iface, err := net.InterfaceByName("en0")
	if err != nil {
		return nil, errors.New("physical interface unavailable")
	}
	_, port, err := net.SplitHostPort(address)
	if err != nil {
		return nil, errors.New("invalid endpoint")
	}
	if port != "443" && port != "8443" {
		return nil, errors.New("unexpected Hostkey port")
	}
	d := net.Dialer{Timeout: 8 * time.Second, KeepAlive: 20 * time.Second, Control: func(_, _ string, raw syscall.RawConn) error {
		var e error
		if err := raw.Control(func(fd uintptr) {
			e = syscall.SetsockoptInt(int(fd), syscall.IPPROTO_IP, syscall.IP_BOUND_IF, iface.Index)
		}); err != nil {
			return err
		}
		return e
	}}
	return d.DialContext(ctx, "tcp4", net.JoinHostPort(hostkeyIP, port))
}

func endpointURL(raw string) (string, error) {
	u, err := url.Parse(raw)
	if err != nil || u.User != nil || u.Hostname() != hostkeyIP+".sslip.io" || (u.Port() != "8443" && u.Port() != "443") {
		return "", errors.New("unexpected endpoint in profile")
	}
	if u.Scheme != "https" && u.Scheme != "wss" {
		return "", errors.New("TLS endpoint required")
	}
	u.Scheme = "wss"
	return u.String(), nil
}

func loadProfile() (profile, error) {
	var p profile
	raw, err := exec.Command("/usr/bin/security", "find-generic-password", "-s", keychainProfile, "-w").Output()
	if err != nil {
		return p, errors.New("Hostkey profile unavailable in Keychain")
	}
	u, err := url.Parse(strings.TrimSpace(string(raw)))
	if err != nil || u.Scheme != "ssconf" || u.User != nil || u.Hostname() != hostkeyIP+".sslip.io" || u.Port() != "8443" {
		return p, errors.New("unexpected Hostkey profile")
	}
	u.Scheme = "https"
	u.Fragment = ""
	tr := &http.Transport{Proxy: nil, DialContext: physicalDial, TLSHandshakeTimeout: 8 * time.Second}
	defer tr.CloseIdleConnections()
	client := &http.Client{Transport: tr, Timeout: 15 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	response, err := client.Get(u.String())
	if err != nil {
		return p, errors.New("cannot fetch Hostkey configuration")
	}
	defer response.Body.Close()
	data, err := io.ReadAll(io.LimitReader(response.Body, 65537))
	if err != nil || response.StatusCode != 200 || len(data) > 65536 {
		return p, errors.New("invalid configuration response")
	}
	var root map[string]any
	if yaml.Unmarshal(data, &root) != nil {
		return p, errors.New("invalid configuration format")
	}
	if nested, ok := root["transport"].(map[string]any); ok {
		root = nested
	}
	if root["$type"] != "tcpudp" {
		return p, errors.New("unsupported transport")
	}
	var values [2]map[string]any
	for i, key := range []string{"tcp", "udp"} {
		m, ok := root[key].(map[string]any)
		if !ok || m["$type"] != "shadowsocks" {
			return p, errors.New("unsupported relay")
		}
		values[i] = m
		e, ok := m["endpoint"].(map[string]any)
		if !ok || e["$type"] != "websocket" {
			return p, errors.New("WebSocket endpoint required")
		}
		raw, _ := e["url"].(string)
		endpoint, err := endpointURL(raw)
		if err != nil {
			return p, err
		}
		if i == 0 {
			p.tcpURL = endpoint
		} else {
			p.udpURL = endpoint
		}
	}
	p.cipher, _ = values[0]["cipher"].(string)
	p.secret, _ = values[0]["secret"].(string)
	if p.cipher == "" || p.secret == "" || values[1]["cipher"] != p.cipher || values[1]["secret"] != p.secret {
		return p, errors.New("TCP/UDP credentials differ")
	}
	return p, nil
}

func (p profile) dial(ctx context.Context, udp bool) (*websocket.Conn, error) {
	raw := p.tcpURL
	if udp {
		raw = p.udpURL
	}
	d := websocket.Dialer{NetDialContext: physicalDial, HandshakeTimeout: 8 * time.Second}
	conn, response, err := d.DialContext(ctx, raw, nil)
	if response != nil && response.Body != nil {
		response.Body.Close()
	}
	if err != nil {
		return nil, errors.New("Hostkey WebSocket connection failed")
	}
	return conn, nil
}

func (p profile) accessKey(address string) string {
	credential := base64.RawURLEncoding.EncodeToString([]byte(p.cipher + ":" + p.secret))
	return "ss://" + credential + "@" + address + "/?outline=1#" + url.PathEscape("Hostkey — локальный мост (Mac)")
}
