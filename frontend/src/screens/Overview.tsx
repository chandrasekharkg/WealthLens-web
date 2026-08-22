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

function statusOf(entity: EntityTotal, asOf: string | null | undefined): "ok" | "excluded" | "stale" {
  if (!entity.contributes) return "excluded";
  // `asOf` is always concrete now — the bridge resolves "no date" to the date it actually valued at, which
  // is what makes this comparison possible at all. Without it a months-old store rendered as current.
  if (asOf && entity.evidence_as_of && entity.evidence_as_of < asOf) return "stale";
  return "ok";
}

export function Overview({ data, format }: OverviewProps) {
  const { t, money, date } = format;
  const excluded = data.entities.filter((e) => !e.contributes);
  const stale = data.entities.filter((e) => statusOf(e, data.as_of) === "stale");

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
        accessorFn: (e) => statusOf(e, data.as_of),
        cell: ({ row }) => {
          const status = statusOf(row.original, data.as_of);
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
    [t, money, date, data.as_of],
  );

  const exportColumns = useMemo<Column<EntityTotal>[]>(
    () => [
      { header: t("column.member"), value: (e) => e.label },
      { header: t("column.total"), value: (e) => e.total ?? null },
      { header: `${t("column.total")} currency`, value: (e) => e.total?.currency ?? null },
      { header: t("column.evidence"), value: (e) => e.evidence_as_of ?? null },
      { header: t("column.status"), value: (e) => statusOf(e, data.as_of) },
    ],
    [t, data.as_of],
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
        {stale.length > 0 && (
          <p role="note" data-tone="warning">
            {t("overview.stale", { count: stale.length })}
          </p>
        )}
        {excluded.length === 0 && stale.length === 0 && <p data-tone="ok">{t("overview.trusted")}</p>}
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
