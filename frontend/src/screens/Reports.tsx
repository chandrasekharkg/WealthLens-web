import type { ColumnDef } from "@tanstack/react-table";
import { useCallback, useEffect, useMemo, useState } from "react";

import { api, type Report, type ReportSection } from "../api/client";
import { DataTable } from "../components/DataTable";
import { Provenance } from "../components/Provenance";
import type { Formatter } from "../i18n";
import type { Column } from "../lib/csv";

/**
 * Reports: a series of sections, one per kind of thing.
 *
 * One flat table of everything is accurate and unreadable. A section per kind — cash, deposits, equities —
 * is how a person actually asks the question, and each is one lens answer laid out rather than anything
 * recomputed here.
 *
 * The section list is expected to churn. It arrives from the bridge as data, so adding a cut or an icon
 * changes no code on this screen.
 *
 * **Which report is on screen is the shell's business**, not this component's: the list of them lives in
 * the left rail, which every tab shares.
 */

type Row = ReportSection["rows"][number];

export type ReportsProps = {
  readonly reportId: string;
  readonly format: Formatter;
};

export function Reports({ reportId, format }: ReportsProps) {
  const { t, money, date, number } = format;
  const [dateField, setDateField] = useState("");
  const [asOf, setAsOf] = useState("");
  const [report, setReport] = useState<Report | null>(null);

  const load = useCallback((id: string, on: string) => {
    void api
      .report(id, on || undefined)
      .then(setReport)
      .catch(() => setReport(null));
  }, []);

  useEffect(() => load(reportId, asOf), [reportId, asOf, load]);

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
        meta: { numeric: true },
        accessorFn: (r) => r.quantity ?? 0,
        cell: ({ row }) =>
          row.original.quantity === null || row.original.quantity === undefined
            ? "—"
            : number(row.original.quantity),
      },
      {
        id: "acquired",
        header: t("column.acquired"),
        // When you FIRST held this — walked over the succession chain in the engine, so a restructured
        // holding shows its true first purchase, not the relabel. A dash where the store has no events to
        // say (a snapshot-only position); the store not knowing is not the epoch.
        accessorFn: (r) => r.first_acquired_on ?? "",
        cell: ({ row }) =>
          row.original.first_acquired_on ? (
            date(row.original.first_acquired_on)
          ) : (
            <span data-empty>—</span>
          ),
      },
      {
        id: "value",
        header: t("column.value"),
        meta: { numeric: true },
        // Sorting is the ONE place a number is unavoidable — comparison needs one. The rendered cell still
        // formats the exact decimal string, so the double is never what a reader sees.
        accessorFn: (r) => Number(r.value.amount),
        cell: ({ row }) => money(row.original.value),
      },
      {
        id: "disposition",
        header: t("column.disposition"),
        // A live position says nothing here. A closed one wears a badge that says WHY it is at zero —
        // written off, or an unexplained zero that is really a prompt to go look. `sold` and `succeeded`
        // never reach this screen (the engine keeps them out of the live set), but the badge renders any
        // value the row carries rather than hard-coding the two.
        accessorFn: (r) => r.disposition ?? "",
        cell: ({ row }) => {
          const d = row.original.disposition;
          if (!d) return <span data-empty>—</span>;
          const known = ["written_off", "sold", "succeeded", "unknown"].includes(d);
          return (
            <span data-disposition={d} data-tone={d === "unknown" ? "warning" : undefined}>
              {known ? t(`disposition.${d}` as Parameters<typeof t>[0]) : d}
            </span>
          );
        },
      },
      { id: "basis", accessorKey: "basis", header: t("column.basis") },
    ],
    [t, money, number, date],
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
      { header: t("column.acquired"), value: (r) => r.first_acquired_on ?? null },
      { header: t("column.disposition"), value: (r) => r.disposition ?? null },
      { header: t("column.basis"), value: (r) => r.basis ?? null },
    ],
    [t],
  );

  return (
    <main data-layout="reports">
      <div className="report-head">
        <div>
          <h1>{report?.title ?? t("reports.title")}</h1>
          {report?.subtitle && <p className="subtitle">{report.subtitle}</p>}
        </div>

        <form
          className="as-of"
          data-print="hide"
          onSubmit={(event) => {
            event.preventDefault();
            setAsOf(dateField);          // applies on submit, not on every keystroke
          }}
        >
          <label htmlFor="as-of">{t("reports.asOfLabel")}</label>
          <input
            id="as-of"
            type="date"
            value={dateField}
            onChange={(event) => setDateField(event.target.value)}
          />
          <button type="submit">{t("reports.apply")}</button>
        </form>
      </div>

      {/*
        ONE provenance header for the whole report, rather than one above every section.
        Scope, date and currency are properties of the report — repeating them over each of four tables
        said nothing new and pushed the data down the page. It keeps no `data-print="hide"`: on paper this
        block is the only thing that says what the figures are and when they were true.
      */}
      {report ? <Provenance header={report.provenance} /> : null}

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
        <section key={section.id} aria-label={section.title} className="report-section">
          <header className="section-head">
            <h2>
              <span className="section-icon" aria-hidden="true">
                {section.icon}
              </span>
              {section.title}
              <span className="section-count">{t("reports.sectionCount", { count: number(section.count) })}</span>
            </h2>
            <p className="section-total">{section.total ? money(section.total) : "—"}</p>
          </header>
          {section.note ? <p className="section-note">{section.note}</p> : null}
          {section.rows.length === 0 ? (
            <p role="status" className="section-note">
              {t("reports.sectionEmpty")}
            </p>
          ) : (
            <DataTable
              rows={section.rows}
              columns={columns}
              exportColumns={exportColumns}
              // Still passed, and still exact: the CSV carries its own provenance header even though the
              // screen now shows one per report rather than one per table.
              provenance={{ ...report.provenance, title: `${report.title} — ${section.title}` }}
              showProvenance={false}
              pageSize={25}
              caption={`${section.title} — ${date(report.as_of)}`}
              format={format}
            />
          )}
        </section>
      ))}
    </main>
  );
}
