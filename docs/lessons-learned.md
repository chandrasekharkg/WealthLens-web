# Lessons Learned — WealthLens-web

Durable, post-incident engineering lessons for the bridge + frontend. ADRs record decisions we made on
purpose; this file records what a bug taught us after the fact — the mechanism, why it hid, and the principle
that outlives the specific code. (WLC keeps its own [lessons-learned](../../WealthLens-core/docs/lessons-learned.md).)

**When to add an entry:** after any saga where the root cause was non-obvious, the diagnosis was expensive, or
the failure mode will recur in a different disguise. Favor the transferable principle.

## Index

| # | Date | Title | One-line lesson |
|---|------|-------|-----------------|
| [W1](#w1--pandas-nan-vs-none-at-the-dataframeapi-boundary) | 2026-08-23 | pandas NaN vs None at the API boundary | A DataFrame column is `None` only until a real value settles its dtype; then gaps become float NaN and fail a `str \| None` model — coerce, and test with MIXED rows. |
| [W2](#w2--table-layoutfixed--nth-child-widths-are-positional) | 2026-08-24 | `table-layout: fixed` widths are positional | Inserting a column shifts every `nth-child` width onto the wrong column; one with no rule collapses to zero — a whole control vanishes with no error. |

---

## W1 — pandas NaN vs None at the DataFrame→API boundary

**Date:** 2026-08-23 · **Area:** bridge / lens_api serialization · **Severity:** correctness (whole-response failure)

### What happened
`lens_api.positions()` passed a holding's `name` straight from the DataFrame into a `str | None` response
field. One name-less instrument arrived not as `None` but as a float `NaN` (pandas settles a column's dtype
once any real string is present, and represents the gaps as `NaN`), which failed the Pydantic model and made
FastAPI reject the **entire** 53-row response — the Market-instruments tab went blank. A single synthetic
name-less row in a test could not reproduce it: alone, it round-trips as `None`, because nothing forced the
column to a float dtype.

### Lessons for the keeps
- **Route every optional string from a DataFrame through a NaN-safe coercion** (`_str()` / `pd.isna`) before
  it meets a response model. The DataFrame boundary is where `None` quietly becomes `NaN`.
- **Test optional fields with MIXED rows — present AND absent together.** The dtype-settling that causes the
  bug only appears when a real value and a gap share a column; an all-absent fixture hides it.
- **One bad cell fails the whole response, not one row.** A per-row defect at the serialization boundary is a
  screen-level outage, so the boundary deserves the coercion, not the caller.

## W2 — `table-layout: fixed` + `nth-child` widths are positional

**Date:** 2026-08-24 · **Area:** frontend / CSS · **Severity:** UX regression (silent)

### What happened
The Workspace collateral table uses `table-layout: fixed` with per-column widths declared as
`td:nth-child(N)`. Adding a new Period column at position 2 shifted every existing width rule onto the wrong
column, and the Password column — now at position 4 with no rule — collapsed to zero width. The Copy-password
control disappeared entirely, with no console error and no failing test.

### Lessons for the keeps
- **`nth-child` width rules are bound to POSITION, not to the column.** Inserting or reordering a column
  silently re-points every rule; re-declare widths for **all** columns keyed to their new positions when the
  set changes.
- **A zero-width column fails silently.** `table-layout: fixed` gives an unruled column zero width rather than
  content width — the failure is invisible layout, not an error, so a human (or a DOM test asserting the
  control is present) has to catch it.
