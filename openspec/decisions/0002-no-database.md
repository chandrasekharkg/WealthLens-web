# ADR-0002 — No database: a stateless presenter plus one manifest file

**Status:** ACCEPTED 2026-08-22

## Context

An aggregating web app reflexively grows a database — session state, cached aggregates, user preferences,
"just one table." But WLC's foundational invariant is `store = replay(corpus)`: every financial fact lives
in a store that can be wiped and reproduced from source documents. A second stateful system in WLW would
create a *second source of truth* that can drift from the first, and every cache of financial data is a new
place for stale or leaked numbers to live.

## Options considered

1. **A WLW database** (SQLite/DuckDB) for aggregates + config. Rejected: drift risk, cache-invalidation
   burden, and it dilutes the answer to "where is my data?" — which today is exactly one place per person.
2. **Fully stateless, config in env vars.** Rejected: family composition (N members, labels, paths) is real
   configuration that deserves a reviewable, versionable artifact.
3. **Stateless aggregation + ONE durable artifact: the family manifest.** Chosen.

## Decision

WLW holds **no database**. All financial state lives in WLC stores, read per request. WLW's only durable
artifact is `family.toml` — the family manifest: entities, their workspace paths, display labels, and
presentation preferences. It is text, versionable, and contains **no financial data and no keys**.
Ephemeral UI state (an open tab's selections) lives in the browser session and may be lost freely.

In-memory, per-process response caching is permitted (a lens query is not free) with one rule: cache
entries are keyed on the store file's identity + mtime, so a store change can never serve a stale number.
A cache that would survive process restart is a database and is prohibited.

## Consequences

- "Where is my family's data?" keeps its one-sentence answer: each person's WLC store, plus one small
  manifest file naming them.
- Aggregation cost is paid at read time; if it ever genuinely hurts, the fix is a faster lens query
  upstream, not a WLW cache with a lifecycle.
- Backup story for WLW is trivial: the manifest is the only thing to keep.
