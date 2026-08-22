# ADR-0013 — Taking data out: export and print are the same problem

**Status:** ACCEPTED 2026-08-22

## Context

Two capabilities were asked for: get a table into a spreadsheet, and produce a print copy of a page. They
look unrelated — one is a file, one is paper. They are the same act.

Everything this project does to keep a number honest lives *around* the number: the basis label, the as-of
date, the entity badge, the currency, the footing warning, the freshness strip. The moment a figure is
exported or printed, all of that context is gone and the number travels alone. A printout is also the
artifact most likely to be handed to an accountant, an advisor, or a family member — the number leaves the
household with nobody able to ask the app what it meant.

So egress is not a feature on a view. It is a boundary, and it needs the same discipline the views have.

## Decision — one egress model, four invariants

These bind **both** CSV export and print. They are the reason the two share one implementation.

**1. What leaves is what you are looking at — all of it.** Egress covers the complete filtered, sorted set,
not the rendered page. Silent truncation to the visible page is the classic bug in this feature, and it is
dishonest in the project's specific sense: the artifact reads as "everything" while being a slice. If any
part genuinely cannot be included, the artifact says so in its own header rather than omitting quietly.

**2. Context travels with the data.** Every exported file and every printed page carries a provenance
header: scope (entity or family), as-of date, reporting currency, filters in effect, the store it came from
with its schema version, when it was generated, and any warning currently attached to that scope. This is
design principle 2 — honesty is a first-class element — extended past the edge of the screen. An unlabelled
stale spreadsheet in circulation is a lie waiting to happen.

**3. Money keeps its currency.** Amount and currency never separate on the way out (data-conventions).
A total appears in the artifact only where it was legitimate on screen — mixed currencies are not summed
into a spreadsheet cell just because a spreadsheet would happily do it.

**4. Nothing that leaves can execute.** Text that originated in a document — a statement narration, an
instrument name — is neutralized against spreadsheet formula injection: a cell beginning `=`, `+`, `-`,
`@`, tab or carriage return is escaped so Excel, Sheets and LibreOffice treat it as text. This is a real
surface, not a theoretical one: those strings come from PDFs we did not write, and the target is the
user's own spreadsheet application.

## Format: CSV, UTF-8 with BOM, generated client-side from the row model

- **Client-side** because the row model already holds exactly the sorted, filtered set the user is looking
  at. No new endpoint, no auth surface, no temp file on disk — and the whole thing is a pure function from
  rows and columns to text, which is Vitest-testable with no DOM and no download (ADR-0010).
- **CSV, not XLSX**, because the user's actual verb is "get this into a spreadsheet", and CSV does that
  everywhere with no dependency. **Graduation trigger (ADR-0012):** when people need preserved column
  types, number formats or multiple sheets, XLSX earns its dependency then.
- **With a BOM**, because Excel on Windows otherwise mangles UTF-8 — and this data is full of Indian names.
- **Dates as ISO 8601**, so no spreadsheet reinterprets them by locale.
- **The honest limitation:** CSV carries no types, so an identifier that looks numeric (a folio, an account
  number with leading zeros) can still be reinterpreted by the receiving application. We state this rather
  than pretend otherwise — and it is the strongest argument for the eventual XLSX graduation.

## Print: the browser's own print, with a real stylesheet — not server-side PDF

Server-side PDF would mean either a headless browser (a heavy dependency that contradicts ADR-0009's light,
native-first distribution) or a second rendering path — and a second path drifts, so the printed page
slowly stops matching the screen. The browser's print dialog already produces "Save as PDF" on every OS
this project targets, using the user's own paper size and margins.

The work is in the stylesheet, which is the part usually neglected:

- the whole table prints, not the paginated page (invariant 1);
- table headers repeat on every page, and a row never splits across a break;
- application chrome — navigation, buttons, filter controls — is dropped, and the filters that were in
  effect appear in the provenance header instead;
- the light palette is forced regardless of the active theme, because printing a dark UI wastes ink and
  reads badly;
- a wide table either fits or drops columns *and names the ones it dropped*;
- pages are numbered.

Charts print because Recharts renders SVG; a canvas-based chart library would have printed blank or
rasterized. That was not why ADR-0003 chose it, but it is a real dividend of the choice.

## Why one implementation, not two

Export and print differ only in rendering. **What leaves** — which rows, which columns, the provenance
header, the escaped cell text — is one set of pure functions shared by both. That is what makes print
testable without a browser: the decisions are data, tested at the pure-function layer, and only the visual
result is CSS. Print therefore earns **no E2E test** — it is not dangerous when wrong, so it does not clear
ADR-0010's bar for adding a fourth browser flow.

## Consequences

- Export and print are properties of the **shipped table and page components**, not per-view features.
  Every table gets both, including tables declared by extensions (ADR-0011), which inherit the escaping and
  the provenance header rather than each reinventing them badly.
- The provenance header is a shared component with one pure function behind it, used by both paths.
- Egress is recorded in Activity as an event — scope and row count, never values — the same treatment as
  copying a password.
- If a view can be exported but its numbers cannot be explained by the header, that is a gap in the
  header's vocabulary, and it is fixed there rather than by adding a note to one view.
