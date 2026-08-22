import {
  type ColumnDef,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { useEffect, useId, useState } from "react";

import "../styles/print.css";

import { type Column, type ProvenanceHeader, toCsv } from "../lib/csv";
import { defaultFormatter } from "../i18n";
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
  /** Locale-aware strings. A component that renders words takes the catalog, never its own literals. */
  readonly format?: { t: (key: never, params?: Record<string, string | number>) => string };
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
  format,
}: DataTableProps<Row>) {
  // Falls back to the shipped catalog so a caller that has not threaded `format` still renders words
  // rather than keys — the table is used from several screens and should not break one by omission.
  const t = (format?.t ?? defaultFormatter.t) as (k: string, p?: Record<string, string | number>) => string;
  /**
   * Printing renders the WHOLE filtered set, not the page.
   *
   * CSS cannot print a row the DOM does not contain, so a print stylesheet alone would silently produce
   * page one — the exact defect the spec names. Swapping the row set on `beforeprint` is what actually
   * satisfies "what leaves is the whole filtered set".
   */
  // A stable id for label/control pairing. useId is React's own answer and is pure — Math.random()
  // here would be an impure call during render and would change on every re-render.
  const tableId = useId();
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
  const [globalFilter, setGlobalFilter] = useState("");
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable<Row>({
    data: rows as Row[],
    columns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    state: { globalFilter },
    onGlobalFilterChange: setGlobalFilter,
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
        <label htmlFor={`${tableId}-filter`}>{t("table.filter")}</label>{" "}
        <input
          id={`${tableId}-filter`}
          type="search"
          value={globalFilter}
          placeholder={t("table.filterPlaceholder")}
          onChange={(event) => setGlobalFilter(event.target.value)}
        />{" "}
        <button type="button" onClick={exportCsv}>
          {t("table.export")}
        </button>
        <button type="button" onClick={() => window.print()}>
          {t("table.print")}
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
                    {header.isPlaceholder ? null : header.column.getCanSort() ? (
                      // The header IS the control: a separate sort widget is one more thing to find, and
                      // aria-sort above already tells a screen reader what clicking it did.
                      <button
                        type="button"
                        data-sort
                        onClick={header.column.getToggleSortingHandler()}
                        aria-label={t("table.sortBy", {
                          column: String(header.column.columnDef.header ?? header.id),
                        })}
                      >
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        {{ asc: " ▲", desc: " ▼" }[header.column.getIsSorted() as string] ?? ""}
                      </button>
                    ) : (
                      flexRender(header.column.columnDef.header, header.getContext())
                    )}
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

      {/* Stating both numbers is what makes a paginated view honest — and the controls are what make the
          rest of them REACHABLE, which a count alone conspicuously does not. */}
      <div data-print="hide">
        <p>
          {t("table.showing", { shown: shown.length, total: leaving.length })}
          {columnsThatLeave(table).length < table.getAllLeafColumns().length
            ? " · some columns hidden"
            : ""}
        </p>
        {table.getPageCount() > 1 && (
          <p>
            <button
              type="button"
              onClick={() => table.previousPage()}
              disabled={!table.getCanPreviousPage()}
            >
              {t("table.prev")}
            </button>{" "}
            <span>
              {t("table.page", {
                page: table.getState().pagination.pageIndex + 1,
                pages: table.getPageCount(),
              })}
            </span>{" "}
            <button type="button" onClick={() => table.nextPage()} disabled={!table.getCanNextPage()}>
              {t("table.next")}
            </button>{" "}
            <label htmlFor={`${tableId}-size`}>{t("table.perPage")}</label>{" "}
            <select
              id={`${tableId}-size`}
              value={table.getState().pagination.pageSize}
              onChange={(event) => table.setPageSize(Number(event.target.value))}
            >
              {[25, 50, 100, 500].map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
              <option value={leaving.length || 1}>{t("table.allRows")}</option>
            </select>
          </p>
        )}
      </div>
    </div>
  );
}
