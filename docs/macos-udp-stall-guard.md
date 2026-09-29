# Mac UDP stall guard: implementation and rollout gate

## What changes

On macOS / Mac Catalyst, an outbound UDP transport send no longer runs on
the lwIP packet-input callback. Each association has one worker and a bounded
queue (64 packets, 64 KiB queued payload, plus at most one in-flight payload).
Full queues drop UDP packets rather than blocking TCP and DNS input. Payloads
are copied before returning to lwIP. Order is preserved for accepted packets.

A send taking over five seconds closes its association. A send error, end of
the receiver, or device shutdown also closes it. Device shutdown closes the
guard before closing lwIP. Underlying PacketSender.Close must interrupt its
transport's blocked operations; this wrapper cannot force an arbitrary broken
implementation to do so. There is no new goroutine per arriving datagram.

The integration is limited to `darwin` and `maccatalyst`. Android, Linux,
Windows and regular iOS builds retain the existing relay. No keys, server
configuration, system routes, VPN settings or installed applications change.

## Evidence and limits

go-tun2socks v1.16.11 invokes the connected UDP handler synchronously while
holding its global lwIP mutex. The SDK relay then calls PacketSender.SendPacket
synchronously. An isolated reproduction confirmed that stalling that send
stops unrelated input and lwIP timers. This patch addresses that mechanism.

Local Mac incidents showed stalled packet processing while direct internet
and Hostkey remained available. However, stripped application stacks did not
identify the precise goroutine or transport operation. This is a tested
mitigation candidate, not proof that all reported outages share this cause.
It does not add automatic VPN reconnect or a continuous tunnel health check.

## Validation

- Unit fault-injection: stalled sender, timeout, concurrent send/close,
  bounded backlog, payload copy, ordering, send error, creation/shutdown race,
  read/write cancellation, isolation of independent associations.
- Real lwip2transport integration: subsequent IP packet input continues while
  the underlying UDP sender is stalled. No TUN or remote connections needed.
- Run `go test -race -count=10 -timeout 90s ./client/go/outline/vpn`.
- Run `go test -race -tags maccatalyst -count=10 -timeout 90s ./client/go/outline/vpn`.
- Run `go test -race -timeout 120s ./client/go/outline/...` and
  `go vet ./client/go/outline/vpn`.

## NOT ready to claim installed / production-stable

The local machine has Command Line Tools only, no complete Xcode, and
`security find-identity -v -p codesigning` reports zero valid identities.
Building, signing and installing a working Mac VPN extension is blocked.
The App Store Outline application has not been modified.

Before shipping:

1. Configure full Xcode and the owner's Apple signing/provisioning setup for
   the app and Network Extension, with their own bundle identifiers.
2. Build a distinctly versioned signed diagnostic Mac application following
   `client/src/cordova/apple/README.md`; validate entitlements and signature.
3. Obtain a safe test window before switching the owner's system VPN. Keep
   a working fallback and a way to communicate without this test tunnel.
4. Test UDP DNS, sustained TCP transfers, WebRTC, send failure, timeout,
   sleep/wake, Wi-Fi change, repeated disconnect/reconnect and a long run
   exceeding the previously observed outage windows. Check memory and worker
   cleanup. Verify the 5-second timeout does not cause unacceptable loss.
5. Review the change before merging/releasing. If outages persist, collect
   symbolized Go stacks and bounded operation timings; do not label all
   failures as this one bug or weaken TLS/OS security as a workaround.

Do not disable sleep, restart production services, change access keys or
periodically reconnect the owner's VPN as a substitute for the rollout gate.
