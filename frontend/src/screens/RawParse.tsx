import { useEffect, useMemo, useState } from "react";

import { api, ApiError, apiReason, type RawParseView, type WorkspaceDetail } from "../api/client";

/** A readable category for a document, so the picker can filter by type/issuer before the statement itself.
 * Derived from where `organize` filed it (its payload_ref folder) — `statements/credit-card/sbi` →
 * "credit-card / sbi", `statements/depository/cas` → "depository / cas" — falling back to the provider. */
function categoryOf(doc: Doc): string {
  const ref = doc.payload_ref ?? "";
  const dir = ref.includes("/") ? ref.slice(0, ref.lastIndexOf("/")) : "";
  const cleaned = dir.replace(/^statements\//, "").replace(/\//g, " / ");
  return cleaned || doc.provider || "other";
}

/**
 * The PDF-beside-interpretation view (data-issue-diagnosis Level 1): the user's real statement page rendered
 * on the left, every extracted line's FATE laid over it in colour, coordinate-locked. A red box is a
 * data-shaped line present in the statement but NOT brought into the store — the parsing gap, pointed at.
 *
 * The page is rendered SERVER-SIDE (WLC opens the file with its own password), so a password-protected CAS
 * shows without the password ever reaching the browser. The PII boundary is spatial: the real values live
 * ONLY on that page image (the owner's own page, to the owner's own browser); every structured thing the app
 * touches — the boxes, the shapes — is masked. The overlay boxes multiply their point bboxes by the same
 * `scale` the image was rendered at, so they line up at any zoom.
 */

type Fate = "interpreted" | "not_interpreted" | "dropped" | "furniture";
type Doc = NonNullable<WorkspaceDetail["documents"]>[number];

const FATE: Record<Fate, { fill: string; edge: string; label: string; mark: string }> = {
  interpreted: { fill: "rgba(34,197,94,0.16)", edge: "rgba(22,163,74,0.6)", label: "interpreted", mark: "✓" },
  not_interpreted: { fill: "rgba(239,68,68,0.32)", edge: "rgba(220,38,38,0.95)", label: "not interpreted", mark: "⚠" },
  dropped: { fill: "rgba(245,158,11,0.3)", edge: "rgba(217,119,6,0.9)", label: "dropped", mark: "⚠" },
  furniture: { fill: "rgba(148,163,184,0.08)", edge: "rgba(100,116,139,0.4)", label: "furniture", mark: "·" },
};
const ORDER: Fate[] = ["interpreted", "furniture", "not_interpreted", "dropped"];

export type RawParseProps = {
  readonly entities: readonly { readonly id: string; readonly label: string }[];
};

export function RawParse({ entities }: RawParseProps) {
  const [entity, setEntity] = useState(entities[0]?.id ?? "");
  const [docs, setDocs] = useState<Doc[]>([]);
  const [category, setCategory] = useState("");
  const [selected, setSelected] = useState<Doc | null>(null);
  const [docsError, setDocsError] = useState<string | null>(null);

  // group the documents by category (type / issuer) for the first-step filter
  const categories = useMemo(() => {
    const by = new Map<string, Doc[]>();
    for (const d of docs) {
      const c = categoryOf(d);
      (by.get(c) ?? by.set(c, []).get(c)!).push(d);
    }
    return [...by.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [docs]);
  const inCategory = useMemo(
    () => docs.filter((d) => categoryOf(d) === category).sort((a, b) => (a.filename ?? "").localeCompare(b.filename ?? "")),
    [docs, category],
  );

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
                setCategory("");
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
            value={category}
            onChange={(e) => {
              setCategory(e.target.value);
              setSelected(null);
            }}
          >
            <option value="">Category…</option>
            {categories.map(([c, ds]) => (
              <option key={c} value={c}>
                {c} ({ds.length})
              </option>
            ))}
          </select>
          <select
            value={selected?.filename ?? ""}
            disabled={!category}
            onChange={(e) => setSelected(inCategory.find((d) => d.filename === e.target.value) ?? null)}
          >
            <option value="">{category ? "Pick a statement…" : "— pick a category first"}</option>
            {inCategory.map((d) => (
              <option key={`${d.provider}/${d.filename}`} value={d.filename ?? ""}>
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

type Load = { state: "loading" } | { state: "ready"; view: RawParseView } | { state: "error"; msg: string };

/** One statement: fetch its fate view, show each real page image, lay the fate boxes over it. Keyed by the
 * document so choosing another remounts it fresh. */
function StatementView({ entity, doc }: { entity: string; doc: Doc }) {
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [pageNo, setPageNo] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [hover, setHover] = useState<number | null>(null);
  const [hideFurniture, setHideFurniture] = useState(false);

  useEffect(() => {
    let live = true;
    api
      .rawParse(entity, { filename: doc.filename, provider: doc.provider, payload_ref: doc.payload_ref })
      .then((view) => live && setLoad({ state: "ready", view }))
      .catch((e) => live && setLoad({ state: "error", msg: e instanceof ApiError ? apiReason(e) : String(e) }));
    return () => {
      live = false;
    };
  }, [entity, doc]);

  const view = load.state === "ready" ? load.view : null;
  const scale = view?.scale ?? 2;
  const pageCount = view?.pages?.length ?? 1;
  const lines = useMemo(() => view?.pages?.find((p) => p.page === pageNo)?.lines ?? [], [view, pageNo]);
  const shown = hideFurniture ? lines.filter((l) => l.fate !== "furniture") : lines;
  const summary = (view?.summary ?? {}) as Record<string, number>;
  const imgUrl = api.pageImageUrl(entity, { filename: doc.filename, provider: doc.provider, payload_ref: doc.payload_ref }, pageNo);

  if (load.state === "loading") return <p className="rawparse__hint">Reading the statement…</p>;
  if (load.state === "error") return <p className="rawparse__error">{load.msg}</p>;

  return (
    <>
      <div className="rawparse__bar">
        <div className="rawparse__controls">
          <span className="rawparse__pager">
            <button disabled={pageNo <= 1} onClick={() => setPageNo((n) => Math.max(1, n - 1))}>‹</button>
            page {pageNo} / {pageCount}
            <button disabled={pageNo >= pageCount} onClick={() => setPageNo((n) => Math.min(pageCount, n + 1))}>›</button>
          </span>
          <span className="rawparse__zoom">
            <button onClick={() => setZoom((z) => Math.max(0.4, +(z - 0.15).toFixed(2)))}>−</button>
            {Math.round(zoom * 100)}%
            <button onClick={() => setZoom((z) => Math.min(2, +(z + 0.15).toFixed(2)))}>+</button>
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
          <div className="rawparse__page" style={{ transform: `scale(${zoom})`, transformOrigin: "top left" }}>
            <img className="rawparse__img" src={imgUrl} alt={`page ${pageNo}`} />
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
                      opacity: on ? 0.55 : 1,
                    }}
                    onMouseEnter={() => setHover(idx)}
                    onMouseLeave={() => setHover(null)}
                    title={`${f.mark} ${f.label}${ln.reason ? ` (${ln.reason})` : ""}\n${ln.shape}`}
                  />
                );
              })}
            </div>
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
                  <span className="rawparse__linemark" style={{ color: f.edge }}>{f.mark}</span>
                  <code>{ln.shape}</code>
                </li>
              );
            })}
          </ul>
          <p className="rawparse__note">
            Shapes only — the real values are on the page image, which never leaves this machine. A red line is
            the one to report.
          </p>
        </aside>
      </div>
    </>
  );
}
