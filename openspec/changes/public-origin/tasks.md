# Tasks — public-origin

> Derived from proposal.md on 2026-11-17.

- [ ] `public_origin()` in `serve.py`: `WLW_PUBLIC_ORIGIN`, default `http://<WLW_HOST>:<WLW_PORT>`; strict parse
      (http/https, host, optional port; no path, query, fragment or credentials); a bad value refuses to start
- [ ] `create_app(..., origin=)`: the Host/Origin checks follow the public origin; the default is today's address
- [ ] `_peer_is_local`: loopback peer AND loopback public origin
- [ ] The printed address and the wrong-address page name the public origin
- [ ] Bridge tests for each row of the proposal's test plan; all fail before, pass after
- [ ] Docs: README / ARCHITECTURE mention `WLW_PUBLIC_ORIGIN`; ADR-0022 indexed
- [ ] Cut-over (controller's window, NOT this change): dad's launcher sets `WLW_PUBLIC_ORIGIN` and binds `127.0.0.1`
- [ ] Promote the spec delta into `openspec/specs/bridge-api/spec.md`
