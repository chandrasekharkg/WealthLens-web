import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { formatter } from "../i18n";
import { Transactions } from "./Transactions";

const money = (a: string) => ({ amount: a, currency: "INR" });
const TXN = {
  provenance: { title: "Transactions", scope: "Me", reporting_currency: "INR" },
  granularity: "transactions", reporting_currency: "INR", is_partial: false, excluded: [],
  rows: [
    { entity_id: "self", entity_label: "Me", date: "2026-07-05", bank: "axis", account_id: "bank:axis",
      narration: "SWIGGY ORDER", amount: money("-750.00"), balance: money("42000.00") }, // pii-ok
    { entity_id: "self", entity_label: "Me", date: "2026-07-03", bank: "axis", account_id: "bank:axis",
      narration: "SALARY CREDIT", amount: money("120000.00"), balance: money("42750.00") }, // pii-ok
  ],
};

function stub() {
  vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve(TXN) } as Response)));
}
afterEach(() => vi.unstubAllGlobals());

describe("Transactions", () => {
  it("lists bank transactions with signed amounts", async () => {
    stub();
    render(<Transactions format={formatter()} />);
    await waitFor(() => expect(screen.getByText("SWIGGY ORDER")).toBeTruthy());
    expect(screen.getByText("SALARY CREDIT")).toBeTruthy();
    expect(screen.getByText("-₹750.00")).toBeTruthy(); // pii-ok
  });

  it("offers a bank facet that narrows the ledger to one account", async () => {
    // two banks present → the facet appears; picking one hides the other's rows.
    const TWO_BANKS = {
      ...TXN,
      rows: [
        ...TXN.rows,
        { entity_id: "self", entity_label: "Me", date: "2026-07-04", bank: "hdfc", account_id: "bank:hdfc",
          narration: "RENT", amount: money("-30000.00"), balance: money("10000.00") }, // pii-ok
      ],
    };
    vi.stubGlobal("fetch", vi.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve(TWO_BANKS) } as Response)));
    render(<Transactions format={formatter()} />);
    await screen.findByText("RENT");
    fireEvent.change(screen.getByLabelText("Bank"), { target: { value: "hdfc" } });
    // the hdfc row stays; the axis rows are filtered out
    expect(screen.getByText("RENT")).toBeTruthy();
    expect(screen.queryByText("SWIGGY ORDER")).toBeNull();
  });

  it("re-fetches when a date window is applied", async () => {
    stub();
    render(<Transactions format={formatter()} />);
    await screen.findByText("SWIGGY ORDER");
    // "From" is also a column header (hence a Columns-picker checkbox), so scope to the date input.
    fireEvent.change(screen.getByLabelText("From", { selector: 'input[type="date"]' }), {
      target: { value: "2026-07-01" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    // the last fetch carries the since= query param
    await waitFor(() => {
      const calls = (globalThis.fetch as unknown as { mock: { calls: string[][] } }).mock.calls;
      expect(calls.some((c) => String(c[0]).includes("since=2026-07-01"))).toBe(true);
    });
  });
});
