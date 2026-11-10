import { constructTable, tableFeatures } from "@tanstack/react-table";
import { storeReactivityBindings } from "@tanstack/table-core/store-reactivity-bindings";
import { describe, expect, it } from "vitest";

import { features, type TableColumn } from "./tableFeatures";

/**
 * TanStack Table v9 resolves a column's `'auto'` sort/filter ONLY among the functions the table registers (v8
 * bundled them all). Every WealthLens column uses `'auto'`, so a function missing here does not fail loudly — the
 * column silently stops sorting or filtering that kind of value. These pin the registries to exactly the names
 * v9's own `'auto'` resolution can return (read from table-core 9.3.1, column_getAutoSortFn /
 * column_getAutoFilterFn), and show the behaviour v8's `'auto'` had survives.
 */
describe("the shared table feature set", () => {
  it("registers every sort function 'auto' can pick (numbers use the built-in basic sort)", () => {
    expect(Object.keys(features.sortFns).sort()).toEqual(["alphanumeric", "datetime", "text"]);
  });

  it("registers every column filter function 'auto' can pick", () => {
    expect(Object.keys(features.filterFns).sort()).toEqual(
      ["arrIncludes", "equals", "inDateRange", "inNumberRange", "includesString", "weakEquals"].sort(),
    );
  });

  type Row = { label: string; when: Date; amount: number };
  const DATA: Row[] = [
    { label: "Item 10", when: new Date("2026-03-01"), amount: 30 },
    { label: "Item 2", when: new Date("2026-01-01"), amount: 10 },
    { label: "Item 1", when: new Date("2026-02-01"), amount: 20 },
  ];
  const COLUMNS: TableColumn<Row>[] = [
    { id: "label", accessorKey: "label" },
    { id: "when", accessorKey: "when" },
    { id: "amount", accessorKey: "amount" },
  ];
  const headless = tableFeatures({ ...features, coreReactivityFeature: storeReactivityBindings() });
  const sortedBy = (id: string) =>
    constructTable({ features: headless, data: DATA, columns: COLUMNS, initialState: { sorting: [{ id, desc: false }] } })
      .getSortedRowModel()
      .rows.map((r) => r.original.label);

  it("sorts text with numbers naturally, dates by date and amounts by value — as v8's 'auto' did", () => {
    expect(sortedBy("label")).toEqual(["Item 1", "Item 2", "Item 10"]); // alphanumeric, not "Item 10" < "Item 2"
    expect(sortedBy("when")).toEqual(["Item 2", "Item 1", "Item 10"]);
    expect(sortedBy("amount")).toEqual(["Item 2", "Item 1", "Item 10"]);
  });

  it("filters a text column by substring and a number column by range", () => {
    const filtered = (id: string, value: unknown) =>
      constructTable({ features: headless, data: DATA, columns: COLUMNS, initialState: { columnFilters: [{ id, value }] } })
        .getFilteredRowModel()
        .rows.map((r) => r.original.label)
        .sort();
    expect(filtered("label", "item 1")).toEqual(["Item 1", "Item 10"]);
    expect(filtered("amount", [15, 35])).toEqual(["Item 1", "Item 10"]);
  });
});
