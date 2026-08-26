import { useEffect, useState } from "react";

import { api, apiReason, isSessionExpired, type SourceDetail } from "../api/client";
import type { Formatter } from "../i18n";
import { presentDocument } from "../present";
import { CopySecret } from "./CopySecret";

/**
 * The source popup (Primitive B): click a fact row's Source, see what it came from.
 *
 * Given a row's `source_id` and the store it belongs to, this fetches the provenance record and shows the
 * document behind the row — its filename (a button that asks the OS to open it, exactly as the Workspace list
 * does; WLW never reads the file), the statement period, the parser that read it, the password to copy, and
 * which store tables it wrote. An id that is no longer in the store fails soft — it says so, it does not error.
 */

type Load = { state: "loading" } | { state: "ready"; data: SourceDetail } | { state: "error" };

export function SourcePopup({
  entity,
  sourceId,
  format,
  onClose,
}: {
  entity: string;
  sourceId: string;
  format: Formatter;
  onClose: () => void;
}) {
  const { t, number, date } = format;
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [openNote, setOpenNote] = useState<string | null>(null);

  useEffect(() => {
    // The popup is mounted fresh per open, so the initial "loading" state already covers the first fetch —
    // no synchronous reset here (which React discourages inside an effect body).
    let live = true;
    void api
      .source(entity, sourceId)
      .then((data) => live && setLoad({ state: "ready", data }))
      .catch(() => live && setLoad({ state: "error" }));
    return () => {
      live = false;
    };
  }, [entity, sourceId]);

  // Escape closes — the dialog is modal, so a keyboard user must be able to dismiss it without the mouse.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const doc = load.state === "ready" ? load.data.document : null;
  // The statement's OWN printed facts, standardised into `detail` by every adapter (WLC capture_io.statement_detail):
  // the printed statement date, and the masked account/card/folio (last-4 only, `••1234`). Shown when present.
  const detail = (load.state === "ready" ? load.data.detail : {}) as Record<string, unknown>;
  const asString = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
  const statementDate = asString(detail.statement_date);
  const accountMasked = asString(detail.account_masked);
  const openFile = async () => {
    if (!doc) return;
    setOpenNote(null);
    try {
      const result = await api.openDocument(entity, doc);
      // Across the LAN the bridge streamed the file to us rather than opening it on the server; show it here.
      if (result.delivery === "streamed") presentDocument(result.blob, result.filename);
    } catch (error: unknown) {
      setOpenNote(isSessionExpired(error) ? t("error.sessionExpired") : t("ws.openFailed", { reason: apiReason(error) }));
    }
  };

  const periodOf = (d: NonNullable<typeof doc>) =>
    d.period_start && d.period_end
      ? `${date(d.period_start)} – ${date(d.period_end)}`
      : d.period_end
        ? date(d.period_end)
        : d.period_start
          ? date(d.period_start)
          : "—";

  return (
    <div className="source-popup-backdrop" onClick={onClose}>
      <div
        className="source-popup"
        role="dialog"
        aria-modal="true"
        aria-label={t("source.title")}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="source-popup-head">
          <h2>{t("source.title")}</h2>
          <button type="button" className="linklike" onClick={onClose} aria-label={t("source.close")}>
            ×
          </button>
        </div>

        {load.state === "loading" ? (
          <p role="status">…</p>
        ) : load.state === "error" ? (
          <p role="alert">{t("error.load")}</p>
        ) : load.data.source_id === null ? (
          <p>{t("source.unknown")}</p>
        ) : (
          <dl className="source-facts">
            {doc && (doc.filename || doc.payload_ref) ? (
              <>
                <dt>{t("column.document")}</dt>
                <dd>
                  {/* Openable via filename OR payload_ref (the workspace-relative path the bridge resolves). */}
                  <button
                    type="button"
                    className="file-open"
                    onClick={() => void openFile()}
                    aria-label={`${t("ws.openFile")}: ${doc.filename ?? doc.payload_ref}`}
                  >
                    {doc.filename ?? doc.payload_ref}
                  </button>
                  {openNote ? <span role="status"> {openNote}</span> : null}
                </dd>
              </>
            ) : null}
            {doc?.provider ? (
              <>
                <dt>{t("column.folder")}</dt>
                <dd>{doc.provider}</dd>
              </>
            ) : null}
            {load.data.adapter ? (
              <>
                <dt>{t("source.adapter")}</dt>
                <dd>{load.data.adapter}</dd>
              </>
            ) : null}
            {doc ? (
              <>
                <dt>{t("column.period")}</dt>
                <dd>{periodOf(doc)}</dd>
              </>
            ) : null}
            {statementDate ? (
              <>
                <dt>{t("source.statementDate")}</dt>
                <dd>{date(statementDate)}</dd>
              </>
            ) : null}
            {accountMasked ? (
              <>
                <dt>{t("source.account")}</dt>
                <dd>{accountMasked}</dd>
              </>
            ) : null}
            {doc?.captured_at ? (
              <>
                <dt>{t("source.captured")}</dt>
                <dd>{doc.captured_at}</dd>
              </>
            ) : null}
            {doc && doc.password.kind === "named" && doc.password.name ? (
              <>
                <dt>{t("column.password")}</dt>
                <dd>
                  <CopySecret
                    entity={entity}
                    what={doc.password.name}
                    label={doc.password.name === "pan" ? t("password.pan") : doc.password.name}
                    format={format}
                  />
                </dd>
              </>
            ) : null}
            {load.data.tables.length ? (
              <>
                <dt>{t("source.tablesWrote")}</dt>
                <dd>
                  <ul className="source-tables">
                    {load.data.tables.map((tbl) => (
                      <li key={tbl.table}>
                        {t("source.tableRows", { table: tbl.table, rows: number(tbl.rows) })}
                      </li>
                    ))}
                  </ul>
                </dd>
              </>
            ) : null}
          </dl>
        )}
      </div>
    </div>
  );
}
