# WealthLens-web — project context

WLW is the **presentation and aggregation** half of the WealthLens split: an open-source (MIT), local-first
web UI for setup, reports, and family-wide views over WealthLens-core (WLC) stores. WLC is the **data
custodian**; the boundary between the two is this project's first law.

## Non-negotiables that shape every design

- **WLW never writes a store; it feeds and drives WLC, which does.** Its write powers are exactly three
  (ADR-0005): deposit inputs (statement uploads into the inbox; passwords into WLC's own config, once,
  unlogged), run WLC's verbs as subprocesses of the real CLI (import/rebuild/verify/diagnose/fetch-* —
  every WLC gate applies unchanged), and nothing else. No parsing, no schema knowledge beyond `lens.py`,
  no direct store access. If a view needs data `lens.py` cannot answer, the fix is a `lens.py`
  contribution to WLC, never a direct store query here.
- **No database.** All financial state lives in WLC stores. WLW's only durable artifact is the **family
  manifest** (`family.toml`): entities, workspace paths, labels, presentation preferences. Anything that
  smells like a cache with a lifecycle is a design smell.
- **One store per entity, forever.** Family aggregation happens at **read time, in memory, per request**.
  No combined store, no materialized family view, no cross-entity rows. Every aggregated figure remains
  attributable to its entity ("whose is this?" must always be answerable) — this preserves WLC's
  federated-store semantics (WLC ADR-0008) and its per-entity encryption boundary.
- **Local-first, private by default.** Binds to 127.0.0.1; zero telemetry; no CDN assets, no external
  fonts, nothing leaves the machine. Serving beyond localhost (LAN / a family member's device) is a
  designed capability behind its own ADR **with authentication** — never a config flag on an unauthenticated
  server.
- **Keys never reach the browser.** Store decryption happens only in the bridge process, with the same
  workspace/key resolution WLC itself uses.
- **The bridge API is honest about provenance.** WLC's `basis` / staleness / footing signals flow through
  to the UI, never smoothed over. A family total whose parts have different bases says so.

## Layout

- `bridge/` — the read-only Python API over `lens.py` (per-entity access, aggregation, family.toml, the
  import trigger). Depends on `wealthlens` (WLC) as a library.
- `frontend/` — the SPA (stack per ADR-0003). Talks ONLY to the bridge.
- `family.example.toml` — the manifest format, documented by example.

## OpenSpec conventions

Same as WLC: governed behavior lands as an OpenSpec change first (`openspec/changes/<id>/…`), capability
specs live under `openspec/specs/<capability>/spec.md`, and architecturally significant choices are ADRs
under `openspec/decisions/` — options weighed, decision, consequences; decided ADRs are immutable and
superseded, never edited.

## Relationship to WLC (the integration contract)

WLW builds against WLC's **public read surface**: `lens.py`'s documented functions and the
`wealthlens import --json` CLI contract. It must not import WLC's private helpers or parsers. Where that
surface is insufficient, the gap is raised upstream — WLC's stable-API doctrine (EXTENDING.md) is the
mechanism, and getting `lens.py` formally onto WLC's semver-stable surface is an early cross-repo task.
