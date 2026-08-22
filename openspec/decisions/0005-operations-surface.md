# ADR-0005 — The operations surface: deposit inputs, run WLC's verbs, never touch the store

**Status:** ACCEPTED 2026-08-22

## Context

The founding framing was "a read-only presenter." Use-case work (openspec/USE-CASES.md) immediately showed
that the users WLW exists for need more than viewing: uploading statements from the browser, supplying a
statement password when a file is locked, and driving rebuild / verify / diagnose / fetch-prices without a
terminal. Taken naively, each of those erodes the read-only promise until it means nothing. This ADR draws
the durable line instead.

## Decision

WLW's write powers are exactly three, and each is a hand-off to WLC rather than an act of custody:

1. **Deposit inputs.** Uploads land in a workspace's `statements/` inbox — extension-allowlisted, size
   capped, never overwriting (WLC's non-clobber naming). Passwords land in that workspace's WLC config by
   WLC's own conventions, transit once over loopback, and are never echoed, logged, or retained by WLW.
   Depositing is not custody: nothing enters a store until WLC's import gates pass it.
2. **Run WLC's verbs.** `import`, `rebuild --check`, `verify`, `diagnose`, `fetch-*` — always as
   subprocesses of the real CLI (list-args, stdin closed, timeouts), so every WLC gate (oracles,
   provenance, footing, PII hooks) applies unchanged. WLW never re-implements a verb's logic, and adds no
   network calls of its own (`fetch-*` remain WLC's only network activity).
3. **Nothing else.** Direct store writes, schema knowledge, and bypassing a verb's gates are prohibited at
   the boundary, not by convention.

**The job model (the lock lesson made structural).** DuckDB read and write attaches conflict — WLC's own
history includes an import failing against an open notebook with a misleading error. The bridge therefore
serializes: at most one verb per workspace at a time; the bridge closes its read handles for that workspace
for the verb's duration; job status/progress is held in memory only (per ADR-0002 — a bridge restart may
lose the *progress view*, never the outcome, which lives with WLC).

**Promotion is not an ordinary verb.** Overwriting a live store is the one destructive act in the system.
If exposed at all, it is offered only after a completed `--check`, rendering the tally/digest delta, behind
a typed confirmation naming the entity — the product form of the abort-first promotion doctrine (WLC
lessons-learned L4). Whether v1 ships it or leaves promotion to the CLI is an open product call
(USE-CASES.md open question 1); this ADR fixes the *shape* it must have if shipped.

## Consequences

- The honest one-liner becomes: **"WLW never writes a store; it feeds and drives WLC, which does."**
  project.md's non-negotiable is restated accordingly.
- Every browser-driven operation inherits WLC's gates for free — the custody bar cannot be lowered from
  the UI, only invoked.
- The per-workspace job queue becomes a core bridge component (and the natural place progress streaming,
  cancellation, and the read-handle dance live).
