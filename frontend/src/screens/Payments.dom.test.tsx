import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { formatter } from "../i18n";
import { Payments } from "./Payments";

const money = (amount: string) => ({ amount, currency: "INR" });

const PAYMENTS = {
  provenance: { title: "Card_payments", scope: "Me", reporting_currency: "INR" },
  granularity: "card_payments",
  reporting_currency: "INR",
  is_partial: false,
  excluded: [],
  rows: [
    { date: "2026-02-05", bank: "axis", amount: money("1000.00"), narration: "UPI/Amazon RBL",
      issuer: "axis", statement_date: "2026-01-31", resolved: true, match: "exact",
      entity_id: "me", entity_label: "Me" },
    { date: "2026-03-03", bank: "axis", amount: money("400.00"), narration: "UPI/Ref#8812",
      issuer: "axis", statement_date: "2026-02-28", resolved: true, match: "cycle",
      entity_id: "me", entity_label: "Me" },
    { date: "2026-01-20", bank: "axis", amount: money("6000.00"), narration: "UPI/Amazon RBL",
      issuer: "icici", statement_date: null, resolved: false, match: "none",
      entity_id: "me", entity_label: "Me" },
  ],
};

const BILL = {
  entity_id: "me", issuer: "axis", statement_date: "2026-01-31",
  previous_balance: money("500.00"), new_balance: money("1000.00"),
  transactions: [
    { date: "2026-01-05", description: "COFFEE SHOP", amount: money("-300.00"), direction: "spend" },
    { date: "2026-01-10", description: "GROCERY", amount: money("-200.00"), direction: "spend" },
  ],
  provenance: { title: "axis statement", scope: "Me", reporting_currency: "INR", row_count: 2 },
};

function stub() {
  vi.stubGlobal("fetch", vi.fn((url: string) =>
    Promise.resolve({
      ok: true,
      json: () => Promise.resolve(url.includes("/statement") ? BILL : PAYMENTS),
    } as Response)));
}

afterEach(() => vi.unstubAllGlobals());

describe("Payments", () => {
  it("lists card bill payments, resolved and unresolved", async () => {
    stub();
    render(<Payments format={formatter()} />);
    await waitFor(() => expect(screen.getAllByText("View bill").length).toBeGreaterThan(0));
    // The resolved payments name their card; the unresolved one is honestly marked.
    expect(screen.getAllByText("AXIS card").length).toBeGreaterThan(0);
    expect(screen.getByText("Statement not loaded")).toBeTruthy();
  });

  it("drills a payment into the bill it cleared", async () => {
    stub();
    render(<Payments format={formatter()} />);
    fireEvent.click((await screen.findAllByText("View bill"))[0]!);
    // The cleared bill opens inline, itemised.
    await waitFor(() => expect(screen.getByText("COFFEE SHOP")).toBeTruthy());
    expect(screen.getByText("The bill this payment cleared")).toBeTruthy();
    expect(screen.getByText("GROCERY")).toBeTruthy();
  });

  it("marks a cycle-fallback match honestly, an exact one plainly", async () => {
    stub();
    render(<Payments format={formatter()} />);
    await screen.findAllByText("View bill");
    // the ₹400 partial payment resolved to the cycle, not an exact bill — it says "· this cycle"
    expect(screen.getByText(/this cycle/)).toBeTruthy();
    // the ₹1000 exact clear carries no such marker (only the one cycle row does)
    expect(screen.getAllByText(/this cycle/)).toHaveLength(1);
  });
});
