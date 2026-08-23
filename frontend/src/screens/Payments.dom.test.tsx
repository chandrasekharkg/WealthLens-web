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
      issuer: "axis", statement_date: "2026-01-31", resolved: true, entity_id: "me", entity_label: "Me" },
    { date: "2026-01-20", bank: "axis", amount: money("6000.00"), narration: "UPI/Amazon RBL",
      issuer: "icici", statement_date: null, resolved: false, entity_id: "me", entity_label: "Me" },
  ],
};

const BILL = {
  entity_id: "me", issuer: "axis", statement_date: "2026-01-31",
  previous_balance: money("500.00"), new_balance: money("1000.00"),
  transactions: [
    { date: "2026-01-05", description: "COFFEE SHOP", amount: money("-300.00"), direction: "spend" },
    { date: "2026-01-10", description: "GROCERY", amount: money("-200.00"), direction: "spend" },
  ],
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
    await waitFor(() => expect(screen.getByText("View bill")).toBeTruthy());
    // The resolved payment names its card; the unresolved one is honestly marked.
    expect(screen.getByText("AXIS card")).toBeTruthy();
    expect(screen.getByText("Statement not loaded")).toBeTruthy();
  });

  it("drills a payment into the bill it cleared", async () => {
    stub();
    render(<Payments format={formatter()} />);
    fireEvent.click(await screen.findByText("View bill"));
    // The cleared bill opens inline, itemised.
    await waitFor(() => expect(screen.getByText("COFFEE SHOP")).toBeTruthy());
    expect(screen.getByText("The bill this payment cleared")).toBeTruthy();
    expect(screen.getByText("GROCERY")).toBeTruthy();
  });
});
