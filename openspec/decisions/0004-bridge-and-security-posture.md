# ADR-0004 — The bridge: a thin read-only Python API, and a phased security posture

**Status:** ACCEPTED 2026-08-22 (phase 1); phase 2 requires its own superseding ADR before any code ·
**SUPERSEDED on the LAN / phase-2 question by [ADR-0020](0020-lan-serving-and-write-surface.md) (2026-09-04)** —
LAN serving via `WLW_HOST` shipped; ADR-0020 records the as-built trusted-LAN posture. The phase-1 controls
below (loopback default, Host/Origin guard, session token, no store writes) still stand.

## Context

The stores are encrypted DuckDB files. A browser cannot (and must not) hold their keys — duckdb-wasm-style
in-browser access would move decryption into the least controllable runtime on the machine. So something
server-side must sit between the SPA and the stores. Meanwhile the first real deployment question is
already visible in the founding use case: one person sets it up, and a spouse wants to *view* — possibly
from another device.

A contributor's prototype (WLC PR #1's report server) proved the shape works and surfaced the first
security lesson: **binding to 127.0.0.1 does not stop a malicious webpage in the local browser from firing
cross-site requests at localhost.** A fire-and-forget POST needs no CORS read permission.

## Decision

**The bridge** (`bridge/`) is a thin Python service that:

- resolves workspaces and keys exactly as WLC does, opens every store **read-only**;
- exposes `lens.py` answers per entity and family-aggregated (family-aggregation spec) as JSON;
- owns `family.toml` (read + guided edit — the setup spec's write surface);
- offers exactly one side-effecting endpoint: trigger `wealthlens import --json` as a subprocess against
  one named workspace (stdin closed, timeout, list-args — no shell);
- serves the built frontend, so the whole app is one process on one port.

**Phase 1 (now): localhost-only, CSRF-hardened.**
- Bind 127.0.0.1 only. Refuse requests whose `Host` is not the bound address:port (DNS-rebinding guard) and
  whose `Origin`, when present, is not the app's own origin (CSRF guard). State-changing endpoints
  additionally require a per-session token the SPA obtains at page load.
- No authentication *user model* — phase 1's boundary is "whoever can run processes on this machine",
  identical to WLC's own CLI boundary.

**Phase 2 (LAN / family devices): DOES NOT EXIST until an ADR supersedes this one.** The moment the bind
leaves loopback, "who is asking" becomes a real question; that ADR must decide authentication, transport
(TLS on a LAN), and per-entity authorization (does a viewer see every family member's data, or their own?
— the manifest will need a viewer model). No `--host 0.0.0.0` flag ships before it.

## Consequences

- Keys and financial data stay in one process with a two-header + token guard; the browser holds numbers
  only for the page it is showing.
- The spouse-on-another-device story is explicitly deferred, not accidentally shipped unauthenticated.
- The bridge depends on WLC as a library; its tested-against WLC version is pinned and stated.
