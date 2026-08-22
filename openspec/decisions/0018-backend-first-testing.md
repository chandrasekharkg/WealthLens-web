# ADR-0018 — Backend-first: if a value can be computed in `core/`, it is

**Status:** ACCEPTED 2026-08-22 · Sharpens ADR-0010 (which stands)

## Context

ADR-0010 established the pyramid: components are dumb, pure functions carry the coverage, browser tests are
capped at three. It did not say **which side of the wire** those pure functions live on, and the BUILD-PLAN
drifted toward the frontend — currency resolution, aggregation shaping and the provenance header were all
scheduled as TypeScript.

That drift matters, because the two sides are not equally testable. A pytest over `core/` needs no DOM, no
server, no browser and no build step; it fails with a Python traceback pointing at a line. A Vitest over a
TS selector needs a toolchain, a transform, and a module graph — and it is testing a computation that had to
be *shipped to the browser* to happen at all.

## Decision

**When a value could be computed either in `core/` or in the frontend, it is computed in `core/`.**

Shaping, aggregation, currency resolution, freshness derivation, warning composition, the provenance header,
the empty-state classification — these are Python. The frontend renders what it is handed.

The frontend keeps only what is genuinely presentational: locale formatting, a sort comparator, a column
definition, the escaping of a cell on its way out. Those are real pure functions and they stay in Vitest.

**Testability is established before a feature is written**, not after — the layer, the concrete assertion,
and the reason that layer can hold it. A feature whose only possible test is a browser test is a design
signal, not a testing problem.

## Why this and not the alternative

The alternative — a thicker frontend with a thin API — is the conventional SPA shape, and it is wrong *here*
for a specific reason: this product's claims are arithmetic ones. "The total excludes Mum's store", "these
parts share one point-in-time date", "this figure is unsummable across currencies". Every one of those is a
statement about numbers, and every one is cheaper and more convincingly proven in Python next to the code
that produced it than in a browser-shaped test three layers away.

It also has a second effect worth naming: an API that returns *finished* answers is an API an MCP server
(ADR-0008) or a script can consume without reimplementing the presentation logic. A thick frontend would
have made the bridge's answers permanently half-baked.

## Consequences

- `core/` grows and the frontend shrinks. That is the intent, not a smell.
- The bridge's response models carry composed, display-ready structures (amount + currency, a header object,
  a classified empty state) rather than raw rows the client must interpret.
- A pull request that adds computation to TypeScript needs a sentence explaining why it could not be done in
  `core/` — the burden of proof sits on the frontend side.
- Regressions get their test at the layer that owns the value, which under this rule is usually pytest.
