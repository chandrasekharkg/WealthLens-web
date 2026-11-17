# public-origin — the bridge learns the address the browser sees, so it can sit behind a TLS front

> **Status: implemented 2026-11-17 (spec promoted); the cut-over waits for the controller's window.** Raised by the home lab's mTLS move (kgc_home_agents controller): KG chose
> server-side TLS for dad's app, served by the existing Caddy front at `https://aipc.local:8444` and proxied to the
> bridge on `127.0.0.1:8765`. That front is live; today it answers 403. Decision: [ADR-0022](../../decisions/0022-public-origin-behind-a-tls-front.md).

## What happens today

The bridge believes its address is `http://<WLW_HOST>:<WLW_PORT>` — `create_app` hard-codes the scheme — and that
belief is what three things are measured against:

1. **The Host check** pins `WLW_HOST:WLW_PORT`. Behind the front, Safari's Host is `aipc.local:8444` (Caddy passes it
   through), so every request is refused with `reason: host` — the 403 the front shows today.
2. **The Origin check** allows only `http://…`. Even with the Host fixed, Safari sends `Origin:
   https://aipc.local:8444` on every POST, so import, rebuild, promote and settings would be refused with
   `reason: origin` while GET pages still load — a half-working app.
3. **Document opening** (`/api/collateral/open`) asks the OS to open the file when the *socket peer* is loopback,
   and streams the bytes otherwise. Behind a proxy the peer is ALWAYS `127.0.0.1` (Caddy), so dad's documents would
   open on AIPC's own screen and Safari would receive only a path.

## What changes

1. **`WLW_PUBLIC_ORIGIN`** — the scheme, name and port the BROWSER uses — is read by `serve.py` alongside
   `WLW_HOST`/`WLW_PORT`. When unset it is `http://<WLW_HOST>:<WLW_PORT>`, which is exactly today's address, so
   nothing changes for anyone until a launcher sets it. It is validated at start-up (`http` or `https`, a host,
   an optional port, nothing else); a malformed value refuses to start with a message saying what is wrong.
2. **The Host and Origin checks follow it.** The allowed Host is the public origin's host:port; the allowed Origin
   is the public origin itself. The bind address is unaffected — uvicorn still binds `WLW_HOST:WLW_PORT`.
3. **"Is this browser on the same machine?"** becomes: the socket peer is loopback **and** the public origin is a
   loopback address. When the app is published under a network name, a loopback peer can only be the front, so the
   file goes to the browser. Direct serving is unchanged by this rule (a LAN peer was already remote; a loopback peer
   of a loopback-published app is still local).
4. **The address the server prints, and the wrong-address page, name the public origin** — the one a person
   should type.

## Not in this change

The cut-over itself, in a window the controller names: dad's launcher sets
`WLW_PUBLIC_ORIGIN=https://aipc.local:8444` and binds `127.0.0.1` instead of `0.0.0.0`. Client certificates for dad
(KG: later). KG's loopback-only Mac app stays plain HTTP. CI and the e2e stay plain HTTP on loopback.

## Test plan (AGENTS §1)

All bridge pytest, through the real middleware and app (`create_app` + Starlette's test client):

| Assertion | Why pytest can hold it |
|---|---|
| With no public origin, Host `127.0.0.1:<port>` / Origin `http://…` behave exactly as before | the default path, unchanged |
| With `https://aipc.local:8444`: Host `aipc.local:8444` + Origin `https://aipc.local:8444` + token → accepted; Host `aipc.local:8765` → `host`; Origin `http://aipc.local:8444` → `origin` | the three checks are pure header logic |
| Malformed `WLW_PUBLIC_ORIGIN` (no scheme, `ftp://`, a path, credentials) → refuses to start, naming the problem | a pure parse function |
| Behind a named public origin, a loopback peer is NOT local (bytes stream); a loopback peer of a loopback-published app still is | `_peer_is_local` over a stub request |
