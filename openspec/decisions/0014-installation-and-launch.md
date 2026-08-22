# ADR-0014 — Installation and launch: a guided installer, then a launcher

**Status:** ACCEPTED 2026-08-22

## Context

The UX validation gate found that step zero had no owner (UX-VALIDATION P1). Every use case begins with a
browser already showing WealthLens; nothing said who put Python and WealthLens-core on the machine.
ADR-0009 chose "native first" but never said what native *contains*.

Three candidates were weighed:

1. **Bundle everything** into a signed native app — one download, nothing assumed. The most forgiving for a
   household, and the most expensive: per-OS packaging and signing, a bundled Python runtime, and WLC
   upgrades become WLW's responsibility rather than the user's.
2. **Assume WLC is installed** — cheapest, purest boundary, and it fails the people this repo exists for.
   That is today's situation, where onboarding happens over a video call.
3. **A guided installer that then launches** — a bootstrapper prepares the environment and starts the app.

## Decision

**A guided installer prepares the machine; a launcher starts the app.**

The installer's job is narrow and stated: ensure a suitable Python, install WealthLens-core and the bridge,
create a launcher the user can run again, and open the browser at the local address. It is a **setup
step, not a runtime** — once it has run, WLW starts through the launcher and the installer is not involved.

This buys the household a path that does not begin with a terminal, without WLW taking ownership of a
bundled runtime or a per-OS signing pipeline it cannot yet maintain. It is the middle path, chosen with
its cost acknowledged rather than hidden.

**The installer never becomes a second custodian.** It installs software. It does not create workspaces,
touch stores, generate keys, or write configuration — those remain WLC's, driven through the guided setup
that runs *after* launch (ADR-0005). An installer that also set up data would quietly become the thing
this project spent thirteen ADRs avoiding.

**Failure is the design problem, not the happy path.** Unattended environment setup fails in ways that are
hard to debug remotely, so the installer SHALL report what it did, where, and what failed — in a form the
user can send to someone. A silent failure on a household's machine is unfixable at a distance.

**The runtime must not assume the installer's world persisted.** A user can upgrade WLC independently,
move a folder, or use a machine where a colleague installed things differently. Preflight (cold-start
spec) therefore checks WLC's presence and version at every launch, not once at install.

## Consequences

- Phase 00 gains a real deliverable: the installer, its failure reporting, and the launcher.
- Platform priority is evidence-led, not anticipated (the ADR-0009 rule): start where the users are, add
  platforms when someone is blocked on one, not before.
- Bundling stays available as a later graduation if installer failures prove to be the dominant support
  cost. That would supersede this ADR, and the trigger is real support evidence.
- The boundary statement gains a clause worth saying out loud: **WLW installs the engine; it still never
  operates the store.**
