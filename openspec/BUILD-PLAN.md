# Build plan

Design is done (13 ADRs, 9 capability specs). This is the order we build in, and why that order.

**Sequencing rules.** Risk first — the parts that could invalidate the design (the lens contract, the lock
model) come before the parts that are merely work. Each phase ends with something demonstrable and its own
tests. The test pyramid is built *before* the features it must carry, because a pyramid retrofitted is a
pyramid nobody builds.

---

## Phase 00 — The cold start

The UX validation gate found that everything before "a store exists with data in it" was thin: every use
case had been written starting from a workspace that already exists. Four blocking findings, now resolved
into work (UX-VALIDATION P1–P4).

- **The installer and launcher** (ADR-0014): prepare Python + WLC + bridge, create a launcher, open the
  browser — and create no workspace, key or config. Failure reporting is part of the deliverable, not a
  polish item; unattended setup fails in ways nobody can debug remotely.
- **Preflight at every launch** (cold-start): WLC present and in range, with a screen that names the
  problem and the fix. Not a one-time install check — users upgrade WLC independently.
- **The key ceremony** (ADR-0015): reveal the key file on the user's machine, never transmit it; explicit
  dated confirmation; optional fingerprint so a user can check what they saved; backup state per workspace
  recorded in the manifest and surfaced family-wide.
- **First-run empty state** (cold-start): guided create-or-connect, candidates offered not included.
- **Retraction teaches the real sequence** (collateral-and-sources): quarantine → rebuild → review →
  promote. No `forget` verb exists, and a taught command that fails when pasted is worse than no button.

Platform priority is evidence-led (ADR-0009's rule): start where the users are.

## Phase 0 — Make the pyramid real

Nothing here is a feature. It exists so that ADR-0010 is enforced by the repo rather than remembered by
contributors.

- `bridge/` packaging (`pyproject.toml`), pytest, ruff. `wealthlens` is an **optional** dependency, not a
  hard one — it is not on PyPI and a hard dependency breaks every contributor's `pip install -e .`; the
  supported range is over WLC's **schema** version (its package version does not track it) and is enforced
  by preflight.
- `frontend/` packaging: Vite + React + TypeScript (ADR-0003), Vitest, React Testing Library, Playwright.
- CI running both suites on every push.
- The **schema → types** generation step and its drift test (bridge-api): a contract change the UI has not
  adopted must fail the build.
- The three sanctioned E2E specs (ADR-0010) committed as **skipped stubs** carrying their justifications,
  so the cap is visible in the repo without a permanently red suite that everyone learns to ignore.
- Linters (ruff, eslint) and the personal-data hooks, from the first commit rather than retrofitted.

**Done when:** an empty app builds, both unit suites run green, the local hooks gate a push, and adding a
fourth E2E test requires deleting a comment that says not to.

## Phase 1 — `core/`: the read layer, with no HTTP

The highest-risk phase and the one that needs no browser. Framework-free per ADR-0007, so every test is a
plain function call.

- Manifest: parse, validate, resolve paths, clear errors for a bad entry.
- Workspace resolution and validation (opens read-only, schema compatible, names found-vs-required).
- Lens access per entity, behind a **thin adapter** — see the cross-repo risk below.
- Granularity as a parameter (`aggregate` / `positions` / `transactions`), enforced at the source.
- Family aggregation: read-time composition, per-entity attribution, multi-workspace entities, partial
  availability that degrades honestly, freshness, and provenance fields surviving the merge.

**Done when:** family aggregation over two real fixture workspaces is asserted in pytest with no server
running — including the case where one store is missing.

## Phase 2 — The bridge: HTTP and hardening

- FastAPI over `core/`, the closed side-effecting set, and nothing outside it.
- ADR-0004 phase 1: loopback bind, Host check, Origin check, per-session token on state-changing calls.
- The **job model** (bridge-api): one mutating verb per workspace, read handles released for its duration,
  other workspaces unaffected. Build this with the first verb, not after several.
- SSE progress; results retrievable after the stream closes.
- Version endpoint (bridge + WLC + supported range).

**Done when:** E2E #2 (cross-site POST refused) goes green, and a rebuild running against one workspace
provably does not block reads of another.

*Status: done except E2E #2, which needs the app shell to fire the request at (Phase 3). The refusal itself
is asserted in pytest today.*

## Phase 3 — The frontend spine

Still not screens. This is the layer every screen then costs almost nothing to add.

- Types generated from the schema; the drift test wired.
- i18n catalog + locale-aware money/date formatters (data-conventions), including Indian digit grouping.
- The shipped **Table** over TanStack headless, and the **Chart** wrapper over Recharts.
- The **provenance header** composed in `core/` (ADR-0018) and the **egress** functions — export and print
  land *here*, with the components (ADR-0013), not as a feature later. Cell escaping stays in TypeScript:
  it is genuinely presentational and belongs beside the writer. Building them into the spine is what makes them free for
  every view, including extension-declared tables.

**Done when:** a throwaway page renders a table that sorts, filters, exports a correctly-escaped CSV and
prints properly — with the money/currency and escaping rules asserted in Vitest, no DOM required.

## Phase 4 — The daily loop

The first phase a household can actually use (UC-B).

- Overview ("is my picture trustworthy right now?"), the context bar (entity/family, as-of).
- Reports: net worth, holdings, point-in-time; family drill-down to per-entity parts.
- Upload → inbox; trigger import; render WLC's per-file verdict verbatim.
- Honesty surfaces: basis, as-of, freshness strip, footing warnings where the numbers are.

**Done when:** E2E #3 (upload → import → a number appears) goes green, and Sharath can run his own
workspace through it.

## Phase 5 — Operations and configuration

The half that makes a non-technical household self-sufficient (UC-A, UC-C).

- Workspace detail: paths, schema version, store file reachable.
- Collateral: each document's fate, the password ring, deliberate copy-to-clipboard reveal.
- **Identity & settings** (identity-and-settings): everything bootstrap asks, editable afterwards;
  comment-preserving `config.toml` edits; PAN handled as a secret.
- The locked-file loop: supply a password, retry, prove it worked.
- Activity (job log), including the honest post-restart state: history is forgotten, the store is not at
  risk, and `rebuild --check` re-establishes the truth (bridge-api).
- Lock handling: surface the engine's named holder, classify it as an engine process or something else,
  and never offer to break it.
- Promotion, driven through WLC's `promote` verb (gated + atomic upstream), in the guarded shape of
  ADR-0005/0006 — the UI's confirmation sits in front of the verb's own gates, never instead of them.

**Done when:** E2E #1 (promotion unreachable without its check) goes green, and a workspace can be created,
configured, corrected and imported without a terminal.

## Phase 6 — Extensions and manual facts

- The declarative page renderer plus the canonical hello-world extension, which doubles as its fixture.
- Manual-fact forms writing `manual/*.yaml` in WLC's vocabulary, with the "store is behind until
  re-applied" honesty.

---

## Deliberately not in v1

Each has its ADR and its graduation trigger — none is an omission.

| Deferred | Why | Graduates when |
|---|---|---|
| MCP server | ADR-0008 — designed, gated | scoped exposure is genuinely wanted |
| Container distribution | ADR-0009 — native first | install feedback says so |
| Retraction button | ADR-0012 — taught, not built | WLC gains the verb, or demand appears |
| XLSX export | ADR-0013 | column types are actually needed |
| Serving beyond loopback | ADR-0004 phase 2 | with authentication, never as a flag |

## The cross-repo risk, and the mitigation

Phase 1 builds against WLC's `lens.py`, which is **not yet on WLC's semver-stable surface** — that
promotion is an open cross-repo task. Until it lands, every lens call goes through one thin adapter module
in `core/`, so an upstream signature change is a one-file fix rather than a diffuse one. Do not scatter
lens calls through the aggregation code.

The second dependency is softer: views may need figures lens cannot yet answer. The rule stands — that is a
`lens.py` contribution to WLC, never a query here (project.md). Expect at least one during Phase 4, and
budget for it.
