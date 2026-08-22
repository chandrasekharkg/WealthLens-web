# UX — first pass

The information architecture and screen definitions for v1. Written to be argued with: this is the
socialization artifact, not a finished design. Every screen traces to a use case in
[USE-CASES.md](USE-CASES.md); every guard rail traces to an ADR.

## Starting point: what already exists, and what it got right

The seed is the report UI in WealthLens-core PR #1 (Krishnus). Reviewed honestly, it is further along
than "a dropdown and a table" — three of its decisions are **kept as-is** and become house patterns:

| His decision | Why it stays |
|---|---|
| **Profile picker + an "all profiles" mode with a per-row profile badge** | This is family aggregation *with attribution* — the family-aggregation spec's hardest requirement, already solved in the UI. |
| **A `Basis` column on net worth, and as-of tooltips that separate "quantity confirmed by a CAS as of X" from "priced as of Y"** | Exactly the honesty doctrine: the UI's polish never exceeds the data's honesty. Most dashboards would have shown one number and one date. |
| **Client-side sort / search / type + broker filters, with count + total footers** | The right interaction model for tables users interrogate rather than glance at. |

What it does not have — and what this pass adds — is the **shell**: everything that is not "show me the
numbers". Setup, workspaces and their collateral, family management, the operational verbs, and health.
That absence is not an oversight on his part; it was a report server, and it did that job well.

## Design principles

1. **The lifecycle is completable in the browser, by a tired person.** (ADR-0006 §1.) Every step from
   "I have a PDF" to "I trust this number" has a screen. No step says "now open a terminal".
2. **Honesty is a first-class UI element, not a footnote.** Basis, as-of, freshness, footing breaks and
   "needs attention" are rendered where the affected number is — never only in a log.
3. **Destructive acts look destructive.** Exactly one exists (promotion). It is unreachable except
   through its guard (ADR-0005), and it never appears as a casual button beside a refresh icon.
4. **Whose money is this?** is always answerable on screen — badge, filter, or column.
5. **The custodian is visible.** Store paths, schema versions, and file locations are shown, not
   abstracted away. Users who want to see the DuckDB file get a link to reveal it.
6. **Nothing spins forever.** Verbs are long-running subprocesses; every one has progress, a cancel where
   safe, and a result that persists in Activity until dismissed.

## Information architecture

```
┌──────────────┬──────────────────────────────────────────────────────────┐
│  WealthLens  │  [ Context bar: ▾ Family / entity ] [ as of ▾ date ]     │
│              ├──────────────────────────────────────────────────────────┤
│ ▸ Overview   │                                                          │
│ ▸ Reports    │                       ( area )                           │
│ ▸ Family     │                                                          │
│ ▸ Activity   │                                                          │
│ ▸ Settings   │                                                          │
│              │                                                          │
│  ● 2 need    │                                                          │
│    attention │                                                          │
└──────────────┴──────────────────────────────────────────────────────────┘
```

- **Context bar is global and sticky.** Entity/Family + as-of date apply to every area that has an
  opinion about them (Reports certainly; Overview shows both scoped and per-entity).
- **The sidebar carries the attention count** — the number of files/entities in a non-clean state. It is
  the app's conscience: if anything is unverified, stale, or failed, the badge shows it everywhere.

## Screens

### 1. Overview — "is my picture trustworthy right now?"

The operator's landing page (P2), and the honest answer to "can I believe the total?".

```
 Family net worth  ₹ X,XX,XX,XXX      as of 22-Aug-2026
 ┌ per entity ────────────────────────────────────────────────────────┐
 │ Me        ₹ …    ✓ verified   last import 2h ago   store 3.9       │
 │ Spouse    ₹ …    ⚠ 1 file needs attention          store 3.9       │
 │ Dad       ₹ …    ⏳ workspace copy is 6 days old    store 3.8 ⚠     │
 └────────────────────────────────────────────────────────────────────┘
 ⚠ Needs attention (2)
   • spouse · HDFC-Aug.pdf — password required            [ Supply password ]
   • dad    · workspace freshness — synced copy is stale  [ How to refresh  ]
```

Each entity card shows: value contribution, verification state (integrity + continuity + units
coverage rolled into one honest badge), last import, store schema version, and **freshness** where the
workspace is a copy (ADR-0006 §2). Clicking a card opens that entity's Workspace detail.

### 2. Reports — Krishnus's screen, kept and extended

Tabs: **Net Worth · Holdings · Spending · Point-in-time**. Net Worth and Holdings are his existing
views, unchanged in substance (basis column, profile badges, sort/filter/search, count+total footers).

Additions:
- The **as-of date moves to the global context bar** (it applies to more than this screen now).
- **Freshness/warning strip** at the top when the current scope includes a stale or unverified entity —
  the number is still shown, never suppressed, with the caveat attached.
- **Drill-down**: a combined family row expands into its per-entity parts (family-aggregation spec).
- Export (CSV) per view — the escape hatch to a spreadsheet, which real users will want.

### 3. Family — the manifest, as a screen

Lists entities from `family.toml`; the only place the manifest is edited.

```
 Entities                                          [ + Add family member ]
 ┌──────────────────────────────────────────────────────────────────────┐
 │ Me      "me-WealthLens-data"          ~/WealthLens/…   ✓  [ Manage ]  │
 │ Spouse  "spouse-WealthLens-data"      ~/WealthLens/…   ✓  [ Manage ]  │
 │ Dad     2 workspaces (current + legacy)                ⏳ [ Manage ]  │
 └──────────────────────────────────────────────────────────────────────┘
 Discovered but not added: kgdata-WealthLens-data        [ Add ] [ Ignore ]
```

- **Discovered ≠ included** (family-aggregation spec): the app may *offer* a workspace it finds; only an
  explicit add puts it in the manifest.
- An entity may hold several workspaces (UC-D2) — shown as a group, aggregated with per-workspace
  attribution.
- Add flow = create new (drives `wealthlens init`) or connect existing (validate → declare).

### 4. Workspace detail — the per-store pane

Reached from Overview or Family. **This is the screen that makes the custodian visible.** Four tabs:

**Config** — store file path with a *Reveal in file manager* link, key file presence (never contents),
schema version + migration status, WLC version, configured passwords **by name only** (`hdfc.pass` ✓
configured — never the value), workspace size, last modified.

**Collateral** — the `statements/` tree: what has been filed where, what is still in the inbox, what
failed. Each file: name, detected type, import outcome, and a *reveal* link. **Upload lands here**
(drag-drop → inbox, ADR-0005). This is the "look into the collateral" pane — the user's own words, and
the thing no current tool gives them.

**Health** — this workspace's integrity report, continuity chain (chained / breaks / coverage gaps),
units coverage, per-source counts. The detail behind Overview's badge.

**Manual facts** — the guided authoring surface for `manual/*.yaml` (manual-facts spec): the facts no
document can parse — unlisted equity, let-out property, a hand-reconciled corporate action, or a stopgap
value awaiting its real statement. Lists existing entries with their fidelity tier and supersession state;
"+ Record a fact" opens a form in WLC's own ITR-2 vocabulary. **These are corpus, not settings** — the tab
says so, and any change marks the workspace as having un-applied corpus changes.

**Operations** — the verbs for *this* workspace: Import · Verify · Fetch prices/instruments/FX ·
Rebuild & check → Promote. One at a time (the per-workspace job model, ADR-0005), with progress.

### 5. Activity — the job log

Every verb run: what, which workspace, when, duration, outcome, and the full output retained until
dismissed. Long-running jobs stream here. This exists because subprocess output is evidence, and because
a user who walks away must be able to find out what happened.

### 6. Settings — global only

App preferences (theme, currency display, number format), manifest file location + *reveal*, versions
(WLW, bridge, WLC, supported store schema range), and About/licence. **Per-store settings live in
Workspace detail**, not here — a deliberate split, because "settings" that are really per-entity are
where multi-profile apps get confusing.

## The four flows that matter most

**A. Locked statement → imported** (UC-A4/B2, the commonest non-technical dead end)
`Import` → result lists `HDFC-Aug.pdf 🔒 password required` → **[Supply password]** inline → password
posts once over loopback → written to that workspace's WLC config → import retries automatically → row
turns ✓. The user never learns what a `.pass` file is.

**B. Upload → import → verdict** (UC-B1/B2)
Drag onto Collateral (or anywhere in the workspace) → file lands in the inbox with its detected type →
`Import` → per-file verdicts rendered verbatim from `import --json`, warnings intact.

**C. Rebuild → check → promote** (UC-C2/C3 — the one destructive path, ADR-0005/0006 §1)
```
 [ Rebuild & check ]  →  progress …  →  ┌ Result ─────────────────────────┐
                                        │ 6 tables differ                  │
                                        │ position_snapshots  2355 → 2357  │
                                        │ holding_events       864 →  868  │
                                        │ instruments          143 →  142  │
                                        │ integrity: CLEAN                 │
                                        │ [ Discard ]  [ Promote… ]        │
                                        └──────────────────────────────────┘
 Promote… →  "This replaces Spouse's live store. A backup is kept.
              Type the entity name to confirm:  [ Spouse ]   [ Promote ]"
```
Promote is unreachable without a completed check; the delta is shown, not summarized away; confirmation
is typed. A backup is stated as fact because WLC makes one.

**D. Recording a fact no document can supply** (manual-facts spec)
```
 Workspace ▸ Manual facts ▸ [ + Record a fact ]
   ① What kind?      Unlisted equity · House property · Corporate action · Other (table+key)
      ⓘ "Could a document supply this? Importing the statement is always better."   [ Import instead ]
   ② The fields       — labelled as ITR-2 labels them (HeldUnlistedEqShrPrYr / ScheduleHP …)
   ③ How certain?     ○ Authoritative — a parser must never overwrite this
                      ● Stopgap — a placeholder; a real document will supersede it
                      ○ Reference — kept to verify the rebuild
   ④ Evidence         attach the AGM notice / valuation / screenshot this came from
   → validated against the live schema BEFORE writing → manual/<name>.yaml
   → banner: "Corpus changed — import or rebuild to apply."      [ Import now ]
```
Stopgap entries stay visibly provisional in the list, and show as superseded once a higher-fidelity
parsed source covers the same fact — the fidelity ladder made visible rather than buried in YAML.

**E. Unsupported statement → contribution** (UC-C4)
An `unrecognized` import row offers **[Diagnose]** → runs `wealthlens diagnose` → renders the masked
report with a plain-language preamble ("this describes the layout only — no amounts, names or account
numbers") and **[Copy for a GitHub issue]**. The contributor funnel, in the product.

## Open questions for the first reviewer (Krishnus)

1. **Nav shape**: left sidebar (assumed here) vs. his existing top-tab model extended. Sidebar scales to
   6 areas; tabs are lighter for the 2-view case.
2. **Where does the as-of date belong** — global context bar (assumed) or per-report? Global is
   consistent; per-report avoids surprising a user whose date silently applies elsewhere.
3. **Entity switching vs. family-first**: does the app open on Family (aggregate) or on the last-used
   entity?
4. **How much of Workspace detail does a P1 household member ever see?** Possibly none — a case for
   role-lite view modes well before phase-2 auth exists.
5. **Manual facts**: is per-workspace (assumed here, since the YAML is corpus in that workspace) the
   right home, or do users think of "my unlisted shares" as a family-level thing to record once?
6. **Anything in the shell that his own users have already asked for and this pass misses.**
