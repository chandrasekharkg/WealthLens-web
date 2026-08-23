import type { ColumnDef } from "@tanstack/react-table";
import { useCallback, useEffect, useMemo, useState } from "react";

import { api, type DiaryLine, type HoldingDiary } from "../api/client";
import type { Formatter } from "../i18n";
import { type Column } from "../lib/csv";
import { DataTable } from "./DataTable";

/**
 * The full transcript of one holding — the detailed_holding_diary drill-down.
 *
 * Where the report row is the holding's current position, this is its whole story: every line the depository
 * statements carried for it, transactional and not, in order. The `role` says why each line did or didn't
 * move ownership — the pledges, settlement legs and unmapped items the quantity ledger deduplicates away are
 * exactly what has reporting value here. Balances are UNIT quantities, not money, so they format as numbers.
 */

type Load<T> = { state: "loading" } | { state: "ready"; data: T } | { state: "error" };

/** A role or, for a non-transaction line, its kind — one legible tag per row. */
function tagOf(line: DiaryLine, t: Formatter["t"]): string {
  if (line.line_kind !== "transaction") return t(`kind.${line.line_kind}` as "kind.balance");
  return line.role ? t(`role.${line.role}` as "role.movement") : "";
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

  const columns = useMemo<ColumnDef<DiaryLine>[]>(
    () => [
      { id: "date", accessorKey: "date", header: t("column.date"), cell: ({ row }) => format.date(row.original.date) },
      {
        id: "type",
        header: t("column.type"),
        accessorFn: (r) => tagOf(r, t),
        cell: ({ row }) => {
          const l = row.original;
          const tag = tagOf(l, t);
          return tag ? <span data-role={l.role ?? l.line_kind}>{tag}</span> : "";
        },
      },
      { id: "description", accessorKey: "description", header: t("column.description") },
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
    ],
    [t, format, num],
  );

  const exportColumns = useMemo<Column<DiaryLine>[]>(
    () => [
      { header: t("column.date"), value: (r) => r.date ?? null },
      { header: t("column.type"), value: (r) => tagOf(r, t) },
      { header: t("column.description"), value: (r) => r.description ?? null },
      { header: t("column.debit"), value: (r) => r.debit ?? null },
      { header: t("column.credit"), value: (r) => r.credit ?? null },
      { header: t("column.balance"), value: (r) => r.closing ?? null },
      { header: "pledged", value: (r) => r.pledged ?? null },
      { header: "locked", value: (r) => r.locked ?? null },
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
        />
      )}
    </section>
  );
}
