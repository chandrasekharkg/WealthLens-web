import type { ColumnDef } from "@tanstack/react-table";
import { useCallback, useEffect, useMemo, useState } from "react";

import { api, type DiaryLine, type HoldingDiary } from "../api/client";
import type { Formatter } from "../i18n";
import { type Column } from "../lib/csv";
import { PROVENANCE_HIDDEN, provenanceColumns, useColumnVisibility } from "../lib/provenance";
import { DataTable } from "./DataTable";
import { SourcePopup } from "./SourcePopup";

/**
 * The full transcript of one holding — the detailed_holding_diary drill-down.
 *
 * Where the report row is the holding's current position, this is its whole story: every line the depository
 * statements carried for it, transactional and not, in order. The `role` says why each line did or didn't
 * move ownership — the pledges, settlement legs and unmapped items the quantity ledger deduplicates away are
 * exactly what has reporting value here. Balances are UNIT quantities, not money, so they format as numbers.
 */

type Load<T> = { state: "loading" } | { state: "ready"; data: T } | { state: "error" };

/** A role or, for a non-transaction line, its kind — one legible tag per row. The raw fallback. */
function tagOf(line: DiaryLine, t: Formatter["t"]): string {
  if (line.line_kind !== "transaction") return t(`kind.${line.line_kind}` as "kind.balance");
  return line.role ? t(`role.${line.role}` as "role.movement") : "";
}

// Colour by economic direction: something arrived, something left, a net-zero status change, or "we're not sure".
const VERDICT_TONE: Record<string, "in" | "out" | "neutral" | "review"> = {
  buy: "in", transfer_in: "in", transmission_in: "in", bonus: "in", merge_in: "in", demerge_in: "in",
  sell: "out", transfer_out: "out", transmission_out: "out", writeoff: "out", forfeit: "out", merge_out: "out",
  review: "review",
};
const KNOWN_VERDICTS = new Set([
  "buy", "sell", "transfer_in", "transfer_out", "transmission_in", "transmission_out", "merge_in", "merge_out",
  "demerge_in", "bonus", "split", "writeoff", "forfeit", "conversion", "dividend", "pledge", "custody",
  "settlement_leg", "balance", "superseded", "review",
]);

/** The interpreted verdict of a line — the household-terms read of what the move IS — with a raw-tag fallback. */
function verdictOf(line: DiaryLine, t: Formatter["t"]): { label: string; tone: string } {
  if (line.needs_review) return { label: t("verdict.review"), tone: "review" };
  const v = line.verdict;
  if (v && KNOWN_VERDICTS.has(v)) {
    return { label: t(`verdict.${v}` as "verdict.buy"), tone: VERDICT_TONE[v] ?? "neutral" };
  }
  return { label: tagOf(line, t), tone: "neutral" }; // an unrecognised verb → the old role/kind tag
}

export function HoldingDiaryPanel({
  entity,
  instrument,
  name,
  format,
  onClose,
}: {
  readonly entity: string;
  readonly instrument: string;
  readonly name: string;
  readonly format: Formatter;
  readonly onClose: () => void;
}) {
  const { t, number, money } = format;
  const [diary, setDiary] = useState<Load<HoldingDiary>>({ state: "loading" });

  useEffect(() => {
    void api
      .holdingDiary(entity, instrument)
      .then((data) => setDiary({ state: "ready", data }))
      .catch(() => setDiary({ state: "error" }));
  }, [entity, instrument]);

  const lines = diary.state === "ready" ? diary.data.lines : [];
  const num = useCallback(
    (v: number | null | undefined) => (v === null || v === undefined ? "" : number(v)),
    [number],
  );

  const [source, setSource] = useState<string | null>(null);
  const openSource = useCallback((row: DiaryLine) => {
    if (row.source_id) setSource(row.source_id);
  }, []);
  const { columnVisibility, onColumnVisibilityChange } = useColumnVisibility(
    "wlw.columns.diary",
    PROVENANCE_HIDDEN,
  );

  const columns = useMemo<ColumnDef<DiaryLine>[]>(
    () => [
      { id: "date", accessorKey: "date", header: t("column.date"), cell: ({ row }) => format.date(row.original.date) },
      {
        id: "type",
        header: t("column.type"),
        accessorFn: (r) => verdictOf(r, t).label,
        // The interpreted verdict, toned by direction — and an honest "Needs review" (warning tone) for an
        // off-market/CA line we couldn't name, rather than a silent `unmapped`.
        cell: ({ row }) => {
          const l = row.original;
          const { label, tone } = verdictOf(l, t);
          if (!label) return "";
          return (
            <span
              data-verdict={l.verdict ?? l.role ?? l.line_kind}
              data-tone={tone}
              title={l.needs_review ? t("diary.needsReview") : undefined}
            >
              {label}
            </span>
          );
        },
      },
      { id: "description", accessorKey: "description", header: t("column.description") },
      {
        id: "broker",
        header: t("column.broker"),
        // The DP/broker of the demat the line touched — the "who" you hunt these moves by. Blank until the
        // broker name is captured/back-filled for that account.
        accessorFn: (r) => r.broker ?? "",
        cell: ({ row }) => row.original.broker ?? <span data-empty>—</span>,
      },
      { id: "debit", header: t("column.debit"), meta: { numeric: true },
        accessorFn: (r) => r.debit ?? 0, cell: ({ row }) => num(row.original.debit) },
      { id: "credit", header: t("column.credit"), meta: { numeric: true },
        accessorFn: (r) => r.credit ?? 0, cell: ({ row }) => num(row.original.credit) },
      { id: "closing", header: t("column.balance"), meta: { numeric: true },
        accessorFn: (r) => r.closing ?? 0,
        cell: ({ row }) => {
          const l = row.original;
          // A balance line's surplus is its band breakdown — surface it beside the total.
          if (l.line_kind === "balance" && (l.pledged || l.locked)) {
            return (
              <span title={t("diary.balanceNote", {
                free: num(l.free) || "0", pledged: num(l.pledged) || "0", locked: num(l.locked) || "0" })}>
                {num(l.closing)} <span data-role="custody">◆</span>
              </span>
            );
          }
          return num(l.closing);
        } },
      ...provenanceColumns<DiaryLine>(t, openSource),
    ],
    [t, format, num, openSource],
  );

  const exportColumns = useMemo<Column<DiaryLine>[]>(
    () => [
      { header: t("column.date"), value: (r) => r.date ?? null },
      { header: t("column.type"), value: (r) => verdictOf(r, t).label },
      { header: t("column.description"), value: (r) => r.description ?? null },
      { header: t("column.broker"), value: (r) => r.broker ?? null },
      { header: t("column.debit"), value: (r) => r.debit ?? null },
      { header: t("column.credit"), value: (r) => r.credit ?? null },
      { header: t("column.balance"), value: (r) => r.closing ?? null },
      { header: "pledged", value: (r) => r.pledged ?? null },
      { header: "locked", value: (r) => r.locked ?? null },
      { header: t("column.source"), value: (r) => r.source_id ?? null },
      { header: t("column.createdBy"), value: (r) => r.created_by ?? null },
      { header: t("column.createdAt"), value: (r) => r.created_at ?? null },
      { header: t("column.updatedBy"), value: (r) => r.updated_by ?? null },
      { header: t("column.updatedAt"), value: (r) => r.updated_at ?? null },
    ],
    [t],
  );

  return (
    <section className="statement statement-drill diary-panel">
      <div className="statement-head">
        <h2>{t("diary.title", { name })}</h2>
        <button type="button" className="linklike" onClick={onClose}>
          {t("diary.close")}
        </button>
      </div>
      <p className="cards-subtitle">{t("diary.subtitle")}</p>

      {diary.state === "ready" && diary.data.performance ? (
        <dl className="perf-strip">
          <div>
            <dt>{t("perf.invested")}</dt>
            <dd>{diary.data.performance.invested ? money(diary.data.performance.invested) : "—"}</dd>
          </div>
          <div>
            <dt>{t("perf.current")}</dt>
            <dd>{diary.data.performance.current ? money(diary.data.performance.current) : "—"}</dd>
          </div>
          <div>
            <dt>{t("perf.gain")}</dt>
            <dd data-sign={diary.data.performance.gain && Number(diary.data.performance.gain.amount) < 0 ? "down" : "up"}>
              {diary.data.performance.gain ? money(diary.data.performance.gain) : "—"}
              {diary.data.performance.abs_return_pct !== null && diary.data.performance.abs_return_pct !== undefined
                ? ` (${diary.data.performance.abs_return_pct}%)`
                : ""}
            </dd>
          </div>
          <div>
            <dt>{t("perf.xirr")}</dt>
            <dd>
              {diary.data.performance.xirr_pct !== null && diary.data.performance.xirr_pct !== undefined
                ? `${diary.data.performance.xirr_pct}%`
                : "—"}
              {diary.data.performance.corp_action ? (
                <span data-role="unmapped" title={t("perf.approx")}> ≈</span>
              ) : diary.data.performance.synthetic_dates ? (
                <span data-role="unmapped" title={t("perf.approxDates")}> ≈</span>
              ) : null}
            </dd>
          </div>
        </dl>
      ) : null}

      {diary.state === "ready" && diary.data.lineage.length > 0 ? (
        <div className="lineage">
          <h3>{t("lineage.heading")}</h3>
          <ul>
            {diary.data.lineage.map((e, i) => (
              <li key={`${e.from_isin}-${e.to_isin}-${i}`}>
                <span className="lineage-when">{format.date(e.date)}</span>{" "}
                {t("lineage.edge", { from: e.from_name ?? e.from_isin ?? "?", to: e.to_name ?? e.to_isin ?? "?" })}
                {e.action ? ` · ${e.action}` : ""}
                {e.ratio ? ` ${e.ratio}` : ""}
                {e.note ? <div className="lineage-note">{e.note}</div> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {diary.state === "ready" && lines.length > 0 ? <h3>{t("diary.transcript")}</h3> : null}

      {diary.state === "error" ? (
        <p role="alert">{t("error.load")}</p>
      ) : diary.state === "loading" ? (
        <p role="status">…</p>
      ) : lines.length === 0 ? (
        <p>{t("diary.none")}</p>
      ) : (
        <DataTable
          rows={lines}
          columns={columns}
          exportColumns={exportColumns}
          format={format}
          pageSize={50}
          caption={t("diary.title", { name })}
          provenance={{
            title: t("diary.title", { name }),
            scope: entity,
            // The reporting currency is the bridge's decision — previously a "—" placeholder.
            reporting_currency: diary.state === "ready" ? diary.data.provenance.reporting_currency : "—",
            row_count: lines.length,
          }}
          columnVisibility={columnVisibility}
          onColumnVisibilityChange={onColumnVisibilityChange}
        />
      )}

      {source ? (
        <SourcePopup entity={entity} sourceId={source} format={format} onClose={() => setSource(null)} />
      ) : null}
    </section>
  );
}
