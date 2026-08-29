# AGENTS.md — the rules of the game

The developer and agent guide for WealthLens-web. Read this before changing anything.

WLW is the **presenter** half of WealthLens: a local-first web UI over WealthLens-core (WLC) stores. WLC is
the **custodian**. That boundary is the first law, and most rules below exist to keep it honest.

**The map:** [ARCHITECTURE.md](ARCHITECTURE.md) → the design index · [openspec/BUILD-PLAN.md](openspec/BUILD-PLAN.md)
→ what we build and in what order · [openspec/decisions/](openspec/decisions/) → why · [openspec/specs/](openspec/specs/)
→ what, testably.

## Working notes for KG's agents

This is a **public repo — synthetic data only** in commits and fixtures (the pre-push PII scan enforces it);
never name a real host, store path, or person here. KG's home-lab context — machines, SSH, deploy playbooks,
the new-repo house rules — lives in the local **`kg-home`** skill (`~/.claude/skills/kg-home/`), not in this
repo. Two facts that ARE public and matter here: `./wealthlens-serve` runs the app locally, and a **deploy
needs a serve RESTART** for bridge (Python) changes — a rebuild alone only refreshes `dist/`.

---

## 1. Testability is proven before a feature is written

**No feature begins without a stated test plan, and the plan must be shown to be achievable at the layer it
claims.** Not "we'll add tests after" — the mechanism by which the thing can be asserted has to exist first.

Before writing feature code, state three things (in the PR, the commit, or the change proposal):

1. **Which layer** the behaviour will be asserted at (see the preference order below).
2. **The assertion** — what is checked, concretely. "Renders correctly" is not an assertion; "a mixed-currency
   set returns `unsummable` with both currency codes" is.
3. **Why that layer can hold it.** If the honest answer is "only a browser test could catch this", that is a
   **design signal, not a testing problem** — restructure until a cheaper layer can answer the question.

A feature whose testability cannot be established does not get built. It gets redesigned.

### The preference order — backend first

| Preference | Layer | Why it wins |
|---|---|---|
| **1st** | **`bridge/` pytest over `core/`** | Fastest, most stable, most informative failure. No DOM, no server, no browser. **Put the logic here.** |
| 2nd | Vitest over pure TS functions | For genuinely presentational logic — formatting, a locale, a sort comparator |
| 3rd | Vitest + Testing Library | Behaviour and accessibility of a component. Never pixels, never a computed number |
| last | Playwright | Three flows only (§4) |

**Backend tests are the preferred approach.** The practical consequence, and it is a design instruction not
just a testing one: **when a value could be computed either in `core/` or in the frontend, compute it in
`core/`.** Shaping, aggregation, currency resolution, freshness, warning composition, provenance headers —
these belong in Python where a plain function call asserts them. The frontend renders what it is given.

This sharpens ADR-0010 rather than replacing it: components stay dumb, and the pure functions that feed them
should live on the side of the wire that pytest can reach.

## 2. A regression demands a test change — always

A bug fix without a test is not a fix; it is a coincidence waiting to recur.

When something regresses, one of two things is true, and the fix must say which:

- **A test should have caught it and didn't** → that test is wrong. Update it so it would have failed, and
  show that it fails before the fix and passes after.
- **No test covered it** → add one, at the layer §1's order dictates.

"Fixed it, tests still pass" is not an acceptable outcome — if the suite was green before and after, the
suite did not cover the defect.

Deleting or weakening an assertion to make a suite green requires saying so explicitly and why the old
assertion was wrong. Silently loosening a test is the one thing that turns a green suite into a lie.

## 3. Specs are the source of truth, and they lead

Governed behaviour lands as an **OpenSpec change first**, then code, then the spec is promoted. A change
that ships code but not its docs is not done.

ADRs are **immutable once decided**. If a decision turns out to be wrong or was overtaken, write a new ADR
that supersedes it — never edit the old one. (The corpus has been reviewed for exactly this failure: later
ADRs silently invalidating earlier statements that were left standing.)

Every claim about **what WLC does** must be verified against WLC's source before it is written down. Several
specs have already been wrong about verbs, columns and guarantees that did not exist. Check, then write.

## 3b. The API contract is generated, never hand-written

The frontend's types come from the bridge's own OpenAPI document. Two gates keep the chain honest:

- a **pytest** asserts the committed `frontend/src/api/openapi.json` matches the live app;
- **CI** regenerates `src/api/types.ts` and fails if it differs from what is committed.

So after changing an endpoint or a response model:

```bash
python bridge/scripts/export_schema.py    # app  → openapi.json
cd frontend && npm run types              # json → types.ts
```

Both files are committed. A contract change the UI has not adopted then fails a check, rather than
rendering `undefined` in somebody's dashboard.

## 4. The three browser tests, and no more

`frontend/e2e/` holds exactly three Playwright specs, each present because a **wrong** outcome is
unrecoverable or dangerous — not because the flow is important:

1. promotion is unreachable without its completed check;
2. a cross-site POST is refused;
3. one end-to-end smoke: upload → import → a number appears.

Adding a fourth requires justifying, in writing, why no cheaper layer can catch that failure. Browser tests
are the slowest, flakiest and least informative confidence money can buy.

## 5. The boundary rules that do not bend

- **WLW never writes a store.** It deposits inputs, drives WLC's verbs as subprocesses, and writes its own
  manifest. Nothing else. If a feature seems to need a store write, it needs a WLC verb instead — raise it
  as a cross-repo task (ARCHITECTURE.md tracks them).
- **WLW never parses a statement.** Custody, parsing and the oracles are WLC's.
- **No database.** All financial state lives in WLC stores. Anything resembling a cache with a lifecycle is
  a design smell (ADR-0002).
- **Keys never reach the browser** (ADR-0015). Secrets are never passed to a subprocess through argv, where
  `ps` can read them.
- **Honesty flows through.** `basis`, staleness, footing breaks, partial totals and excluded entities are
  rendered where the affected number is. The UI's polish must never exceed the data's honesty.

## 6. Local gates are the real gates

CI runs **once a day**, not per push — this project deliberately does not burn a CI quota on every commit.
That makes the local hooks the enforcement, so keep them enabled:

```bash
git config core.hooksPath .githooks
```

- **pre-commit** — personal-data scan of the staged lines. This repo is public; the realistic leak is a real
  value pasted into an *example*. Reports `file:line` and which pattern matched, never the matched text.
  Genuinely synthetic data: put `pii-ok` on the line.
- **pre-push** — the same scan over the pushed range, then `ruff`, `eslint`, `tsc` and both unit suites.

E2E is **not** in the hooks (too slow for every push) and **is** runnable on demand:

```bash
cd frontend && npm run e2e:install   # once
npm run build && npm run e2e         # e2e serves the BUILT app, so build first
```

E2E runs against a throwaway workspace it creates itself (`e2e/setup/`), on a different port from the
app's usual one — so a run can never touch a household's real stores or collide with a live instance.

Run it locally before anything that touches the three guarded flows. The daily CI run is a backstop, not
the first time anyone finds out.

## 7. Working on this repo

```bash
python -m venv .venv && .venv/bin/pip install -e "bridge[dev]"
cd frontend && npm install
git config core.hooksPath .githooks
```

| | Command |
|---|---|
| Bridge tests | `.venv/bin/python -m pytest` (from `bridge/`) |
| Bridge lint | `.venv/bin/python -m ruff check bridge/` |
| Frontend unit | `npm test` (in `frontend/`) |
| Frontend lint + types | `npm run lint && npm run typecheck` |
| E2E | `npm run e2e` |

WLC is deliberately **not** a hard dependency: it is not on PyPI, households install it from source, and a
hard dependency would break `pip install -e .` for every contributor. The bridge imports it at runtime, and
a missing engine is a **state the UI renders**, not a crash (cold-start spec). CI runs without it on purpose,
so the absent path is exercised rather than assumed.
