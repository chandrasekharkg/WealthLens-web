import type { ColumnDef } from "@tanstack/react-table";
import { useCallback, useEffect, useMemo, useState } from "react";

import { api, type Report, type ReportSection, type ReportSummary } from "../api/client";
import { DataTable } from "../components/DataTable";
import type { Formatter } from "../i18n";
import type { Column } from "../lib/csv";

/**
 * Reports: a list of reports on the left, each a series of sections.
 *
 * One flat table of everything is accurate and unreadable. A section per kind of thing — cash, deposits,
 * equities — is how a person actually asks the question, and each is one lens answer laid out rather than
 * anything recomputed here.
 *
 * The section list is expected to churn. It arrives from the bridge as data, so adding a cut or an icon
 * changes no code on this screen.
 */

type Row = ReportSection["rows"][number];

export type ReportsProps = {
  readonly format: Formatter;
};

export function Reports({ format }: ReportsProps) {
  const { t, money, date, number } = format;
  const [catalogue, setCatalogue] = useState<ReportSummary[]>([]);
  const [current, setCurrent] = useState("accounts");
  const [dateField, setDateField] = useState("");
  const [asOf, setAsOf] = useState("");
  const [report, setReport] = useState<Report | null>(null);

  useEffect(() => {
    void api
      .reports()
      .then(setCatalogue)
      .catch(() => setCatalogue([]));
  }, []);

  const load = useCallback((id: string, asOf: string) => {
    void api
      .report(id, asOf || undefined)
      .then(setReport)
      .catch(() => setReport(null));
  }, []);

  useEffect(() => load(current, asOf), [current, asOf, load]);

  const columns = useMemo<ColumnDef<Row>[]>(
    () => [
      { id: "name", accessorKey: "name", header: t("column.instrument") },
      { id: "entity", accessorKey: "entity_label", header: t("column.whose") },
      { id: "account", accessorKey: "account_id", header: t("ops.workspace") },
      {
        id: "identifier",
        header: t("column.identifier"),
        accessorFn: (r) => r.identifier.value ?? "",
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
      { header: t("ops.workspace"), value: (r) => r.account_id ?? null },
      { header: t("column.identifier"), value: (r) => r.identifier.value ?? t("identifier.none") },
      { header: t("column.units"), value: (r) => r.quantity ?? null },
      { header: t("column.value"), value: (r) => r.value },
      { header: `${t("column.value")} currency`, value: (r) => r.value.currency },
      { header: t("column.basis"), value: (r) => r.basis ?? null },
    ],
    [t],
  );

  return (
    <main data-layout="reports">
      <nav aria-label={t("reports.pick")} data-print="hide">
        <h2>{t("reports.pick")}</h2>
        <ul>
          {catalogue.map((entry) => (
            <li key={entry.id}>
              <button
                type="button"
                onClick={() => setCurrent(entry.id)}
                aria-current={entry.id === current}
                data-selected={entry.id === current}
              >
                {entry.title}
              </button>
            </li>
          ))}
        </ul>
      </nav>

      <section>
        <h1>{report?.title ?? t("reports.title")}</h1>
        {report?.subtitle && <p>{report.subtitle}</p>}

        <form
          data-print="hide"
          onSubmit={(event) => {
            event.preventDefault();
            setAsOf(dateField);          // applies on submit, not on every keystroke
          }}
        >
          <label htmlFor="as-of">{t("reports.asOfLabel")}</label>{" "}
          <input
            id="as-of"
            type="date"
            value={dateField}
            onChange={(event) => setDateField(event.target.value)}
          />{" "}
          <button type="submit">{t("reports.apply")}</button>
        </form>

        {report?.excluded.length ? (
          <div>
            <h3>{t("reports.excludedHeading")}</h3>
            <ul>
              {report.excluded.map((entity) => (
                <li key={entity.entity_id} role="alert" data-tone="warning">
                  {entity.label}: {entity.reason ?? entity.owner_warning}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {report?.sections.map((section) => (
          <section key={section.id} aria-label={section.title}>
            <h2>
              <span aria-hidden="true">{section.icon}</span> {section.title}
            </h2>
            <p>
              {t("reports.sectionTotal", {
                count: number(section.count),
                total: section.total ? money(section.total) : "—",
              })}
              {section.note ? ` · ${section.note}` : ""}
            </p>
            {section.rows.length === 0 ? (
              <p role="status">{t("reports.sectionEmpty")}</p>
            ) : (
              <DataTable
                rows={section.rows}
                columns={columns}
                exportColumns={exportColumns}
                provenance={{ ...report.provenance, title: `${report.title} — ${section.title}` }}
                pageSize={25}
                caption={`${section.title} — ${date(report.as_of)}`}
                format={format}
              />
            )}
          </section>
        ))}
      </section>
    </main>
  );
}
