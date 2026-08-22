# Use cases — who WLW serves, and what each flow really demands

The design source for the capability specs: every requirement should trace to a numbered use case here,
and every use case names the constraint it puts on the architecture. Evidence informing these is real:
WLC's first non-developer onboarding test found install/config/first-import all flaky (the user was
rescued by an IDE assistant mid-import) — WLW exists to make that person self-sufficient.

## Personas

> Field evidence shaping all of this: the founder onboards users over Google Meet / WhatsApp video, often
> with a desktop AI agent doing most of the workload; even seasoned professionals hesitate at a command
> line; and a new user typically reaches WLC only AFTER hours of inbox work in document-collector — tired.
> WLW's bar is that the entire lifecycle is completable in that state, in the browser.

- **P1 — Household member, non-technical.** Downloads statements from net-banking; will never open a
  terminal. Wants: drop the file somewhere, see numbers, be told plainly when something needs attention.
- **P2 — Family operator.** Set up WLC, understands workspaces and passwords, runs the bridge. Wants the
  operational surface (rebuild, verify, prices) without babysitting a terminal, and wants P1 family
  members to be self-sufficient.
- **P3 — Contributor.** Hits an unsupported statement; needs the shortest path from "didn't parse" to a
  useful, PII-free report upstream.

## UC-A — Onboarding and setup

- **A1. First run**: no workspace exists → guided creation (drives `wealthlens init`), explains the
  store key's importance, ends with a working single-entity view.
- **A2. Connect existing workspace(s)**: pick a folder, validate (opens read-only, schema compatible),
  declare in the manifest.
- **A3. Add a family member**: A1 or A2 under a new entity id + label.
- **A4. Statement passwords via browser**: when an import reports a file locked (🔒), P1 supplies the
  password in the UI; it lands in *that workspace's* WLC config by WLC's own conventions and the import
  retries. Constraint: the password transits once, over loopback, is never echoed back, logged, or stored
  by WLW.

## UC-B — The daily loop (P1's whole world)

- **B1. Upload a statement in the browser**: drag-drop → the entity's `statements/` inbox. Constraints:
  target is the inbox and nothing else; extension allowlist (what WLC dispatch accepts); never overwrite
  (WLC's non-clobber naming); upload is DEPOSIT-ONLY — parsing/custody remain WLC's import gates.
- **B2. Import and see the verdict**: trigger import, render WLC's per-file outcomes verbatim —
  imported / needs-attention with warning types (footing break, units incomplete, locked, unrecognized).
  A locked file flows to A4; an unrecognized one flows to C4.
- **B3. See the money**: per-entity and family views (report-views spec), with basis/as-of honesty.

- **B4. Record a fact no document can supply**: unlisted shares, a let-out property's rent, a
  hand-reconciled corporate action, or a stopgap value awaiting its real statement → a guided form writes
  `manual/*.yaml` in WLC's ITR-2 vocabulary (manual-facts spec). Constraint: this is CORPUS, so it is
  replayed on every rebuild and the UI must say the store is behind until re-applied. Documents are
  always offered first; manual entry is the exception, not the shortcut.

## UC-C — Operations in the browser (P2)

The principle: **WLW surfaces WLC's verbs; it never re-implements them.** Each is a subprocess of the
real CLI, so every gate WLC has (oracles, provenance, PII hooks) applies unchanged.

- **C1. Status dashboard**: integrity report, continuity-chain summary (chained/breaks/gaps), units
  coverage, last import per entity, store schema version — the `verify` family, always visible.
- **C2. Rebuild + check**: run `rebuild --check` per entity, stream progress, render the tally and digest
  comparison when done.
- **C3. PROMOTION is a guarded, explicit act.** Overwriting the live store is the one destructive step in
  the whole system. The UI may offer it ONLY after a completed `--check`, showing the delta/tally, behind
  a typed confirmation naming the entity — the product form of the project's abort-first promotion
  doctrine (WLC lessons-learned L4). No one-click promote, ever. **In v1** — ADR-0006 §1.
- **C4. Diagnose an unsupported statement**: run `wealthlens diagnose`, render the masked report, with a
  "copy for a GitHub issue" affordance — the contributor funnel, in the browser.
- **C5. Market data**: trigger `fetch-prices` / `fetch-instruments` / `fetch-fx`; show capture results.
  These are WLC's only network verbs; WLW adds no network calls of its own.

**Cross-cutting constraint (the lock lesson):** DuckDB write and read attaches conflict. WLC's own history
includes a live import failing against an open notebook with a misleading error. Therefore the bridge
maintains a **per-workspace job model**: one WLC verb at a time per workspace, read handles for that
workspace closed for the verb's duration, job state held in memory only (ADR-0002: it may be lost on
restart; the subprocess's own outcome is still in WLC's hands).

## UC-D — Family shapes

- **D1. Family view** over N entities (family-aggregation spec).
- **D2. An entity with several workspaces.** Real case: a person with a legacy workspace beside a current
  one. The manifest allows `workspaces = [...]` per entity; aggregation treats them like family
  aggregation does entities — read-time, attributable to the workspace.
- **D3. A remote entity's workspace.** Real case in the founding family: one member's store lives on
  another machine. **Resolved: the host-accessibility model** — ADR-0006 §2.
- **D4. Who may see whom.** The moment more than one person USES the UI (vs one operator viewing all),
  visibility scoping is required. Deferred with phase-2 auth (ADR-0004) — but the manifest format must
  not preclude a future viewer model (per-entity visibility is a manifest concern, not a store concern).

## Resolved questions → ADR-0006

1. **C3 promotion: IN v1**, in the guarded shape (post-`--check`, delta rendered, typed confirmation).
   The founder's field evidence decided it: onboarding happens over video calls, even pros resist the
   terminal, and users arrive at WLC already tired from hours of document-collector work — the UI must
   carry the full lifecycle.
2. **D3 remote workspaces: the host-accessibility model.** The aggregator host sees the workspaces
   accessible to it as files (local, mounted, or synced — declared in the manifest); every machine can run
   its own identical WLW; a synced copy's staleness is surfaced per workspace, never smoothed. No bridge
   federation, no WLW-built sync (future work behind a superseding ADR).
3. **A4 passwords: zero retention.** One loopback transit into WLC's own config; WLW keeps nothing;
   WLC's `remembered.pass` is the only memory in the system.
