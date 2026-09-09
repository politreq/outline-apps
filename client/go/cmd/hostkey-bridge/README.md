# Hostkey local bridge for the installed macOS Outline client

Experimental local workaround, not a replacement/signed build of Outline.
The installed official client connects using a static Shadowsocks key to
127.0.0.1:17843. This helper forwards the **already encrypted** Shadowsocks
stream/datagrams over the existing Hostkey HTTPS/WebSocket endpoints.
TCP and UDP are retained; payloads are not decrypted, inspected or logged.

This moves WebSocket I/O outside the Network Extension process without an
Apple Developer account. It may bypass transport-related stalls there, but
does not fix every possible lwIP/NetworkExtension bug or a failing server.
Long-term stability in the actual installed Outline client is not yet proven.

## Scope and safety

- macOS only (`darwin && !ios`), no NetworkExtension entitlement needed.
- Listens only on IPv4 loopback; rejects non-loopback listen addresses.
- Outer sockets use IP_BOUND_IF on en0, never the system VPN route. If en0
  is unavailable there is no fallback that leaks traffic directly.
- Uses the existing Hostkey 82.38.68.250 profile on port 8443, loaded from
  Keychain service `codex-vpn-profile:hostkey-us-vmnano-250-jazz`.
- Download and WebSocket hosts/ports are validated, TLS verification stays
  enabled, redirects are refused, configuration size is bounded.
- No server/key changes and no system VPN start/stop operations.
- Does not cache access keys/configuration in plaintext. `--copy-profile`
  writes the generated local profile only to the user's clipboard.
- The local profile is usable **only on the Mac running this helper**.
- Bound concurrency: 128 TCP streams, 64 UDP peers; UDP backlog 8 datagrams
  per peer (up to 65535 bytes each). Drops on backpressure. Local OS UDP
  datagram limits also apply; tests cover up to 8000-byte datagrams on macOS.
- Each flow gets a separate upstream connection. Dial/write deadlines,
  TCP WebSocket ping/pong and UDP idle cleanup bound failures independently.
- No transparent replay of an interrupted TCP stream. Applications must
  reconnect; lossless recovery of arbitrary TCP sessions is not promised.
- Counters are operational hints, not exhaustive accounting of every close.

The unauthenticated loopback forwarder still requires valid Shadowsocks
encryption for traffic to be accepted by Hostkey. It is not a public proxy.
Other local processes can reach loopback, so avoid exposing the listener or
reusing this as a general multi-user gateway.

## Build and test

From repository root:

```sh
go test -race -count=10 -timeout 90s ./client/go/cmd/hostkey-bridge
go vet ./client/go/cmd/hostkey-bridge
go build -trimpath -o /tmp/hostkey-bridge ./client/go/cmd/hostkey-bridge
/tmp/hostkey-bridge --self-test --rounds 3
```

Unit tests use local mock WebSocket endpoints: stream-byte integrity,
datagram boundaries, queue limits, cancellation during stalled dials,
recovery on a fresh connection after a failed dial, loopback-only binding,
remote endpoint validation and import through Outline's actual config parser.
Test endpoints may use plain WS locally; production accepts TLS endpoints only.

Self-tests create an ephemeral local bridge and make synthetic HTTPS requests
plus UDP DNS queries via official Outline SDK Shadowsocks clients. The
Cloudflare trace must show the Hostkey exit IP. They do not switch the system
VPN. `--test-running` instead exercises the listener already on port 17843.
UDP uses one association across rounds, reopening it if a probe fails.
Repeated HTTPS requests use fresh streams; this is not a long-lived TCP test.

```sh
/tmp/hostkey-bridge --listen 127.0.0.1:17843
# In another terminal, after the listener is ready:
/tmp/hostkey-bridge --test-running --rounds 3
/tmp/hostkey-bridge --copy-profile
```

Add the copied key in Outline, then connect **manually in an agreed safe test
window**. Keep the old profile / Happ available. Do not import this local key
on a phone. The helper must remain running while its profile is used.

For a bounded longer synthetic test (about 50 minutes), writing a new private
report without overwriting an existing file:

```sh
/tmp/hostkey-bridge --test-running --rounds 90 --interval 30s --report /tmp/hostkey-soak-results.txt
```

## Local installation performed 2026-09-09

Binary and manual start/stop/copy/test commands:
`/Users/artem/Library/Application Support/HostkeyBridge`.
User LaunchAgent: `local.hostkey-bridge`; starts at login, restarts on exit
with a 30-second throttle. It does not activate any VPN profile.
Private logs: `/Users/artem/Library/Logs/HostkeyBridge`.

Verification before user handoff:
- 10 repeated race-enabled unit suites passed.
- Initial end-to-end series: 48/48 HTTPS/DNS checks, race-enabled helper.
- Installed service: 12/12 HTTPS/DNS checks.
- Listeners verified as 127.0.0.1 TCP/UDP only; working Happ left connected.
- A longer synthetic run was started; completion must be verified from the
  report, not inferred from these short checks.

Still required: manual import and actual Outline test, longer sessions,
sleep/wake, Wi-Fi changes, WebRTC calls, and observing memory over time.
Do not report all outages fixed before those checks.
