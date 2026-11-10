# ADR-0021 — TanStack Table v9, with one explicit feature set

**Status:** ACCEPTED 2026-11-10 · Refines [ADR-0003](0003-frontend-stack.md)'s choice of TanStack Table (headless) to
its v9 line · Replaces a stance that lived only in a test comment ("v8 deliberately").

## Context

ADR-0003 chose TanStack Table for the shipped table and named no version. When v9 shipped, `src/lib/table.test.ts`
recorded a stance — not an ADR — to stay on v8: "v9 is a fresh major with a new features API and thin documentation,
and a young API is exactly the contribution cost ADR-0010 argues against."

On 2026-11-10 the frontend dependency pass (playbook §11, KG: "update to the latest toolchain") reopened it:

- **v9 is no longer young.** It is at 9.3.1, and it ships its own versioned migration and API guides inside the
  package (`node_modules/@tanstack/*/skills/`). The "thin documentation" premise no longer holds.
- **React 19 moves at the same time.** Staying on a superseded table line beside a current React adds a second
  migration later, not less contribution cost.
- **v9 changes one thing that matters to correctness.** Features, row models and sort/filter functions are
  registered per table, and a column's `'auto'` sort/filter resolves **only among registered functions**. A
  WealthLens column always uses `'auto'`, so an unregistered function doesn't fail loudly: the column silently
  stops sorting or filtering that kind of value.

## Decision

1. **WealthLens-web uses TanStack Table v9** (`@tanstack/react-table` 9.x; `@tanstack/table-core` declared
   directly at the same version for headless tests).
2. **There is ONE feature set**, `frontend/src/lib/tableFeatures.ts`.
   - It contains row sorting, column filtering, global filtering, pagination and column visibility, with their row
     models.
   - It contains exactly the sort/filter functions v9's own `'auto'` resolution can return (read from
     table-core 9.3.1), which are the ones v8's `'auto'` chose from.
   - It types `columnDef.meta` through the `columnMeta` slot (`numeric`) instead of global declaration merging.
   - Every table and every column type (`TableColumn<Row>`) is built from it, the shipped `DataTable` and the
     headless tests alike, so the tests assert the configuration that ships.
3. **The registries are pinned by tests.** `tableFeatures.test.ts` checks the exact names, and the behaviour v8's
   `'auto'` had: natural text-with-numbers sort, date sort, and substring and number-range filters. Removing a
   function fails it.

## Consequences

- No `stockFeatures` and no `useLegacyTable`: the explicit set is the end state, not a bridge.
- Headless tests add a plain store (`coreReactivityFeature: storeReactivityBindings()`); in React, `useTable`
  supplies the reactivity.
- **The production bundle grows** with React 19 and the v9 runtime: 324 kB → 402 kB, or 96 → 120.5 kB gzipped,
  measured 2026-11-10. That's acceptable for a local app served on a home network. If it ever matters, look first
  at code-splitting the screens, not the table.
- Adding a table feature (grouping, pinning, selection, …) means registering it, and any functions it uses, in
  `tableFeatures.ts`. That one place is where review should look.
