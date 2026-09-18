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

// Package tlscompat configures the TLS connections used to reach VPN servers.
package tlscompat

import "crypto/tls"

// Config returns a fresh configuration with classical key exchanges. Hybrid
// ML-KEM ClientHellos can stall on paths that mishandle larger TLS records.
// Keep TLS 1.3 and certificate/hostname verification enabled; do not change
// process-wide GODEBUG or weaken the TLS used by unrelated connections.
func Config() *tls.Config {
	return &tls.Config{
		MinVersion:       tls.VersionTLS12,
		CurvePreferences: []tls.CurveID{tls.X25519, tls.CurveP256, tls.CurveP384, tls.CurveP521},
	}
}
