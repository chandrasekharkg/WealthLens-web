import { useCallback, useEffect, useState } from "react";

import { api, ApiError, type WorkspaceDetail } from "../api/client";
import { CopySecret } from "../components/CopySecret";
import type { Formatter } from "../i18n";

/**
 * The per-store pane: where the money physically lives, what built it, and the identity behind it.
 *
 * Settings are per WORKSPACE, not global — there is no household-wide identity, because each person has
 * their own PAN and their own name (identity-and-settings). The PAN is shown as set-or-unset and never as
 * text: it unlocks CAS and many statements, so it is a secret as much as an identifier.
 */

export type WorkspaceProps = {
  readonly entities: readonly { readonly id: string; readonly label: string }[];
  readonly format: Formatter;
};

export function Workspace({ entities, format }: WorkspaceProps) {
  const { t, number } = format;
  // `format` itself is passed down: a component that renders words takes the catalog, never its own strings.
  const [entity, setEntity] = useState(entities[0]?.id ?? "");
  const [detail, setDetail] = useState<WorkspaceDetail | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const load = useCallback((id: string) => {
    if (!id) return;
    void api
      .workspace(id)
      .then(setDetail)
      .catch(() => setDetail(null));
  }, []);

  useEffect(() => load(entity), [entity, load]);

  const save = async (body: Record<string, unknown>) => {
    setProblem(null);
    setSaved(false);
    try {
      await api.changeSettings(entity, body);
      setSaved(true);
      load(entity);
    } catch (error: unknown) {
      const detailed = error instanceof ApiError ? error.detail : null;
      setProblem((detailed as { detail?: { reason?: string } } | null)?.detail?.reason ?? t("error.load"));
    }
  };

  return (
    <main>
      <h1>{t("ws.title")}</h1>

      <p>
        <label htmlFor="ws-entity">{t("import.chooseEntity")}</label>{" "}
        <select id="ws-entity" value={entity} onChange={(event) => setEntity(event.target.value)}>
          {entities.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </p>

      {detail && (
        <>
          <section aria-label={t("ws.where")}>
            <h2>{t("ws.where")}</h2>
            {/* The custodian is visible: a household that wants to see the file is shown where it is. */}
            <p>
              <code>{detail.path}</code>
            </p>
            <p>
              {t("ws.schema", { version: detail.workspace.schema_version ?? "—" })} ·{" "}
              {detail.workspace.availability}
            </p>
            {detail.workspace.detail && <p data-tone="warning">{detail.workspace.detail}</p>}
          </section>

          <section aria-label={t("ws.collateral")}>
            <h2>{t("ws.collateral")}</h2>
            {detail.documents.length === 0 ? (
              <p role="status">{t("ws.noDocuments")}</p>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>{t("column.document")}</th>
                    <th>{t("column.rows")}</th>
                    <th>{t("column.opensWith")}</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.documents.map((doc) => (
                    <tr key={doc.source_id}>
                      <td>{doc.filename ?? doc.payload_ref ?? doc.source_id}</td>
                      <td>{doc.rows === null || doc.rows === undefined ? "—" : number(doc.rows)}</td>
                      {/* Three states, not two. "an unnamed password" is not "nothing has opened it". */}
                      <td data-password={doc.password.kind}>
                        {doc.password.kind === "named"
                          ? t("password.named", { name: doc.password.name ?? "" })
                          : doc.password.kind === "unnamed"
                            ? t("password.unnamed")
                            : t("password.none")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <section aria-label={t("ws.settings")}>
            <h2>{t("ws.settings")}</h2>
            <p>{t("ws.settingsWhere", { path: detail.settings.config_path })}</p>

            <p>
              <label htmlFor="holder">{t("ws.holderNames")}</label>{" "}
              <input
                id="holder"
                defaultValue={detail.settings.holder_names.join(", ")}
                onBlur={(event) =>
                  void save({ holder_names: event.target.value.split(",").map((n) => n.trim()) })
                }
              />
            </p>

            <p>
              <label htmlFor="pan">{t("ws.pan")}</label>{" "}
              <input id="pan" placeholder={t("ws.panPlaceholder")} defaultValue=""
                     onBlur={(event) => event.target.value && void save({ pan: event.target.value })} />{" "}
              <span data-pan={detail.settings.pan_set ? "set" : "unset"}>
                {detail.settings.pan_set ? t("ws.panSet") : t("ws.panUnset")}
              </span>{" "}
              {detail.settings.pan_set && (
                <CopySecret entity={entity} what="pan" label={t("ws.pan")} format={format} />
              )}
            </p>

            <p>
              <label htmlFor="organize">{t("ws.organize")}</label>{" "}
              <input
                id="organize"
                type="checkbox"
                checked={detail.settings.organize}
                onChange={(event) => void save({ organize: event.target.checked })}
              />
            </p>

            <h3>{t("ws.ring")}</h3>
            {/* Said once, where somebody would look for it: the key is the one secret with no reveal. */}
            <p>{t("secret.keyNever")}</p>
            {detail.settings.secret_names.length === 0 ? (
              <p role="status">{t("ws.ringEmpty")}</p>
            ) : (
              <ul>
                {detail.settings.secret_names.map((name) => (
                  <li key={name}>
                    {name}{" "}
                    <CopySecret entity={entity} what={name} label={name} format={format} />
                  </li>
                ))}
              </ul>
            )}

            {problem && (
              <p role="alert" data-tone="warning">
                {problem}
              </p>
            )}
            {saved && !problem && <p role="status">{t("ws.saved")}</p>}
          </section>
        </>
      )}
    </main>
  );
}
