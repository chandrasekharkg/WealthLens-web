import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { formatter } from "../i18n";
import { HoldingDiaryPanel } from "./HoldingDiaryPanel";

const DIARY = {
  entity_id: "self", instrument: "INE000A01001", name: "ALPHA LTD",
  performance: {
    invested: { amount: "10000.00", currency: "INR" }, current: { amount: "15000.00", currency: "INR" },
    gain: { amount: "5000.00", currency: "INR" }, realised: null, unrealised: null,
    abs_return_pct: 50, xirr_pct: 12.3, corp_action: false, synthetic_dates: false,
  },
  positions: [
    { broker: "ZERODHA", account_masked: "••1857", shares: 100, since: "2020-05-10", reconciliation: null },
    { broker: "HDFC SECURITIES", account_masked: "••6e07", shares: 60, since: null, reconciliation: null },
  ],
  lineage: [
    { date: "2020-07-31", from_isin: "INE000OLD001", from_name: "OLD BANK LTD",
      to_isin: "INE000NEW002", to_name: "NEW BANK LTD", action: "merger", ratio: "1:1", note: "OLD merged into NEW" },
  ],
  lines: [
    { date: "2026-05-10", line_kind: "transaction", role: "movement", action: "buy",
      description: "Purchase", debit: null, credit: 100, closing: 100, pledged: null, locked: null, free: null, booked: true },
    { date: "2026-05-11", line_kind: "transaction", role: "custody", action: null,
      description: "Pledge Request", debit: null, credit: 0, closing: 100, pledged: null, locked: null, free: null, booked: false },
    { date: "2026-05-31", line_kind: "balance", role: null, action: null,
      description: "ALPHA", debit: null, credit: null, closing: 100, pledged: 20, locked: null, free: 80, booked: false },
  ],
  provenance: { title: "ALPHA LTD", scope: "Me", reporting_currency: "INR", row_count: 3 },
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
    // the performance strip and the identity lineage render above the transcript
    expect(screen.getByText("₹15,000.00")).toBeTruthy();
    expect(screen.getByText("12.3%")).toBeTruthy();
    expect(screen.getByText("Identity history")).toBeTruthy();
    expect(screen.getByText(/OLD BANK LTD/)).toBeTruthy();
    // the per-broker holdings strip announces the consolidation and lists each demat's shares/broker
    expect(screen.getByText(/Held across 2 demat accounts/)).toBeTruthy();
    expect(screen.getByText(/ZERODHA/)).toBeTruthy();
    expect(screen.getByText(/HDFC SECURITIES/)).toBeTruthy();
    expect(screen.getByText(/since 10 May 2020/)).toBeTruthy();
  });

  it("folds a run of identical balance lines into one confidence row, and the toggle reveals them", async () => {
    const { fireEvent } = await import("@testing-library/react");
    // Five identical monthly confirmations at 100 units — the sameness the fold collapses to one row.
    const runLines = Array.from({ length: 5 }, (_, k) => ({
      date: `2026-0${k + 1}-28`, line_kind: "balance", role: null, action: null,
      description: "ALPHA", debit: null, credit: null, closing: 100, pledged: null, locked: null, free: 100, booked: false,
    }));
    vi.stubGlobal("fetch", vi.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({ ...DIARY, lines: runLines }) } as Response)));
    render(<HoldingDiaryPanel entity="self" instrument="INE000A01001" name="ALPHA LTD"
      format={formatter()} onClose={() => {}} />);
    // Collapsed by default: one "Confirmed" row standing for all five statements, none of the raw rows.
    await waitFor(() => expect(screen.getByText("Confirmed")).toBeTruthy());
    expect(screen.getByText(/confirmed by 5 statements/)).toBeTruthy();
    // The toggle is offered and names how many rows it absorbs; unchecking it reveals every row.
    const toggle = screen.getByRole("checkbox", { name: /Collapse/ });
    expect(toggle).toBeTruthy();
    fireEvent.click(toggle);
    await waitFor(() => expect(screen.queryByText("Confirmed")).toBeNull());
  });

  it("focuses a deep-linked line — marks it, and expands the fold when the target was folded away", async () => {
    // A run of five identical balances (folds to one, keeping the LAST) plus a movement. Focus the FIRST
    // balance — a line the fold absorbs — so the panel must expand to reveal it, then mark it focused.
    const runLines = [
      { diary_id: "dhd-first", date: "2026-01-31", line_kind: "balance", role: null, action: null,
        description: "ALPHA", debit: null, credit: null, closing: 100, pledged: null, locked: null, free: 100, booked: false },
      ...Array.from({ length: 4 }, (_, k) => ({
        diary_id: `dhd-run-${k}`, date: `2026-0${k + 2}-28`, line_kind: "balance", role: null, action: null,
        description: "ALPHA", debit: null, credit: null, closing: 100, pledged: null, locked: null, free: 100, booked: false })),
    ];
    vi.stubGlobal("fetch", vi.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({ ...DIARY, lines: runLines }) } as Response)));
    render(<HoldingDiaryPanel entity="self" instrument="INE000A01001" name="ALPHA LTD"
      format={formatter()} onClose={() => {}} focusDiaryId="dhd-first" />);
    // The focused row is present and marked — the fold auto-expanded because the target was a folded-away row.
    await waitFor(() => {
      const focused = document.querySelector('[data-row-id="dhd-first"][data-focused="true"]');
      expect(focused).toBeTruthy();
    });
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
