import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RawParse } from "./RawParse";

/**
 * The right pane shows what was READ — the raw line, with its masked shape beside it — while the copied issue
 * body stays masked. Both halves of the 2026-09-05 report: `<W×3>` was unreadable next to the real page, and
 * the shareable report must never carry the text that now makes the pane readable.
 */

const doc = {
  source_id: "src-1",
  filename: "cas.pdf",
  provider: "nsdl",
  payload_ref: "statements/depository/cas/cas.pdf",
  format_id: "nsdl.cas",
  period_end: "2026-07-31",
};

const view = {
  filename: "cas.pdf",
  scale: 2,
  classified: true,
  method: "cas",
  summary: { interpreted: 2, furniture: 1 },
  pages: [
    {
      page: 1,
      lines: [
        {
          bbox: { x0: 10, x1: 500, top: 100, bottom: 107 },
          fate: "interpreted",
          reason: null,
          shape: "<ISIN> <W×2> ##.## #,### ###.## #,##,###.##",
          text: "INE000A01001 SAMPLE BANK 10.00 2,292 319.75 7,32,867.00", // pii-ok — invented fixture row
          became: { table: "position_snapshots", kind: "holding", fields: ["isin", "quantity", "price", "value"] },
        },
        {
          bbox: { x0: 10, x1: 200, top: 108.5, bottom: 115 },
          fate: "interpreted",
          reason: "continuation — part of the interpreted row above",
          shape: "<W×2>",
          text: "SAMPLE.NSE LIMITED",
          became: { table: "position_snapshots", kind: "holding", fields: ["isin", "quantity", "price", "value"] },
        },
        {
          bbox: { x0: 10, x1: 300, top: 140, bottom: 147 },
          fate: "not_interpreted",
          reason: null,
          shape: "<DATE> <W×3> #,###.##",
          text: "01/07/2026 SOME MISSED ROW 1,234.00", // pii-ok — invented fixture row
        },
      ],
    },
  ],
};

function stubFetch() {
  return vi.fn((input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const body = url.endsWith("/raw-parse") ? view : url.endsWith("/api/workspace/alpha") ? { documents: [doc] } : {};
    return Promise.resolve({ ok: true, json: () => Promise.resolve(body) } as Response);
  });
}

afterEach(() => vi.unstubAllGlobals());

async function openTheStatement() {
  render(<RawParse entities={[{ id: "alpha", label: "Alpha" }]} />);
  const [categorySelect] = await waitFor(() => {
    const selects = screen.getAllByRole("combobox");
    if (!selects[0] || (selects[0] as HTMLSelectElement).options.length < 2) throw new Error("docs not loaded");
    return selects;
  });
  fireEvent.change(categorySelect!, { target: { value: "cas / nsdl" } });
  const statementSelect = screen.getAllByRole("combobox")[1]!;
  fireEvent.change(statementSelect, { target: { value: "src-1" } });
  await waitFor(() => expect(screen.getByText("SAMPLE.NSE LIMITED")).toBeTruthy());
}

describe("the right pane shows the raw line beside its shape", () => {
  it("renders the text the reader saw, with the masked shape muted beside it", async () => {
    vi.stubGlobal("fetch", stubFetch());
    await openTheStatement();
    expect(screen.getByText(/INE000A01001 SAMPLE BANK 10\.00/)).toBeTruthy();
    expect(screen.getByText("<ISIN> <W×2> ##.## #,### ###.## #,##,###.##")).toBeTruthy();
    // the wrapped tail is shown as read (✓), not offered for flagging
    const tail = screen.getByText("SAMPLE.NSE LIMITED").closest("li")!;
    expect(tail.className).toContain("rawparse__line--interpreted");
    expect(tail.querySelector("button")).toBeNull();
  });

  it("keeps the copied issue body masked — shapes only, never the text", async () => {
    vi.stubGlobal("fetch", stubFetch());
    const written: string[] = [];
    Object.assign(navigator, { clipboard: { writeText: (t: string) => { written.push(t); return Promise.resolve(); } } });
    await openTheStatement();
    fireEvent.click(screen.getByText(/Copy for a GitHub issue/));
    await waitFor(() => expect(written.length).toBe(1));
    const body = written[0]!;
    expect(body).toContain("`<DATE> <W×3> #,###.##`");        // the flagged line, as its shape
    expect(body).not.toContain("SOME MISSED ROW");             // never its text
    expect(body).not.toContain("SAMPLE BANK");
    expect(body).not.toContain("SAMPLE.NSE");                  // the folded tail is not a gap
  });

  it("carries each flagged line's neighbours in the replayable geometry format", async () => {
    // the format WealthLens-core's tests/geometry_replay.py parses: - `shape`  — page N, x a–b, y t.t  ⚑ flagged | (fate)
    vi.stubGlobal("fetch", stubFetch());
    const written: string[] = [];
    Object.assign(navigator, { clipboard: { writeText: (t: string) => { written.push(t); return Promise.resolve(); } } });
    await openTheStatement();
    fireEvent.click(screen.getByText(/Copy for a GitHub issue/));
    await waitFor(() => expect(written.length).toBe(1));
    const body = written[0]!;
    expect(body).toContain("### Context — the lines around each flagged one (masked)");
    const lineRe = /^- `(.+?)` {2}— page (\d+), x (\d+)–(\d+), y (\d+\.\d)( {2}⚑ flagged| {2}\((\w+)\))/;
    const contextLines = body.split("\n").filter((l) => l.startsWith("- `") && lineRe.test(l));
    // the flagged line, and the two interpreted rows above it, all in the one parseable shape
    expect(contextLines.some((l) => l.includes("`<DATE> <W×3> #,###.##`") && l.includes("⚑ flagged"))).toBe(true);
    expect(contextLines.some((l) => l.includes("`<ISIN> <W×2> ##.## #,### ###.## #,##,###.##`") && l.includes("(interpreted)"))).toBe(true);
    expect(contextLines.some((l) => l.includes("y 108.5"))).toBe(true);   // one-decimal y survives — the fold decides by a few points
    expect(body).not.toMatch(/SAMPLE|MISSED ROW|INE000A01001 SAMPLE/); // still no text anywhere in the body
  });
});
