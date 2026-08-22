# UX validation gate — findings

A ten-step click-through of the cold start (nothing installed → a number the household trusts) was built
before Phase 0 specifically to find what the specs don't answer. It found eleven, and a twelfth surfaced while resolving them. Four were blocking, two of
those decisions rather than omissions.

The walkthrough is at `openspec/mockup/cold-start-walkthrough.html` — open it in a browser. Screens 1–10
map to UC-A and UC-B, and the four decided findings are now reflected in the screens themselves.

## The shape of what it found

Every hole sits in the same place: **the beginning**. The design is strong from "a store exists with data
in it" onward — Overview and family aggregation survived the walkthrough with nothing new against them.
Everything before that point is thin, because every use case was written starting from a workspace that
already exists.

---

## Resolution status

| | Finding | Status |
|---|---|---|
| P1 | Installation ownership | **Decided** — guided installer, then launcher (ADR-0014) |
| P2 | WLC missing / version-skewed | **Specified** — preflight at every launch (cold-start) |
| P3 | Store-key custody | **Decided** — never crosses the bridge (ADR-0015) |
| P4 | Retraction teaches a missing verb | **Fixed** — teaches quarantine→rebuild→promote (collateral-and-sources) |
| P5 | Empty states | First run specified; the rest is a Phase 4 item |
| P6 | Statement acquisition | **Specified** — a help page covering per-institution collection and `document-collector` as an optional companion (setup-and-config) |
| P7 | Password naming on entry | **Specified** — prove it opens, then ring-or-once, with the reproducibility consequence stated (setup-and-config) |
| P8 | Mixed-scope provenance header | **Resolved** — aggregate views are point-in-time at one chosen date, so there is one date (ADR-0016) |
| P9 | Foreign currency | **Decided** — three-level currency resolution, one reporting figure (ADR-0016); two WLC tasks raised |
| P10 | Activity durability across restart | **Resolved** — forget state, surface the lock, classify the holder, verify with `rebuild --check` (bridge-api) |
| P12 | Promotion has no WLC verb | **Resolved upstream** — WLC now ships `wealthlens promote`, gated and atomic (WLC `c9fdb41`) |
| P11 | The set of keys a family holds | **Resolved** — backup state per workspace in the manifest (ADR-0015) |

The findings below are the original write-up, kept as the record of what the gate caught.

## Blocking

### P1 — Nobody owns the installation

**Where:** step 1, before any screen exists.
Every use case begins with a browser already showing WealthLens. Nothing says how it gets there, or who
put Python and WLC on the machine. ADR-0009 chose "native first" but not what native *contains*.

If WLW assumes WLC is already installed, the non-technical household — the entire justification for this
repo (ADR-0006 §1) — cannot reach step 2. If WLW bundles WLC and a Python runtime, the installer becomes a
real deliverable with its own phase, and "WLW never writes a store" gains an asterisk about who put the
engine there.

**Needs:** a decision, then an ADR. It changes the build plan (a packaging phase) and possibly Phase 0.

### P2 — No design for "WLC missing, or the wrong version"

**Where:** step 1–2.
The bridge has a version endpoint (bridge-api) that can *detect* skew. No screen is specified for it —
and it is the first failure a real user can hit, before any data exists to fall back on.

**Needs:** a spec addition. Cheap once P1 is decided.

### P3 — The store key has no home

**Where:** step 4, and it is the most destructive moment in the product.
WLC generates `store.key` at init and prints BACK THIS UP — it is the only key to the encrypted store,
with no reset. In a browser flow that warning either gets a real ceremony or gets clicked past.

But project.md's non-negotiable says **keys never reach the browser**. Both cannot hold. Either the browser
displays the key once with a gated acknowledgement, or the UI walks the user to the file on disk without
ever holding its contents.

Compounding it: **each workspace has its own key**. A family of four repeats the ceremony four times and
must retain four separate secrets — a burden nothing in the design acknowledges.

**Needs:** a decision, then an ADR. Losing this key loses everything, so it should not be settled in code.

### P4 — Retraction teaches a command that does not exist

**Where:** step 9. A regression introduced by ADR-0012 itself.
"Teach the command" assumed the command exists and only lacks a UI. For retraction it does not:
`capture_io.delete_source()` is a function with no CLI verb. A copyable command that fails when pasted is
worse than a disabled button — it destroys the trust the pattern was built to earn.

**Needs:** either the WLC verb ships, or v1 teaches the real sequence (remove the file, rebuild, promote),
or the panel doesn't appear. ADR-0012's *principle* survives; its worked example was wrong.

---

## Should fix before the screens they affect

### P5 — Every empty state is unspecified
No family declared, an inbox with no files, a store with no holdings, an Activity log with no jobs. The
first screen every user sees is the state no spec describes. **Phase 4 dependency.**

### P6 — Statement acquisition is outside the design
Onboarding actually stalls at "download twelve months from six portals", not at the drop zone. WLW rightly
never connects to a bank — but the inbox empty state must at minimum teach where files come from.
**Phase 4; also the strongest argument for a companion tool later.**

### P7 — Password naming and scope on entry
WLC's config holds *named* passwords tried in series. When a user supplies one for a locked file, does it
become a new named entry, get reused across files, or attach to that file alone? "By WLC's convention"
doesn't answer it, and the wrong default quietly builds a list nobody can maintain. **Phase 5.**

### P8 — The provenance header has no mixed-scope form
Export/print carry "the as-of date" — but a family artifact has several, and may exclude a member whose
store wouldn't open. A single date in that header is exactly the dishonesty ADR-0013 exists to prevent.
**Phase 3, where the header is built.**

---

## Worth noting

### P9 — The foreign-currency row shows up in v1 views
ADR-0012's standing test case is not hypothetical the moment one family member banks abroad. Exercise it
through the table, the CSV and the print layout early rather than after release.

### P10 — Activity's durability is promised in one doc and denied in another
bridge-api says a finished job is "still available in Activity" after a tab closes; ADR-0005 says job state
is memory-only and a bridge restart loses it. Both can be true — tab-close is not process-restart — but no
screen says which, so the UI will imply the stronger promise.

### P11 — Per-workspace key ceremony repeats
Folded into P3, but tracked separately because it survives whichever way P3 is decided: the *set* of keys
a family holds needs a design, not just each individual key.

---

## What this changes

Nothing in Phases 1–6 moves. The gate's real output is that **the cold start needs its own phase**, placed
before or beside Phase 0, covering: how the app is installed and launched, what happens when WLC is absent
or skewed, and how the store key is handed to a human being who must not lose it.

Design held up well past that point — which is the useful half of this result.


---

## P12 — Promotion ships in the UI, but has no verb to drive

Found while answering P10. ADR-0006 §1 decided that promotion ships in v1 in its guarded shape, reasoning
that a lifecycle dead-ending at "now open a terminal" breaks exactly the users WLW exists for. That
reasoning stands. The mechanism does not: **WLC has no `promote` verb** — promotion is a runbook step, a
file swap performed by hand under the abort-first gate (WLC lessons-learned L4).

So promotion in WLW today would mean WLW replacing a live store file itself — precisely the store write
ADR-0001 and ADR-0005 forbid. This is P4's shape a second time: a UI built on a verb that does not exist.

**The resolution is upstream, not a workaround here.** WLC should gain `wealthlens promote`: atomic (a
rename, never a copy that can half-finish), refusing to run unless the rebuild it is promoting passed its
check, and reporting what it replaced. That is a better home for the abort-first doctrine than a runbook —
the gate becomes executable instead of remembered.

**Resolved.** WLC now ships `wealthlens promote` (commit `c9fdb41`): eight abort-first gates, a backup, and
an atomic `os.replace`. WLW drives it as a subprocess like every other verb, so ADR-0006's in-UI promotion
has something to call and the ADR-0001/0005 boundary is intact. E2E #1 asserts the guard in front of that
verb.

Its schema gate found a latent WLC bug on its first run — fresh stores stamped 3.8 while structurally being
3.9 — which is a small argument for gates that refuse over gates that warn.
