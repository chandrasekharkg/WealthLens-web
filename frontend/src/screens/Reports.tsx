import type { ColumnDef } from "@tanstack/react-table";
import { useCallback, useEffect, useMemo, useState } from "react";

import { api, type Report, type ReportSection } from "../api/client";
import { DataTable } from "../components/DataTable";
import { HoldingDiaryPanel } from "../components/HoldingDiaryPanel";
import { Provenance } from "../components/Provenance";
import { SourcePopup } from "../components/SourcePopup";
import type { Formatter } from "../i18n";
import type { Column } from "../lib/csv";
import { PROVENANCE_HIDDEN, provenanceColumns } from "../lib/provenance";

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

// The diary a URL points at: ?holding=<entity>/<instrument>. Returns the open-diary descriptor (name is a
// placeholder the panel replaces from fetched data) or null. Read once, as a state initializer.
function diaryFromUrl(): { entity: string; instrument: string; name: string } | null {
  const holding = new URLSearchParams(window.location.search).get("holding");
  if (!holding) return null;
  const slash = holding.indexOf("/");
  if (slash < 0) return null;
  const instrument = holding.slice(slash + 1);
  if (!instrument) return null;
  return { entity: holding.slice(0, slash), instrument, name: instrument };
}

// Hidden by default: the everyday columns show, the rest are one click away in the Columns picker. Kept at
// module scope so it is one shared object, never rebuilt per render.
const HIDDEN_BY_DEFAULT: Record<string, boolean> = {
  last_acquired: false, lots: false, fills: false, last_valued: false, closed: false,
  subtype: false, amfi: false, jurisdiction: false, instrument_id: false,
  // The provenance/audit group (Primitive A) joins the addable columns, hidden by default like the rest.
  ...PROVENANCE_HIDDEN,
};

// ONE column config for the whole app. Every report renders the SAME position columns (they differ only in
// which rows they section), so a household's choice is a property of the columns, not of a report — pick
// "Lots" once and it is on everywhere. If feedback ever wants per-report or per-table granularity, this key
// grows a suffix; today the simplicity of one config that applies everywhere is the feature.
const COLUMNS_KEY = "wlw.columns";

/** The saved column choice, merged over the defaults. A refusing/empty store just gives defaults. */
function loadVisibility(storageKey: string): Record<string, boolean> {
  try {
    const saved = localStorage.getItem(storageKey);
    if (!saved) return HIDDEN_BY_DEFAULT;
    return { ...HIDDEN_BY_DEFAULT, ...(JSON.parse(saved) as Record<string, boolean>) };
  } catch {
    return HIDDEN_BY_DEFAULT;
  }
}

export type ReportsProps = {
  readonly reportId: string;
  readonly format: Formatter;
};

export function Reports({ reportId, format }: ReportsProps) {
  const { t, money, date, number } = format;
  const [asOf, setAsOf] = useState("");
  // A half-typed date (submitted before it is complete) and a request that failed are two different problems,
  // each surfaced rather than silently swallowed — the second is what read as "the PIT showed nothing".
  const [badDate, setBadDate] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [report, setReport] = useState<Report | null>(null);
  // The holding whose full transcript is open below the report, or none. Its INITIAL value is read once from
  // the URL — ?holding=<entity>/<instrument> — so a shared/bookmarked link opens straight to that diary. The
  // panel derives the holding's name from the data it fetches, so the URL needn't carry it.
  const [diary, setDiary] = useState<{ entity: string; instrument: string; name: string } | null>(
    () => diaryFromUrl(),
  );
  // Trial affordance: flip the diary between an inline section and a popup. Popup is the intended default;
  // the choice persists across opens so a reviewer can compare without re-toggling each time.
  const [diaryMode, setDiaryMode] = useState<"inline" | "popup">("popup");
  // A specific diary line to open focused — the URL's ?line= on load, or a future review-queue deep-link.
  const [focusLine, setFocusLine] = useState<string | null>(
    () => (diaryFromUrl() ? new URLSearchParams(window.location.search).get("line") : null),
  );
  // The source popup (Primitive B) for whichever row's Source was clicked.
  const [source, setSource] = useState<{ entity: string; sourceId: string } | null>(null);
  const openSource = useCallback((row: Row) => {
    if (row.source_id && row.entity_id) setSource({ entity: row.entity_id, sourceId: row.source_id });
  }, []);

  const load = useCallback((id: string, on: string) => {
    void api
      .report(id, on || undefined)
      .then((r) => {
        setReport(r);
        setLoadError(false);
      })
      // Distinguish a failed request from a report whose sections are legitimately empty. A failure surfaces an
      // error and KEEPS the last report on screen, rather than nulling it — silently blanking everything is what
      // made a date query that errored look like "the PIT returned nothing".
      .catch(() => setLoadError(true));
  }, []);

  useEffect(() => load(reportId, asOf), [reportId, asOf, load]);

  // Deep-link OUT: keep the URL in step with what's open, so a diary (and the line in focus) is bookmarkable,
  // reload-surviving, and shareable — the same link opens the same view on another machine. replaceState, so
  // it never floods the back button.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (diary) {
      q.set("holding", `${diary.entity}/${diary.instrument}`);
      if (focusLine) q.set("line", focusLine);
      else q.delete("line");
    } else {
      q.delete("holding");
      q.delete("line");
    }
    const qs = q.toString();
    window.history.replaceState(null, "", qs ? `?${qs}` : window.location.pathname);
  }, [diary, focusLine]);

  const columns = useMemo<ColumnDef<Row>[]>(
    () => [
      {
        id: "name",
        accessorKey: "name",
        header: t("column.instrument"),
        // The name opens the holding's full CAS transcript — the diary drill-down. Only rows the store keys
        // by instrument_id have one; the rest render as plain text.
        cell: ({ row }) =>
          row.original.instrument_id ? (
            <button
              type="button"
              className="linklike"
              title={t("diary.open")}
              onClick={() => {
                setFocusLine(null); // a fresh open from the name isn't focusing any particular line
                setDiary({
                  entity: row.original.entity_id ?? "",
                  instrument: row.original.instrument_id as string,
                  name: row.original.name ?? (row.original.instrument_id as string),
                });
              }}
            >
              {row.original.name}
            </button>
          ) : (
            row.original.name
          ),
      },
      { id: "entity", accessorKey: "entity_label", header: t("column.whose") },
      {
        id: "account",
        // Sort/filter by the broker name when we have it (so "Filter columns → Held with: religare" works),
        // else the raw account key. The cell shows the readable broker with the DP/client short code beside it.
        accessorFn: (r) => r.broker ?? r.account_id ?? "",
        header: t("column.heldWith"),
        cell: ({ row }) => {
          const broker = row.original.broker;
          const acct = row.original.account_id;
          if (!broker) return acct ?? "—";
          const code = acct?.startsWith("demat:") ? acct.slice("demat:".length) : acct;
          return (
            <span className="broker-cell">
              {broker}
              {code ? <span className="broker-code"> · {code}</span> : null}
            </span>
          );
        },
      },
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
      {
        id: "reconciliation",
        header: t("column.reconciliation"),
        // FACT vs INTROSPECTION, made visible. Blank = the position is confirmed by (or is not gated on) a
        // latest CAS — take it as fact. `superseded` = still counted, but a newer statement of its OWN demat
        // dropped it and the engine could not say where it went: a warning-toned prompt to load the missing
        // CAS, never a silent removal. The value stays in the total; this only tells you which rows to trust.
        accessorFn: (r) => r.reconciliation ?? "",
        cell: ({ row }) => {
          const v = row.original.reconciliation;
          if (!v) return <span data-empty>—</span>;
          const known = v === "superseded";
          return (
            <span data-reconciliation={v} data-tone="warning">
              {known ? t("reconciliation.superseded") : v}
            </span>
          );
        },
      },
      { id: "basis", accessorKey: "basis", header: t("column.basis") },
      // Addable columns — hidden by default, offered through the Columns picker. Each formats by what it IS
      // (a date, a count, a code), and shows a muted dash where the store had nothing to say.
      {
        id: "last_acquired",
        header: t("column.lastAcquired"),
        accessorFn: (r) => r.last_acquired_on ?? "",
        cell: ({ row }) =>
          row.original.last_acquired_on ? date(row.original.last_acquired_on) : <span data-empty>—</span>,
      },
      {
        id: "lots",
        header: t("column.lots"),
        meta: { numeric: true },
        accessorFn: (r) => r.lots ?? -1,
        cell: ({ row }) => (row.original.lots == null ? <span data-empty>—</span> : number(row.original.lots)),
      },
      {
        id: "fills",
        header: t("column.fills"),
        meta: { numeric: true },
        accessorFn: (r) => r.fills ?? -1,
        cell: ({ row }) => (row.original.fills == null ? <span data-empty>—</span> : number(row.original.fills)),
      },
      {
        id: "last_valued",
        header: t("column.lastValued"),
        accessorFn: (r) => r.last_valued_on ?? "",
        cell: ({ row }) =>
          row.original.last_valued_on ? date(row.original.last_valued_on) : <span data-empty>—</span>,
      },
      {
        id: "closed",
        header: t("column.closed"),
        accessorFn: (r) => r.closed_on ?? "",
        cell: ({ row }) =>
          row.original.closed_on ? date(row.original.closed_on) : <span data-empty>—</span>,
      },
      { id: "subtype", accessorKey: "subtype", header: t("column.subtype"),
        cell: ({ row }) => row.original.subtype ?? <span data-empty>—</span> },
      { id: "amfi", accessorKey: "amfi_code", header: t("column.amfi"),
        cell: ({ row }) => row.original.amfi_code ?? <span data-empty>—</span> },
      { id: "jurisdiction", accessorKey: "jurisdiction", header: t("column.jurisdiction"),
        cell: ({ row }) => row.original.jurisdiction ?? <span data-empty>—</span> },
      { id: "instrument_id", accessorKey: "instrument_id", header: t("column.instrumentId"),
        cell: ({ row }) => row.original.instrument_id ?? <span data-empty>—</span> },
      // The provenance/audit group (Primitive A + B) — a snapshot row opens its source; derived rows show "—".
      ...provenanceColumns<Row>(t, openSource),
    ],
    [t, money, number, date, openSource],
  );

  // Which columns show, remembered per report. The default shows the everyday set and hides the rest;
  // the Columns picker lets a household add any of them, and the choice persists across sessions. A new
  // column arriving from the engine is simply another entry in the picker — no code change to reveal it.
  const [columnVisibility, setColumnVisibility] = useState<Record<string, boolean>>(() =>
    loadVisibility(COLUMNS_KEY),
  );
  const onColumnVisibilityChange = useCallback((next: Record<string, boolean>) => {
    setColumnVisibility(next);
    try {
      localStorage.setItem(COLUMNS_KEY, JSON.stringify(next));
    } catch {
      /* a store that refuses to persist just does not remember — never a broken render */
    }
  }, []);

  const exportColumns = useMemo<Column<Row>[]>(
    () => [
      { header: t("column.instrument"), value: (r) => r.name ?? null },
      { header: t("column.whose"), value: (r) => r.entity_label },
      { header: t("column.heldWith"), value: (r) => r.broker ?? r.account_id ?? null },
      { header: t("column.identifier"), value: (r) => r.identifier.value ?? t("identifier.none") },
      { header: t("column.units"), value: (r) => r.quantity ?? null },
      { header: t("column.value"), value: (r) => r.value },
      { header: `${t("column.value")} currency`, value: (r) => r.value.currency },
      { header: t("column.acquired"), value: (r) => r.first_acquired_on ?? null },
      { header: t("column.disposition"), value: (r) => r.disposition ?? null },
      { header: t("column.reconciliation"), value: (r) => r.reconciliation ?? null },
      { header: t("column.basis"), value: (r) => r.basis ?? null },
      { header: t("column.source"), value: (r) => r.source_id ?? null },
      { header: t("column.createdBy"), value: (r) => r.created_by ?? null },
      { header: t("column.createdAt"), value: (r) => r.created_at ?? null },
      { header: t("column.updatedBy"), value: (r) => r.updated_by ?? null },
      { header: t("column.updatedAt"), value: (r) => r.updated_at ?? null },
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
          // noValidate: we do the checking ourselves and show our own hint, so the browser never pops its bare
          // "Invalid value" bubble over a half-typed date (e.g. only the year filled). `input.validity` is still
          // computed, so the check below still works.
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            const input = event.currentTarget.elements.namedItem("as-of") as HTMLInputElement;
            // The input is UNCONTROLLED so a half-typed date isn't wiped mid-edit. A partial date reports
            // `badInput` and an empty value — refuse it with our own hint; an empty field means "today".
            if (input.validity.badInput) {
              setBadDate(true);
              return;
            }
            setBadDate(false);
            setAsOf(input.value); // "" = today; a complete date = that point-in-time
          }}
        >
          <label htmlFor="as-of">{t("reports.asOfLabel")}</label>
          <input
            id="as-of"
            name="as-of"
            type="date"
            defaultValue={asOf}
            onInput={() => setBadDate(false)}
          />
          <button type="submit">{t("reports.apply")}</button>
          {badDate ? (
            <span role="alert" className="as-of-error" data-tone="warning">
              {t("reports.invalidDate")}
            </span>
          ) : null}
        </form>
      </div>

      {loadError ? (
        <p role="alert" className="report-error" data-tone="warning">
          {t("reports.loadError")}
        </p>
      ) : null}

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
              columnVisibility={columnVisibility}
              onColumnVisibilityChange={onColumnVisibilityChange}
            />
          )}
        </section>
      ))}

      {diary ? (
        // Keyed by the holding, so opening another remounts to its loading state.
        <HoldingDiaryPanel
          key={`${diary.entity}/${diary.instrument}`}
          entity={diary.entity}
          instrument={diary.instrument}
          name={diary.name}
          format={format}
          onClose={() => setDiary(null)}
          presentation={diaryMode}
          onSetPresentation={setDiaryMode}
          focusDiaryId={focusLine}
        />
      ) : null}

      {source ? (
        <SourcePopup
          entity={source.entity}
          sourceId={source.sourceId}
          format={format}
          onClose={() => setSource(null)}
        />
      ) : null}
    </main>
  );
}
