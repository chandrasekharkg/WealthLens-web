# ADR-0007 — The bridge is a FastAPI service over a reusable read layer

**Status:** ACCEPTED 2026-08-22

## Context

ADR-0004 fixed *what* the bridge is (thin, read-only, localhost-hardened, one import trigger) without
fixing *how* it is built. The seed prototype used stdlib `http.server`, which was right for a single-page
report and is wrong for what the use cases now demand:

- **Long-running verbs need streamed progress** (UC-C2: rebuild on a 131-file corpus runs for minutes).
  Hand-rolling SSE or chunked responses on `BaseHTTPRequestHandler` is where local tools accumulate bugs.
- **The API is a contract between two layers in one repo** (ADR-0003 chose TypeScript partly for this),
  and the contract can drift silently unless it is generated from one source.
- **The security posture is middleware-shaped.** Host, Origin and session-token checks (ADR-0004) belong
  in one enforced place with tests, not repeated per handler.
- **The honesty fields are a schema.** `basis`, as-of, freshness, footing, per-entity attribution — these
  are the payload's whole point, and typed models keep them from being quietly dropped.

## Decision

**FastAPI (with uvicorn) is the bridge framework**, structured in two layers:

```
bridge/wealthlens_web/
  core/        ← the reusable READ LAYER: workspace resolution, lens access, family aggregation,
                 freshness, the per-workspace job queue. Framework-free, unit-testable, no HTTP.
  api/         ← FastAPI: routes, Pydantic response models, middleware (Host/Origin/token), SSE
                 job streams, static serving of the built frontend.
```

The split matters more than the framework choice: **`core/` knows nothing about HTTP**, so a second
consumer (ADR-0008's MCP server, a CLI, a test harness) reuses it without inheriting a web server.

**Consequences that follow from FastAPI specifically:**
- OpenAPI is generated; the frontend's TypeScript types are generated from it, so contract drift becomes
  a build error rather than a broken dashboard.
- Pydantic models make the bridge-api spec's honesty fields structural.
- Middleware is the single enforcement point for ADR-0004's guards, with one test proving a cross-site
  POST is refused.
- Dependencies added: `fastapi`, `uvicorn`, `pydantic`. Accepted as a reviewed budget item — the bridge
  already depends on `wealthlens` (and therefore duckdb/pandas), so this is not a meaningful marginal
  audit burden, and it buys the four things above.

## How the bridge touches data (restating the boundary precisely)

- **Queries go through `lens.py`'s named functions**, never bespoke SQL against a store. `lens.sql()`
  exists as lens's own read-only escape hatch; using it is within the contract, but a view that needs it
  repeatedly is a signal that a named lens function is missing — which is a WLC contribution, not a
  bridge workaround (project.md's first non-negotiable).
- **Commands are subprocesses of the real CLI** (ADR-0005), serialized per workspace by `core/`'s job
  queue, with read handles for that workspace released for the verb's duration.

## Alternatives considered

- **Stay on stdlib `http.server`.** Zero new dependencies, but hand-rolled streaming, no schema, and
  security checks scattered across handlers. Rejected: the savings are one dependency; the cost is the
  three properties above.
- **Flask.** Comparable footprint, no first-class async/SSE story, no schema generation. Rejected for
  the same reasons in weaker form.
- **A desktop app shell (Electron/Tauri).** Solves nothing the browser does not, and adds a large
  runtime to a tool whose users are asked to trust it. Rejected.
