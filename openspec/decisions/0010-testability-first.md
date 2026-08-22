# ADR-0010 — Testability first: the architecture exists to keep the test burden low

**Status:** ACCEPTED 2026-08-22

## Context

A UI is where test cost silently explodes. Every "cool feature" adds surface that every future
contributor must keep green, and browser-driven tests are the slowest, flakiest and least informative
way to buy that confidence. The founding principle here is explicit and worth stating in the repo:

> **A conservative tool that is easy to enhance is worth far more than a feature-rich one that nobody can
> maintain.** Test effort is a tax on every future contribution — architecture's job is to keep it small.

## Decision

**Push logic out of components so that fast, boring tests can carry the load.**

The rule that generalizes everything below: **components are dumb; what they render is computed by pure
functions.** A component's test asks "given this data, did it render and behave", never "is this number
right" — that question is answered one layer down, in a test with no DOM at all.

### The pyramid, and what each layer is *for*

| Layer | Tool | Carries | Rule |
|---|---|---|---|
| Pure logic — selectors, formatters, aggregation shaping, money/i18n, extension-manifest validation | **Vitest**, no DOM | **The bulk of coverage** | Every figure a user sees traces to a pure function tested here |
| Table behaviour | **Vitest** against TanStack Table's headless core | Sorting, filtering, grouping, column state | Assert the row model directly; no rendering |
| Component behaviour | **Vitest + React Testing Library** | Does it render, respond, show the right states | Behaviour and accessibility, never pixels |
| Bridge | **pytest** against `core/` (framework-free by ADR-0007) | Workspaces, aggregation, freshness, jobs | No HTTP needed to test the logic |
| API contract | Schema-derived types + a drift test | The seam between the two layers | A contract change the UI hasn't adopted fails at **build** time |
| End-to-end | **Playwright**, deliberately tiny | A handful of flows only | See the cap below |

### The E2E cap (the load-bearing constraint)

Browser tests are capped at the flows where a *wrong* outcome is unrecoverable or dangerous, not where a
flow is merely important. The starting list is short and stays short:

1. **Promotion is unreachable without a completed check** (ADR-0005/0006) — asserts the guard, not the
   happy path.
2. **A cross-site POST is refused** (ADR-0004) — the CSRF guard.
3. **One end-to-end smoke**: upload → import → a number appears.

Adding a fourth requires justifying why no cheaper layer can catch that failure. Playwright, not Selenium.

### What this forbids

- Business logic inside a component (a `.map()` that computes a total, a formatter inline in JSX).
- Charts that compute anything: a chart receives a **finished series** and draws it. This is why charts
  need almost no tests — there is nothing in them to be wrong.
- Tests that assert on rendered markup structure or styling.
- A feature whose only possible test is an E2E test. That is a design signal, not a testing problem —
  restructure until a pure function can answer the question.

## Consequences

- Contributors add features by adding **pure functions plus a dumb component**, and the test they must
  write is a fast one. That is the whole point.
- The chart library choice becomes low-stakes — it is a drawing dependency behind a thin wrapper, not a
  place logic lives.
- CI stays fast enough that nobody is tempted to skip it.
