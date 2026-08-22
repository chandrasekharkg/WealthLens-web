# ADR-0017 — One engine, uniform stores: version skew is refused, not absorbed

**Status:** ACCEPTED 2026-08-22

## Context

An aggregate view reads several stores at once. Those stores are files, and files drift: one built on a
machine that upgraded, another a synced copy from a machine that didn't (ADR-0006's host-accessibility
model makes this ordinary, not exotic). So which `lens.py` reads which store?

Two shapes were possible. **Dispatch per store** — each workspace answered by the engine version that built
it. Or **one engine** — a single `lens.py`, with uniformity as a precondition.

### What the code says, checked rather than assumed

- **`lens.py` has no version awareness at all.** Nothing below the aggregation layer is prepared for a store
  that differs from the engine reading it. Divergence is undefined behaviour, not a handled case.
- **`schema.migrate()` exists but is called from nowhere** — no CLI path, no test. A store therefore never
  silently upgrades itself in place.
- **`promote` refuses anything but engine-equal schema.** The only sanctioned way to install a store already
  enforces uniformity at the moment of installation.
- The bridge imports `wealthlens` as a **library**, so there is physically one `lens.py` in the process.

## Decision

**One engine per bridge, and uniformity is a precondition for aggregation — checked before every aggregate,
never assumed.**

### Why dispatch-per-store is rejected

It would mean a subprocess per store per query against a different WLC install — a version matrix in the hot
path of every view. But the decisive argument is not cost, it is that **dispatch solves the wrong problem**.

The risk in mixed versions is not failure to read. It is **coherence**. Two stores built under different
engine semantics produce parts that mean subtly different things — an instrument classified one way here and
another there, a quantity recorded as unknown in one vocabulary and zero in an older one. Summing them
yields a number that is not wrong in any single place and cannot be explained anywhere. Dispatch would make
that outcome *more* likely by making the divergence invisible.

This project's whole claim is that a figure can be traced to how it was derived. A cross-version total
cannot be.

### The rule

1. **The bridge's WLC is the engine.** There is one, and it reads everything.
2. **A store not at the engine's schema version is not read for figures.** It is excluded and named, exactly
   as an unreachable or locked store is (family-aggregation), and the total is labelled partial. The
   aggregated set is therefore **uniform by construction** — we never mix semantics, and we never need to
   reason about which parts came from which vocabulary.
3. **The app does not go dark on a mismatch.** Identity, paths, schema version and collateral do not depend
   on lens semantics, so a mismatched workspace still shows what it is and how to bring it current. What is
   withheld is money figures, precisely because those are what would be incoherent.

### The upgrade path is a replay, not a migration

Bringing a store current is `rebuild` with the new engine, then `promote`. That is not a workaround for a
missing migration tool — it *is* the architecture: `store = replay(corpus)`. Promote's schema gate then
guarantees what lands is engine-equal, so the fleet converges through the loop users already run.

WLC's unwired `schema.migrate()` could one day make additive changes cheaper. If it is ever wired, it is an
**optimisation of this path, not an alternative to it** — the store still ends at the engine's version or it
is not aggregated.

### Cadence

- **WLW declares the WLC range it supports**; preflight enforces it at every launch (cold-start).
- **Order: upgrade WLC → rebuild and promote each workspace → aggregation returns → upgrade WLW.** The
  engine is the custodian and moves first; the presenter follows.
- **A schema bump is a fleet event.** Every workspace needs a rebuild and promote before family views work
  again. Naming that cost is the point: it is a reason to batch schema changes rather than trickle them, and
  that discipline is a feature.
- **Machines do not need matching WLW installs.** Only the *reading engine* and the *stores it reads* must
  agree. Two households running different WLW versions is a UX difference, not a correctness one — which
  removes an entire class of imagined coordination.

## Consequences

- The version endpoint reports the engine version **and each declared store's version**, so skew is
  diagnosable by name rather than inferred from a failure.
- Store versions are **read, never recorded** in the manifest — a remembered version is a cache that goes
  stale, and ADR-0002 rules that out.
- One mechanism now covers unreachable, locked and version-skewed stores: excluded, named, total labelled
  partial. Three causes, one honest shape.
- A user who upgrades WLC mid-week sees family views narrow to the workspaces they have rebuilt, with the
  rest named and actionable. That is the seam showing on purpose, which is the alternative to it showing by
  accident later.
