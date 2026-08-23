import {
  type ColumnDef,
  type VisibilityState,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  type RowData,
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

/**
 * A column can declare itself numeric. That is a data property, not a style: figures line up on the decimal
 * and use tabular figures so columns of digits are comparable at a glance, on screen and on paper alike.
 */
/* eslint-disable @typescript-eslint/consistent-type-definitions, @typescript-eslint/no-unused-vars --
   a module augmentation must be an interface, and must repeat the upstream type parameters verbatim even
   though this addition uses neither. */
declare module "@tanstack/react-table" {
  interface ColumnMeta<TData extends RowData, TValue> {
    numeric?: boolean;
  }
}
/* eslint-enable @typescript-eslint/consistent-type-definitions, @typescript-eslint/no-unused-vars */

export type DataTableProps<Row> = {
  readonly rows: readonly Row[];
  readonly columns: ColumnDef<Row>[];
  /** Column definitions for what LEAVES — the same headers, mapped to plain cells. */
  readonly exportColumns: readonly Column<Row>[];
  readonly provenance: ProvenanceHeader;
  /**
   * Whether to RENDER the provenance block. It is always carried into the CSV either way — a screen that
   * shows one header above several tables (Reports) suppresses the duplicates here, it does not drop them
   * from what leaves.
   */
  readonly showProvenance?: boolean;
  readonly pageSize?: number;
  /** Locale-aware strings. A component that renders words takes the catalog, never its own literals. */
  readonly format?: { t: (key: never, params?: Record<string, string | number>) => string };
  /** Seam for tests: receives the finished CSV instead of writing a file. */
  readonly onExport?: (csv: string, filename: string) => void;
  readonly caption?: string;
  /**
   * Column personalization. When a handler is given the table shows a "Columns" picker beside Export/Print,
   * and renders exactly the columns the caller says are visible. Controlled by the caller (Reports) so the
   * choice is shared across a report's sections and persisted in one place.
   */
  readonly columnVisibility?: VisibilityState;
  readonly onColumnVisibilityChange?: (next: VisibilityState) => void;
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
  showProvenance = true,
  pageSize = 50,
  onExport,
  caption,
  format,
  columnVisibility,
  onColumnVisibilityChange,
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
    state: { globalFilter, ...(columnVisibility ? { columnVisibility } : {}) },
    onGlobalFilterChange: setGlobalFilter,
    onColumnVisibilityChange: onColumnVisibilityChange
      ? (updater) =>
          onColumnVisibilityChange(
            typeof updater === "function" ? updater(columnVisibility ?? {}) : updater,
          )
      : undefined,
    initialState: { pagination: { pageIndex: 0, pageSize } },
  });

  const leaving = rowsThatLeave(table);
  const shown = printing ? leaving : table.getPaginationRowModel().rows;
  const columnsHidden = columnsThatLeave(table).length < table.getAllLeafColumns().length;

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
    <div className="datatable">
      {showProvenance ? <Provenance header={{ ...provenance, row_count: leaving.length }} /> : null}

      <div className="table-tools" data-print="hide">
        <label htmlFor={`${tableId}-filter`}>{t("table.filter")}</label>
        <input
          id={`${tableId}-filter`}
          type="search"
          value={globalFilter}
          placeholder={t("table.filterPlaceholder")}
          onChange={(event) => setGlobalFilter(event.target.value)}
        />
        <span className="spacer" />
        <button type="button" onClick={exportCsv}>
          {t("table.export")}
        </button>
        <button type="button" onClick={() => window.print()}>
          {t("table.print")}
        </button>
        {onColumnVisibilityChange ? (
          <details className="column-picker">
            <summary>{t("table.columns")}</summary>
            <div className="column-picker-menu" role="group" aria-label={t("table.columns")}>
              {table
                .getAllLeafColumns()
                .filter((col) => col.getCanHide())
                .map((col) => (
                  <label key={col.id}>
                    <input
                      type="checkbox"
                      checked={col.getIsVisible()}
                      onChange={col.getToggleVisibilityHandler()}
                    />
                    {String(col.columnDef.header ?? col.id)}
                  </label>
                ))}
            </div>
          </details>
        ) : null}
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
                    className={header.column.columnDef.meta?.numeric ? "numeric" : undefined}
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
                  <td
                    key={cell.id}
                    className={cell.column.columnDef.meta?.numeric ? "numeric" : undefined}
                  >
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Stating both numbers is what makes a paginated view honest — and the controls are what make the
          rest of them REACHABLE, which a count alone conspicuously does not. */}
      <div className="table-foot" data-print="hide">
        {/* The count is a DISCLOSURE, so it appears when there is something to disclose: rows held back by
            the page size, a filter narrowing the set, or a column left out. With every row of an unfiltered
            table already on screen it repeated the count in the heading above and told nobody anything. */}
        {shown.length < leaving.length || globalFilter.trim() !== "" || columnsHidden ? (
          <p>
            {t("table.showing", { shown: shown.length, total: leaving.length })}
            {columnsHidden ? " · some columns hidden" : ""}
          </p>
        ) : null}
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
