# wlw-introspection-ux — a one-pass, layer-by-layer provenance/introspection pass over the web app

> **Status: DESIGN v2 (decisions locked; ready to turn into a layered plan).** Raised 2026-08-26 (KG collated UX
> feedback); refined after review. Grounded in a three-way code recon (bridge data surface, frontend structure,
> WLC engine data availability) — every AVAILABLE/PARTIAL/MISSING verdict carries schema/file evidence.
>
> **Execution is deliberately layer-by-layer: SQL/store → Lens → Bridge → UI** (KG's sequencing call), so each
> layer is complete and testable before the next builds on it.

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
