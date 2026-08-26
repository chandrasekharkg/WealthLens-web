import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { formatter } from "../i18n";
import { Cards } from "./Cards";

const money = (amount: string) => ({ amount, currency: "INR" });

const CARDS = {
  provenance: { title: "Cards", scope: "Me", reporting_currency: "INR" },
  granularity: "cards",
  reporting_currency: "INR",
  is_partial: false,
  excluded: [],
  rows: [
    { account_id: "card:icici", issuer: "icici", statements: 1, since: "2026-02-01",
      last_statement: "2026-02-11", outstanding: money("5000.00"), status: "pending", entity_id: "me", entity_label: "Me" },
    { account_id: "card:axis", issuer: "axis", statements: 2, since: "2026-01-05",
      last_statement: "2026-02-28", outstanding: money("300.00"), status: "pending", entity_id: "me", entity_label: "Me" },
  ],
};

const AXIS_STATEMENTS = {
  entity_id: "me", issuer: "axis",
  statements: [
    { statement_date: "2026-02-28", previous_balance: money("1000.00"), new_balance: money("300.00"),
      spends: money("100.00"), payments: money("800.00"), transactions: 2, status: "pending" },
    { statement_date: "2026-01-31", previous_balance: money("500.00"), new_balance: money("1000.00"),
      spends: money("500.00"), payments: money("0.00"), transactions: 2, status: "partial" },
  ],
};

const AXIS_LATEST = {
  entity_id: "me", issuer: "axis", statement_date: "2026-02-28",
  previous_balance: money("1000.00"), new_balance: money("300.00"),
  transactions: [
    { date: "2026-02-03", description: "BOOKSTORE", amount: money("-100.00"), direction: "spend" },
    { date: "2026-02-15", description: "BILL PAYMENT", amount: money("800.00"), direction: "payment" },
  ],
  provenance: { title: "axis statement", scope: "Me", reporting_currency: "INR", row_count: 2 },
};

const ICICI_LATEST = {
  entity_id: "me", issuer: "icici", statement_date: "2026-02-11",
  previous_balance: money("0.00"), new_balance: money("5000.00"),
  transactions: [
    { date: "2026-02-01", description: "ELECTRONICS", amount: money("-5000.00"), direction: "spend" },
  ],
  provenance: { title: "icici statement", scope: "Me", reporting_currency: "INR", row_count: 1 },
};

const AXIS_JAN = {
  entity_id: "me", issuer: "axis", statement_date: "2026-01-31",
  previous_balance: money("500.00"), new_balance: money("1000.00"),
  transactions: [
    { date: "2026-01-05", description: "COFFEE SHOP", amount: money("-300.00"), direction: "spend" },
    { date: "2026-01-10", description: "GROCERY", amount: money("-200.00"), direction: "spend" },
  ],
  provenance: { title: "axis statement", scope: "Me", reporting_currency: "INR", row_count: 2 },
};

function stub() {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) => {
      const body = url === "/api/cards" ? CARDS
        : url.endsWith("/statements") ? AXIS_STATEMENTS
        : url.includes("/icici/") ? ICICI_LATEST
        : url.includes("period=2026-01") ? AXIS_JAN
        : AXIS_LATEST;
      return Promise.resolve({ ok: true, json: () => Promise.resolve(body) } as Response);
    }),
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("Cards", () => {
  it("lists cards ordered by what is owed and opens the current month by default", async () => {
    stub();
    render(<Cards format={formatter()} />);
    // The picker names both cards; icici (owing more) is first.
    const tiles = await screen.findAllByRole("listitem");
    expect(within(tiles[0]!).getByText("ICICI card")).toBeTruthy();
    expect(within(tiles[1]!).getByText("AXIS card")).toBeTruthy();
    // Pre-selected first card → its latest statement itemised.
    await waitFor(() => expect(screen.getByText("ELECTRONICS")).toBeTruthy());
    // each tile shows the newest statement's closing date, the "as of" for the outstanding figure
    expect(screen.getAllByText(/as of/).length).toBeGreaterThan(0);
  });

  it("switches card and drills into its latest statement, then an older period", async () => {
    stub();
    render(<Cards format={formatter()} />);
    await screen.findAllByRole("listitem");

    fireEvent.click(screen.getByText("AXIS card"));
    await waitFor(() => expect(screen.getByText("BOOKSTORE")).toBeTruthy());

    // Pick the older statement from the period dropdown.
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "2026-01-31" } });
    await waitFor(() => expect(screen.getByText("COFFEE SHOP")).toBeTruthy());
    expect(screen.queryByText("BOOKSTORE")).toBeNull();
  });

  it("stars each statement's paid-state: the open month is Current, an underpaid older one Part paid", async () => {
    stub();
    render(<Cards format={formatter()} />);
    await screen.findAllByRole("listitem");

    fireEvent.click(screen.getByText("AXIS card"));
    // the latest (open) statement is Current — badged on both the tile and the statement head
    await waitFor(() => expect(screen.getByText("BOOKSTORE")).toBeTruthy());
    expect(screen.getAllByText("Current").length).toBeGreaterThanOrEqual(1);

    // the January statement was underpaid → Part paid
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "2026-01-31" } });
    await waitFor(() => expect(screen.getByText("Part paid")).toBeTruthy());
  });

  it("shows an empty-state when no cards are present", async () => {
    vi.stubGlobal("fetch", vi.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({ ...CARDS, rows: [] }) } as Response)));
    render(<Cards format={formatter()} />);
    await waitFor(() =>
      expect(screen.getByText("No credit-card statements have been imported yet.")).toBeTruthy());
  });
});
