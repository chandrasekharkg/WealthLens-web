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
      account_label: "AXIS", narration: "SWIGGY ORDER", amount: money("-750.00"), balance: money("42000.00") }, // pii-ok
    { entity_id: "self", entity_label: "Me", date: "2026-07-03", bank: "axis", account_id: "bank:axis",
      account_label: "AXIS", narration: "SALARY CREDIT", amount: money("120000.00"), balance: money("42750.00") }, // pii-ok
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

  it("offers an account facet — accounts grouped by bank — that narrows to one account", async () => {
    // several accounts present (two of them in the same bank) → the facet appears, grouped under the bank;
    // picking one account hides every other account's rows.
    const MANY = {
      ...TXN,
      rows: [
        ...TXN.rows, // two AXIS rows
        { entity_id: "self", entity_label: "Me", date: "2026-07-04", bank: "sbi", account_id: "bank:sbi:1375",
          account_label: "SBI ••1375", narration: "RENT", amount: money("-30000.00"), balance: money("10000.00") }, // pii-ok
        { entity_id: "self", entity_label: "Me", date: "2026-07-02", bank: "sbi", account_id: "bank:sbi:5845",
          account_label: "SBI ••5845", narration: "INTEREST", amount: money("512.00"), balance: money("60000.00") }, // pii-ok
      ],
    };
    vi.stubGlobal("fetch", vi.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve(MANY) } as Response)));
    render(<Transactions format={formatter()} />);
    await screen.findByText("RENT");
    const facet = screen.getByLabelText("Account");
    // the two SBI accounts are grouped under an "SBI" optgroup
    expect(facet.querySelector('optgroup[label="SBI"]')).toBeTruthy();
    fireEvent.change(facet, { target: { value: "SBI ••1375" } }); // pii-ok
    // only the picked account's row stays; the other SBI account and the AXIS rows are filtered out
    expect(screen.getByText("RENT")).toBeTruthy();
    expect(screen.queryByText("INTEREST")).toBeNull();
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
