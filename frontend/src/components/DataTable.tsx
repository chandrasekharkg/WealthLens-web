import {
  type ColumnDef,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { useEffect, useState } from "react";

import "../styles/print.css";

import { type Column, type ProvenanceHeader, toCsv } from "../lib/csv";
import { columnsThatLeave, rowsThatLeave } from "../lib/table";
import { Provenance } from "./Provenance";

/**
 * The shipped table. Export and print are properties of THIS component, so every view built on it gets
 * both without its author implementing anything (ADR-0013).
 *
 * It is deliberately dumb about money: a cell renders what it is handed. Amounts arrive already resolved,
 * already in the reporting currency, already carrying their unit (ADR-0018).
 */

export type DataTableProps<Row> = {
  readonly rows: readonly Row[];
  readonly columns: ColumnDef<Row>[];
  /** Column definitions for what LEAVES — the same headers, mapped to plain cells. */
  readonly exportColumns: readonly Column<Row>[];
  readonly provenance: ProvenanceHeader;
  readonly pageSize?: number;
  /** Seam for tests: receives the finished CSV instead of writing a file. */
  readonly onExport?: (csv: string, filename: string) => void;
  readonly caption?: string;
};

function download(csv: string, filename: string) {
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function DataTable<Row>({
  rows,
  columns,
  exportColumns,
  provenance,
  pageSize = 50,
  onExport,
  caption,
}: DataTableProps<Row>) {
  /**
   * Printing renders the WHOLE filtered set, not the page.
   *
   * CSS cannot print a row the DOM does not contain, so a print stylesheet alone would silently produce
   * page one — the exact defect the spec names. Swapping the row set on `beforeprint` is what actually
   * satisfies "what leaves is the whole filtered set".
   */
  const [printing, setPrinting] = useState(false);
  useEffect(() => {
    const before = () => setPrinting(true);
    const after = () => setPrinting(false);
    window.addEventListener("beforeprint", before);
    window.addEventListener("afterprint", after);
    return () => {
      window.removeEventListener("beforeprint", before);
      window.removeEventListener("afterprint", after);
    };
  }, []);

  // React Compiler cannot memoize TanStack's returned functions, so it skips this component. That is a
  // known interaction with the library rather than a defect here, and a warning nobody can act on trains
  // people to ignore warnings.
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable<Row>({
    data: rows as Row[],
    columns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageIndex: 0, pageSize } },
  });

  const leaving = rowsThatLeave(table);
  const shown = printing ? leaving : table.getPaginationRowModel().rows;

  const exportCsv = () => {
    const csv = toCsv(
      leaving.map((r) => r.original),
      exportColumns,
      { ...provenance, row_count: leaving.length },
    );
    const name = `wealthlens-${provenance.title.toLowerCase().replace(/\s+/g, "-")}.csv`;
    (onExport ?? download)(csv, name);
  };

  return (
    <div>
      <Provenance header={{ ...provenance, row_count: leaving.length }} />

      <div data-print="hide">
        <button type="button" onClick={exportCsv}>
          Export CSV
        </button>
        <button type="button" onClick={() => window.print()}>
          Print
        </button>
      </div>

      <div className="scroll-x" style={{ overflowX: "auto" }}>
        <table>
          {caption ? <caption>{caption}</caption> : null}
          <thead>
            {table.getHeaderGroups().map((group) => (
              <tr key={group.id}>
                {group.headers.map((header) => (
                  <th
                    key={header.id}
                    aria-sort={
                      header.column.getIsSorted() === "asc"
                        ? "ascending"
                        : header.column.getIsSorted() === "desc"
                          ? "descending"
                          : "none"
                    }
                  >
                    {header.isPlaceholder
                      ? null
                      : flexRender(header.column.columnDef.header, header.getContext())}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {shown.map((row) => (
              <tr key={row.id}>
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Stating both numbers on screen is what makes a paginated view honest about what it is showing. */}
      <p data-print="hide">
        Showing {shown.length} of {leaving.length} rows
        {columnsThatLeave(table).length < table.getAllLeafColumns().length ? " · some columns hidden" : ""}
      </p>
    </div>
  );
}
