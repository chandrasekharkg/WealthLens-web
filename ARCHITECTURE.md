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
- **Rules of the game (read first)** — [AGENTS.md](AGENTS.md)
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
  [0015 store-key custody](openspec/decisions/0015-store-key-custody.md) ·
  [0016 currency & point-in-time](openspec/decisions/0016-currency-and-point-in-time.md) ·
  [0017 fleet uniformity](openspec/decisions/0017-fleet-uniformity.md) ·
  [0018 backend-first testing](openspec/decisions/0018-backend-first-testing.md) ·
  [0019 secret exposure](openspec/decisions/0019-secret-exposure.md)
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

- [x] WLC: **a named-workspace read surface** — shipped (WLC `a618a87`). `wealthlens.workspace` resolves an
      explicit path, opens it read-only with that workspace's own key, several at once in one process, with
      no cache and no environment mutation. Declared stable in EXTENDING.md alongside `lens.py`'s `__all__`.
      This was the v1 blocker: family aggregation had no foundation without it.
- [x] WLC: **honest lock errors** — shipped with the above. `StoreLocked` carries the holding process and
      pid as the database reported them; the engine no longer discards the error and guesses a culprit.
- [x] WLC: **`lens.owners()`** — shipped. Makes the silent-zero ownership hazard answerable.
- [x] WLC: **freshness on the read surface** — shipped (WLC `d550a8e`). `lens.freshness()` reports the
      newest date per evidence kind; `lens.latest_evidence()` reduces it to one. Document evidence is split
      from fetched market data, so a store with three-month-old statements and this morning's prices reports
      as stale rather than current.
- [x] WLC: **currency on lens rows** — shipped (WLC `2e521d6`, schema 3.10). `position_snapshots` gained a
      `currency` column and `holdings()` reports one on every row. A *native amount* alongside the converted
      one is still absent, but no parser produces foreign holdings yet, so it lands with the first one that
      does rather than being invented ahead of a real statement.
- [x] WLC: **FX disclosure** — shipped. `price_at()` reports `quote_currency`, `price_as_of` and `fx_as_of`.
      The reported "silent drop" turned out not to exist: an unconvertible quote is omitted from the ledger
      price tier deliberately (never converted at 1.0) and the position is still valued by its statement or
      its cost. Verified in the engine and now pinned by a test.
- [ ] **Fleet event pending:** WLC's schema is now 3.10. Existing stores read 3.9 and need a rebuild +
      promote before an aggregator will include them (ADR-0017).
- [x] WLC: **a machine-readable job contract** — shipped (WLC `455c0e0`). `--json` on rebuild, verify and
      promote; an `outcome` (ok / attention / refused / failed) separate from the exit code; every refusal
      names its gate; under `--json` the envelope owns stdout and narration goes to stderr.
- [ ] WLC (**not v1-blocking**): a retraction verb (`wealthlens forget <source_id>`).
      `capture_io.delete_source()` exists as a function with no CLI surface — until then WLW *teaches* the
      command rather than building the button (ADR-0012). Graduates on demand.
- [x] WLC: **a `promote` verb** — shipped (WLC `c9fdb41`). Eight abort-first gates, backup, atomic
      `os.replace`. ADR-0006's in-UI promotion now has a verb to drive within the ADR-0005 boundary.
- [ ] WLC (**deferred — waiting for a real user to want it**): a one-time password path for `import`,
      e.g. `--password-file <path>`, read then forgotten. Today "use it once" is unbuildable: `import`
      takes no password argument and gives up on a closed stdin (ADR-0019). Designed and understood, but
      not built — the ring covers every case we have actually seen, and ADR-0012's rule is that native
      support follows demand rather than anticipation. Graduates when somebody asks.
- [ ] WLC: **decide `schema.migrate()`'s fate** — it exists but is called from nowhere (no CLI path, no
      test), so a store never upgrades in place and rebuild+promote is the only route. Either wire it as an
      optimisation of that route (never an alternative — ADR-0017), or retire it; a function nothing calls
      reads as a capability the system has and doesn't.
- [ ] WLC: **a configured store default currency**. `currency` exists on accounts/instruments/facts but
      only as a column default of `'INR'` — an entity's default should be configuration, not a schema
      constant (ADR-0016).
- [ ] WLC: **a reporting-currency-relative FX pivot**. `fx_rates` stores `inr_rate`, and `value_inr` /
      `fx_to_inr` appear across ~20 modules, so INR is baked into the vocabulary rather than chosen. Until
      this lands, WLW supports an INR pivot and refuses other reporting currencies rather than
      approximating (ADR-0016).
- [ ] WLC (roadmap): foreign-held accounts. WLW's standing free-landing test — if displaying one needs
      more than a locale string, WLW's data conventions are wrong (ADR-0012 part 2).
- [ ] Seed the bridge from the reviewed prototype (WLC PR #1's report server) — with ADR-0004's
      Host/Origin/token hardening and the manifest replacing ad-hoc workspace discovery.
