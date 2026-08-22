import {
  type ColumnDef,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  createTable,
} from "@tanstack/react-table";
// v8 deliberately: v9 is a fresh major with a new features API and thin documentation, and a young API is
// exactly the contribution cost ADR-0010 argues against. Both give the headless row model ADR-0003 chose
// TanStack for, so the stable line is the cheaper one to build on.
import { describe, expect, it } from "vitest";

import { columnsThatLeave, droppedColumnsNote, fitForPrint, rowsThatLeave } from "./table";

type Row = { name: string; value: number };

const DATA: Row[] = Array.from({ length: 25 }, (_, i) => ({ name: `Item ${25 - i}`, value: 25 - i }));

const COLUMNS: ColumnDef<Row>[] = [
  { id: "name", accessorKey: "name" },
  { id: "value", accessorKey: "value" },
];

/** A headless table — TanStack's core with no React and no DOM, which is the point (ADR-0010). */
function makeTable(state: Record<string, unknown> = {}) {
  const table = createTable<Row>({
    data: DATA,
    columns: COLUMNS,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    state: { pagination: { pageIndex: 0, pageSize: 10 }, ...state },
    onStateChange: () => {},
    renderFallbackValue: null,
  });
  return table;
}

describe("what leaves", () => {
  it("is the whole filtered set, not the page a reader can see", () => {
    // The single easiest way to ship a broken export is to reach for the pagination row model.
    const table = makeTable();
    expect(table.getPaginationRowModel().rows).toHaveLength(10);
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
