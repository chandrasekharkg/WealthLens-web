import type { ColumnDef } from "@tanstack/react-table";
import { useMemo } from "react";

import type { EntityTotal, NetWorth } from "../api/client";
import { DataTable } from "../components/DataTable";
import type { Column } from "../lib/csv";
import type { Formatter } from "../i18n";

/**
 * "Is this picture trustworthy right now?"
 *
 * The screen leads with the caveats, not the number. A total is only meaningful once a reader knows
 * whether it is missing anybody and whether anybody is answering from old evidence — so those come first,
 * and the headline figure is read in their light.
 *
 * Nothing here computes money. Totals, exclusions, freshness and the provenance header all arrive decided
 * from the bridge (ADR-0018); this renders them.
 */

export type OverviewProps = {
  readonly data: NetWorth;
  readonly format: Formatter;
};

export function Overview({ data, format }: OverviewProps) {
  const { t, money, date } = format;
  const excluded = data.entities.filter((e) => !e.contributes);
  // Freshness is decided by the bridge: each entity carries a `status`, and the household's stale count
  // arrives as `stale_count`. This screen only renders them — it does not re-derive either.
  const staleCount = data.stale_count;

  const columns = useMemo<ColumnDef<EntityTotal>[]>(
    () => [
      { id: "label", accessorKey: "label", header: t("column.member") },
      {
        id: "total",
        header: t("column.total"),
        meta: { numeric: true },
        accessorFn: (e) => e.total?.amount ?? "",
        cell: ({ row }) => (row.original.total ? money(row.original.total) : "—"),
      },
      {
        id: "evidence",
        header: t("column.evidence"),
        accessorFn: (e) => e.evidence_as_of ?? "",
        cell: ({ row }) => date(row.original.evidence_as_of),
      },
      {
        id: "status",
        header: t("column.status"),
        accessorFn: (e) => e.status,
        cell: ({ row }) => {
          const status = row.original.status;
          return (
            <span data-status={status}>
              {t(`status.${status}` as "status.ok")}
              {/* The reason travels with the status: "not included" without a cause is not an answer. */}
              {row.original.excluded_reason ? ` — ${row.original.excluded_reason}` : ""}
            </span>
          );
        },
      },
    ],
    [t, money, date],
  );

  const exportColumns = useMemo<Column<EntityTotal>[]>(
    () => [
      { header: t("column.member"), value: (e) => e.label },
      { header: t("column.total"), value: (e) => e.total ?? null },
      { header: `${t("column.total")} currency`, value: (e) => e.total?.currency ?? null },
      { header: t("column.evidence"), value: (e) => e.evidence_as_of ?? null },
      { header: t("column.status"), value: (e) => e.status },
    ],
    [t],
  );

  return (
    <main>
      <h1>{t("overview.title")}</h1>

      {/* Caveats before the figure, deliberately. */}
      <div aria-live="polite">
        {excluded.length > 0 && (
          <p role="alert" data-tone="warning">
            {t("overview.partial", { count: excluded.length, total: data.entities.length })}
          </p>
        )}
        {staleCount > 0 && (
          <p role="note" data-tone="warning">
            {t("overview.stale", { count: staleCount })}
          </p>
        )}
        {excluded.length === 0 && staleCount === 0 && <p data-tone="ok">{t("overview.trusted")}</p>}
      </div>

      {/* The figure is given the weight it has — but AFTER the caveats above, which is the whole point of
          this screen and the reason the card is not at the top of it. */}
      <section className="headline" aria-label={t("overview.netWorth")}>
        <h2>{t("overview.netWorth")}</h2>
        <p className="figure" data-testid="net-worth-total">{data.total ? money(data.total) : "—"}</p>
        <p className="figure-note">
          {t("overview.asOf", { date: data.as_of ? date(data.as_of) : t("overview.noDate") })} ·{" "}
          {t("overview.reportingIn", { currency: data.reporting_currency })}
        </p>
      </section>

      <DataTable
        rows={data.entities}
        columns={columns}
        exportColumns={exportColumns}
        provenance={data.provenance}
        caption={t("overview.membersTable")}
      />
    </main>
  );
}
