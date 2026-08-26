import type { ColumnDef } from "@tanstack/react-table";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  api,
  type CardBillPaymentRow,
  type CardBillPayments,
  type CardStatement,
} from "../api/client";
import { DataTable } from "../components/DataTable";
import { SourcePopup } from "../components/SourcePopup";
import type { Formatter } from "../i18n";
import { type Column, moneyColumns } from "../lib/csv";
import { PROVENANCE_HIDDEN, provenanceColumns, useColumnVisibility } from "../lib/provenance";
import { CardStatementBody } from "./Cards";

/**
 * Bill payments: the bank→card drill-down.
 *
 * A credit-card bill leaves the bank as a debit and lands on the card as a payment of the SAME amount — so
 * this screen finds the card bill payments across the bank statements by that amount match, which works even
 * when the bank narration names no card (an Amazon Pay / UPI / BBPS payment reads as a bare reference, and
 * the same rail pays every card). Each resolved payment opens the very statement it cleared, reusing the
 * card-statement view so a bill looks and exports identically wherever it is read.
 *
 * Nothing is computed here: the match, the resolved card, and the drill target all arrive from the bridge.
 */

type Load<T> = { state: "loading" } | { state: "ready"; data: T } | { state: "error" };

const cardName = (issuer: string | null | undefined) => (issuer ? `${issuer.toUpperCase()} card` : "—");

/** Identifies the selected payment's drill target: which store, which card, which statement. */
type Focus = { entity: string; issuer: string; period: string; key: string };

export type PaymentsProps = {
  readonly format: Formatter;
};

export function Payments({ format }: PaymentsProps) {
  const { t, money, date } = format;
  const [payments, setPayments] = useState<Load<CardBillPayments>>({ state: "loading" });
  const [focus, setFocus] = useState<Focus | null>(null);

  useEffect(() => {
    void api
      .cardBillPayments()
      .then((data) => setPayments({ state: "ready", data }))
      .catch(() => setPayments({ state: "error" }));
  }, []);

  const rows = payments.state === "ready" ? payments.data.rows : [];

  // The source popup (Primitive B) for the payment's own bank-statement source.
  const [source, setSource] = useState<{ entity: string; sourceId: string } | null>(null);
  const openSource = useCallback((r: CardBillPaymentRow) => {
    if (r.source_id && r.entity_id) setSource({ entity: r.entity_id, sourceId: r.source_id });
  }, []);
  const { columnVisibility, onColumnVisibilityChange } = useColumnVisibility(
    "wlw.columns.payments",
    PROVENANCE_HIDDEN,
  );

  const open = (r: CardBillPaymentRow) => {
    if (!r.resolved || !r.issuer || !r.statement_date || !r.entity_id) return;
    setFocus({
      entity: r.entity_id,
      issuer: r.issuer,
      period: r.statement_date,
      key: `${r.entity_id}/${r.issuer}/${r.statement_date}`,
    });
  };

  const columns = useMemo<ColumnDef<CardBillPaymentRow>[]>(
    () => [
      { id: "date", accessorKey: "date", header: t("column.date"), cell: ({ row }) => date(row.original.date) },
      { id: "bank", accessorKey: "bank", header: t("column.from") },
      {
        id: "amount",
        header: t("column.amount"),
        meta: { numeric: true },
        accessorFn: (r) => Number(r.amount.amount),
        cell: ({ row }) => money(row.original.amount),
      },
      {
        id: "card",
        header: t("payments.paidTo"),
        accessorFn: (r) => r.issuer ?? "",
        cell: ({ row }) => cardName(row.original.issuer),
      },
      {
        id: "link",
        header: t("payments.link"),
        enableSorting: false,
        // Honest linkage: the card is always matched by amount, but the STATEMENT is either an exact
        // bill-balance clear or a cycle fallback (a partial payment lands on the cycle, not a confirmed bill).
        cell: ({ row }) => {
          const r = row.original;
          if (!r.resolved) return <span data-identifier="none">{t("payments.notLoaded")}</span>;
          return (
            <button type="button" className="linklike" onClick={() => open(r)}>
              {t("payments.view")}
              {r.match === "cycle" ? (
                <span className="link-inferred" title={t("payments.cycleTip")}>
                  {" "}· {t("payments.cycle")}
                </span>
              ) : null}
            </button>
          );
        },
      },
      // The provenance/audit group (Primitive A) — the payment's own bank-statement source, hidden by default.
      ...provenanceColumns<CardBillPaymentRow>(t, openSource),
    ],
    [t, money, date, openSource],
  );

  const exportColumns = useMemo<Column<CardBillPaymentRow>[]>(
    () => [
      { header: t("column.date"), value: (r) => r.date ?? null },
      { header: t("column.from"), value: (r) => r.bank ?? null },
      ...moneyColumns<CardBillPaymentRow>(t("column.amount"), (r) => r.amount),
      { header: t("payments.paidTo"), value: (r) => r.issuer ?? null },
      { header: t("cards.period"), value: (r) => r.statement_date ?? null },
      { header: t("payments.link"), value: (r) => r.match ?? null },
      { header: t("column.source"), value: (r) => r.source_id ?? null },
      { header: t("column.createdBy"), value: (r) => r.created_by ?? null },
      { header: t("column.createdAt"), value: (r) => r.created_at ?? null },
      { header: t("column.updatedBy"), value: (r) => r.updated_by ?? null },
      { header: t("column.updatedAt"), value: (r) => r.updated_at ?? null },
    ],
    [t],
  );

  if (payments.state === "loading") return <p role="status">…</p>;
  if (payments.state === "error") return <p role="alert">{t("error.load")}</p>;
  if (rows.length === 0) return <p>{t("payments.none")}</p>;

  return (
    <main className="payments">
      <h1>{t("payments.title")}</h1>
      <p className="cards-subtitle">{t("payments.subtitle")}</p>

      <DataTable
        rows={rows}
        columns={columns}
        exportColumns={exportColumns}
        format={format}
        pageSize={25}
        caption={t("payments.title")}
        provenance={{
          ...payments.data.provenance,
          title: t("payments.title"),
        }}
        columnVisibility={columnVisibility}
        onColumnVisibilityChange={onColumnVisibilityChange}
      />

      {focus ? (
        <section className="statement statement-drill">
          <div className="statement-head">
            <h2>{t("payments.viewing")}</h2>
            <button type="button" className="linklike" onClick={() => setFocus(null)}>
              {t("payments.close")}
            </button>
          </div>
          {/* Keyed by the payment, so opening another remounts to its loading state — no synchronous reset. */}
          <BillDetail key={focus.key} focus={focus} format={format} />
        </section>
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

/** Fetches and shows one cleared bill — the card statement whose dues the payment settled. */
function BillDetail({ focus, format }: { focus: Focus; format: Formatter }) {
  const { t } = format;
  const [statement, setStatement] = useState<Load<CardStatement>>({ state: "loading" });

  useEffect(() => {
    void api
      .cardStatement(focus.entity, focus.issuer, focus.period)
      .then((data) => setStatement({ state: "ready", data }))
      .catch(() => setStatement({ state: "error" }));
  }, [focus.entity, focus.issuer, focus.period]);

  if (statement.state === "error") return <p role="alert">{t("error.load")}</p>;

  return (
    <CardStatementBody
      statement={statement.state === "ready" ? statement.data : null}
      loading={statement.state === "loading"}
      issuer={focus.issuer}
      scope={focus.entity}
      entity={focus.entity}
      format={format}
    />
  );
}
