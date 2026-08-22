# ADR-0006 — Three v1 product decisions: promotion in the UI, the host-accessibility family model, zero password retention

**Status:** ACCEPTED 2026-08-22 (resolves the three open questions in USE-CASES.md)

## 1. Store promotion ships in v1, in the guarded shape

**Decision:** the UI carries the full store lifecycle including promotion — offered only after a completed
`rebuild --check`, with the tally/digest delta rendered, behind a typed confirmation naming the entity
(the shape fixed by ADR-0005). Not CLI-only.

**Why (founder's field evidence):** real onboarding happens over video calls, and even seasoned
professionals are uncomfortable at a command line. More decisively: by the time a user reaches WLC they
have already spent hours working their inbox through document-collector — they arrive *tired*. A lifecycle
that dead-ends at "now open a terminal to promote" breaks exactly the users WLW exists for. The safety
argument was never CLI-vs-UI; it is the guarded shape itself (delta shown, typed confirmation), which a UI
can enforce more reliably than a habit can.

## 2. Family across machines: the host-accessibility model

**Decision:** the family aggregator is whichever host runs the bridge, and it sees exactly the workspaces
**accessible from that host as files** — local paths, mounts, or synced copies, all declared in the
manifest. Every household machine may run its own WLW for its own user with the identical setup. There is
no bridge federation and no WLW-built sync.

**The honest trade, stated in the product:** an accessible live workspace gives immediate data; a synced
copy risks staleness — so family views surface per-workspace freshness (store as-of / file age), and a
copy that lags says so. Staleness is labelled, never smoothed (the honesty doctrine applied to D3).
Bridge federation with authentication remains possible future work under a superseding ADR; nothing in the
manifest precludes it.

## 3. WLW's config store is the manifest — and it avoids holding passwords

**Decision:** `family.toml` is WLW's one config store (per ADR-0002). Passwords are minimized toward zero:
a password supplied in the UI transits once, over loopback, into that workspace's WLC config by WLC's own
conventions, and WLW retains nothing — no copy, no cache, no log, in memory no longer than the single
hand-off requires. WLC's own `remembered.pass` convention is the only memory in the system. If a future
flow seems to need WLW-held credentials, that is a design smell to route back through WLC's config
surface, not a storage feature to add here.

## Consequences

- The v1 surface is the FULL non-technical lifecycle: upload → import → fix passwords → verify → rebuild
  → check → promote → view, terminal-free.
- The bridge needs per-workspace freshness metadata in family responses (family-aggregation spec).
- Multi-machine households get a working answer today (same setup everywhere; aggregate where files
  meet), with the harder federated answer intentionally deferred.
