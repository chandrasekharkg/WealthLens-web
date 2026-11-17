# Tasks — public-origin

> Derived from proposal.md on 2026-11-17. Code, tests, docs and spec done 2026-11-17; cut over the same evening.

- [x] `public_origin()` in `serve.py`: `WLW_PUBLIC_ORIGIN`, default `http://<WLW_HOST>:<WLW_PORT>`; strict parse
      (http/https, host, optional port; no path, query, fragment or credentials); a bad value refuses to start
- [x] `create_app(..., origin=)`: the Host/Origin checks follow the public origin; the default is today's address
- [x] `_peer_is_local`: loopback peer AND loopback public origin
- [x] The printed address and the wrong-address page name the public origin
- [x] Bridge tests for each row of the proposal's test plan; all fail before, pass after
- [x] Docs: README / ARCHITECTURE mention `WLW_PUBLIC_ORIGIN`; ADR-0022 indexed
- [x] Cut-over 2026-11-17 21:42 IST (KG's go; the controller watched the front's log): dad's launcher sets
      `WLW_PUBLIC_ORIGIN=https://aipc.local:8444` and binds `127.0.0.1`; checked through the front (GET 200, a POST
      passes the guard, an `http://` Origin is refused, `:8765` unreachable from the LAN) and on dad's laptop
      (page, net worth and opening a statement)
- [x] Promote the spec delta into `openspec/specs/bridge-api/spec.md`
