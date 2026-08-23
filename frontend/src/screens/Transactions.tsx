import type { ColumnDef } from "@tanstack/react-table";
import { useCallback, useEffect, useMemo, useState } from "react";

import { api, type Transactions as TxnData, type TransactionRow } from "../api/client";
import { DataTable } from "../components/DataTable";
import { Provenance } from "../components/Provenance";
import type { Formatter } from "../i18n";
import { type Column, moneyColumns } from "../lib/csv";

/**
 * Bank transactions — the finest grain there is, made browsable.
 *
 * The heavy lifting is the shared DataTable: text filter, column sort, pagination and CSV all come from it,
 * so this screen is just the fetch, a date window (server-side, since a household's ledger runs to thousands
 * of rows), and the columns. Amounts are signed exactly as the bridge sends them — negative left the
 * household — and coloured by direction. Nothing is recomputed here.
 */

type Load<T> = { state: "loading" } | { state: "ready"; data: T } | { state: "error" };

export type TransactionsProps = { readonly format: Formatter };

export function Transactions({ format }: TransactionsProps) {
  const { t, money, date } = format;
  const [since, setSince] = useState("");
  const [until, setUntil] = useState("");
  const [applied, setApplied] = useState<{ since: string; until: string }>({ since: "", until: "" });
  const [txns, setTxns] = useState<Load<TxnData>>({ state: "loading" });

  const load = useCallback((s: string, u: string) => {
    void api
      .transactions(s || undefined, u || undefined)
      .then((data) => setTxns({ state: "ready", data }))
      .catch(() => setTxns({ state: "error" }));
  }, []);

  useEffect(() => load(applied.since, applied.until), [applied, load]);

  const rows = txns.state === "ready" ? txns.data.rows : [];
  // Whose column only earns its place when more than one member's rows are present.
  const multiEntity = new Set(rows.map((r) => r.entity_id)).size > 1;

  const columns = useMemo<ColumnDef<TransactionRow>[]>(
    () => [
      { id: "date", accessorKey: "date", header: t("column.date"), cell: ({ row }) => date(row.original.date) },
      ...(multiEntity
        ? [{ id: "whose", accessorKey: "entity_label", header: t("column.whose") } as ColumnDef<TransactionRow>]
        : []),
      { id: "account", accessorFn: (r) => r.bank ?? r.account_id ?? "", header: t("column.from") },
      { id: "narration", accessorKey: "narration", header: t("column.description") },
      {
        id: "amount",
        header: t("column.amount"),
        meta: { numeric: true },
        accessorFn: (r) => Number(r.amount.amount),
        cell: ({ row }) => (
          <span data-direction={Number(row.original.amount.amount) < 0 ? "spend" : "payment"}>
            {money(row.original.amount)}
          </span>
        ),
      },
      { id: "balance", header: t("column.balance"), meta: { numeric: true },
        accessorFn: (r) => (r.balance ? Number(r.balance.amount) : null),
        cell: ({ row }) => (row.original.balance ? money(row.original.balance) : "—") },
    ],
    [t, money, date, multiEntity],
  );

  const exportColumns = useMemo<Column<TransactionRow>[]>(
    () => [
      { header: t("column.date"), value: (r) => r.date ?? null },
      { header: t("column.whose"), value: (r) => r.entity_label },
      { header: t("column.from"), value: (r) => r.bank ?? r.account_id ?? null },
      { header: t("column.description"), value: (r) => r.narration ?? null },
      ...moneyColumns<TransactionRow>(t("column.amount"), (r) => r.amount),
      ...moneyColumns<TransactionRow>(t("column.balance"), (r) => r.balance),
    ],
    [t],
  );

  const hasDates = applied.since !== "" || applied.until !== "";

  return (
    <main className="transactions">
      <h1>{t("txn.title")}</h1>
      <p className="cards-subtitle">{t("txn.subtitle")}</p>

      <div className="txn-dates">
        <label>
          {t("txn.from")}
          <input type="date" value={since} onChange={(e) => setSince(e.target.value)} />
        </label>
        <label>
          {t("txn.to")}
          <input type="date" value={until} onChange={(e) => setUntil(e.target.value)} />
        </label>
        <button type="button" onClick={() => setApplied({ since, until })}>{t("txn.apply")}</button>
        {hasDates ? (
          <button type="button" className="linklike" onClick={() => { setSince(""); setUntil(""); setApplied({ since: "", until: "" }); }}>
            {t("txn.clear")}
          </button>
        ) : null}
      </div>

      {txns.state === "error" ? (
        <p role="alert">{t("error.load")}</p>
      ) : txns.state === "loading" ? (
        <p role="status">…</p>
      ) : rows.length === 0 ? (
        <>
          <Provenance header={txns.data.provenance} />
          <p>{t("txn.none")}</p>
        </>
      ) : (
        <DataTable
          rows={rows}
          columns={columns}
          exportColumns={exportColumns}
          format={format}
          pageSize={50}
          caption={t("txn.title")}
          provenance={txns.data.provenance}
        />
      )}
    </main>
  );
}
