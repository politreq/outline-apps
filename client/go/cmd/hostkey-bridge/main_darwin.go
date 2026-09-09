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
	"flag"
	"fmt"
	"io"
	"net"
	"os"
	"os/exec"
	"os/signal"
	"strings"
	"syscall"
	"time"
)

func main() {
	address := flag.String("listen", "127.0.0.1:17843", "loopback TCP/UDP address")
	copyKey := flag.Bool("copy-profile", false, "copy matching profile to macOS clipboard; does not connect VPN")
	selfTest := flag.Bool("self-test", false, "test an ephemeral local bridge through Hostkey; no VPN changes")
	testRunning := flag.Bool("test-running", false, "test the already running loopback bridge; no VPN changes")
	rounds := flag.Int("rounds", 3, "self-test rounds")
	interval := flag.Duration("interval", 5*time.Second, "delay between self-test rounds")
	reportPath := flag.String("report", "", "write synthetic test results to a NEW private file")
	flag.Parse()
	var output io.Writer = os.Stdout
	if *reportPath != "" {
		if !*selfTest && !*testRunning {
			fmt.Fprintln(os.Stderr, "report requires test mode")
			os.Exit(1)
		}
		f, err := os.OpenFile(*reportPath, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
		if err != nil {
			fmt.Fprintln(os.Stderr, "cannot create private report")
			os.Exit(1)
		}
		defer f.Close()
		output = io.MultiWriter(os.Stdout, f)
	}
	a, e := net.ResolveTCPAddr("tcp4", *address)
	if e != nil || !a.IP.Equal(net.IPv4(127, 0, 0, 1)) || a.Port == 0 {
		fmt.Fprintln(os.Stderr, "invalid loopback address")
		os.Exit(1)
	}
	if *rounds < 1 || *rounds > 240 || *interval < 0 || *interval > time.Minute {
		fmt.Fprintln(os.Stderr, "invalid self-test limits")
		os.Exit(1)
	}
	p, err := loadProfile()
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	if *copyKey {
		a, e := net.ResolveTCPAddr("tcp4", *address)
		if e != nil || !a.IP.Equal(net.IPv4(127, 0, 0, 1)) || a.Port == 0 {
			fmt.Fprintln(os.Stderr, "invalid loopback address")
			os.Exit(1)
		}
		cmd := exec.Command("/usr/bin/pbcopy")
		cmd.Stdin = strings.NewReader(p.accessKey(*address))
		if cmd.Run() != nil {
			fmt.Fprintln(os.Stderr, "clipboard unavailable")
			os.Exit(1)
		}
		fmt.Println("Hostkey local bridge profile copied. VPN not switched.")
		return
	}
	ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer cancel()
	if *testRunning {
		if !runSelfTest(ctx, p, *address, *rounds, *interval, output) {
			os.Exit(1)
		}
		return
	}
	if *selfTest {
		*address = "127.0.0.1:0"
	}
	b, err := startBridge(ctx, *address, p.dial)
	if err != nil {
		fmt.Fprintln(os.Stderr, "cannot open loopback bridge:", err)
		os.Exit(1)
	}
	if *selfTest {
		ok := runSelfTest(ctx, p, b.tcp.Addr().String(), *rounds, *interval, output)
		b.close()
		if !ok {
			os.Exit(1)
		}
		return
	}
	fmt.Printf("Hostkey bridge ready: %s TCP+UDP; physical=en0; VPN untouched\n", b.tcp.Addr())
	ticker := time.NewTicker(time.Minute)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			b.close()
			return
		case <-ticker.C:
			fmt.Printf("counters tcp=%d udp=%d queue_drops=%d upstream_failures=%d\n", b.tcpCount.Load(), b.udpCount.Load(), b.drops.Load(), b.failures.Load())
		}
	}
}
