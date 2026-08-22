/**
 * What leaves a table — the functions export and print BOTH use.
 *
 * ADR-0013's central claim is that export and print are the same act, differing only in rendering. That is
 * only true if the decisions — which rows, which columns, what the header says — are made once, here, in
 * pure functions. It is also what lets print be tested without a browser: the visual result is CSS, but
 * everything that could be *wrong* is data.
 *
 * The rule these enforce: **what leaves is the whole filtered set, never the rendered page.** TanStack
 * offers both row models, and reaching for the wrong one is the single easiest way to ship an export that
 * silently contains page one.
 */
import type { Row, Table } from "@tanstack/react-table";

/**
 * Every row the user's current sort and filters select — deliberately NOT `getPaginationRowModel`.
 *
 * `getSortedRowModel` is post-filter and post-sort but pre-pagination, which is exactly "what you are
 * looking at, all of it".
 */
export function rowsThatLeave<T>(table: Table<T>): Row<T>[] {
  return table.getSortedRowModel().rows;
}

/** The columns a reader can currently see, in the order they see them. A hidden column does not leave. */
export function columnsThatLeave<T>(table: Table<T>) {
  return table.getVisibleLeafColumns();
}

export type PrintFit = {
  /** Columns that fit the page, in order. */
  readonly kept: readonly string[];
  /**
   * Columns that did not fit. Named rather than silently dropped: a printout missing a column without
   * saying so is a printout that lies by omission (export-and-print spec).
   */
  readonly dropped: readonly string[];
};

/**
 * Decide which columns survive a printed page.
 *
 * Column *count* is the honest proxy here: real column widths depend on paper size and the browser's own
 * layout, which we cannot know, so the stylesheet handles fitting and this only handles the case where
 * there are simply too many to fit at all.
 */
export function fitForPrint(headers: readonly string[], maxColumns: number): PrintFit {
  if (maxColumns <= 0) return { kept: [], dropped: [...headers] };
  return { kept: headers.slice(0, maxColumns), dropped: headers.slice(maxColumns) };
}

/** The one line a printed page adds when it could not show everything. */
export function droppedColumnsNote(fit: PrintFit): string | null {
  return fit.dropped.length ? `Columns not shown: ${fit.dropped.join(", ")}` : null;
}
