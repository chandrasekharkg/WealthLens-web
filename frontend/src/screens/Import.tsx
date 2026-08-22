import { useState } from "react";

import { api, ApiError, type Job } from "../api/client";
import type { Formatter } from "../i18n";

/**
 * The daily loop: put a statement in, run the import, read what the engine made of it.
 *
 * Two rules shape this screen. **The verdict is WLC's, verbatim** — every file's status and warnings are
 * rendered as returned, and no file's warning may be dropped (report-views). And **a refusal is not a
 * failure**: the job contract distinguishes them, so a refused job says plainly that nothing changed
 * rather than reading as breakage.
 */

type FileVerdict = {
  file?: string;
  status?: string;
  loaded?: number;
  warnings?: string[];
  message?: string;
  error?: string;
};

export type ImportProps = {
  readonly entities: readonly {
    readonly id: string;
    readonly label: string;
    /** False when this member's store could not be read — depositing there would refuse anyway. */
    readonly available?: boolean;
  }[];
  readonly format: Formatter;
  readonly onImported?: () => void;
};

export function Import({ entities, format, onImported }: ImportProps) {
  const { t } = format;
  // Default to a member whose store can actually receive a file, rather than to whoever is first.
  const [entity, setEntity] = useState(
    (entities.find((option) => option.available !== false) ?? entities[0])?.id ?? "",
  );
  const [notes, setNotes] = useState<string[]>([]);
  const [job, setJob] = useState<Job | null>(null);
  const [busy, setBusy] = useState(false);

  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    for (const file of Array.from(files)) {
      setNotes((prev) => [...prev, t("import.uploading", { name: file.name })]);
      const body = new FormData();
      body.append("entity", entity);
      body.append("file", file);
      try {
        const response = await fetch("/api/upload", {
          method: "POST",
          body,
          headers: {
            "x-wlw-token":
              document.querySelector<HTMLMetaElement>('meta[name="wlw-token"]')?.content ?? "",
          },
        });
        const landed = (await response.json()) as {
          filename?: string;
          renamed_from?: string | null;
          detail?: { reason?: string };
        };
        if (!response.ok) {
          setNotes((prev) => [...prev, landed.detail?.reason ?? t("error.load")]);
          continue;
        }
        setNotes((prev) => [
          ...prev,
          landed.renamed_from
            ? // Say it plainly: otherwise the user finds "s (2).pdf" later and has to guess why.
              t("import.renamed", { name: landed.renamed_from, saved: landed.filename ?? "" })
            : t("import.uploaded", { name: landed.filename ?? file.name }),
        ]);
      } catch {
        setNotes((prev) => [...prev, t("error.load")]);
      }
    }
  };

  const runImport = async () => {
    setBusy(true);
    setJob(null);
    try {
      const started = await api.startJob("import", entity);
      let current = started;
      while (current.state !== "finished") {
        await new Promise((resolve) => setTimeout(resolve, 400));
        current = await api.job(started.id);
      }
      setJob(current);
      if (current.changed_something) onImported?.();
    } catch (error: unknown) {
      const reason =
        error instanceof ApiError ? JSON.stringify(error.detail) : t("error.load");
      setJob({
        id: "-", verb: "import", entity_id: entity, state: "finished", outcome: "failed",
        gate: null, message: reason, changed_something: false, result: {}, exit_code: null,
      });
    } finally {
      setBusy(false);
    }
  };

  const files = (job?.result?.files as FileVerdict[] | undefined) ?? [];

  return (
    <main>
      <h1>{t("import.title")}</h1>

      <p>
        <label htmlFor="entity">{t("import.chooseEntity")}</label>{" "}
        <select id="entity" value={entity} onChange={(event) => setEntity(event.target.value)}>
          {entities.map((option) => (
            <option key={option.id} value={option.id} disabled={option.available === false}>
              {option.label}
              {option.available === false ? ` — ${t("status.excluded").toLowerCase()}` : ""}
            </option>
          ))}
        </select>
      </p>

      <p>
        <label htmlFor="files">{t("import.drop")}</label>{" "}
        <input
          id="files"
          type="file"
          multiple
          onChange={(event) => {
            void upload(event.target.files);
          }}
        />
      </p>

      {/* Where statements come from is part of the screen, because that is where onboarding actually
          stalls — not at the drop target (UX-VALIDATION P6). */}
      <details>
        <summary>{t("import.whereFrom")}</summary>
        <p>{t("import.whereFromBody")}</p>
      </details>

      <ul aria-live="polite">
        {notes.map((note, index) => (
          <li key={`${note}-${index}`}>{note}</li>
        ))}
      </ul>

      <button type="button" onClick={() => void runImport()} disabled={busy || !entity}>
        {busy ? t("import.running") : t("import.run")}
      </button>

      {job?.state === "finished" && <Verdict job={job} files={files} format={format} />}
    </main>
  );
}

function Verdict({
  job,
  files,
  format,
}: {
  job: Job;
  files: FileVerdict[];
  format: Formatter;
}) {
  const { t, number } = format;

  // A refusal changed nothing. Saying so is the difference between "your store is fine" and "something
  // broke" — and the contract tells us which without parsing prose.
  if (job.outcome === "refused") {
    return (
      <p role="alert" data-tone="warning">
        {t("import.nothingChanged", {
          reason: job.gate ? t("import.refusedBy", { gate: job.gate }) : (job.message ?? ""),
        })}
      </p>
    );
  }
  if (job.outcome === "failed") {
    return (
      <p role="alert" data-tone="warning">
        {t("import.failed", { reason: job.message ?? "" })}
      </p>
    );
  }

  const imported = Number(job.result?.imported ?? 0);
  const attention = Number(job.result?.attention ?? 0);

  return (
    <section aria-label={t("import.verdict")}>
      <h2>{t("import.verdict")}</h2>
      <p>
        {t("import.imported", { count: number(imported) })} ·{" "}
        {t("import.attention", { count: number(attention) })}
      </p>
      <table>
        <thead>
          <tr>
            <th>{t("column.file")}</th>
            <th>{t("column.outcome")}</th>
            <th>{t("column.rows")}</th>
            <th>{t("column.warnings")}</th>
          </tr>
        </thead>
        <tbody>
          {/* Index as the fallback key: a random one would be unstable across renders and remount
              every row. The engine names each file, so the fallback is for a malformed payload only. */}
          {files.map((file, index) => (
            <tr key={file.file ?? `row-${index}`}>
              <td>{file.file}</td>
              <td data-status={file.status}>
                {t(`file.status.${file.status ?? "unknown"}` as "file.status.unknown")}
              </td>
              <td>{file.loaded === undefined ? "—" : number(file.loaded)}</td>
              {/* Verbatim: no file's warning may be dropped, however many it has. */}
              <td>{(file.warnings ?? []).join(", ") || file.error || file.message || ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
