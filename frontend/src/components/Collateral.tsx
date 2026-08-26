import { useMemo, useState } from "react";

import { CopySecret } from "./CopySecret";
import type { Formatter } from "../i18n";
import type { WorkspaceDetail } from "../api/client";

type Doc = WorkspaceDetail["documents"][number];

// How many documents a folder shows before it offers "show all". A real store runs to hundreds of documents
// in a single folder (a monthly contract note over years), so an uncapped, all-expanded list buries the screen.
const FOLDER_CAP = 10;
// Above this many folders the folders start collapsed — the list becomes a navigable index, not a wall.
const COLLAPSE_ABOVE = 4;

/**
 * What a store was built from — as folders, filterable and capped, not one endless expanded list.
 *
 * The documents were filed into folders BY the app (organize groups each by its issuer/provider), so showing
 * them any other way discards knowledge the store already has. At scale (hundreds of documents across dozens
 * of folders) three things keep it usable: a **folder filter** to narrow to one issuer, folders that **start
 * collapsed** once there are more than a handful, and a **per-folder cap** with "show all". A filename is a
 * link that asks the OS to open the file (WLW never reads it — ADR-0001); where a document records a named
 * password, a Copy control puts it on the clipboard without ever rendering it (ADR-0019).
 */
export function Collateral({
  documents,
  entity,
  format,
  onOpen,
  onSource,
}: {
  documents: readonly Doc[];
  entity: string;
  format: Formatter;
  onOpen: (doc: Doc) => void;
  /** Open the source popup for a document — its provenance + which store tables it wrote. */
  onSource?: (doc: Doc) => void;
}) {
  const { t, number, date } = format;
  const [folder, setFolder] = useState("");
  // Folders the household has asked to see in full (past the cap). Keyed by folder name.
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());

  // The statement period, from the source: a from–to when both are recorded, else the single date.
  const periodOf = (doc: Doc) =>
    doc.period_start && doc.period_end
      ? `${date(doc.period_start)} – ${date(doc.period_end)}`
      : doc.period_end
        ? date(doc.period_end)
        : doc.period_start
          ? date(doc.period_start)
          : "—";

  // Group by folder (provider). Insertion order preserves the store's own newest-first ordering; a document
  // with no provider lands in an "unfiled" group rather than vanishing.
  const folders = useMemo(() => {
    const map = new Map<string, Doc[]>();
    for (const doc of documents) {
      const key = doc.provider ?? "";
      (map.get(key) ?? map.set(key, []).get(key)!).push(doc);
    }
    return map;
  }, [documents]);

  // The filter offers every folder (with its count); the default shows them all.
  const folderNames = [...folders.keys()];
  const shownFolders = folder ? folderNames.filter((f) => f === folder) : folderNames;
  const openByDefault = shownFolders.length <= COLLAPSE_ABOVE;

  return (
    <div className="collateral">
      <div className="collateral-tools">
        <label>
          {t("ws.filterFolder")}{" "}
          <select value={folder} onChange={(e) => setFolder(e.target.value)}>
            <option value="">{t("ws.allFolders", { count: documents.length })}</option>
            {folderNames.map((f) => (
              <option key={f || "—"} value={f}>
                {(f || t("column.folder")) + ` (${folders.get(f)!.length})`}
              </option>
            ))}
          </select>
        </label>
        <span className="collateral-count">
          {t("ws.docCount", { count: documents.length, folders: folderNames.length })}
        </span>
      </div>

      {shownFolders.map((name) => {
        const docs = folders.get(name)!;
        const isExpanded = expanded.has(name);
        const shown = isExpanded ? docs : docs.slice(0, FOLDER_CAP);
        return (
          <details key={name || "—"} className="folder" open={openByDefault}>
            <summary>
              <span className="folder-name">{name || t("column.folder")}</span>
              <span className="folder-count">{t("ws.folderCount", { count: docs.length })}</span>
            </summary>
            <table>
              <thead>
                <tr>
                  <th>{t("column.document")}</th>
                  <th>{t("column.period")}</th>
                  <th>{t("column.rows")}</th>
                  <th>{t("column.password")}</th>
                  {onSource ? <th>{t("column.source")}</th> : null}
                </tr>
              </thead>
              <tbody>
                {shown.map((doc) => {
                  const label = doc.filename ?? doc.payload_ref ?? doc.source_id;
                  return (
                    <tr key={doc.source_id}>
                      <td>
                        {doc.filename ? (
                          // A link because it opens something; a button because the act is a POST, not a URL.
                          <button
                            type="button"
                            className="file-open"
                            onClick={() => onOpen(doc)}
                            aria-label={`${t("ws.openFile")}: ${label}`}
                          >
                            {label}
                          </button>
                        ) : (
                          <span>{label}</span>
                        )}
                      </td>
                      <td className="doc-period">{periodOf(doc)}</td>
                      <td className="numeric">{doc.rows === null || doc.rows === undefined ? "—" : number(doc.rows)}</td>
                      {/* Three states. A NAMED password gets a Copy control; unnamed/none just say so. */}
                      <td data-password={doc.password.kind}>
                        {doc.password.kind === "named" && doc.password.name ? (
                          <CopySecret
                            entity={entity}
                            what={doc.password.name}
                            label={doc.password.name === "pan" ? t("password.pan") : doc.password.name}
                            format={format}
                          />
                        ) : doc.password.kind === "unnamed" ? (
                          t("password.unnamed")
                        ) : (
                          t("password.none")
                        )}
                      </td>
                      {onSource ? (
                        <td>
                          <button
                            type="button"
                            className="linklike"
                            onClick={() => onSource(doc)}
                            aria-label={t("source.view")}
                          >
                            {t("source.view")}
                          </button>
                        </td>
                      ) : null}
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {docs.length > FOLDER_CAP ? (
              <p className="folder-more">
                {isExpanded ? (
                  <span>{t("ws.showingDocs", { shown: docs.length, total: docs.length })}</span>
                ) : (
                  <>
                    <span>{t("ws.showingDocs", { shown: shown.length, total: docs.length })}</span>{" "}
                    <button
                      type="button"
                      className="linklike"
                      onClick={() => setExpanded((s) => new Set(s).add(name))}
                    >
                      {t("ws.showAllDocs", { count: docs.length })}
                    </button>
                  </>
                )}
              </p>
            ) : null}
          </details>
        );
      })}
    </div>
  );
}
