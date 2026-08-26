# ADR-0001 — WLW is a separate repo: custodian and presenter are different products

**Status:** ACCEPTED 2026-08-22

## Context

WealthLens-core is deliberately minimal: encrypted per-entity stores, oracle-gated parsers, a CLI, and a
read-only notebook lens. Its credibility rests on that minimalism — every line is in service of provable
data custody. Meanwhile real households want what minimalism doesn't give: guided setup, dashboards, and one
view across the family. A contributor has already built a local report server against WLC internals; the
first user request on the table is "track my holdings and my wife's in one app."

## Options considered

1. **Grow the UI inside WLC** (merge the report server). Rejected: couples the custodian's release cadence
   and review bar to UI churn; every UI dependency (web stack, JS toolchain) lands in the repo whose pitch
   is "read the source — that's the point"; and UI contributors would need custodian-level review scrutiny.
2. **Closed/companion app.** Rejected: the project's trust model is open source end to end.
3. **Separate open-source repo (this one), consuming WLC's public read surface.** Chosen. Same split the
   project already applies elsewhere (WLC vs the analytics/market repos): the custodian stays small and
   auditable; the presenter iterates fast with a different contributor pool; the boundary is an API, so it
   is testable and enforceable.

## Decision

WLW is its own MIT-licensed repo. **WLC owns the truth; WLW shows it.** WLW never parses, never writes a
store, and depends only on WLC's public read surface (`lens.py` + the `import --json` CLI contract). Any
data need the surface can't meet is fixed upstream in WLC, never by reaching around the boundary.

## Consequences

- WLC's minimalism is protected structurally, not by review vigilance.
- The boundary forces `lens.py` to become a real, versioned API (cross-repo task with WLC).
- Cost: two repos to govern, and integration bugs live at the seam — mitigated by pinning the WLC version
  the bridge is tested against.

## Amendment 2026-08-26 — transporting a file is not reading it (the LAN open)

"WLW never reads a statement" has always meant WLW never **parses or interprets** its contents — that is the
custodian's job, behind WLC's gates. It did not mean the bytes may never pass through the bridge process.
Opening a collateral file made that distinction concrete. Asking the server's OS to open the file is right
only when the browser is on the same machine as the bridge; a household member reaching the app across the
LAN (e.g. `http://aipc.local:8765` from a phone) would otherwise trigger the file to open on the *server*,
where they never see it. So for a non-loopback peer the bridge now **streams the file to that browser**.

This is a deliberate, minimal carve-out, and it stays inside the split: the bridge moves the **owner's own
file to the owner**, still never opening, parsing, or deriving anything from the bytes. It is guarded exactly
like the local open — `collateral.resolve_document_path` containment — and, being a POST, sits behind the
session token a foreign page cannot read (ADR-0004). The choice of delivery is made by the request's real
peer address (`_peer_is_local`), which assumes a direct connection with no reverse proxy rewriting it.
