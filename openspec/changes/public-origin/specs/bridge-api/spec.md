# Bridge API

## MODIFIED Requirements

### Requirement: Loopback by default; LAN serving is a trusted-LAN capability

The bridge SHALL bind loopback **by default**; SHALL reject requests whose `Host` header is not the **public**
host:port (the address the browser uses — `WLW_PUBLIC_ORIGIN`, which defaults to the bound
`http://<WLW_HOST>:<WLW_PORT>`); SHALL reject requests bearing an `Origin` other than the public origin; and
state-changing endpoints SHALL require a per-session token issued with the page. LAN serving beyond loopback is a
supported, **off-by-default** capability via the `WLW_HOST` configuration, permitted **only under a
trusted-home-LAN assumption** ([ADR-0020](../../../../decisions/0020-lan-serving-and-write-surface.md),
[ADR-0022](../../../../decisions/0022-public-origin-behind-a-tls-front.md)): there is **no per-user authentication**,
so any device on that LAN that can reach the host and load the page may view the presented workspaces. The bridge
MAY sit behind a TLS front on the same machine (the front terminates TLS and proxies to a loopback bind); it SHALL
then treat a loopback peer as remote unless the public origin is itself a loopback address. Serving beyond a trusted
home LAN SHALL wait for a further ADR that resolves authentication and per-entity viewer authorization.

#### Scenario: Cross-site POST from a browser tab
- **WHEN** an arbitrary webpage fires a POST at the bridge's import endpoint
- **THEN** it is rejected (foreign/absent Origin + missing token) and no subprocess runs

#### Scenario: DNS-rebinding read attempt
- **WHEN** a request arrives with a Host header naming an external domain resolved to 127.0.0.1
- **THEN** it is rejected before any store is opened

#### Scenario: Served behind a TLS front
- **WHEN** the public origin is `https://aipc.local:8444` and the bridge binds `127.0.0.1:8765`
- **THEN** a request with Host `aipc.local:8444`, Origin `https://aipc.local:8444` and the session token is
  accepted; Host `aipc.local:8765` is refused with `host`; Origin `http://aipc.local:8444` is refused with
  `origin`; and opening a document streams its bytes to the browser rather than opening it on the server
