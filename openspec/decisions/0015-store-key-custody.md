# ADR-0015 — The store key never enters the browser

**Status:** ACCEPTED 2026-08-22

## Context

WealthLens-core generates `store.key` during init and prints a blunt warning: it is the only key to the
encrypted store, and there is no reset. Losing it loses everything. The CLI can afford to print it.

A browser cannot, because project.md's non-negotiable says **keys never reach the browser** — and the UX
validation gate found the two in direct conflict at the single most destructive moment in the product
(UX-VALIDATION P3). It compounds: each workspace has its own key, so a family of four faces this four
times and must retain four separate secrets.

Three ways out were weighed: deliver the key to the clipboard without rendering it (the pattern already
accepted for statement passwords); display it once behind a gated acknowledgement; or never send it at all.

## Decision

**The key never crosses the bridge. The UI walks the user to the file instead.**

The setup flow states the stakes plainly, then acts on the user's machine rather than in the page:

- **Reveal, don't transmit.** The bridge opens the key file's location in the operating system's file
  manager. The user handles the file themselves — copying it into a password manager, a safe, wherever
  they keep things that cannot be replaced. No endpoint returns the key's contents, and no page ever holds
  them.
- **Confirm deliberately.** Setup does not continue on a glance. The user confirms they have stored it,
  and that confirmation is recorded against the workspace with its date.
- **Verify by fingerprint, not by value.** The bridge MAY compute and show a short fingerprint of the key
  — a hash prefix, never the key — so a user can check that what sits in their password manager is the
  right secret for this workspace. This answers "did I save the correct thing?" without the secret ever
  travelling.
- **Track the set, not just the key.** Because keys are per workspace, the family view SHALL show which
  workspaces have a confirmed backup and when, so an unconfirmed one is visible rather than forgotten.
  This is the part that survives regardless of how any individual ceremony is designed.

The clipboard option was rejected despite its precedent: a statement password is re-obtainable from the
institution that issued it, and this key is not. The asymmetry in what is lost justifies the asymmetry in
handling.

## The honest cost

Friction sits at exactly the moment users skip things, and a skipped backup is unrecoverable. We accept
that, and answer it with design rather than by weakening the rule: the stakes are stated in plain words,
the confirmation is explicit, and an unconfirmed workspace stays visible in the family view until it is
resolved. If evidence later shows households still losing keys, the fix is a better ceremony — or a
superseding ADR argued on that evidence — not a quiet relaxation.

## Consequences

- The bridge needs one narrow OS integration: reveal a path in the file manager. It is not a general
  "open anything" capability and should be scoped to workspace paths.
- Backup state (workspace, confirmed, when, fingerprint) is state — and WLW has no database (ADR-0002).
  It therefore belongs in the **manifest**, which already holds per-entity facts and stays harmless if
  public: a fingerprint and a date are not secrets.
- A workspace connected rather than created (an existing WLC user) starts unconfirmed, which is correct —
  we do not know whether they ever backed it up, and the family view saying so is a service, not a nag.
- "Keys never reach the browser" survives intact and literally true, which keeps it usable as a rule
  contributors can apply without consulting an exceptions list.
