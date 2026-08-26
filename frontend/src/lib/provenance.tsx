import type { ColumnDef } from "@tanstack/react-table";
import { useCallback, useState } from "react";

import type { Formatter } from "../i18n";

/**
 * The provenance + audit column group (Primitive A), shared by every table.
 *
 * The bridge now carries `source_id` and the created/updated audit quartet on every fact row (RowProvenance).
 * These are the columns that expose them — one factory so the WHO/source group looks and behaves identically
 * on Transactions, Cards, the diary, wherever a fact row is shown. They are **hidden by default**: the everyday
 * view stays uncluttered, and the shared Columns picker reveals any of them. The `source` column is not text
 * but a control — clicking it opens the source popup (Primitive B) for that row.
 *
 * A new provenance column arriving from the engine is one more entry here and in the picker — no screen changes.
 */

/** The row shape these columns read. Every field is optional — a derived/aggregate row leaves them null. */
export type RowProvenanceShape = {
  readonly source_id?: string | null;
  readonly created_by?: string | null;
  readonly created_at?: string | null;
  readonly updated_by?: string | null;
  readonly updated_at?: string | null;
};

/** The column ids, in display order. */
export const PROVENANCE_COLUMN_IDS = [
  "source",
  "created_by",
  "created_at",
  "updated_by",
  "updated_at",
] as const;

/** Hidden-by-default visibility for the whole group — merge into a screen's own defaults. */
export const PROVENANCE_HIDDEN: Record<string, boolean> = Object.fromEntries(
  PROVENANCE_COLUMN_IDS.map((id) => [id, false]),
);

/**
 * The five columns, ready to append to a screen's column list. `onOpenSource` is handed the row so the screen
 * can resolve which store it belongs to (a row may carry its own `entity_id`, or the screen supplies one).
 */
export function provenanceColumns<Row extends RowProvenanceShape>(
  t: Formatter["t"],
  onOpenSource: (row: Row) => void,
): ColumnDef<Row>[] {
  return [
    {
      id: "source",
      header: t("column.source"),
      enableSorting: false,
      // The cell is the control (Primitive B): a source_id opens its popup; a row with none says so plainly.
      cell: ({ row }) =>
        row.original.source_id ? (
          <button
            type="button"
            className="linklike"
            onClick={() => onOpenSource(row.original)}
            aria-label={t("source.view")}
          >
            {t("source.view")}
          </button>
        ) : (
          <span data-empty>—</span>
        ),
    },
    { id: "created_by", accessorKey: "created_by", header: t("column.createdBy"),
      cell: ({ row }) => row.original.created_by ?? <span data-empty>—</span> },
    { id: "created_at", accessorKey: "created_at", header: t("column.createdAt"),
      cell: ({ row }) => row.original.created_at ?? <span data-empty>—</span> },
    { id: "updated_by", accessorKey: "updated_by", header: t("column.updatedBy"),
      cell: ({ row }) => row.original.updated_by ?? <span data-empty>—</span> },
    { id: "updated_at", accessorKey: "updated_at", header: t("column.updatedAt"),
      cell: ({ row }) => row.original.updated_at ?? <span data-empty>—</span> },
  ];
}

/**
 * Column-visibility state, persisted per storage key. Extracted from the Reports screen so every table shares
 * the same behaviour: the saved choice merges over `defaults`, and a store that refuses to persist simply does
 * not remember (never a broken render).
 */
export function useColumnVisibility(storageKey: string, defaults: Record<string, boolean>) {
  const read = (): Record<string, boolean> => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (!saved) return defaults;
      return { ...defaults, ...(JSON.parse(saved) as Record<string, boolean>) };
    } catch {
      return defaults;
    }
  };
  const [columnVisibility, setState] = useState<Record<string, boolean>>(read);
  const onColumnVisibilityChange = useCallback(
    (next: Record<string, boolean>) => {
      setState(next);
      try {
        localStorage.setItem(storageKey, JSON.stringify(next));
      } catch {
        /* a refusing store just does not remember */
      }
    },
    [storageKey],
  );
  return { columnVisibility, onColumnVisibilityChange };
}
