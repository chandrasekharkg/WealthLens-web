import { useCallback, useState } from "react";

import { api, ApiError, type Job, type NetWorth } from "../api/client";
import type { Formatter } from "../i18n";

/**
 * Rebuild, review, promote — the store lifecycle, in the order it must happen.
 *
 * Promotion is the one act here that cannot be undone, so the screen never offers it as a button beside a
 * refresh icon. It is reachable only after a rebuild has produced a tally the user can read, and the
 * confirmation is typed. The same rule is enforced on the server (`check_promotion`): this screen makes
 * the guard visible, it does not constitute it.
 */

type Tally = { table: string; current: number; rebuilt: number; delta: number };

export type OperationsProps = {
  readonly entities: NetWorth["entities"];
  readonly format: Formatter;
  readonly onPromoted?: () => void;
};

export function Operations({ entities, format, onPromoted }: OperationsProps) {
  const { t, number } = format;
  const [entity, setEntity] = useState(entities[0]?.entity_id ?? "");
  const [rebuild, setRebuild] = useState<Job | null>(null);
  const [promotion, setPromotion] = useState<Job | null>(null);
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);

  const chosen = entities.find((candidate) => candidate.entity_id === entity);

  const await_ = useCallback(async (id: string) => {
    let job = await api.job(id);
    while (job.state !== "finished") {
      await new Promise((resolve) => setTimeout(resolve, 500));
      job = await api.job(id);
    }
    return job;
  }, []);

  const runRebuild = async () => {
    setBusy(true);
    setRefusal(null);
    setPromotion(null);
    try {
      const started = await api.startJob("rebuild", entity);
      setRebuild(await await_(started.id));
    } finally {
      setBusy(false);
    }
  };

  const runPromote = async () => {
    setBusy(true);
    setRefusal(null);
    try {
      const started = await api.promote(entity, { confirm, after: rebuild?.id });
      const done = await await_(started.id);
      setPromotion(done);
      if (done.changed_something) onPromoted?.();
    } catch (error: unknown) {
      // A refused promotion is not a failure: the store is untouched, and the reason is actionable.
      const detail = error instanceof ApiError ? error.detail : null;
      setRefusal(
        (detail as { detail?: { reason?: string } } | null)?.detail?.reason ?? t("error.load"),
      );
    } finally {
      setBusy(false);
    }
  };

  const tally = ((rebuild?.result?.tally as Tally[] | undefined) ?? []).filter((row) => row.delta !== 0);
  const regressions = (rebuild?.result?.regressions as unknown[] | undefined) ?? [];
  const reviewed = rebuild?.state === "finished" && rebuild.changed_something;

  return (
    <main>
      <h1>{t("ops.title")}</h1>

      <p>
        <label htmlFor="ops-entity">{t("import.chooseEntity")}</label>{" "}
        <select
          id="ops-entity"
          value={entity}
          onChange={(event) => {
            setEntity(event.target.value);
            // A tally belongs to ONE workspace. Carrying it across a selection change would offer to
            // promote one member's rebuild into another member's store.
            setRebuild(null);
            setPromotion(null);
            setConfirm("");
          }}
        >
          {entities.map((option) => (
            <option key={option.entity_id} value={option.entity_id} disabled={!option.contributes}>
              {option.label}
            </option>
          ))}
        </select>
      </p>

      <section aria-label={t("ops.rebuild")}>
        <p>{t("ops.rebuildWhy")}</p>
        <button type="button" onClick={() => void runRebuild()} disabled={busy || !entity}>
          {busy && !rebuild ? t("ops.rebuilding") : t("ops.rebuild")}
        </button>
      </section>

      {rebuild?.state === "finished" && (
        <section aria-label={t("ops.tally")}>
          <h2>{t("ops.tally")}</h2>
          {regressions.length > 0 && (
            <p role="alert" data-tone="warning">
              {t("ops.regressions", { count: number(regressions.length) })}
            </p>
          )}
          {tally.length === 0 ? (
            <p role="status">{t("ops.noChange")}</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>{t("ops.tallyTable")}</th>
                  <th>{t("ops.tallyCurrent")}</th>
                  <th>{t("ops.tallyRebuilt")}</th>
                  <th>{t("ops.tallyDelta")}</th>
                </tr>
              </thead>
              <tbody>
                {tally.map((row) => (
                  <tr key={row.table}>
                    <td>{row.table}</td>
                    <td>{number(row.current)}</td>
                    <td>{number(row.rebuilt)}</td>
                    <td>{row.delta > 0 ? `+${number(row.delta)}` : number(row.delta)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}

      <section aria-label={t("ops.promote")}>
        <h2>{t("ops.promote")}</h2>
        {!reviewed ? (
          <p role="status">{t("ops.needsRebuild")}</p>
        ) : (
          <>
            <p role="alert" data-tone="warning">
              {t("ops.promoteWarning", { label: chosen?.label ?? entity })}
            </p>
            <label htmlFor="confirm">{t("ops.confirmLabel", { id: entity })}</label>{" "}
            <input id="confirm" value={confirm} onChange={(event) => setConfirm(event.target.value)} />{" "}
            <button
              type="button"
              onClick={() => void runPromote()}
              // Unreachable until the word matches — and refused again on the server if it does not.
              disabled={busy || confirm !== entity}
            >
              {t("ops.promote")}
            </button>
          </>
        )}
        {refusal && (
          <p role="alert" data-tone="warning">
            {t("import.nothingChanged", { reason: refusal })}
          </p>
        )}
        {promotion?.outcome === "refused" && (
          <p role="alert" data-tone="warning">
            {t("import.nothingChanged", {
              reason: promotion.gate ? t("import.refusedBy", { gate: promotion.gate }) : "",
            })}
          </p>
        )}
        {promotion?.outcome === "ok" && (
          <p role="status">{t("ops.promoted", { label: chosen?.label ?? entity })}</p>
        )}
      </section>
    </main>
  );
}
