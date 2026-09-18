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

package tlscompat

import (
	"crypto/tls"
	"crypto/x509"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestConfigKeepsVerificationAndClassicalTLS(t *testing.T) {
	c := Config()
	require.False(t, c.InsecureSkipVerify)
	require.Equal(t, uint16(tls.VersionTLS12), c.MinVersion)
	require.Zero(t, c.MaxVersion) // TLS 1.3 remains available.
	require.Equal(t, []tls.CurveID{tls.X25519, tls.CurveP256, tls.CurveP384, tls.CurveP521}, c.CurvePreferences)
	c.CurvePreferences[0] = 0
	require.Equal(t, tls.X25519, Config().CurvePreferences[0])
}

func TestTLS13AndCertificateVerification(t *testing.T) {
	hello := make(chan []tls.CurveID, 4)
	srv := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.TLS.Version != tls.VersionTLS13 {
			t.Errorf("TLS version = %x", r.TLS.Version)
		}
		w.Write([]byte("ok"))
	}))
	srv.TLS = &tls.Config{MinVersion: tls.VersionTLS13, GetConfigForClient: func(h *tls.ClientHelloInfo) (*tls.Config, error) {
		hello <- append([]tls.CurveID(nil), h.SupportedCurves...)
		return nil, nil
	}}
	srv.StartTLS()
	defer srv.Close()
	c := Config()
	c.RootCAs = x509.NewCertPool()
	c.RootCAs.AddCert(srv.Certificate())
	tr := &http.Transport{TLSClientConfig: c}
	defer tr.CloseIdleConnections()
	resp, err := (&http.Client{Transport: tr}).Get(srv.URL)
	require.NoError(t, err)
	defer resp.Body.Close()
	b, err := io.ReadAll(resp.Body)
	require.NoError(t, err)
	require.Equal(t, "ok", string(b))
	require.Equal(t, Config().CurvePreferences, <-hello)

	untrusted := &http.Transport{TLSClientConfig: Config()}
	defer untrusted.CloseIdleConnections()
	_, err = (&http.Client{Transport: untrusted}).Get(srv.URL)
	require.Error(t, err)
	<-hello

	wrongHost := Config()
	wrongHost.RootCAs = c.RootCAs
	wrongHost.ServerName = "wrong.invalid"
	wrong := &http.Transport{TLSClientConfig: wrongHost}
	defer wrong.CloseIdleConnections()
	_, err = (&http.Client{Transport: wrong}).Get(srv.URL)
	require.Error(t, err)
}
