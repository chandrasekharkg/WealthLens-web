# ARCHITECTURE.md — why WealthLens-web is built this way

**Read this first** (~2 minutes). WLW is the presenter/aggregator half of the WealthLens split; the
custodian half is [WealthLens-core](https://github.com/chandrasekharkg/WealthLens-core). The whole design
follows from one sentence:

> **WLC owns the truth; WLW shows it.** WLW is a stateless, read-only, local-first window over per-entity
> WLC stores — plus one manifest file naming the family.

```
  family.toml            bridge/ (Python, FastAPI)           frontend/ (React+Vite+TS)
  ───────────            ─────────────────────────           ─────────────────────────
  entities + paths  ──►  core/  workspaces · lens access ──►  setup · workspaces · family
  labels, prefs                 aggregation · freshness       reports · operations
  (no secrets,                  per-workspace job queue       (talks only to the bridge)
   no data)                     (framework-free, reusable)
                         api/   typed routes · SSE progress
                                Host/Origin/token guards
                                serves the built SPA
                         └─ verbs = subprocesses of the real WLC CLI
                            (import · rebuild · verify · diagnose · fetch-*)
                         mcp/   future, ADR-0008 — second consumer of core/, off by default
```

## Five load-bearing principles

1. **Custodian/presenter split** — separate repo, API boundary, no store writes, no parsing.
   → [ADR-0001](openspec/decisions/0001-custodian-presenter-split.md)
2. **No database** — stores + `family.toml` + ephemeral UI state; restart-surviving caches are prohibited.
   → [ADR-0002](openspec/decisions/0002-no-database.md)
3. **One store per entity, aggregation at read time** — family views compose in memory and every figure
   stays attributable; WLC's federation semantics (its ADR-0008) are the foundation.
   → [family-aggregation](openspec/specs/family-aggregation/spec.md)
4. **Keys never reach the browser; localhost hardened; LAN is ADR-gated** — Host/Origin checks + session
   token now; any bind beyond loopback requires the phase-2 ADR with a real auth model.
   → [ADR-0004](openspec/decisions/0004-bridge-and-security-posture.md) ·
   [bridge-api](openspec/specs/bridge-api/spec.md) ·
  [export-and-print](openspec/specs/export-and-print/spec.md) ·
  [identity-and-settings](openspec/specs/identity-and-settings/spec.md)
5. **Testability is architecture** — components are dumb, logic is pure functions, browser tests are
   capped at a handful of guard flows. A conservative tool that is easy to enhance beats a
   feature-rich one nobody can maintain. → [ADR-0010](openspec/decisions/0010-testability-first.md)
6. **Extensions are data, not code in the UI** — a Python module plus a declarative page manifest,
   rendered by the shipped components, visibly marked as user-supplied.
   → [ADR-0011](openspec/decisions/0011-extension-model.md)
7. **Honesty flows through** — basis, as-of, footing and import warnings render in the UI; polish never
   exceeds the data's honesty. → [report-views](openspec/specs/report-views/spec.md)

## The design index

- **Build plan (what we build, in what order)** — [openspec/BUILD-PLAN.md](openspec/BUILD-PLAN.md)
- **UX validation findings (11 open questions)** — [openspec/UX-VALIDATION.md](openspec/UX-VALIDATION.md)
- Use cases (the design source) — [openspec/USE-CASES.md](openspec/USE-CASES.md)
- UX first pass (IA + screens + flows) — [openspec/UX.md](openspec/UX.md)
- Governance & non-negotiables — [openspec/project.md](openspec/project.md)
- ADRs — [0001 split](openspec/decisions/0001-custodian-presenter-split.md) ·
  [0002 no-database](openspec/decisions/0002-no-database.md) ·
  [0003 frontend stack](openspec/decisions/0003-frontend-stack.md) ·
  [0004 bridge & security](openspec/decisions/0004-bridge-and-security-posture.md) ·
  [0005 operations surface](openspec/decisions/0005-operations-surface.md) ·
  [0006 v1 product decisions](openspec/decisions/0006-v1-product-decisions.md) ·
  [0007 bridge = FastAPI over a reusable core](openspec/decisions/0007-bridge-framework-fastapi.md) ·
  [0008 MCP exposure (designed, deferred, gated)](openspec/decisions/0008-mcp-exposure.md) ·
  [0009 distribution: native first, container phased](openspec/decisions/0009-distribution-and-deployment.md) ·
  [0010 testability first](openspec/decisions/0010-testability-first.md) ·
  [0011 extension model](openspec/decisions/0011-extension-model.md) ·
  [0012 evolution](openspec/decisions/0012-evolution.md) ·
  [0013 egress: export & print](openspec/decisions/0013-egress.md) ·
  [0014 installation & launch](openspec/decisions/0014-installation-and-launch.md) ·
  [0015 store-key custody](openspec/decisions/0015-store-key-custody.md)
- Capability specs — [cold-start](openspec/specs/cold-start/spec.md) ·
  [family-aggregation](openspec/specs/family-aggregation/spec.md) ·
  [setup-and-config](openspec/specs/setup-and-config/spec.md) ·
  [report-views](openspec/specs/report-views/spec.md) ·
  [manual-facts](openspec/specs/manual-facts/spec.md) ·
  [data-conventions](openspec/specs/data-conventions/spec.md) ·
  [collateral-and-sources](openspec/specs/collateral-and-sources/spec.md) ·
  [bridge-api](openspec/specs/bridge-api/spec.md)
- Manifest format — [family.example.toml](family.example.toml)

## Keep the docs current — the loop

Same rule as WLC: **a change that ships code but not its docs is not done.** Governed behavior lands as an
OpenSpec change first; significant choices become ADRs (immutable once decided — supersede, never edit).

## Cross-repo tasks (tracked here until they land)

- [ ] WLC: promote `lens.py`'s read functions onto the semver-stable API surface (EXTENDING.md) — the
      contract this repo builds against.
- [ ] WLC (**not v1-blocking**): a retraction verb (`wealthlens forget <source_id>`).
      `capture_io.delete_source()` exists as a function with no CLI surface — until then WLW *teaches* the
      command rather than building the button (ADR-0012). Graduates on demand.
- [ ] WLC (roadmap): foreign-held accounts. WLW's standing free-landing test — if displaying one needs
      more than a locale string, WLW's data conventions are wrong (ADR-0012 part 2).
- [ ] Seed the bridge from the reviewed prototype (WLC PR #1's report server) — with ADR-0004's
      Host/Origin/token hardening and the manifest replacing ad-hoc workspace discovery.
