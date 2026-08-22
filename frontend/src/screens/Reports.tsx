import type { ColumnDef } from "@tanstack/react-table";
import { useMemo, useState } from "react";

import type { Positions } from "../api/client";
import { DataTable } from "../components/DataTable";
import { EmptyState } from "../components/EmptyState";
import type { Formatter } from "../i18n";
import type { Column } from "../lib/csv";

/**
 * Holdings, at a chosen point in time.
 *
 * The date is the basis of computation, not a label: changing it re-asks every store the same question at
 * the same instant, which is what makes one as-of date honest across a family (ADR-0016).
 */

type Row = Positions["rows"][number];

export type ReportsProps = {
  readonly data: Positions;
  readonly format: Formatter;
  readonly onDateChange: (date: string) => void;
};

export function Reports({ data, format, onDateChange }: ReportsProps) {
  const { t, money, date, number } = format;
  const [pending, setPending] = useState(data.as_of ?? "");

  const columns = useMemo<ColumnDef<Row>[]>(
    () => [
      { id: "name", accessorKey: "name", header: t("column.instrument") },
      { id: "entity", accessorKey: "entity_label", header: t("column.whose") },
      {
        id: "identifier",
        header: t("column.identifier"),
        accessorFn: (r) => r.identifier.value ?? "",
        // "No identifier" is STATED. A blank would be both hidden and matched by a filter (data-conventions).
        cell: ({ row }) =>
          row.original.identifier.kind === "isin" ? (
            row.original.identifier.value
          ) : (
            <span data-identifier="none">{t("identifier.none")}</span>
          ),
      },
      {
        id: "units",
        header: t("column.units"),
        accessorFn: (r) => r.quantity ?? 0,
        // A quantity is genuinely absent for cash, a deposit, a property — an em dash says so, where a
        // zero would assert the holding is empty.
        cell: ({ row }) =>
          row.original.quantity === null || row.original.quantity === undefined
            ? "—"
            : number(row.original.quantity),
      },
      {
        id: "value",
        header: t("column.value"),
        accessorFn: (r) => Number(r.value.amount),
        cell: ({ row }) => money(row.original.value),
      },
      { id: "basis", accessorKey: "basis", header: t("column.basis") },
    ],
    [t, money, number],
  );

  const exportColumns = useMemo<Column<Row>[]>(
    () => [
      { header: t("column.instrument"), value: (r) => r.name ?? null },
      { header: t("column.whose"), value: (r) => r.entity_label },
      // The stated "not applicable" travels too — an empty cell would be ambiguous in a spreadsheet as well.
      { header: t("column.identifier"), value: (r) => r.identifier.value ?? t("identifier.none") },
      { header: t("column.units"), value: (r) => r.quantity ?? null },
      { header: t("column.value"), value: (r) => r.value },
      { header: `${t("column.value")} currency`, value: (r) => r.value.currency },
      { header: t("column.basis"), value: (r) => r.basis ?? null },
    ],
    [t],
  );

  return (
    <main>
      <h1>{t("reports.title")}</h1>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          onDateChange(pending);
        }}
      >
        <label htmlFor="as-of">{t("reports.asOfLabel")}</label>{" "}
        <input
          id="as-of"
          type="date"
          value={pending}
          onChange={(event) => setPending(event.target.value)}
        />{" "}
        <button type="submit">{t("reports.apply")}</button>
      </form>

      {data.excluded.length > 0 && (
        <ul aria-label={t("overview.partial", { count: data.excluded.length, total: 0 })}>
          {data.excluded.map((entity) => (
            <li key={entity.entity_id} data-tone="warning" role="alert">
              {entity.label}: {entity.reason ?? entity.owner_warning}
            </li>
          ))}
        </ul>
      )}

      <h2>
        {t("reports.holdings")} — {date(data.as_of)}
      </h2>

      {data.rows.length === 0 ? (
        <EmptyState
          state={
            data.is_partial
              ? { kind: "unavailable", reason: data.excluded[0]?.reason ?? "" }
              : { kind: "nothing-yet" }
          }
          format={format}
        />
      ) : (
        <DataTable
          rows={data.rows}
          columns={columns}
          exportColumns={exportColumns}
          provenance={data.provenance}
          caption={t("reports.holdings")}
        />
      )}
    </main>
  );
}
