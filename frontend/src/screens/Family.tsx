import type { ColumnDef } from "@tanstack/react-table";
import { useCallback, useEffect, useMemo, useState } from "react";

import { api, type Family as FamilyData, type FamilyTransfers, type TransferRow } from "../api/client";
import { DataTable } from "../components/DataTable";
import { SourcePopup } from "../components/SourcePopup";
import type { Formatter } from "../i18n";
import { type Column, moneyColumns } from "../lib/csv";
import { PROVENANCE_HIDDEN, provenanceColumns, useColumnVisibility } from "../lib/provenance";

/**
 * Family — money moved to the people in your household.
 *
 * Each person the store records a kinship with, with what was sent to them (matched by name on the bank
 * statements, every part of the name required so a person isn't a coincidental substring) and what the store
 * attributes to them. Open a person to see each transfer. Nothing is computed here — the match and the totals
 * arrive from the bridge.
 */

type Load<T> = { state: "loading" } | { state: "ready"; data: T } | { state: "error" };
type Focus = { entity: string; member: string; name: string; key: string };

export type FamilyProps = { readonly format: Formatter };

export function Family({ format }: FamilyProps) {
  const { t, money, date } = format;
  const [fam, setFam] = useState<Load<FamilyData>>({ state: "loading" });
  const [focus, setFocus] = useState<Focus | null>(null);

  useEffect(() => {
    void api
      .family()
      .then((data) => setFam({ state: "ready", data }))
      .catch(() => setFam({ state: "error" }));
  }, []);

  if (fam.state === "loading") return <p role="status">…</p>;
  if (fam.state === "error") return <p role="alert">{t("error.load")}</p>;
  if (fam.data.rows.length === 0) return <p>{t("family.none")}</p>;

  return (
    <main className="family">
      <h1>{t("family.title")}</h1>
      <p className="cards-subtitle">{t("family.subtitle")}</p>

      <div className="family-list" role="list">
        {fam.data.rows.map((m) => {
          const key = `${m.entity_id}/${m.member_id}`;
          const sent = Number(m.total.amount);
          return (
            <button
              key={key}
              type="button"
              role="listitem"
              className="family-tile"
              aria-current={focus?.key === key}
              onClick={() =>
                m.member_id
                  ? setFocus({ entity: m.entity_id ?? "", member: m.member_id, name: m.name ?? m.member_id, key })
                  : undefined
              }
              disabled={m.transfers === 0}
            >
              <span className="family-name">{m.name}</span>
              <span className="family-rel">{m.relationship}</span>
              <span className="family-amount" data-sent={sent > 0}>{money(m.total)}</span>
              <span className="family-meta">
                {t("family.count", { count: m.transfers })}
                {m.holdings > 0 ? ` · ${t("family.holdings", { count: m.holdings })}` : ""}
                {m.first_transfer && m.last_transfer
                  ? ` · ${t("family.since", { from: date(m.first_transfer), to: date(m.last_transfer) })}`
                  : ""}
              </span>
            </button>
          );
        })}
      </div>

      {focus ? (
        <section className="statement statement-drill">
          <div className="statement-head">
            <h2>{t("family.transfersTo", { name: focus.name })}</h2>
            <button type="button" className="linklike" onClick={() => setFocus(null)}>
              {t("family.close")}
            </button>
          </div>
          <TransferList key={focus.key} focus={focus} format={format} />
        </section>
      ) : null}
    </main>
  );
}

/** The individual transfers to one member — fetched on open, keyed so switching members remounts. */
function TransferList({ focus, format }: { focus: Focus; format: Formatter }) {
  const { t, money, date } = format;
  const [state, setState] = useState<Load<FamilyTransfers>>({ state: "loading" });

  useEffect(() => {
    void api
      .familyTransfers(focus.entity, focus.member)
      .then((data) => setState({ state: "ready", data }))
      .catch(() => setState({ state: "error" }));
  }, [focus.entity, focus.member]);

  const rows = state.state === "ready" ? state.data.transfers : [];

  const [source, setSource] = useState<string | null>(null);
  const openSource = useCallback((row: TransferRow) => {
    if (row.source_id) setSource(row.source_id);
  }, []);
  const { columnVisibility, onColumnVisibilityChange } = useColumnVisibility(
    "wlw.columns.transfers",
    PROVENANCE_HIDDEN,
  );

  const columns = useMemo<ColumnDef<TransferRow>[]>(
    () => [
      { id: "date", accessorKey: "date", header: t("column.date"), cell: ({ row }) => date(row.original.date) },
      { id: "bank", accessorKey: "bank", header: t("column.from") },
      { id: "narration", accessorKey: "narration", header: t("column.description") },
      {
        id: "amount",
        header: t("column.amount"),
        meta: { numeric: true },
        accessorFn: (r) => Number(r.amount.amount),
        cell: ({ row }) => money(row.original.amount),
      },
      ...provenanceColumns<TransferRow>(t, openSource),
    ],
    [t, money, date, openSource],
  );

  const exportColumns = useMemo<Column<TransferRow>[]>(
    () => [
      { header: t("column.date"), value: (r) => r.date ?? null },
      { header: t("column.from"), value: (r) => r.bank ?? null },
      { header: t("column.description"), value: (r) => r.narration ?? null },
      ...moneyColumns<TransferRow>(t("column.amount"), (r) => r.amount),
      { header: t("column.source"), value: (r) => r.source_id ?? null },
      { header: t("column.createdBy"), value: (r) => r.created_by ?? null },
      { header: t("column.createdAt"), value: (r) => r.created_at ?? null },
      { header: t("column.updatedBy"), value: (r) => r.updated_by ?? null },
      { header: t("column.updatedAt"), value: (r) => r.updated_at ?? null },
    ],
    [t],
  );

  if (state.state === "error") return <p role="alert">{t("error.load")}</p>;
  if (state.state === "loading") return <p role="status">…</p>;

  return (
    <>
      <DataTable
        rows={rows}
        columns={columns}
        exportColumns={exportColumns}
        format={format}
        pageSize={25}
        caption={t("family.transfersTo", { name: focus.name })}
        provenance={{
          title: t("family.transfersTo", { name: focus.name }),
          scope: focus.entity,
          // The reporting currency is the bridge's decision, not something to read off the first row.
          reporting_currency: state.data.provenance.reporting_currency,
          row_count: rows.length,
        }}
        columnVisibility={columnVisibility}
        onColumnVisibilityChange={onColumnVisibilityChange}
      />
      {source ? (
        <SourcePopup entity={focus.entity} sourceId={source} format={format} onClose={() => setSource(null)} />
      ) : null}
    </>
  );
}
