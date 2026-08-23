import { CopySecret } from "./CopySecret";
import type { Formatter } from "../i18n";
import type { WorkspaceDetail } from "../api/client";

type Doc = WorkspaceDetail["documents"][number];

/**
 * What a store was built from — as expanded folders, not a flat list.
 *
 * The documents were filed into folders BY the app (organize groups each by its issuer/provider), so showing
 * them any other way discards knowledge the store already has. Each folder is an expanded group; a filename
 * is a link that asks the OS to open the file (WLW never reads it — ADR-0001); and where a document records a
 * named password, a Copy control puts it on the clipboard without ever rendering it (ADR-0019).
 */
export function Collateral({
  documents,
  entity,
  format,
  onOpen,
}: {
  documents: readonly Doc[];
  entity: string;
  format: Formatter;
  onOpen: (doc: Doc) => void;
}) {
  const { t, number } = format;

  // Group by folder (provider). Insertion order preserves the store's own newest-first ordering; a document
  // with no provider lands in an "unfiled" group rather than vanishing.
  const folders = new Map<string, Doc[]>();
  for (const doc of documents) {
    const key = doc.provider ?? "";
    (folders.get(key) ?? folders.set(key, []).get(key)!).push(doc);
  }

  return (
    <div className="collateral">
      {[...folders.entries()].map(([folder, docs]) => (
        <details key={folder || "—"} className="folder" open>
          <summary>
            <span className="folder-name">{folder || t("column.folder")}</span>
            <span className="folder-count">{t("ws.folderCount", { count: docs.length })}</span>
          </summary>
          <table>
            <thead>
              <tr>
                <th>{t("column.document")}</th>
                <th>{t("column.rows")}</th>
                <th>{t("column.password")}</th>
              </tr>
            </thead>
            <tbody>
              {docs.map((doc) => {
                const name = doc.filename ?? doc.payload_ref ?? doc.source_id;
                return (
                  <tr key={doc.source_id}>
                    <td>
                      {doc.filename ? (
                        // A link because it opens something; a button because the act is a POST, not a URL.
                        <button
                          type="button"
                          className="file-open"
                          onClick={() => onOpen(doc)}
                          aria-label={`${t("ws.openFile")}: ${name}`}
                        >
                          {name}
                        </button>
                      ) : (
                        <span>{name}</span>
                      )}
                    </td>
                    <td className="numeric">{doc.rows === null || doc.rows === undefined ? "—" : number(doc.rows)}</td>
                    {/* Three states. A NAMED password gets a Copy control; unnamed/none just say so. */}
                    <td data-password={doc.password.kind}>
                      {doc.password.kind === "named" && doc.password.name ? (
                        <CopySecret
                          entity={entity}
                          what={doc.password.name}
                          label={doc.password.name}
                          format={format}
                        />
                      ) : doc.password.kind === "unnamed" ? (
                        t("password.unnamed")
                      ) : (
                        t("password.none")
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </details>
      ))}
    </div>
  );
}
