import { constructTable, tableFeatures } from "@tanstack/react-table";
import { storeReactivityBindings } from "@tanstack/table-core/store-reactivity-bindings";
import { describe, expect, it } from "vitest";

import { columnsThatLeave, droppedColumnsNote, fitForPrint, rowsThatLeave } from "./table";
import { features, type TableColumn } from "./tableFeatures";

type Row = { name: string; value: number };

const DATA: Row[] = Array.from({ length: 25 }, (_, i) => ({ name: `Item ${25 - i}`, value: 25 - i }));

const COLUMNS: TableColumn<Row>[] = [
  { id: "name", accessorKey: "name" },
  { id: "value", accessorKey: "value" },
];

/**
 * A headless table — TanStack's core with no React and no DOM, which is the point (ADR-0010) — built from the
 * SAME feature set the shipped table uses (lib/tableFeatures, ADR-0021), so these assertions hold for it.
 */
// The shipped features plus a plain store: in React, useTable supplies the reactivity; with no framework the
// table needs one of its own, and v9's store binding is the one TanStack ships for exactly that.
const headless = tableFeatures({ ...features, coreReactivityFeature: storeReactivityBindings() });

function makeTable(state: Record<string, unknown> = {}) {
  return constructTable({
    features: headless,
    data: DATA,
    columns: COLUMNS,
    initialState: { pagination: { pageIndex: 0, pageSize: 10 }, ...state },
  });
}

describe("what leaves", () => {
  it("is the whole filtered set, not the page a reader can see", () => {
    // The single easiest way to ship a broken export is to reach for the pagination row model.
    const table = makeTable();
    expect(table.getPaginatedRowModel().rows).toHaveLength(10);
    expect(rowsThatLeave(table)).toHaveLength(25);
  });

  it("respects an active filter — 'everything' means everything MATCHING", () => {
    const table = makeTable({ columnFilters: [{ id: "name", value: "Item 1" }] });
    const leaving = rowsThatLeave(table).map((r) => r.original.name);
    expect(leaving.length).toBeGreaterThan(0);
    expect(leaving.every((n) => n.includes("Item 1"))).toBe(true);
    expect(leaving.length).toBeLessThan(25);
  });

  it("leaves in the order the reader sorted it", () => {
    const table = makeTable({ sorting: [{ id: "value", desc: false }] });
    const values = rowsThatLeave(table).map((r) => r.original.value);
    expect(values[0]).toBe(1);
    expect(values).toEqual([...values].sort((a, b) => a - b));
  });

  it("takes the visible columns, so a hidden column does not leave", () => {
    const table = makeTable({ columnVisibility: { value: false } });
    expect(columnsThatLeave(table).map((c) => c.id)).toEqual(["name"]);
  });
});

describe("fitting a printed page", () => {
  it("names the columns it could not show", () => {
    const fit = fitForPrint(["A", "B", "C", "D"], 2);
    expect(fit.kept).toEqual(["A", "B"]);
    expect(fit.dropped).toEqual(["C", "D"]);
    expect(droppedColumnsNote(fit)).toBe("Columns not shown: C, D");
  });

  it("says nothing when everything fits", () => {
    expect(droppedColumnsNote(fitForPrint(["A", "B"], 5))).toBeNull();
  });

  it("drops everything rather than guessing when nothing can fit", () => {
    expect(fitForPrint(["A"], 0).kept).toEqual([]);
  });
});
