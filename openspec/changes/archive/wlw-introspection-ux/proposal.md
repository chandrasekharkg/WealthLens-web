# wlw-introspection-ux — a one-pass, layer-by-layer provenance/introspection pass over the web app

> **Status: ✅ IMPLEMENTED (2026-08-26).** Raised 2026-08-26 (KG collated UX feedback); refined after review.
> Grounded in a three-way code recon (bridge data surface, frontend structure, WLC engine data availability) —
> every AVAILABLE/PARTIAL/MISSING verdict carries schema/file evidence. Executed **layer-by-layer: SQL/store →
> Lens → Bridge → UI** (KG's sequencing call), each layer green before the next built on it. Verified live on the
> demo Nair store. See **Closed** at the foot for the full landed-vs-carried-forward tally.
>
> **The two backbone primitives shipped end-to-end.** Primitive A (the provenance/audit column group — `source`
> + the created/updated audit quartet, hidden by default in every table's Columns picker) and Primitive B (click a
> row's *Source* → a popup with the document's filename [opens via the OS], period, parser, copy-password, and the
> tables it wrote). Rolled across the Bank ledger, card statement lines, family transfers, and the holding diary.
>
> **Where it landed (WLC main + WLW main):**
> - **Layer 1 (WLC store/adapters, `8d9de60` + card action-tuple `a1e1760`/`12053bd`):** card min-due/due-date/
>   statement-date/masked-number → `sources.detail` (validated on KG's + dad's real corpora, zero-value months
>   survive); CAS period fix; `detailed_holding_diary` added to `_SOURCED_FACTS`; `capture_io.source_table_counts()`.
> - **Layer 2 (WLC lens, `2b8d900`):** `card_paid_status()`, `source_detail()`, `source_tables()`, `asset_groups()`,
>   and `source_id` + audit quartet on the fact projections. (`holdings`/positions source_id deferred — an
>   aggregate-source nuance.)
> - **Layer 3 (WLW bridge, `705fb8c`):** `_prov()` carries source_id + audit onto every fact-row DTO (the aggregate
>   fan spreads them through unchanged); `GET /api/source/{entity}/{id}` (one payload = provenance + collateral
>   `DocumentInfo` + tables-it-wrote, fails soft on an unknown id); card paid-status on the cards response; the
>   growth-chart round axis-ticks (`_nice_axis_step`).
> - **Layer 4 (WLW UI, `6887eea`):** `SourcePopup.tsx` (Primitive B); `lib/provenance.tsx` = `provenanceColumns()` +
>   `useColumnVisibility()` (Primitive A), rolled across the four fact tables; the **Card Star** (paid-state badge on
>   the picker + statement); **"Bank ledger"** rename + a **bank facet**; Performance breakup legibility (the Tier-2
>   classes epf/ppf/nps/gratuity gained `class.*` labels + distinct palette colours; cash-vs-FD was already split).
>
> **Carried forward (per-tab polish, NOT blockers — see Closed):** Workspace screen enhancements (item 17 — category
> facet, 10-doc default, passwords-as-table, per-source tables-updated *on the Workspace screen*; the popup already
> shows tables-updated); Performance unified fonts + explicit gridlines (item 18, beyond the label/colour fix);
> Bill-payments honest-linkage labels + statement-date on the card tile (items 19/15). These are cosmetic follow-ups.

## Decisions locked in review (2026-08-26)

1. **Payables — DEFERRED.** Not modelled in this pass. It'll be a brand-new capability designed against a REAL
   outstanding-loan example, validated by a collaborator (identified via the onboarding sequence) who actually
   holds one. Removed from scope here; see §Deferred.
2. **"WHO" columns = the AUDIT QUARTET, not beneficiary.** The columns wanted are the ones already on the shared
   audit block — **`created_by`, `created_at`, `updated_by`, `updated_at`** — enriched by **source / store_id**
   in a multi-store view. No beneficiary/owner modelling. Purpose: visually inspect *when a statement was
   loaded / what was going on*. (These already exist on every table — see Primitive A.)
3. **"Open file" (B-1) — confirmed posture.** Popup exposes a **Copy** for the file's password so KG opens the
   statement himself under the existing security posture. The crux is *convenience for cross-checking*: while
   looking at data, pop up → copy password → right-click "open in new window" → close popup → compare
   statement side-by-side. Store key is never revealed.
4. **Card star — include "paid ≥ minimum".** So `minimum_amount_due`/`due_date` capture IS in scope.
5. **Family tab — leave the linkage as-is.** No UPI/mobile matching, no disclosure banner. It still receives the
   universal provenance/audit columns + file popup (item 7.2), but its name-based transfer logic is untouched.

## The shape

Every remaining item collapses into **two backbone primitives** (which merge into one "provenance & audit
visibility" theme), plus per-tab polish, plus a few small engine touches. The recon's headline: **both
primitives are almost entirely projection/plumbing over data that already exists in the store** — every fact
table already carries the audit quartet AND `source_id`; the file-open and password-copy endpoints already
exist. The one missing wire is that the **lens/bridge fact projections drop these columns today.**

---

## Primitive A — Provenance/audit columns, pickable on every table

**What.** A **column group** — `source` (file), `created_by`, `created_at`, `updated_by`, `updated_at`, and
`whose` (store/`entity_label`, multi-store only) — **present in every table's column picker, default hidden**,
toggled on to inspect "when/how did this row get here."

**Reality check (all AVAILABLE, no migration).** Every fact table already has the audit quartet + `source_id`
(`bank_transactions` schema.sql:313-317, `position_snapshots` :335-336, and the universal audit-block
convention, schema.sql:6). The shared `DataTable` (`frontend/src/components/DataTable.tsx`) already has a
built-in column picker; only `Reports` wires it. `entity_label` is already stamped per aggregate row
(`aggregate.py:235`). **So the work is: SELECT these columns in the lens → carry them in the bridge DTOs → wire
the picker per screen.** Zero schema change.

**Design.**
- Lens fact projections add `source_id, created_by, created_at, updated_by, updated_at` to their SELECT.
- Bridge DTOs + `core/lens_api.py` projections carry them through.
- UI: extract a shared `useColumnVisibility(key)` hook from `Reports.tsx`; every screen wires the picker and
  gets the provenance/audit group (default hidden). Normalize the store column id to `whose`.
- Tile screens (Cards, Family): the *sub-tables* get the group; the tiles keep their existing WHO line.

*Minor implementation choice (not blocking): per-screen persistence key (`wlw.columns.<screen>`) vs the current
single global `wlw.columns`. Recommend per-screen. Will confirm at build time.*

## Primitive B — Click a source → one popup (name · path · open · copy-password)

**The core finding.** Every fact carries `source_id`; `sources.payload_ref` is the file path;
`collateral.resolve_document_path()` + `POST /api/workspace/{id}/open` already open a file safely; `CopySecret` +
`/reveal` already copy a *named* per-file password to the clipboard without rendering it. Provenance is
**MISSING on every fact screen** only because `core/lens_api.py` projections drop `source_id`.

**Design.**
- The `source` column (Primitive A) renders as a **`<FileRef sourceId>`** cell. Clicking opens a popup:
  **file name · path · period · provider · [Open] · [Copy password]** (Copy shown only when
  `password.kind == "named"`).
- Backed by a new **`GET /api/source/{source_id}`** ( `{filename, payload_ref, provider, period,
  password{kind,name}}`, reusing `collateral` resolution) + the existing `/open` and `/reveal` actions.
- **Convenience posture (KG):** the popup is non-modal enough to Copy the password, right-click **Open in new
  window**, close the popup, and view the statement **side-by-side** with the tool. Store key never revealed.
- **Cheapest first win:** the **card statement view** — a statement *is* one source, so "Open statement PDF" is
  a single `source_id` on that response.
- **Fold-in fix:** a document with a `payload_ref` but no parsed `filename` is currently un-openable
  (`Collateral.tsx:68` gates on `filename`) though `resolve_document_path` supports `payload_ref` — fix so the
  popup can always open by `payload_ref`.

**Use-case coverage (item 2):** bank cash (`bank_transactions.source_id`), market instrument (position →
CAS/CN), holding diary (**each line already has its own `source_id`** — AVAILABLE per-line).

---

## Per-tab polish (layered on the primitives)

- **Overview / Reports / Bill payments / Bank Ledger / Family:** receive Primitives A + B. (Reports already has
  the picker — just add the provenance/audit group + normalize `whose`.)
- **Cards (item 3):**
  - Tile: **latest statement date** on the tile (data exists on the statement detail, surface it up) + a
    **paid-status star** — Green/Yellow/Red = fully-paid / partial / unpaid, from next-cycle payments vs
    `new_balance`, **plus "paid ≥ minimum"** once `minimum_amount_due` is captured (§Layer 1).
  - Statement DataTable: column-picker + `source` column ("Open statement PDF").
- **Bill payments (item 5):** the **Cards tab is authoritative** for the obligation (settled/unsettled). The
  bill-payment view surfaces linkage honestly as **matched / unmatched (likely paid from another account)** —
  `lens.card_bill_payments` already returns `resolved`; present it as-is, never as a missing payment.
- **Performance (item 6):**
  - **Round axis ticks** (0/5.98/11.96 → 0/5/10/15): computed in the **bridge** (`aggregate.py:335`) — round
    `axis_max` up to a nice number + nice ticks.
  - **Unified fonts:** replace hard px chart fonts (`app.css:868-881`) with the app's rem/token scale; handle
    the `preserveAspectRatio="none"` text-distortion (`charts.tsx:102`) via an un-scaled text overlay.
  - **Gridlines:** add horizontal value-axis gridlines (area chart has them at ticks; make them read on a
    static chart).
  - **Cash vs term-deposit split (6.2):** already AVAILABLE — group by `asset_classes.group` (`cash`) ∪ the
    `fixed_deposit` class. Pure UI grouping.
- **Bank Ledger (item 8):** rename label (`i18n/en.ts:319`; tab id stays `transactions`); add a **bank-name
  dropdown (+ "ALL")** alongside the existing server-side **month window** — both axes (by-bank, by-month).
- **Workspace (item 9):** category dropdown for docs (depository/CAS, cards, bank, … + **ALL**, API listing
  last); **default show 10** (+ show-all); **fix the blank CAS period** (§Layer 1); **passwords as a table**
  (replace the cluttered `<ul>`, keep the non-revealable store-key note); **per-row "tables updated"** detail
  (§Layer 2 endpoint).

---

## Data-gap register (updated)

| # | Need | Verdict | Evidence | Close it in |
|---|------|---------|----------|-------------|
| A | Audit quartet + `source_id` per row | **AVAILABLE** | schema.sql:313-317, :335-336 (universal block) | Lens SELECT → Bridge → UI (no migration) |
| B | Source **file path** per fact | **AVAILABLE** | `sources.payload_ref`; every fact has `source_id` | Lens/Bridge projection |
| B'| **Password value** | **PARTIAL (by design)** | never stored; only a named `.pass` ref | copy named `.pass`; never reveal value |
| 3 | Card **fully/partly/unpaid** | **AVAILABLE** | `new_balance` in `sources.detail`; payments from ledger | Lens derivation |
| 3'| Card **min-due / due-date** | **MISSING** | no `card_specs.toml` regex; not persisted | **Layer 1** (regex + persist to `sources.detail`) |
| 5 | **CAS period** | **MISSING (trivial)** | `cas.py:_register` omits period; `as_of` is parsed | **Layer 1** (pass `as_of`) |
| 4t| Source → **tables updated** | **PARTIAL (computable)** | no manifest; `_SOURCED_FACTS` scan (capture_io.py:181) | **Layer 1/2** (scan query; add diary to the set) |
| 7 | Diary **per-line source** | **AVAILABLE** | `detailed_holding_diary.source_id` | plumbing |
| 9 | Chart **cash vs FD** | **AVAILABLE** | `asset_classes.group` / `asset_class` | UI grouping |

**Latent bug to fix in this pass:** `detailed_holding_diary` is absent from `_SOURCED_FACTS`, so its rows aren't
delete-cleaned when a source is removed (breaks `store = replay(corpus)`). Fold into Layer 1 with the
source→tables work.

---

## Layered execution plan (the build order)

### Layer 1 — SQL / store / ingest (do first)
The only layer that changes what's *in* the store or the raw query surface.
1. **Card `minimum_amount_due` + `due_date`:** add regexes to `card_specs.toml`; persist both into
   `sources.detail` JSON (where `previous_balance`/`new_balance` already live — no schema migration).
2. **CAS period:** in `cas.py:_register`, pass `period_start = period_end = as_of` into `register_file` (native
   + fallback paths). One line each; `as_of` is already parsed.
3. **Diary sourced-facts + source→tables query:** add `detailed_holding_diary` to `_SOURCED_FACTS`
   (`capture_io.py:181`); add a store-level helper that, given a `source_id`, returns per-table row counts by
   scanning the sourced-fact tables.
4. **(No migration for audit/`source_id`)** — confirm the columns are present and queryable (they are).

### Layer 2 — Lens (WLC Python API)
5. **Emit provenance/audit columns:** add `source_id, created_by, created_at, updated_by, updated_at` to the
   SELECT in each fact-returning lens function (holdings/positions, bank transactions, card statement lines,
   diary lines, family transfers). Several already `LEFT JOIN sources` — extend, don't re-join.
6. **`lens.card_paid_status()`** derivation: fully/partly/unpaid + paid-≥-minimum (uses new min-due).
7. **`lens.source_detail(source_id)`** (path/provider/period/password-ref) and **`lens.source_tables(source_id)`**
   (Layer-1 helper wrapped for the bridge).
8. **Asset cash-vs-FD grouping helper** (over `asset_classes.group`/`asset_class`) for Performance.

### Layer 3 — Bridge (WLW)
9. **Carry the new columns** in `core/lens_api.py` row projections + `api/models.py` DTOs (source_id + audit
   quartet on every fact row; card paid-status on the cards response).
10. **New endpoints:** `GET /api/source/{id}` and `GET /api/source/{id}/tables`; reuse `/open` + `/reveal`.
11. **Chart round-ticks** in `core/aggregate.py:335` (nice `axis_max` + ticks).
12. **Bank Ledger facet** (distinct bank list + ALL) and **Workspace** passthrough (category facet; CAS period
    now populated).

### Layer 4 — UI (React)
13. **Extract `useColumnVisibility` hook**; wire the picker + provenance/audit group on every `DataTable`;
    normalize `whose`.
14. **`<FileRef>` popup** (name/path/open/copy-password), used by the `source` column + card "Open statement".
15. **Cards:** tile statement-date + paid-status star; statement table picker.
16. **Bank Ledger:** rename label + bank dropdown (+ ALL) beside the month window.
17. **Workspace:** category dropdown (+ ALL, API last), 10-doc default (+ show all), passwords table,
    per-source "tables updated" detail.
18. **Performance:** unified fonts (+ fix `preserveAspectRatio` text), gridlines, cash-vs-FD grouping.
19. **Bill payments / Family:** primitives + Bill-payments honest linkage labels.

Each layer ships with its own tests (WLC: lens/query tests; WLW: bridge contract tests; UI: Vitest/Playwright),
so a layer is green before the next depends on it.

---

## Deferred (explicitly out of this pass)
- **Payables / mortgage (item 4):** modelled fresh later against a real outstanding-loan statement, validated by
  a collaborator who holds one. Will need a loan-statement parser + a `lens.payables()` API + net-worth
  integration. (Schema `liability_terms`/`amortization_schedules` already exists to build on.)
- **Family UPI/mobile matching (item 7.1):** name-based linkage stays; structured UPI/mobile counterparty
  parsing is a separate future item.
- **Beneficial-owner-at-row-grain:** not modelled (WHO = audit/store, per decision 2).

## Out of scope
Import/Operations/Activity screens; the store-key model; dedup/idempotency; any change to WLC's read-only,
valuation, or provenance invariants. This pass adds *visibility/introspection* over data that already exists,
plus the three small additive Layer-1 items (card min-due, CAS period, diary sourced-facts).

## Closed
Archived on completion (2026-08-26). The backbone — **both primitives, end-to-end across all four layers** — landed
and is verified live on the demo store; the WLW suite (bridge contract + 131 frontend) and the WLC lens suite are
green. Item-by-item against the plan (§Layers 1–4):

- **1–14, 16 — DONE.** Layer-1 store facts; Layer-2 lens (`card_paid_status`/`source_detail`/`source_tables`/
  `asset_groups` + sourced projections); Layer-3 bridge (fact-row provenance DTOs, `/api/source`, card paid-status,
  round ticks); Layer-4 UI (`useColumnVisibility`, the provenance column group, the source popup, the Card Star,
  the Bank-ledger rename + bank facet).
- **15 — PARTIAL.** The paid-status **star** shipped on the picker tile and the statement header; the **statement
  date on the tile** was not added (the tile shows owed/settled + statement count). Cosmetic.
- **17 — NOT DONE (carried forward).** The **Workspace screen** enhancements (category dropdown + ALL, 10-doc
  default, passwords-as-table, per-source tables-updated *on that screen*) were not built. Note the *engine + bridge*
  support exists — `source_tables()` and the CAS period fix landed — and the **source popup already surfaces
  tables-updated**, so this is a self-contained UI follow-up, not a new capability.
- **18 — PARTIAL.** Cash-vs-FD was **already split** (distinct `asset_class` slices), and the breakup was made
  legible (Tier-2 class labels + distinct colours); the **round axis-ticks** landed (Layer-3 bridge). **Unified
  fonts + explicit gridlines** on the Performance charts were not done.
- **19 — PARTIAL.** Family and Bill-payments (via the shared card-statement body) received the primitives; the
  **Bill-payments honest-linkage labels** were not revised in this pass.

The carried-forward items (15 tile-date, 17 Workspace screen, 18 fonts/gridlines, 19 linkage labels) are all
UI polish over data that already exists — none is a blocker, and each is a small self-contained follow-up. Deferred
design items (positions/holdings `source_id`; standardised `sources.detail.{statement_date, account_masked}`) remain
as recorded above and in the WLC `statement-metadata-completeness` archive. Both repos clean + in sync.
