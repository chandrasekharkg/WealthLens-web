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
type Regression = { table: string; current: number; rebuilt: number };
type SourceRegression = { payload_ref: string; current: number; rebuilt: number };
type OracleFlag = { payload_ref: string; flag: string; value: unknown };
type Quarantined = { file: string; reason: string; moved_to: string };

/**
 * The engine's two REVIEW gates — the only refusals a person may waive after reading why (the server holds
 * the same list and refuses anything else). Everything else — schema, integrity, locked, stale — is final.
 */
const WAIVABLE_GATES = new Set(["coverage-regression", "oracle-flags"]);

const basename = (ref: string) => ref.split("/").pop() ?? ref;

/** Whether a verb can be run against this entity's store at all. */
function isOperable(entity: NetWorth["entities"][number]): boolean {
  if (entity.contributes) return true;
  // Skew is the case operations EXISTS for: the store opens fine, it was just built by another engine.
  return entity.workspaces.some((w) => w.availability === "schema_skew");
}

export type OperationsProps = {
  readonly entities: NetWorth["entities"];
  readonly format: Formatter;
  readonly onPromoted?: () => void;
};

export function Operations({ entities, format, onPromoted }: OperationsProps) {
  const { t, number } = format;
  const [entity, setEntity] = useState(
    (entities.find(isOperable) ?? entities[0])?.entity_id ?? "",
  );
  const [rebuild, setRebuild] = useState<Job | null>(null);
  const [promotion, setPromotion] = useState<Job | null>(null);
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [waived, setWaived] = useState<string[]>([]);

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
    setWaived([]); // a waiver belongs to ONE refusal of ONE candidate
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
      const started = await api.promote(entity, {
        confirm,
        after: rebuild?.id,
        ...(waived.length > 0 ? { allow: waived } : {}),
      });
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
  const quarantined = (rebuild?.result?.quarantined as Quarantined[] | undefined) ?? [];
  const reviewed = rebuild?.state === "finished" && rebuild.changed_something;

  // What the engine refused ON, verbatim from its envelope — the gate name alone left a person with no idea
  // which file or table, and no way on but a terminal.
  const refusedGate = promotion?.outcome === "refused" ? promotion.gate ?? null : null;
  const refusedTables = (promotion?.result?.regressions as Regression[] | undefined) ?? [];
  const refusedSources = (promotion?.result?.source_regressions as SourceRegression[] | undefined) ?? [];
  const refusedOracle = (promotion?.result?.oracle_flags as OracleFlag[] | undefined) ?? [];
  const canWaive = refusedGate !== null && WAIVABLE_GATES.has(refusedGate);

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
            setWaived([]);
          }}
        >
          {/*
            A store excluded for SCHEMA SKEW must stay selectable — promoting a rebuild is precisely how
            that skew is resolved, so disabling it would lock the door from the inside. Only a store that
            genuinely cannot be opened (missing, unreadable) has nothing to do here.
          */}
          {entities.map((option) => (
            <option key={option.entity_id} value={option.entity_id} disabled={!isOperable(option)}>
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
          {quarantined.length > 0 && (
            <section aria-label={t("ops.quarantined", { count: number(quarantined.length) })} data-tone="warning">
              <p role="alert">{t("ops.quarantined", { count: number(quarantined.length) })}</p>
              <ul>
                {quarantined.map((q) => (
                  <li key={q.moved_to}>
                    <strong>{q.file}</strong> — {q.reason}
                  </li>
                ))}
              </ul>
            </section>
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
          <section aria-label={t("ops.refusedWhy")} data-tone="warning">
            <p role="alert">
              {t("import.nothingChanged", {
                reason: promotion.gate ? t("import.refusedBy", { gate: promotion.gate }) : "",
              })}
            </p>
            {promotion.message && <p>{promotion.message}</p>}
            {(refusedTables.length > 0 || refusedSources.length > 0 || refusedOracle.length > 0) && (
              <ul>
                {refusedTables.map((r) => (
                  <li key={`t-${r.table}`}>
                    {t("ops.refusedTable", { table: r.table, rebuilt: number(r.rebuilt), current: number(r.current) })}
                  </li>
                ))}
                {refusedSources.map((r) => (
                  <li key={`s-${r.payload_ref}`}>
                    {t("ops.refusedSource", {
                      file: basename(r.payload_ref),
                      rebuilt: number(r.rebuilt),
                      current: number(r.current),
                    })}
                  </li>
                ))}
                {refusedOracle.map((r) => (
                  <li key={`o-${r.payload_ref}-${r.flag}`}>
                    {t("ops.refusedOracle", { file: basename(r.payload_ref), flag: r.flag, value: String(r.value) })}
                  </li>
                ))}
              </ul>
            )}
            {canWaive && refusedGate && (
              <p>
                <label>
                  <input
                    type="checkbox"
                    checked={waived.includes(refusedGate)}
                    onChange={(event) =>
                      setWaived((was) =>
                        event.target.checked
                          ? [...new Set([...was, refusedGate])]
                          : was.filter((gate) => gate !== refusedGate),
                      )
                    }
                  />{" "}
                  {t("ops.waive", { gate: refusedGate })}
                </label>
                <br />
                <small>{t("ops.waiveHint")}</small>
              </p>
            )}
          </section>
        )}
        {promotion?.outcome === "ok" && (
          <p role="status">{t("ops.promoted", { label: chosen?.label ?? entity })}</p>
        )}
      </section>
    </main>
  );
}
