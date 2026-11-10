/**
 * The ONE TanStack Table v9 feature set every WealthLens table is built from (ADR-0021).
 *
 * v9 is explicit where v8 bundled everything: a table only has the features — and the sort/filter functions —
 * registered here. `'auto'` (what every column uses; none names a function) resolves ONLY registered functions,
 * so the registries below are exactly the set v9's own `'auto'` resolution can pick, which is the set v8 picked
 * from: sorting → datetime / alphanumeric / text (numbers use the built-in basic sort); column filtering →
 * includesString / inNumberRange / equals / arrIncludes / inDateRange / weakEquals. The global filter's 'auto' is
 * includesString, built in. Drop one and a column silently stops sorting or filtering on that kind of value.
 */
import {
  columnFilteringFeature,
  columnVisibilityFeature,
  createFilteredRowModel,
  createPaginatedRowModel,
  createSortedRowModel,
  filterFn_arrIncludes,
  filterFn_equals,
  filterFn_inDateRange,
  filterFn_inNumberRange,
  filterFn_includesString,
  filterFn_weakEquals,
  globalFilteringFeature,
  metaHelper,
  rowPaginationFeature,
  rowSortingFeature,
  sortFn_alphanumeric,
  sortFn_datetime,
  sortFn_text,
  tableFeatures,
  type ColumnDef,
  type Row,
  type RowData,
  type Table,
} from "@tanstack/react-table";

/**
 * Per-column data the table renders by. `numeric` is a data property, not a style: figures line up on the
 * decimal and use tabular figures, on screen and on paper alike.
 */
export type TableColumnMeta = { numeric?: boolean };

export const features = tableFeatures({
  rowSortingFeature,
  columnFilteringFeature, // before global filtering, which builds on it
  globalFilteringFeature,
  rowPaginationFeature,
  columnVisibilityFeature,
  sortedRowModel: createSortedRowModel(),
  filteredRowModel: createFilteredRowModel(),
  paginatedRowModel: createPaginatedRowModel(),
  sortFns: { alphanumeric: sortFn_alphanumeric, text: sortFn_text, datetime: sortFn_datetime },
  filterFns: {
    includesString: filterFn_includesString,
    inNumberRange: filterFn_inNumberRange,
    equals: filterFn_equals,
    arrIncludes: filterFn_arrIncludes,
    inDateRange: filterFn_inDateRange,
    weakEquals: filterFn_weakEquals,
  },
  columnMeta: metaHelper<TableColumnMeta>(), // type-only slot: what `columnDef.meta` holds
});

export type Features = typeof features;
/** A column of a WealthLens table. `any` is TanStack's own default for a column array's mixed value types. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type TableColumn<TRow extends RowData> = ColumnDef<Features, TRow, any>;
export type TableOf<TRow extends RowData> = Table<Features, TRow>;
export type RowOf<TRow extends RowData> = Row<Features, TRow>;
