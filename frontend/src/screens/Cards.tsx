import type { ColumnDef } from "@tanstack/react-table";
import { useEffect, useMemo, useState } from "react";

import {
  api,
  type CardRow,
  type Cards as CardsData,
  type CardStatement,
  type CardStatements,
  type CardStatementLine,
} from "../api/client";
import { DataTable } from "../components/DataTable";
import type { Formatter } from "../i18n";
import { type Column, moneyColumns } from "../lib/csv";

/**
 * Cards: pick a card, read a statement.
 *
 * A credit card is a `card:<issuer>` subledger of the bank ledger — every statement PDF loads its purchases
 * and payments there, and its (previous, new) balance rides on the source. This screen is two questions in
 * sequence: *which card* (the picker, one tile per card, ordered by what is owed) and *which statement of
 * it* (the period selector, defaulting to the latest — "this month"). Nothing here computes money: the
 * outstanding figure, the balances, and the per-line signs all arrive decided from the bridge.
 *
 * A card is tagged with whose store it came from, so a family with several stores sees every card, each
 * attributed — and the drill-down into a statement asks that store, by (entity, issuer).
 */

type Load<T> = { state: "loading" } | { state: "ready"; data: T } | { state: "error" };

/** A stable id for a card across the family: which store, which issuer. */
const cardKey = (c: Pick<CardRow, "entity_id" | "issuer">) => `${c.entity_id}/${c.issuer}`;

/** "axis" → "AXIS card". The issuer is the canonical short name the store keyed on. */
const cardName = (issuer: string) => `${issuer.toUpperCase()} card`;

/**
 * The Card Star: a statement's paid-state, coloured by how settled it is. "Paid" and "minimum paid" are the
 * good states (the user's rule: paid ≥ minimum earns the star); "part paid" warns; "unpaid" is bad; "nothing
 * due" and the still-open "current" statement are neutral. The bridge derives the state — this only paints it.
 */
const STATUS_TONE: Record<string, string> = {
  paid: "ok",
  paid_minimum: "ok",
  partial: "warn",
  unpaid: "bad",
  nil: "muted",
  pending: "muted",
};

function StatusBadge({ status, t }: { status: CardRow["status"]; t: Formatter["t"] }) {
  if (!status) return null;
  return (
    <span className="card-status" data-tone={STATUS_TONE[status] ?? "muted"}>
      {t(`cards.status.${status}` as "cards.status.paid")}
    </span>
  );
}

export type CardsProps = {
  readonly format: Formatter;
};

export function Cards({ format }: CardsProps) {
  const { t, money } = format;
  const [cards, setCards] = useState<Load<CardsData>>({ state: "loading" });
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    void api
      .cards()
      .then((data) => {
        setCards({ state: "ready", data });
        // Land on a statement immediately: pre-select the first card (the one owing the most).
        const first = data.rows[0];
        setSelected((prev) => prev ?? (first ? cardKey(first) : null));
      })
      .catch(() => setCards({ state: "error" }));
  }, []);

  if (cards.state === "loading") return <p role="status">…</p>;
  if (cards.state === "error") return <p role="alert">{t("error.load")}</p>;
  if (cards.data.rows.length === 0) return <p>{t("cards.none")}</p>;

  const rows = cards.data.rows;
  const current = rows.find((c) => cardKey(c) === selected) ?? null;

  return (
    <main className="cards">
      <h1>{t("cards.title")}</h1>
      <p className="cards-subtitle">{t("cards.subtitle")}</p>

      <div className="card-picker" role="list">
        {rows.map((c) => {
          const owed = c.outstanding ? Number(c.outstanding.amount) : 0;
          return (
            <button
              key={cardKey(c)}
              type="button"
              role="listitem"
              className="card-tile"
              aria-current={cardKey(c) === selected}
              onClick={() => setSelected(cardKey(c))}
            >
              <span className="card-tile-name">{cardName(c.issuer)}</span>
              {/* When several stores contribute, whose card it is matters; a single store stays quiet. */}
              {c.entity_label && rows.some((o) => o.entity_id !== c.entity_id) ? (
                <span className="card-tile-whose">{c.entity_label}</span>
              ) : null}
              <span className="card-tile-amount" data-owed={owed > 0}>
                {c.outstanding ? money(c.outstanding) : "—"}
              </span>
              <span className="card-tile-meta">
                {owed > 0 ? t("cards.owed") : t("cards.settled")} ·{" "}
                {t("cards.statements", { count: c.statements })}
              </span>
              {/* The star: the newest statement's paid-state. */}
              <StatusBadge status={c.status} t={t} />
            </button>
          );
        })}
      </div>

      {current ? (
        // Keyed by the card, so switching cards remounts: the period resets to "latest" and the loading
        // state is the fresh mount's initial state — no synchronous reset inside an effect.
        <Statement key={cardKey(current)} card={current} format={format} />
      ) : (
        <p>{t("cards.pick")}</p>
      )}
    </main>
  );
}

/** The selected card's statement — its period selector, the summary header, and the itemised lines. */
function Statement({ card, format }: { card: CardRow; format: Formatter }) {
  const { t, date } = format;
  const entity = card.entity_id ?? "";
  const [periods, setPeriods] = useState<Load<CardStatements>>({ state: "loading" });
  const [period, setPeriod] = useState<string | undefined>(undefined);
  const [statement, setStatement] = useState<Load<CardStatement>>({ state: "loading" });

  // The period list drives the dropdown. It is a property of the card, so it is fetched once per mount —
  // and the component is keyed by card, so a card switch is a remount, not a re-fetch here.
  useEffect(() => {
    void api
      .cardStatements(entity, card.issuer)
      .then((data) => setPeriods({ state: "ready", data }))
      .catch(() => setPeriods({ state: "error" }));
  }, [entity, card.issuer]);

  // State is set only from the fetch's callbacks (never synchronously in the body): the initial "loading"
  // is the initial STATE, and a period change lets the prior statement stand until the new one arrives.
  useEffect(() => {
    void api
      .cardStatement(entity, card.issuer, period)
      .then((data) => setStatement({ state: "ready", data }))
      .catch(() => setStatement({ state: "error" }));
  }, [entity, card.issuer, period]);

  if (statement.state === "error") return <p role="alert">{t("error.load")}</p>;

  const head = statement.state === "ready" ? statement.data : null;
  const options = periods.state === "ready" ? periods.data.statements : [];
  // The paid-state of the statement now shown: the selected period, or the latest when none is chosen.
  const shownStatus = (period ? options.find((o) => o.statement_date === period) : options[0])?.status ?? null;

  return (
    <section className="statement">
      <div className="statement-head">
        <h2>{cardName(card.issuer)}</h2>
        <StatusBadge status={shownStatus} t={t} />
        <label className="statement-period">
          {t("cards.period")}
          <select
            value={period ?? ""}
            onChange={(e) => setPeriod(e.target.value || undefined)}
            disabled={options.length === 0}
          >
            {/* Empty value = "latest", so the default selection is always the current month. */}
            {options.map((s, i) => (
              <option key={s.statement_date ?? i} value={i === 0 ? "" : (s.statement_date ?? "")}>
                {date(s.statement_date)}
              </option>
            ))}
          </select>
        </label>
      </div>

      <CardStatementBody
        statement={head}
        loading={statement.state === "loading"}
        issuer={card.issuer}
        scope={card.entity_label ?? entity}
        format={format}
      />
    </section>
  );
}

/**
 * The body of one card statement — the balance summary and the itemised lines. Presentational: it renders
 * whatever loaded statement it is handed. Shared by the Cards tab (under its period selector) and the
 * bank→card drill-down, so a statement looks and exports identically wherever it is opened.
 */
export function CardStatementBody({
  statement,
  loading,
  issuer,
  scope,
  format,
}: {
  readonly statement: CardStatement | null;
  readonly loading: boolean;
  readonly issuer: string;
  readonly scope: string;
  readonly format: Formatter;
}) {
  const { t, money, date } = format;
  const lines = statement?.transactions ?? [];

  const columns = useMemo<ColumnDef<CardStatementLine>[]>(
    () => [
      { id: "date", accessorKey: "date", header: t("column.date"), cell: ({ row }) => date(row.original.date) },
      {
        id: "description",
        accessorKey: "description",
        header: t("column.description"),
        // Close the loop: a payment line names the bank account that funded it (reverse of Bill payments).
        cell: ({ row }) =>
          row.original.funded_by_bank ? (
            <>
              {row.original.description}{" "}
              <span className="funded-tag">← {t("cards.fundedBy", { bank: row.original.funded_by_bank })}</span>
            </>
          ) : (
            row.original.description
          ),
      },
      {
        id: "direction",
        header: t("column.direction"),
        accessorFn: (r) => r.direction,
        cell: ({ row }) => (
          <span data-direction={row.original.direction}>
            {t(`direction.${row.original.direction}` as "direction.spend")}
          </span>
        ),
      },
      {
        id: "amount",
        header: t("column.amount"),
        meta: { numeric: true },
        accessorFn: (r) => Number(r.amount.amount),
        cell: ({ row }) => (
          <span data-direction={row.original.direction}>{money(row.original.amount)}</span>
        ),
      },
    ],
    [t, money, date],
  );

  const exportColumns = useMemo<Column<CardStatementLine>[]>(
    () => [
      { header: t("column.date"), value: (r) => r.date ?? null },
      { header: t("column.description"), value: (r) => r.description ?? null },
      { header: t("column.direction"), value: (r) => r.direction },
      ...moneyColumns<CardStatementLine>(t("column.amount"), (r) => r.amount),
    ],
    [t],
  );

  const caption = `${cardName(issuer)} — ${date(statement?.statement_date)}`;

  return (
    <>
      {statement ? (
        <dl className="statement-summary">
          <div>
            <dt>{t("cards.previousBalance")}</dt>
            <dd>{statement.previous_balance ? money(statement.previous_balance) : "—"}</dd>
          </div>
          <div>
            <dt>{t("cards.newBalance")}</dt>
            <dd className="statement-owed">{statement.new_balance ? money(statement.new_balance) : "—"}</dd>
          </div>
        </dl>
      ) : null}

      {loading ? (
        <p role="status">…</p>
      ) : lines.length === 0 ? (
        <p>{t("cards.empty")}</p>
      ) : (
        <DataTable
          rows={lines}
          columns={columns}
          exportColumns={exportColumns}
          format={format}
          caption={caption}
          provenance={{
            title: caption,
            scope,
            as_of: statement?.statement_date ?? null,
            // The reporting currency is the bridge's decision, not something to read off the first row.
            reporting_currency: statement?.provenance.reporting_currency ?? "INR",
            row_count: lines.length,
          }}
        />
      )}
    </>
  );
}
