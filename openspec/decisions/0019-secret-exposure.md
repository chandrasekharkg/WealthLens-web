# ADR-0019 — Reveal what can be re-obtained; never reveal what cannot

**Status:** ACCEPTED 2026-08-23 · Resolves the contradiction found in the design review (UX-VALIDATION)

## Context

Two current specs gave opposite instructions about secrets, and the design review caught it:

- `collateral-and-sources` says the value behind a password reference is released on an explicit action and
  **delivered to the clipboard**.
- `bridge-api` says **no endpoint** returns store keys, statement passwords, or the contents of a
  workspace's secret files.

Both cannot hold. Phase 5 shipped the legible half — the ring shows *references* — and left the reveal
unbuilt rather than guess at a security-relevant answer.

The unblocking argument is the household's own posture: a laptop behind a login password is already the
trusted surface these files sit on. `hdfc.pass` is plaintext on that disk, readable by any process running
as that user. A local bridge reading it, and a local page displaying it over loopback, does not change what
an attacker with that machine already has.

## Decision

**A secret that can be re-obtained may be revealed deliberately. A secret that cannot, never is.**

That line is not new — ADR-0015 already used it to reject the clipboard for the store key: *"a statement
password is re-obtainable from the institution that issued it, and this key is not. The asymmetry in what
is lost justifies the asymmetry in handling."* This ADR applies the same test to the rest.

| Secret | Re-obtainable? | May be revealed |
|---|---|---|
| Store key (`store.key`) | **No** — lose it and the data is unrecoverable | **Never.** ADR-0015 stands unchanged |
| PAN | Yes — the household knows their own | Yes, deliberately |
| Statement password | Yes — the institution reissues it | Yes, deliberately |

**Deliberately** means, precisely: one secret, one document or field, per explicit user action, on a
dedicated endpoint that never appears in any listing, never written to a log or an error, and recorded in
Activity as an event without the value.

**Reading is broader than revealing.** The bridge MAY read secret values from a workspace's configuration
for its own use — it must, to do anything with them. That is separate from returning one to the page, and
the endpoint rule above governs only the latter.

## Why the boundary sits where it does

The counter-argument deserves stating, because it is the reason the line was drawn here originally. The
browser is a *different* exposure surface from the filesystem: a malicious page cannot read `hdfc.pass`,
but if the bridge will hand a password to a page, then any weakness in the Host/Origin/token guard becomes
a **password disclosure** rather than merely a data one.

That risk is accepted for re-obtainable secrets and refused for the store key, which is exactly what the
re-obtainability test is for: the blast radius of the first is an inconvenience, and of the second, the
household's entire financial history.

## Proving a password works, without parsing anything

`identity-and-settings` requires that a saved password be *demonstrated* rather than assumed. WLW cannot
open the PDF itself — it never parses a statement (ADR-0001) — and `import` takes no password argument.

So the proof is **by retry, not by inspection**: the password is added to the ring, the import is re-run,
and WLC's own per-file verdict says whether the file opened. No document is ever opened by this app, and
the demonstration is the engine's, which is the only opinion that counts anyway.

## Consequences

- `bridge-api` gains one **named** exception rather than a blanket contradiction, and the exception is
  shaped so it cannot widen: one value, one request, its own endpoint, never in a listing.
- The store key keeps its own rule, and that rule is now justified by a stated test rather than by being
  the older decision.
- "Use it once, written nowhere" remains unbuildable and is not made buildable by this: `import` still has
  no password argument, so a one-time password cannot reach the engine without being written down. That
  needs a WLC change, tracked separately.
