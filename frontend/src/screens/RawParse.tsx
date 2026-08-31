import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as pdfjs from "pdfjs-dist";

import { api, ApiError, apiReason, type RawParseView, type WorkspaceDetail } from "../api/client";

// Vite bundles the worker from this URL; no `?url` import (which needs an ambient type) is required.
pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();

/**
 * The PDF-beside-interpretation view (data-issue-diagnosis Level 1): the user's real statement rendered on
 * the left, every extracted line's FATE laid over it in colour, coordinate-locked to the page. A red box is
 * a data-shaped line present in the statement but NOT brought into the store — the parsing gap, pointed at.
 *
 * The PII boundary is spatial and airtight: the real values live ONLY on the PDF (streamed to this browser,
 * never re-exported); every structured thing the app touches — the boxes, the shapes — is masked. So a user
 * can look at their own statement in full while nothing identifying ever leaves.
 */

type Fate = "interpreted" | "not_interpreted" | "dropped" | "furniture";
type Doc = NonNullable<WorkspaceDetail["documents"]>[number];

const FATE: Record<Fate, { fill: string; edge: string; label: string; mark: string }> = {
  interpreted: { fill: "rgba(34,197,94,0.16)", edge: "rgba(22,163,74,0.55)", label: "interpreted", mark: "✓" },
  not_interpreted: { fill: "rgba(239,68,68,0.30)", edge: "rgba(220,38,38,0.9)", label: "not interpreted", mark: "⚠" },
  dropped: { fill: "rgba(245,158,11,0.28)", edge: "rgba(217,119,6,0.85)", label: "dropped", mark: "⚠" },
  furniture: { fill: "rgba(148,163,184,0.10)", edge: "rgba(100,116,139,0.35)", label: "furniture", mark: "·" },
};
const ORDER: Fate[] = ["interpreted", "furniture", "not_interpreted", "dropped"];

export type RawParseProps = {
  readonly entities: readonly { readonly id: string; readonly label: string }[];
};

export function RawParse({ entities }: RawParseProps) {
  const [entity, setEntity] = useState(entities[0]?.id ?? "");
  const [docs, setDocs] = useState<Doc[]>([]);
  const [selected, setSelected] = useState<Doc | null>(null);
  const [docsError, setDocsError] = useState<string | null>(null);

  // the PDF-bearing documents of the chosen store — setState only in the async callbacks (codebase pattern)
  useEffect(() => {
    if (!entity) return;
    let live = true;
    api
      .workspace(entity)
      .then((w) => {
        if (!live) return;
        setDocs((w.documents ?? []).filter((d) => (d.filename ?? "").toLowerCase().endsWith(".pdf")));
      })
      .catch((e) => live && setDocsError(e instanceof ApiError ? apiReason(e) : String(e)));
    return () => {
      live = false;
    };
  }, [entity]);

  return (
    <div className="rawparse">
      <header className="rawparse__bar">
        <div className="rawparse__controls">
          {entities.length > 1 && (
            <select
              value={entity}
              onChange={(e) => {
                setEntity(e.target.value);
                setSelected(null);
                setDocs([]);
              }}
            >
              {entities.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.label}
                </option>
              ))}
            </select>
          )}
          <select
            value={selected?.filename ?? ""}
            onChange={(e) => setSelected(docs.find((d) => d.filename === e.target.value) ?? null)}
          >
            <option value="">Pick a statement…</option>
            {docs.map((d) => (
              <option key={`${d.provider}/${d.filename}`} value={d.filename ?? ""}>
                {d.provider ? `${d.provider} · ` : ""}
                {d.filename}
              </option>
            ))}
          </select>
        </div>
      </header>

      {docsError && <p className="rawparse__error">{docsError}</p>}
      {!selected && (
        <p className="rawparse__hint">
          Pick a statement to see its real page beside what WealthLens read — every line coloured by its fate.
          A <b>red</b> box is data present on the page but not in the store: the parsing gap.
        </p>
      )}
      {selected && (
        <StatementView key={`${entity}/${selected.provider}/${selected.filename}`} entity={entity} doc={selected} />
      )}
    </div>
  );
}

type Load =
  | { state: "loading" }
  | { state: "ready"; view: RawParseView }
  | { state: "error"; msg: string };

/** One statement: fetch its fate view, render its PDF, lay the fate boxes over it. Keyed by the document, so
 * choosing another remounts it fresh — no synchronous state reset in an effect. */
function StatementView({ entity, doc }: { entity: string; doc: Doc }) {
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [pageNo, setPageNo] = useState(1);
  const [pageCount, setPageCount] = useState(1);
  const [scale, setScale] = useState(1.5);
  const [hover, setHover] = useState<number | null>(null);
  const [hideFurniture, setHideFurniture] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pdfRef = useRef<pdfjs.PDFDocumentProxy | null>(null);

  useEffect(() => {
    let live = true;
    const ref = { filename: doc.filename, provider: doc.provider, payload_ref: doc.payload_ref };
    Promise.all([api.rawParse(entity, ref), pdfjs.getDocument(api.documentUrl(entity, ref)).promise])
      .then(([view, pdf]) => {
        if (!live) return;
        pdfRef.current = pdf;
        setPageCount(pdf.numPages);
        setLoad({ state: "ready", view });
      })
      .catch((e) => live && setLoad({ state: "error", msg: e instanceof ApiError ? apiReason(e) : String(e) }));
    return () => {
      live = false;
    };
  }, [entity, doc]);

  const renderPage = useCallback(async () => {
    const pdf = pdfRef.current;
    const canvas = canvasRef.current;
    if (!pdf || !canvas) return;
    const page = await pdf.getPage(pageNo);
    const viewport = page.getViewport({ scale });
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    await page.render({ canvasContext: ctx, viewport }).promise;
  }, [pageNo, scale]);

  useEffect(() => {
    if (load.state === "ready") void renderPage();
  }, [renderPage, load.state]);

  const view = load.state === "ready" ? load.view : null;
  const lines = useMemo(() => view?.pages?.find((p) => p.page === pageNo)?.lines ?? [], [view, pageNo]);
  const shown = hideFurniture ? lines.filter((l) => l.fate !== "furniture") : lines;
  const summary = (view?.summary ?? {}) as Record<string, number>;

  if (load.state === "loading") return <p className="rawparse__hint">Reading the statement…</p>;
  if (load.state === "error") return <p className="rawparse__error">{load.msg}</p>;

  return (
    <>
      <div className="rawparse__bar">
        <div className="rawparse__controls">
          <span className="rawparse__pager">
            <button disabled={pageNo <= 1} onClick={() => setPageNo((n) => Math.max(1, n - 1))}>
              ‹
            </button>
            page {pageNo} / {pageCount}
            <button disabled={pageNo >= pageCount} onClick={() => setPageNo((n) => Math.min(pageCount, n + 1))}>
              ›
            </button>
          </span>
          <span className="rawparse__zoom">
            <button onClick={() => setScale((s) => Math.max(0.6, +(s - 0.2).toFixed(2)))}>−</button>
            {Math.round(scale * 100)}%
            <button onClick={() => setScale((s) => Math.min(3, +(s + 0.2).toFixed(2)))}>+</button>
          </span>
          <label className="rawparse__toggle">
            <input type="checkbox" checked={hideFurniture} onChange={(e) => setHideFurniture(e.target.checked)} />
            hide furniture
          </label>
        </div>
        <div className="rawparse__summary">
          {ORDER.map((f) => (
            <span key={f} className="rawparse__chip" title={FATE[f].label}>
              <span className="rawparse__swatch" style={{ background: FATE[f].fill, borderColor: FATE[f].edge }} />
              {FATE[f].mark} {FATE[f].label} <b>{summary[f] ?? 0}</b>
            </span>
          ))}
        </div>
      </div>

      <div className="rawparse__split">
        <div className="rawparse__stage">
          <canvas ref={canvasRef} className="rawparse__canvas" />
          <div className="rawparse__overlay">
            {shown.map((ln) => {
              const idx = lines.indexOf(ln);
              const f = FATE[ln.fate as Fate] ?? FATE.furniture;
              const b = ln.bbox as { x0: number; x1: number; top: number; bottom: number };
              const on = hover === idx;
              return (
                <div
                  key={idx}
                  className="rawparse__box"
                  style={{
                    left: b.x0 * scale,
                    top: b.top * scale,
                    width: Math.max(2, (b.x1 - b.x0) * scale),
                    height: Math.max(2, (b.bottom - b.top) * scale),
                    background: on ? f.edge : f.fill,
                    outline: `1px solid ${f.edge}`,
                    opacity: on ? 0.5 : 1,
                  }}
                  onMouseEnter={() => setHover(idx)}
                  onMouseLeave={() => setHover(null)}
                  title={`${f.mark} ${f.label}${ln.reason ? ` (${ln.reason})` : ""}\n${ln.shape}`}
                />
              );
            })}
          </div>
        </div>

        <aside className="rawparse__side">
          <h3>What the reader made of page {pageNo}</h3>
          <ul className="rawparse__lines">
            {shown.map((ln) => {
              const idx = lines.indexOf(ln);
              const f = FATE[ln.fate as Fate] ?? FATE.furniture;
              return (
                <li
                  key={idx}
                  className={`rawparse__line rawparse__line--${ln.fate}${hover === idx ? " is-on" : ""}`}
                  onMouseEnter={() => setHover(idx)}
                  onMouseLeave={() => setHover(null)}
                >
                  <span className="rawparse__linemark" style={{ color: f.edge }}>
                    {f.mark}
                  </span>
                  <code>{ln.shape}</code>
                </li>
              );
            })}
          </ul>
          <p className="rawparse__note">
            Shapes only — the real values are on the PDF, which never leaves this machine. A red line is the one
            to report.
          </p>
        </aside>
      </div>
    </>
  );
}
