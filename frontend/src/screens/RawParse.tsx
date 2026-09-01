import { useEffect, useMemo, useState } from "react";

import { api, ApiError, apiReason, type RawParseLine, type RawParseView, type WorkspaceDetail } from "../api/client";
import { writeClipboard } from "../lib/clipboard";

/** A readable category for a document, so the picker can filter by type/issuer before the statement itself.
 * Derived from where `organize` filed it (its payload_ref folder) — `statements/credit-card/sbi` →
 * "credit-card / sbi", `statements/depository/cas` → "depository / cas" — falling back to the provider. */
// The 2a chip: what an interpreted line BECAME in the store — table · kind (bound fields). Pure structure (the
// bridge never sends a value), so it is safe to render; the real figures are read from the page image beside it.
function becameLabel(b: NonNullable<RawParseLine["became"]>): string {
  return `${b.table} · ${b.kind}${b.fields?.length ? ` (${b.fields.join(", ")})` : ""}`;
}

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

type Doc = NonNullable<WorkspaceDetail["documents"]>[number];

// A skipped line is one of two things, and the user can toggle between them: FURNITURE (we judged it not
// relevant to the statement's details) or NOT-INTERPRETED (statement detail we missed — a gap to report).
// Everything the reader DID turn into a row is INTERPRETED. `dropped`/`not_interpreted` both display as `flag`.
type Eff = "interpreted" | "flag" | "furniture";
const DISPLAY: Record<Eff, { fill: string; edge: string; mark: string; label: string; hint: string }> = {
  interpreted: { fill: "rgba(34,197,94,0.16)", edge: "rgba(22,163,74,0.6)", mark: "✓", label: "interpreted",
                 hint: "read into the store" },
  flag: { fill: "rgba(239,68,68,0.32)", edge: "rgba(220,38,38,0.95)", mark: "⚑", label: "not interpreted",
          hint: "statement detail we missed — click to mark as furniture (not relevant)" },
  furniture: { fill: "rgba(148,163,184,0.1)", edge: "rgba(100,116,139,0.5)", mark: "⚐", label: "furniture",
               hint: "not relevant to the statement's details — click to flag as missed detail" },
};
const ORDER: Eff[] = ["interpreted", "flag", "furniture"];

/** The reader's verdict, collapsed to the three the user cares about (`dropped` ≡ `not_interpreted` ≡ flag). */
function baseEff(fate: string): Eff {
  return fate === "interpreted" ? "interpreted" : fate === "furniture" ? "furniture" : "flag";
}

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
  const [copied, setCopied] = useState(false);
  // the user's per-line reclassification: flag ↔ furniture. Keyed by page:index; defaults to the reader's verdict.
  const [override, setOverride] = useState<Record<string, "flag" | "furniture">>({});

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
  const imgUrl = api.pageImageUrl(
    entity,
    { filename: doc.filename, provider: doc.provider, payload_ref: doc.payload_ref },
    pageNo,
  );

  const keyOf = (page: number, idx: number) => `${page}:${idx}`;
  const effOf = (fate: string, page: number, idx: number): Eff => {
    const b = baseEff(fate);
    return b === "interpreted" ? "interpreted" : (override[keyOf(page, idx)] ?? b);
  };
  const toggle = (page: number, idx: number, fate: string) => {
    const cur = override[keyOf(page, idx)] ?? baseEff(fate);
    setOverride((o) => ({ ...o, [keyOf(page, idx)]: cur === "flag" ? "furniture" : "flag" }));
  };

  // per-page counts by the EFFECTIVE (post-reclassification) state, so the chips respond to the toggles
  const counts = useMemo(() => {
    const c: Record<Eff, number> = { interpreted: 0, flag: 0, furniture: 0 };
    lines.forEach((ln, i) => (c[effOf(ln.fate, pageNo, i)] += 1));
    return c;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines, override, pageNo]);

  // Assemble the PII-free GitHub-issue body: the flagged (⚑) lines across ALL pages, as masked shape + page +
  // box. Nothing but structure leaves — the raw text never enters this.
  const issueBody = (v: RawParseView): string => {
    const flagged: string[] = [];
    for (const pg of v.pages ?? []) {
      (pg.lines ?? []).forEach((ln, idx) => {
        if (effOf(ln.fate, pg.page, idx) === "flag") {
          const b = ln.bbox as { x0: number; x1: number; top: number };
          flagged.push(
            `- \`${ln.shape}\`  — page ${pg.page}, x ${Math.round(b.x0)}–${Math.round(b.x1)}, y ${Math.round(b.top)}` +
              (ln.reason ? ` (${ln.reason})` : ""),
          );
        }
      });
    }
    const sum = Object.entries((v.summary ?? {}) as Record<string, number>)
      .map(([k, n]) => `${k} ${n}`)
      .join(" · ");
    const method =
      v.method === "cas"
        ? "depository CAS — fates from the reader's own per-line accounting (precise)"
        : v.method === "facts"
          ? "amount-matched to the parser's booked facts — an auto `not_interpreted` line is a CANDIDATE (a dated, numeric line whose amount matched nothing booked; could be a wrapped/summary line — verify before acting)"
          : "not auto-classified for this statement type — every line shown as furniture; the reporter flagged the gaps below";
    return [
      `## Raw-parse gap — ${categoryOf(doc)}`,
      ``,
      `Reported from the WealthLens raw-parse view. **Masked — no values, names, or account numbers: every ` +
        "line is reduced to its shape (`#` per digit, `<ISIN>`, `<W>` per word) and the geometry is in PDF points.**",
      ``,
      `- classification: ${method}`,
      `- reader's auto-summary (what the parser did on its own): ${sum}`,
      `- reporter-flagged (⚑) as not interpreted: **${flagged.length}**`,
      ``,
      `### Reporter-flagged — lines that should be read but were not`,
      ...(flagged.length ? flagged : ["_(none flagged yet — flag the lines the reader missed, then copy again)_"]),
    ].join("\n");
  };
  const copyIssue = async (v: RawParseView) => {
    try {
      await writeClipboard(issueBody(v));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked — nothing to surface here */
    }
  };
  const flaggedCount = (view?.pages ?? []).reduce(
    (n, pg) => n + (pg.lines ?? []).filter((ln, idx) => effOf(ln.fate, pg.page, idx) === "flag").length,
    0,
  );

  if (load.state === "loading") return <p className="rawparse__hint">Reading the statement…</p>;
  if (load.state === "error") return <p className="rawparse__error">{load.msg}</p>;

  const visible = lines.map((ln, i) => ({ ln, i })).filter(({ i, ln }) => !(hideFurniture && effOf(ln.fate, pageNo, i) === "furniture"));

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
          <button
            type="button"
            className="rawparse__copy"
            onClick={() => {
              void copyIssue(load.view);
            }}
            title="Copy a masked, PII-free bug report of the flagged lines, ready to paste into a GitHub issue"
          >
            {copied ? "Copied ✓" : `Copy for a GitHub issue${flaggedCount ? ` (${flaggedCount})` : ""}`}
          </button>
        </div>
        <div className="rawparse__summary">
          {ORDER.map((e) => (
            <span key={e} className="rawparse__chip" title={DISPLAY[e].hint}>
              <span className="rawparse__swatch" style={{ background: DISPLAY[e].fill, borderColor: DISPLAY[e].edge }} />
              {DISPLAY[e].mark} {DISPLAY[e].label} <b>{counts[e]}</b>
            </span>
          ))}
          <span className="rawparse__pagenote">page {pageNo}</span>
        </div>
      </div>

      {!load.view.classified && (
        <p className="rawparse__hint rawparse__hint--warn">
          Fates aren't auto-assigned for this statement type yet — every line shows as <b>furniture</b>. Flag
          (⚑) the lines that carry your data but were missed, then copy the report.
        </p>
      )}

      <div className="rawparse__split">
        <div className="rawparse__stage">
          <div className="rawparse__page" style={{ transform: `scale(${zoom})`, transformOrigin: "top left" }}>
            <img className="rawparse__img" src={imgUrl} alt={`page ${pageNo}`} />
            <div className="rawparse__overlay">
              {visible.map(({ ln, i }) => {
                const eff = effOf(ln.fate, pageNo, i);
                const d = DISPLAY[eff];
                const b = ln.bbox as { x0: number; x1: number; top: number; bottom: number };
                const on = hover === i;
                return (
                  <div
                    key={i}
                    className="rawparse__box"
                    style={{
                      left: b.x0 * scale,
                      top: b.top * scale,
                      width: Math.max(2, (b.x1 - b.x0) * scale),
                      height: Math.max(2, (b.bottom - b.top) * scale),
                      background: on ? d.edge : d.fill,
                      outline: `1px solid ${d.edge}`,
                      opacity: on ? 0.55 : 1,
                    }}
                    onMouseEnter={() => setHover(i)}
                    onMouseLeave={() => setHover(null)}
                    onClick={() => eff !== "interpreted" && toggle(pageNo, i, ln.fate)}
                    title={`${d.mark} ${d.label}${ln.reason ? ` (${ln.reason})` : ""}\n${ln.shape}\n${eff === "interpreted" && ln.became ? `→ became ${becameLabel(ln.became)}` : eff !== "interpreted" ? d.hint : ""}`}
                  />
                );
              })}
            </div>
          </div>
        </div>

        <aside className="rawparse__side">
          <h3>What the reader made of page {pageNo}</h3>
          <p className="rawparse__note">
            Each skipped line carries a flag: ⚑ <b>not interpreted</b> (statement detail we missed — report it)
            or ⚐ <b>furniture</b> (not relevant). Click the flag to change our verdict.
          </p>
          <ul className="rawparse__lines">
            {visible.map(({ ln, i }) => {
              const eff = effOf(ln.fate, pageNo, i);
              const d = DISPLAY[eff];
              return (
                <li
                  key={i}
                  className={`rawparse__line rawparse__line--${eff}${hover === i ? " is-on" : ""}`}
                  onMouseEnter={() => setHover(i)}
                  onMouseLeave={() => setHover(null)}
                >
                  {eff === "interpreted" ? (
                    <span className="rawparse__linemark" style={{ color: d.edge }}>{d.mark}</span>
                  ) : (
                    <button
                      type="button"
                      className="rawparse__flag"
                      style={{ color: d.edge }}
                      onClick={() => toggle(pageNo, i, ln.fate)}
                      title={d.hint}
                      aria-label={`${d.label} — click to change`}
                    >
                      {d.mark}
                    </button>
                  )}
                  <code>{ln.shape}</code>
                  {eff === "interpreted" && ln.became && (
                    <span className="rawparse__became" title="what this line became in the store — table · kind (the fields that bound). Structure only; the values are on the page image.">
                      → {becameLabel(ln.became)}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </aside>
      </div>
    </>
  );
}
