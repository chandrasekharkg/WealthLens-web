# ADR-0020 — LAN serving on a trusted home network, and the honest write surface

**Status:** ACCEPTED 2026-09-04 · **Supersedes [ADR-0004](0004-bridge-and-security-posture.md)** on the LAN /
phase-2 question · Records the as-built state a 2026-09-04 scale-readiness review found the top-level docs
misrepresenting.

## Context

[ADR-0004](0004-bridge-and-security-posture.md) set a two-phase security posture: phase 1 binds loopback only,
and **"phase 2 (LAN / family devices) DOES NOT EXIST until an ADR supersedes this one … No `--host 0.0.0.0`
flag ships before it."** Two things have since diverged from that text, and the review (§C3) caught the docs
lagging the code:

1. **LAN serving already ships and is in daily use.** `serve.py` reads a `WLW_HOST` env var (`bound_to()`),
   and the production runbook launches the bridge as `WLW_HOST=aipc.local … uvicorn … --host 0.0.0.0 --port
   8765` so a household member can reach it from a phone. [ADR-0001's 2026-08-26 amendment](0001-custodian-presenter-split.md)
   already presupposes exactly this — it streams a collateral file to a **non-loopback** peer at
   `http://aipc.local:8765`. So the `--host 0.0.0.0` that ADR-0004 said "ships before no ADR" is already
   shipped, governed only by an amendment scoped to *file transport*, never by a decision about the socket
   bind itself.

2. **The "read-only, one write endpoint" framing was never accurate.** README/ARCHITECTURE/project.md
   described the bridge as a "stateless read-only presenter" with "one write-ish endpoint (POST /import)". The
   bridge in fact exposes a **closed, enumerated set of eight non-GET side-effecting routes** (settings write,
   secret reveal, collateral open, upload, inbox delete, diagnose, raw-parse, and the generic verb runner) plus
   one GET that renders a page via a subprocess. `bridge-api/spec.md` already retracted the "one write endpoint"
   claim ("no store writes, and a list short enough to audit"); the top-level docs had not caught up.

This ADR records the decision the codebase already embodies, makes its assumption explicit, and states plainly
what is **still** unbuilt — rather than leaving an authoritative ADR contradicting the running system.

## Decision

**1. LAN serving is a supported capability on a *trusted* home LAN, off by default.** The bridge binds
`127.0.0.1` unless `WLW_HOST` names another address AND uvicorn is launched with a matching `--host`. That is a
deliberate, documented capability — not an accident to be walled off — for the founding use case (one person
sets it up; a household member views from another device on the same home network).

**2. The security boundary is "the trusted home LAN", and it is the same trust boundary as WLC's own CLI.**
The controls that ship are: loopback-only default; a `LocalOnly`/`Host`-header + `Origin` (DNS-rebinding /
CSRF) guard; a per-session token the SPA obtains at page load, required on every state-changing endpoint; and
peer-address routing for the collateral `open` (OS-open only for a loopback peer, file-stream for a remote
peer, per the ADR-0001 amendment). Secrets and store keys never leave the bridge process.

**3. There is deliberately NO per-user authentication model yet — this is the trusted-LAN assumption, and it
is a real limitation, stated openly.** Any device on the LAN that can reach the host and load the page obtains
a session token and can view whatever workspaces the manifest presents; there is no per-viewer login and no
per-entity viewer authorization. This is acceptable ONLY under the assumption that the home LAN and every
device on it are trusted (the same assumption that makes a plaintext `hdfc.pass` on the machine acceptable, cf.
[ADR-0019](0019-secret-exposure.md)). It is NOT acceptable on an untrusted or shared network.

**4. The write surface is the closed enumerated set in [`bridge-api/spec.md`](../specs/bridge-api/spec.md), not
"one endpoint".** No endpoint writes a WLC store; every side effect is a hand-off to WLC (a verb subprocess, an
inbox deposit, a config/secret write by WLC's own convention) or a write of WLW's own manifest. The docs SHALL
describe it that way.

## Still open (explicitly deferred, not resolved here)

The hard parts ADR-0004 named remain unbuilt, and this ADR does **not** pretend otherwise:

- **A real authentication model** (per-viewer identity) for any use beyond a trusted home LAN.
- **Transport security** (TLS) on the LAN — traffic is currently plaintext HTTP.
- **Per-entity viewer authorization** — does a viewer see every family member's data, or only their own? The
  manifest still has no viewer model.

Serving on anything other than a trusted home LAN SHALL wait for a further ADR that resolves these.

## Consequences

- The authoritative docs now match the running system: LAN serving is real and bounded by a stated trust
  assumption, and the write surface is described as the closed enumerated set.
- The trusted-LAN assumption is now written down where a future contributor (or the household) can weigh it,
  rather than being an undocumented property of the launch command.
- ADR-0004's phase-1 controls (loopback default, Host/Origin guard, session token, no store writes) still
  stand — this ADR supersedes only its "phase 2 does not exist / no `--host 0.0.0.0`" clause.
