# ADR-0022 — The bridge knows its public origin, so a TLS front can sit in front of it

**Status:** ACCEPTED 2026-11-17 · **Supersedes [ADR-0020](0020-lan-serving-and-write-surface.md)** on one point:
"Host must be the bound address" becomes "Host must be the *public* address". Everything else in ADR-0020 —
the trusted-LAN boundary, no per-user authentication, the closed write surface — stands.

## Context

The home lab is moving to TLS (kgc_home_agents controller, 2026-11-17). For dad's app KG chose **server-side TLS
only**: the machine's existing Caddy front terminates TLS at `https://aipc.local:8444`, with the home certificate
authority's server certificate, and proxies to the bridge, which will bind `127.0.0.1:8765`. Dad's Safari trusts
the home root once; there's no client certificate, because 7-day certificates would lapse weekly on a device he
can't renew. Client-certificate mTLS is deferred.

ADR-0020's controls were written for a bridge reached directly. Three of its assumptions break behind a front:

- **Host:** the Host check pins the *bound* address, but the browser's Host is now the front's.
- **Origin:** the Origin check hard-codes `http://`, but the browser now sends `https://`.
- **Peer address:** the collateral `open` routes on the socket's peer address, but every peer is now the front
  on loopback.

## Decision

1. **The bridge has a public origin**, `WLW_PUBLIC_ORIGIN`: the scheme, name and port a person types. It defaults
   to the bound `http://<WLW_HOST>:<WLW_PORT>`, so an unset value is today's behaviour exactly. It's parsed strictly
   at start-up, and a malformed value refuses to start rather than serving with a guess.
2. **The Host and Origin checks pin the public origin.** The DNS-rebinding and cross-site defences are unchanged in
   kind; they now name the address the browser actually uses. The bind address remains a separate setting, and the
   launcher keeps it on loopback when a front is in use.
3. **A loopback peer is "this machine" only when the public origin is a loopback address.** When the bridge is
   published under a network name, a loopback peer is the front, and the bytes go to the browser. That's ADR-0020's
   "file-stream for a remote peer" applied to a proxied one. It's also the safer failure: a misjudged local peer
   opens a file on a screen nobody is looking at.
4. **The front is trusted only by being on the same machine.** The bridge trusts no forwarded header
   (`X-Forwarded-*`); it doesn't need the browser's real address, only to know it isn't local.

## Consequences

- **A cut-over is a launcher change and a restart,** with no code change: set `WLW_PUBLIC_ORIGIN`, bind loopback.
  Rolling back is unsetting it and binding as before.
- **Today's deployments are unaffected:** KG's loopback app, dad's direct LAN app until the window, and CI/e2e.
- **Reachability:** with a front, the bridge's own port is reachable only from the machine itself; the front is
  the only way in from the LAN.
- **Still open:** per-user authentication and client certificates, as ADR-0020 listed. TLS no longer sits on that
  list for the front-served case.
