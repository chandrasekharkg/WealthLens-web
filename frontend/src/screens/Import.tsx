import { useState } from "react";

import { api, ApiError, type DiagnoseBundle, type Job } from "../api/client";
import type { Formatter } from "../i18n";

/**
 * The daily loop: put a statement in, run the import, read what the engine made of it.
 *
 * Two rules shape this screen. **The verdict is WLC's, verbatim** — every file's status and warnings are
 * rendered as returned, and no file's warning may be dropped (report-views). And **a refusal is not a
 * failure**: the job contract distinguishes them, so a refused job says plainly that nothing changed
 * rather than reading as breakage.
 */

// WLC emits STRUCTURED warnings ({type, …}) so `import --json` and the exit code can branch on them without
// parsing prose; older/other paths may emit a plain string. Accept both.
type Warning = string | { type?: string; [key: string]: unknown };
type FileVerdict = {
  file?: string;
  status?: string;
  loaded?: number;
  warnings?: Warning[];
  message?: string;
  error?: string;
};

/** One structured warning → the sentence a household reads. A bare `.join(", ")` on the objects printed
 *  "[object Object]"; this renders each by its `type`, with a readable fallback for an unknown shape. */
function warningText(w: Warning): string {
  if (typeof w === "string") return w;
  // Never stringify an `unknown` directly — that is the "[object Object]" bug. Coerce to number/string only.
  const num = (v: unknown) =>
    typeof v === "number" ? v.toLocaleString("en-IN") : typeof v === "string" ? v : "";
  const str = (v: unknown) => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");
  switch (w.type) {
    case "footing_break":
      return `didn't foot — Σ ≠ opening→closing by ₹${num(w.delta)} (some rows may be missing)`;
    case "footing_unverified":
      return "whole-statement footing not verified (no opening/closing balance in this layout)";
    case "low_confidence": {
      const also = str(w.also_matched);
      return `low confidence${also ? ` — also matched ${also}` : ""}`;
    }
    case "units_incomplete":
      return `${num(w.unknown)} row(s) missing a quantity`;
    case "rows_rejected":
      return `${num(w.rows)} row(s) not loaded (carried neither a quantity nor a value)`;
    case "cas_incomplete":
      // A recognized depository CAS whose parse came up short — a parser gap on a SUPPORTED format, never an
      // unsupported-bank message. Names the cause and points at the raw-parse lens; nothing was loaded.
      return `recognized, but the parse is incomplete${w.error ? ` — ${str(w.error)}` : ""}. A parser gap on a supported format — nothing loaded; open it in Raw parse to see the missed rows.`;
    default:
      return str(w.type) || JSON.stringify(w);
  }
}

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
  const [dragOver, setDragOver] = useState(false);

  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    // Replace this file's "Uploading…" line in place when it lands, rather than appending a second note — a
    // lingering "Uploading X…" beside "X is in the inbox" read as still-in-progress (the user waited on it).
    // Uploads are sequential, so the last note is always the one for the file in hand.
    const settle = (text: string) => setNotes((prev) => [...prev.slice(0, -1), text]);
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
          settle(landed.detail?.reason ?? t("error.load"));
          continue;
        }
        settle(
          landed.renamed_from
            ? // Say it plainly: otherwise the user finds "s (2).pdf" later and has to guess why.
              t("import.renamed", { name: landed.renamed_from, saved: landed.filename ?? "" })
            : t("import.uploaded", { name: landed.filename ?? file.name }),
        );
      } catch {
        settle(t("error.load"));
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
  const locked = files.filter((file) => file.status === "locked");
  // An unrecognized statement is not a failure — it is a format we have not met yet. Turn it into an on-ramp.
  const unrecognized = files.filter((file) => file.status === "unrecognized");

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

      {/* A real drop target: dad can drag a whole folder of statements at once, or click to choose. Each file
          uploads to the inbox as it arrives and they accumulate, so several drops/picks build one batch that
          Import then processes together. */}
      <div
        className="dropzone"
        data-dragover={dragOver || undefined}
        onDragOver={(event) => {
          event.preventDefault();
          if (!dragOver) setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragOver(false);
          void upload(event.dataTransfer.files);
        }}
      >
        <label htmlFor="files">{t("import.drop")}</label>
        <input
          id="files"
          type="file"
          multiple
          onChange={(event) => {
            void upload(event.target.files);
            // Clear the value so choosing the SAME file(s) again still fires onChange — a second pick adds to
            // the batch rather than being ignored as "no change".
            event.target.value = "";
          }}
        />
        <p className="dropzone-hint">{t("import.dropHint")}</p>
      </div>

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

      {/* The locked-file loop. The password is added to the ring and the import re-run — WealthLens-core
          proves it worked by opening the file, because nothing here reads a statement (ADR-0019). */}
      {locked.length > 0 && (
        <Unlock entity={entity} files={locked} format={format} onSaved={() => void runImport()} />
      )}

      {unrecognized.map((file) => (
        <AddYourBank key={file.file} entity={entity} filename={file.file ?? ""} format={format} />
      ))}
    </main>
  );
}

/**
 * The unrecognized-statement on-ramp (1→2→3). Not a wall: an institution we have not met yet. `diagnose`
 * runs in WLC's own workspace context (the bridge duplicates no password logic), and returns a value-free
 * layout description a user hands to their AI assistant — or reads beside the guide.
 */
function AddYourBank({
  entity,
  filename,
  format,
}: {
  entity: string;
  filename: string;
  format: Formatter;
}) {
  const { t } = format;
  const [bundle, setBundle] = useState<DiagnoseBundle | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const run = async () => {
    setBusy(true);
    setProblem(null);
    try {
      setBundle(await api.diagnose(entity, filename));
    } catch {
      setProblem(t("error.load"));
    } finally {
      setBusy(false);
    }
  };

  const agentText = bundle ? `${t("diagnose.agentPrompt")}\n\n${bundle.report}` : "";

  return (
    <section aria-label={t("diagnose.title", { name: filename })} data-tone="info">
      <h2>{t("diagnose.title", { name: filename })}</h2>
      <p>{t("diagnose.intro")}</p>
      <ol>
        <li>{t("diagnose.step1")}</li>
        <li>{t("diagnose.step2")}</li>
        <li>{t("diagnose.step3")}</li>
      </ol>

      {!bundle ? (
        <button type="button" onClick={() => void run()} disabled={busy}>
          {busy ? t("diagnose.running") : t("diagnose.run")}
        </button>
      ) : (
        <>
          {bundle.needs_ocr && (
            <p role="note" data-tone="warning">
              {t("diagnose.scanned", { count: bundle.scanned })}
            </p>
          )}
          <div className="diagnose-actions">
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard.writeText(agentText).then(() => setCopied(true));
              }}
            >
              {copied ? t("diagnose.copied") : t("diagnose.copyAgent")}
            </button>{" "}
            <a
              href="https://github.com/chandrasekharkg/WealthLens-core/blob/main/GETTING_STARTED.md#your-bank-isnt-recognized-add-it-great-with-cursor"
              target="_blank"
              rel="noreferrer"
            >
              {t("diagnose.guide")}
            </a>
          </div>
          <pre className="diagnose-report" aria-label={t("diagnose.reportLabel")}>
            {bundle.report}
          </pre>
        </>
      )}
      {problem && (
        <p role="alert" data-tone="warning">
          {problem}
        </p>
      )}
    </section>
  );
}

function Unlock({
  entity,
  files,
  format,
  onSaved,
}: {
  entity: string;
  files: FileVerdict[];
  format: Formatter;
  onSaved: () => void;
}) {
  const { t } = format;
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    setProblem(null);
    try {
      await api.changeSettings(entity, { secret: { name, value } });
      setValue("");
      onSaved();          // proof is the RETRY: the engine's verdict says whether the file opened
    } catch (error: unknown) {
      const detail = error instanceof ApiError ? error.detail : null;
      setProblem((detail as { detail?: { reason?: string } } | null)?.detail?.reason ?? t("error.load"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-label={t("locked.title")}>
      <h2>{t("locked.title")}</h2>
      <ul>
        {files.map((file) => (
          <li key={file.file}>{file.file}</li>
        ))}
      </ul>
      <p>{t("locked.explain")}</p>
      <p>
        <label htmlFor="pw-name">{t("locked.name")}</label>{" "}
        <input id="pw-name" value={name} onChange={(event) => setName(event.target.value)} />{" "}
        <label htmlFor="pw-value">{t("locked.value")}</label>{" "}
        <input
          id="pw-value"
          type="password"
          value={value}
          onChange={(event) => setValue(event.target.value)}
        />{" "}
        <button type="button" onClick={() => void save()} disabled={busy || !name || !value}>
          {busy ? t("locked.retrying") : t("locked.save")}
        </button>
      </p>
      {problem && (
        <p role="alert" data-tone="warning">
          {problem}
        </p>
      )}
    </section>
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

  // Show detail only about files that DID something — loaded rows, a warning/error, or a status that needs
  // action (locked / unrecognised). The rest are the re-walk of an already-loaded corpus (0 new rows); a
  // single-file import otherwise printed a line per provider with "0". Collapse them into a count — never
  // dropped, openable below (no statement the engine touched disappears).
  const changed = files.filter(
    (file) =>
      (file.loaded ?? 0) > 0 ||
      (file.warnings?.length ?? 0) > 0 ||
      Boolean(file.error) ||
      (file.status !== undefined && file.status !== "imported" && file.status !== "skipped"),
  );
  const quiet = files.filter((file) => !changed.includes(file));

  const fileRow = (file: FileVerdict, index: number) => (
    <tr key={file.file ?? `row-${index}`}>
      <td>{file.file}</td>
      <td data-status={file.status}>
        {t(`file.status.${file.status ?? "unknown"}` as "file.status.unknown")}
      </td>
      <td>{file.loaded === undefined ? "—" : number(file.loaded)}</td>
      {/* Verbatim: no file's warning may be dropped, however many it has — each rendered as a sentence,
          never a raw object. */}
      <td>{(file.warnings ?? []).map(warningText).join("; ") || file.error || file.message || ""}</td>
    </tr>
  );
  const fileTable = (rows: FileVerdict[]) => (
    <table>
      <thead>
        <tr>
          <th>{t("column.file")}</th>
          <th>{t("column.outcome")}</th>
          <th>{t("column.rows")}</th>
          <th>{t("column.warnings")}</th>
        </tr>
      </thead>
      <tbody>{rows.map(fileRow)}</tbody>
    </table>
  );

  return (
    <section aria-label={t("import.verdict")}>
      <h2>{t("import.verdict")}</h2>
      <p>
        {t("import.imported", { count: number(imported) })} ·{" "}
        {t("import.attention", { count: number(attention) })}
      </p>
      {changed.length > 0 ? (
        fileTable(changed)
      ) : (
        <p role="status">{t("import.allQuiet")}</p>
      )}
      {quiet.length > 0 ? (
        <details className="import-quiet">
          <summary>{t("import.quietSummary", { count: number(quiet.length) })}</summary>
          {fileTable(quiet)}
        </details>
      ) : null}
    </section>
  );
}
