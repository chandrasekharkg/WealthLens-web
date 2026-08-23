import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { formatter } from "../i18n";
import { HoldingDiaryPanel } from "./HoldingDiaryPanel";

const DIARY = {
  entity_id: "self", instrument: "INE000A01001", name: "ALPHA LTD",
  lines: [
    { date: "2026-05-10", line_kind: "transaction", role: "movement", action: "buy",
      description: "Purchase", debit: null, credit: 100, closing: 100, pledged: null, locked: null, free: null, booked: true },
    { date: "2026-05-11", line_kind: "transaction", role: "custody", action: null,
      description: "Pledge Request", debit: null, credit: 0, closing: 100, pledged: null, locked: null, free: null, booked: false },
    { date: "2026-05-31", line_kind: "balance", role: null, action: null,
      description: "ALPHA", debit: null, credit: null, closing: 100, pledged: 20, locked: null, free: 80, booked: false },
  ],
};

afterEach(() => vi.unstubAllGlobals());

describe("HoldingDiaryPanel", () => {
  it("renders the transcript with role tags and a pledged-balance flag", async () => {
    vi.stubGlobal("fetch", vi.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve(DIARY) } as Response)));
    render(<HoldingDiaryPanel entity="self" instrument="INE000A01001" name="ALPHA LTD"
      format={formatter()} onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText("Purchase")).toBeTruthy());
    expect(screen.getByText("Movement")).toBeTruthy();
    expect(screen.getByText("Custody")).toBeTruthy();
    expect(screen.getByText("Pledge Request")).toBeTruthy();
    // the balance line's band breakdown is surfaced (the ◆ flag carries the pledged/locked tooltip)
    expect(screen.getByText("◆")).toBeTruthy();
  });

  it("shows an empty-state when the holding has no transcript", async () => {
    vi.stubGlobal("fetch", vi.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({ ...DIARY, lines: [] }) } as Response)));
    render(<HoldingDiaryPanel entity="self" instrument="X" name="X"
      format={formatter()} onClose={() => {}} />);
    await waitFor(() =>
      expect(screen.getByText("No depository transcript for this holding.")).toBeTruthy());
  });
});
