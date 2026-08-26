import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { formatter } from "../i18n";
import type { SourceDetail } from "../api/client";
import { SourcePopup } from "./SourcePopup";

const DETAIL: SourceDetail = {
  source_id: "src:cas:1",
  adapter: "cas",
  document: {
    source_id: "src:cas:1",
    kind: "file",
    provider: "nsdl",
    filename: "cas.pdf",
    payload_ref: "abc123",
    rows: 12,
    captured_at: "2026-07-01 09:00:00",
    period_start: "2026-04-01",
    period_end: "2026-06-30",
    password: { kind: "named", name: "pan" },
  },
  detail: {},
  tables: [
    { table: "position_snapshots", rows: 8 },
    { table: "holding_events", rows: 4 },
  ],
};

function stub(body: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve(body) } as Response)),
  );
}
afterEach(() => vi.unstubAllGlobals());

describe("SourcePopup — Primitive B", () => {
  it("shows the document behind a fact row: file to open, period, tables it wrote, password to copy", async () => {
    stub(DETAIL);
    render(<SourcePopup entity="me" sourceId="src:cas:1" format={formatter("en-IN")} onClose={() => {}} />);

    // the filename is a control that asks the OS to open the file
    await waitFor(() => expect(screen.getByRole("button", { name: /Open the file: cas.pdf/ })).toBeTruthy());
    // the parser, and the tables the source wrote (one line each)
    expect(screen.getByText("cas")).toBeTruthy();
    expect(screen.getByText(/position_snapshots · 8 row/)).toBeTruthy();
    expect(screen.getByText(/holding_events · 4 row/)).toBeTruthy();
    // a named password gets a Copy control (the value is never rendered)
    expect(screen.getByRole("button", { name: /Copy/ })).toBeTruthy();
  });

  it("fails soft on a source that is no longer in the store", async () => {
    stub({ source_id: null, adapter: null, document: null, detail: {}, tables: [] });
    render(<SourcePopup entity="me" sourceId="gone" format={formatter("en-IN")} onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText(/no longer in the store/)).toBeTruthy());
  });
});
