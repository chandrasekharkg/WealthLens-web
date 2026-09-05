import type { ColumnDef } from "@tanstack/react-table";
import type { MouseEvent as ReactMouseEvent, ReactNode } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { api, type DiaryLine, type HoldingDiary } from "../api/client";
import type { Formatter } from "../i18n";
import { type Column } from "../lib/csv";
import { type DiaryMeaning, diaryMeaning, diaryMeaningText } from "../lib/diaryMeaning";
import { PROVENANCE_HIDDEN, provenanceColumns, useColumnVisibility } from "../lib/provenance";
import { DataTable } from "./DataTable";
import { Modal } from "./Modal";
import { SourcePopup } from "./SourcePopup";

/**
 * The full transcript of one holding — the detailed_holding_diary drill-down.
 *
 * Where the report row is the holding's current position, this is its whole story: every line the depository
 * statements carried for it, transactional and not, in order. The `role` says why each line did or didn't
 * move ownership — the pledges, settlement legs and unmapped items the quantity ledger deduplicates away are
 * exactly what has reporting value here. Balances are UNIT quantities, not money, so they format as numbers.
 *
 * Two capabilities live here beyond the raw table. (1) Sameness is evidence, not events: a holding held
 * unchanged for years prints one identical balance line per statement — dozens of rows that say the same
 * thing. Consecutive balance lines at an identical position fold into ONE confidence row ("Unchanged at N —
 * confirmed by C statements"); anything that CHANGES breaks the run and stands alone, because change is the
 * event. The fold is a view (a toggle turns it off to see every row); it never touches the data. (2) The
 * panel is presentation-agnostic — it renders inline (a section in the page flow) or as a popup (the shared
 * Modal), chosen by the caller, so the same component can be trialed both ways.
 */

type Load<T> = { state: "loading" } | { state: "ready"; data: T } | { state: "error" };

/** A run of identical consecutive balance lines, folded to one row (see `foldBalanceRuns`). */
type BalanceRun = { count: number; from: string | null; to: string | null };
type DiaryRow = DiaryLine & { _run?: BalanceRun };

// The position a balance line asserts — total plus the band breakdown. Two balance lines are "the same
// confirmation" iff every component matches; a pledge appearing or a lock expiring changes the key and so
// breaks the run, which is exactly right: that IS an event.
function positionKey(l: DiaryLine): string {
  return `${l.closing ?? ""}|${l.pledged ?? ""}|${l.locked ?? ""}|${l.free ?? ""}`;
}

// Fold runs of >= FOLD_MIN consecutive identical balance lines into a single representative row (the most
// recent, so the shown position is current) annotated with the span. Shorter runs, transaction lines, and any
// balance line whose position differs from its neighbour pass through untouched — order is preserved.
const FOLD_MIN = 3;
function foldBalanceRuns(lines: DiaryLine[]): DiaryRow[] {
  const out: DiaryRow[] = [];
  for (let i = 0; i < lines.length; ) {
    const line = lines[i];
    if (!line) {
      i += 1;
      continue;
    }
    if (line.line_kind !== "balance") {
      out.push(line);
      i += 1;
      continue;
    }
    const key = positionKey(line);
    let j = i + 1;
    while (j < lines.length) {
      const next = lines[j];
      if (!next || next.line_kind !== "balance" || positionKey(next) !== key) break;
      j += 1;
    }
    const count = j - i;
    const rep = lines[j - 1] ?? line; // the latest confirmation carries the current position
    if (count >= FOLD_MIN) {
      out.push({ ...rep, _run: { count, from: line.date ?? null, to: rep.date ?? null } });
    } else {
      for (let k = i; k < j; k += 1) {
        const r = lines[k];
        if (r) out.push(r);
      }
    }
    i = j;
  }
  return out;
}

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
  presentation = "inline",
  onSetPresentation,
  focusDiaryId,
}: {
  readonly entity: string;
  readonly instrument: string;
  readonly name: string;
  readonly format: Formatter;
  readonly onClose: () => void;
  /** How to frame the panel: `inline` a section in the page flow, `popup` the shared Modal. */
  readonly presentation?: "inline" | "popup";
  /** When given, the head shows a live inline⇄popup switch (the trial affordance). */
  readonly onSetPresentation?: (mode: "inline" | "popup") => void;
  /** A diary line to open scrolled-to and highlighted — the review-queue / story-strip deep-link anchor. */
  readonly focusDiaryId?: string | null;
}) {
  const { t, number, number2, money } = format;
  const [diary, setDiary] = useState<Load<HoldingDiary>>({ state: "loading" });
  // Sameness-fold on by default: the confidence view is what a reader wants first; the toggle reveals every row.
  const [collapsed, setCollapsed] = useState(true);

  // The plain-language meaning tooltip: which line, and where to float the card. Positioned `fixed` from the
  // trigger's rect so the scrollable transcript never clips it. Shown on hover (desktop) or tap (touch).
  const [tip, setTip] = useState<{ m: DiaryMeaning; x: number; y: number } | null>(null);
  const showTip = useCallback(
    (el: HTMLElement, line: DiaryLine) => {
      const r = el.getBoundingClientRect();
      setTip({ m: diaryMeaning(line, t), x: r.left + r.width / 2, y: r.top });
    },
    [t],
  );
  const hideTip = useCallback(() => setTip(null), []);
  // A fixed tooltip goes stale when the page scrolls under it — dismiss it on any scroll or resize.
  useEffect(() => {
    if (!tip) return;
    const off = () => setTip(null);
    window.addEventListener("scroll", off, true);
    window.addEventListener("resize", off);
    return () => {
      window.removeEventListener("scroll", off, true);
      window.removeEventListener("resize", off);
    };
  }, [tip]);

  useEffect(() => {
    void api
      .holdingDiary(entity, instrument)
      .then((data) => setDiary({ state: "ready", data }))
      .catch(() => setDiary({ state: "error" }));
  }, [entity, instrument]);

  const lines = useMemo(() => (diary.state === "ready" ? diary.data.lines : []), [diary]);
  // Prefer the name the fetch resolved (a URL-opened diary is handed only the instrument id as a placeholder;
  // the fetched holding carries the real name), falling back to the prop until the data arrives.
  const shownName = (diary.state === "ready" && diary.data.name) || name;
  const num = useCallback(
    (v: number | null | undefined) => (v === null || v === undefined ? "" : number(v)),
    [number],
  );

  // What the table shows: the sameness-folded view by default, the raw lines when the reader expands. The
  // count of rows the fold absorbs drives the toggle's label so the reader knows what's hidden and that it's
  // one click away — never a silent truncation.
  const folded = useMemo(() => foldBalanceRuns(lines), [lines]);
  const absorbed = lines.length - folded.length;
  // A deep-link may target a line the fold absorbed (an earlier row of a run — the fold keeps only the latest).
  // When it does, show every row so the anchor is actually there to scroll to; the fold is a view and the
  // anchor wins. Derived (not a setState) so it reverts on its own when the focus clears — the user's collapse
  // preference is never overwritten, only overridden while a hidden line is being pointed at.
  const targetFolded = focusDiaryId ? folded.some((r) => r.diary_id === focusDiaryId) : true;
  const effectiveCollapsed = collapsed && targetFolded;
  // Newest first (KG, 2026-09-05): the transcript is read from "what happened last" backwards, and with a page
  // of 50 the chronological order put a decade-old buy on page 1 and last month's pledge on page 4. The fold is
  // computed on the chronological list (runs are adjacency, which a reversal preserves) and reversed AFTER, so
  // a run's from/to dates stay chronological inside its label.
  const rows: DiaryRow[] = useMemo(
    () => [...(effectiveCollapsed ? folded : lines)].reverse(),
    [effectiveCollapsed, folded, lines],
  );

  const [source, setSource] = useState<string | null>(null);
  const openSource = useCallback((row: DiaryLine) => {
    if (row.source_id) setSource(row.source_id);
  }, []);
  // The derived-end copy-for-issue: fetch the store's PII-free self-check bundle and put it on the clipboard,
  // ready to paste into a GitHub issue (the masking is the engine's, so no real value ever reaches here).
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">("idle");
  const copyDiagnosis = useCallback(async () => {
    try {
      const { writeClipboard } = await import("../lib/clipboard");
      const bundle = await api.holdingDiagnose(entity, instrument);
      await writeClipboard(bundle.report || "");
      setCopyState("copied");
    } catch {
      setCopyState("error");
    }
    setTimeout(() => setCopyState("idle"), 2500);
  }, [entity, instrument]);
  const { columnVisibility, onColumnVisibilityChange } = useColumnVisibility(
    "wlw.columns.diary",
    PROVENANCE_HIDDEN,
  );

  const columns = useMemo<ColumnDef<DiaryRow>[]>(
    () => [
      {
        id: "date",
        accessorKey: "date",
        header: t("column.date"),
        // A folded run spans dates; show the range so the confidence row reads as a period, not a moment.
        cell: ({ row }) => {
          const l = row.original;
          if (l._run && l._run.from && l._run.to && l._run.from !== l._run.to) {
            return `${format.date(l._run.from)} – ${format.date(l._run.to)}`;
          }
          return format.date(l.date);
        },
      },
      {
        id: "type",
        header: t("column.type"),
        accessorFn: (r) => (r._run ? t("diary.confirmed") : verdictOf(r, t).label),
        // The interpreted verdict, toned by direction — and an honest "Needs review" (warning tone) for an
        // off-market/CA line we couldn't name, rather than a silent `unmapped`. A folded run reads as
        // "Confirmed" — the sameness is the strongest evidence, so it renders as its own quiet verdict.
        cell: ({ row }) => {
          const l = row.original;
          // The verdict chip carries the plain-language meaning tooltip — hover, or tap on touch. aria-label
          // gives a screen reader the same sentence without adding a tab stop per row.
          const tipHandlers = {
            className: "verdict-chip",
            tabIndex: -1,
            "aria-label": diaryMeaningText(l, t),
            onMouseEnter: (e: ReactMouseEvent<HTMLElement>) => showTip(e.currentTarget, l),
            onMouseLeave: hideTip,
            onClick: (e: ReactMouseEvent<HTMLElement>) =>
              setTip((cur) => (cur ? null : { m: diaryMeaning(l, t), x: e.currentTarget.getBoundingClientRect().left + e.currentTarget.getBoundingClientRect().width / 2, y: e.currentTarget.getBoundingClientRect().top })),
          };
          if (l._run) {
            return <span data-verdict="confirmed" data-tone="neutral" {...tipHandlers}>{t("diary.confirmed")}</span>;
          }
          const { label, tone } = verdictOf(l, t);
          if (!label) return "";
          return (
            <span data-verdict={l.verdict ?? l.role ?? l.line_kind} data-tone={tone} {...tipHandlers}>
              {label}
            </span>
          );
        },
      },
      {
        id: "description",
        header: t("column.description"),
        accessorFn: (r) =>
          r._run
            ? t("diary.runSummary", { qty: num(r.closing) || "0", count: r._run.count })
            : r.description ?? "",
        // A folded run says what it is in words: unchanged at N, confirmed by C statements.
        cell: ({ row }) => {
          const l = row.original;
          if (l._run) return t("diary.runSummary", { qty: num(l.closing) || "0", count: l._run.count });
          return l.description ?? "";
        },
      },
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
      ...provenanceColumns<DiaryRow>(t, openSource),
    ],
    [t, format, num, openSource, showTip, hideTip],
  );

  const exportColumns = useMemo<Column<DiaryRow>[]>(
    () => [
      { header: "diary_id", value: (r) => r.diary_id ?? null },
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

  // The inline⇄popup switch, shown in the head only when the caller wants to trial the two framings.
  const modeSwitch: ReactNode = onSetPresentation ? (
    <div className="seg" role="group" aria-label={t("diary.viewMode")}>
      <button type="button" aria-pressed={presentation === "inline"} onClick={() => onSetPresentation("inline")}>
        {t("diary.inline")}
      </button>
      <button type="button" aria-pressed={presentation === "popup"} onClick={() => onSetPresentation("popup")}>
        {t("diary.popup")}
      </button>
    </div>
  ) : null;

  const body: ReactNode = (
    <>
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

      {diary.state === "ready" && (diary.data.positions ?? []).length > 0 ? (
        // "Held in" — the per-broker breakdown as a table (the transcript below MERGES every demat's lines,
        // since the diary is keyed by instrument, not account). Who holds how many, since when.
        // `?? []` guards a new frontend talking to an older bridge that predates this field (deploy skew).
        <div className="heldin">
          <h3>{t("diary.heldInHeading")}</h3>
          <table className="mini-table">
            <thead>
              <tr>
                <th>{t("diary.col.broker")}</th>
                <th>{t("diary.col.since")}</th>
                <th className="num">{t("diary.col.units")}</th>
              </tr>
            </thead>
            <tbody>
              {(diary.data.positions ?? []).map((p, i) => (
                <tr key={`${p.broker ?? "?"}-${p.account_masked ?? i}`}>
                  <td>
                    {p.broker ?? t("diary.unknownBroker")}
                    {p.account_masked ? <span className="muted"> {p.account_masked}</span> : null}
                    {p.reconciliation === "superseded" ? (
                      <span data-role="unmapped" title={t("verdict.review")}> ⚑</span>
                    ) : null}
                  </td>
                  <td>{p.since ? format.date(p.since) : "—"}</td>
                  <td className="num">{num(p.shares) || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {diary.state === "ready" && diary.data.value_derivation ? (() => {
        // Level 2 — the VALUE derivation, one figure up from quantity. For a LEDGER-valued holding it reads
        // `value = quantity × price` (the product footing to the value shown); for a STATEMENT-valued one the
        // value is a figure the statement stated, shown with its source — never dressed up as an arithmetic we
        // didn't do. The quantity here breaks down in the table just below (value nests over quantity).
        const vd = diary.data.value_derivation;
        const asProduct = vd.basis === "ledger" && vd.quantity != null && vd.price != null;
        return (
          <div className="valuederiv">
            <h3>{t("valuederiv.heading")}</h3>
            <p className="valuederiv-eq">
              <span className="valuederiv-total">{vd.value ? money(vd.value) : "—"}</span>
              {asProduct ? (
                <>
                  <span className="valuederiv-mark"> = </span>
                  <b>{num(vd.quantity)}</b> {t("valuederiv.units")}
                  <span className="valuederiv-mark"> × </span>
                  <b>{number2(vd.price!)}</b>
                  {vd.price_date ? (
                    <span className="muted"> {t("valuederiv.priceAsOf", { date: format.date(vd.price_date) })}</span>
                  ) : null}
                </>
              ) : (
                <>
                  <span className="muted"> {t("valuederiv.stated")}</span>
                  {vd.source_id ? (
                    <button type="button" className="linklike" onClick={() => setSource(vd.source_id!)}
                      title={t("derivation.openSource")}>
                      {t("derivation.col.source")}
                    </button>
                  ) : null}
                </>
              )}
            </p>
            {asProduct ? <p className="derivation-foot">{t("valuederiv.foots")}</p> : null}
          </div>
        );
      })() : null}

      {diary.state === "ready" && diary.data.derivation ? (() => {
        // Level 2 — the derivation: the ARITHMETIC behind the quantity, as a table. One row per event (date,
        // verb, signed units, fill price, money leg), footing to the total — the honest proof the number adds
        // up. The Source cell opens the statement that asserted the row (Primitive B). The Broker column
        // appears ONLY when the holding was accumulated across MORE THAN ONE broker (else it's noise — one
        // demat holds it all). `?? []` + the outer guard keep an older bridge (no derivation) from breaking.
        const terms = diary.data.derivation.terms ?? [];
        const showBroker = new Set(terms.map((tm) => tm.broker).filter(Boolean)).size > 1;
        return (
          <div className="derivation">
            <h3>{t("derivation.heading")}</h3>
            <table className="mini-table derivation-table">
              <thead>
                <tr>
                  <th>{t("derivation.col.date")}</th>
                  <th>{t("derivation.col.event")}</th>
                  {showBroker ? <th>{t("derivation.col.broker")}</th> : null}
                  <th className="num">{t("derivation.col.units")}</th>
                  <th className="num">{t("derivation.col.price")}</th>
                  <th className="num">{t("derivation.col.amount")}</th>
                  <th aria-label={t("derivation.col.source")} />
                </tr>
              </thead>
              <tbody>
                {terms.map((term, i) => (
                  <tr key={`${term.date ?? ""}-${term.action ?? ""}-${i}`} data-sign={term.sign === "-" ? "down" : "up"}>
                    <td>{term.date ? format.date(term.date) : "—"}</td>
                    <td>{term.action}</td>
                    {showBroker ? <td>{term.broker ?? t("diary.unknownBroker")}</td> : null}
                    <td className="num" data-sign={term.sign === "-" ? "down" : "up"}>{term.sign}{num(term.quantity)}</td>
                    <td className="num">{term.price ? number2(term.price) : "—"}</td>
                    <td className="num">{term.amount ? money(term.amount) : "—"}</td>
                    <td className="num">
                      {term.source_id ? (
                        <button type="button" className="linklike" onClick={() => setSource(term.source_id!)}
                          title={t("derivation.openSource")}>
                          {t("derivation.col.source")}
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={showBroker ? 3 : 2}>{t("derivation.total")}</td>
                  <td className="num"><b>{num(diary.data.derivation.total)}</b></td>
                  <td colSpan={3} />
                </tr>
              </tfoot>
            </table>
            <p className="derivation-foot">{t("derivation.foots")}</p>
            <button
              type="button"
              className="derivation-copy"
              onClick={() => void copyDiagnosis()}
              title={t("derivation.copyHint")}
            >
              {copyState === "copied" ? t("derivation.copied")
                : copyState === "error" ? t("derivation.copyFailed")
                : t("derivation.copy")}
            </button>
          </div>
        );
      })() : null}

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

      {diary.state === "ready" && lines.length > 0 ? (
        <div className="diary-transcript-head">
          <h3>{t("diary.transcript")}</h3>
          {absorbed > 0 ? (
            // The fold is honest: the reader is told how many rows it absorbs and that the toggle reveals them.
            <label className="diary-collapse">
              <input type="checkbox" checked={effectiveCollapsed} onChange={(e) => setCollapsed(e.target.checked)} />
              {t("diary.collapseRuns", { count: absorbed })}
            </label>
          ) : null}
        </div>
      ) : null}

      {diary.state === "error" ? (
        <p role="alert">{t("error.load")}</p>
      ) : diary.state === "loading" ? (
        <p role="status">…</p>
      ) : lines.length === 0 ? (
        <p>{t("diary.none")}</p>
      ) : (
        <DataTable
          rows={rows}
          columns={columns}
          exportColumns={exportColumns}
          format={format}
          pageSize={50}
          caption={t("diary.title", { name: shownName })}
          provenance={{
            title: t("diary.title", { name: shownName }),
            scope: entity,
            // The reporting currency is the bridge's decision — previously a "—" placeholder.
            reporting_currency: diary.state === "ready" ? diary.data.provenance.reporting_currency : "—",
            row_count: rows.length,
          }}
          columnVisibility={columnVisibility}
          onColumnVisibilityChange={onColumnVisibilityChange}
          getRowId={(r) => r.diary_id ?? undefined}
          focusRowId={focusDiaryId ?? null}
        />
      )}

      {source ? (
        <SourcePopup entity={entity} sourceId={source} format={format} onClose={() => setSource(null)} />
      ) : null}

      {tip ? (
        // The plain-language meaning card — floated above the hovered/tapped verdict chip. `fixed` + the
        // trigger's own coordinates keep it out of the transcript's horizontal scroll clip.
        <div className="diary-tip" style={{ left: tip.x, top: tip.y }} aria-hidden="true">
          {tip.m.event ? <p className="diary-tip-event">{tip.m.event}</p> : null}
          <p className="diary-tip-status">{tip.m.status}</p>
          <p className="diary-tip-foot">{t("diary.mean.foot")}</p>
        </div>
      ) : null}
    </>
  );

  if (presentation === "popup") {
    return (
      <Modal
        title={t("diary.title", { name: shownName })}
        onClose={onClose}
        closeLabel={t("diary.close")}
        size="wide"
        headExtra={modeSwitch}
      >
        {body}
      </Modal>
    );
  }

  return (
    <section className="statement statement-drill diary-panel">
      <div className="statement-head">
        <h2>{t("diary.title", { name: shownName })}</h2>
        <div className="modal-head-tail">
          {modeSwitch}
          <button type="button" className="linklike" onClick={onClose}>
            {t("diary.close")}
          </button>
        </div>
      </div>
      {body}
    </section>
  );
}
