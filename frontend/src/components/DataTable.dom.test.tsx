import type { ColumnDef } from "@tanstack/react-table";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { Column, ProvenanceHeader } from "../lib/csv";
import { DataTable } from "./DataTable";

/**
 * Component behaviour only — does it render, does it respond, does it show the right states. The numbers
 * themselves are asserted a layer down, with no DOM (ADR-0010).
 */

type Row = { name: string; value: { amount: string; currency: string } };

const ROWS: Row[] = Array.from({ length: 12 }, (_, i) => ({
  name: `Item ${i + 1}`,
  value: { amount: `${(i + 1) * 100}.00`, currency: "INR" },
}));

const COLUMNS: ColumnDef<Row>[] = [
  { id: "name", accessorKey: "name", header: "Instrument" },
  { id: "value", accessorFn: (r) => r.value.amount, header: "Value" },
];

const EXPORT_COLUMNS: Column<Row>[] = [
  { header: "Instrument", value: (r) => r.name },
  { header: "Value", value: (r) => r.value },
];

const PROVENANCE: ProvenanceHeader = {
  title: "Holdings",
  scope: "Family (2 members)",
  as_of: "2026-07-31",
  reporting_currency: "INR",
  warnings: ["Excludes Mum: the store is missing"],
};

function setup(props: Partial<React.ComponentProps<typeof DataTable<Row>>> = {}) {
  const onExport = vi.fn();
  render(
    <DataTable
      rows={ROWS}
      columns={COLUMNS}
      exportColumns={EXPORT_COLUMNS}
      provenance={PROVENANCE}
      pageSize={5}
      onExport={onExport}
      {...props}
    />,
  );
  return { onExport };
}

describe("the shipped table", () => {
  it("shows a page, and says how much it is not showing", () => {
    setup();
    expect(screen.getByText(/Showing 5 of 12 rows/)).toBeTruthy();
  });

  it("renders the provenance header as part of the document", () => {
    setup();
    expect(screen.getByRole("heading", { name: "Holdings" })).toBeTruthy();
    expect(screen.getByText(/Family \(2 members\)/)).toBeTruthy();
  });

  it("shows every warning where the numbers are, not only in a log", () => {
    setup();
    // A warning must render where the numbers are, marked as a note so it is announced, not just styled.
    expect(screen.getByRole("note").textContent).toContain("Excludes Mum");
  });

  it("marks its own chrome as not-for-print", () => {
    const { container } = render(
      <DataTable
        rows={ROWS}
        columns={COLUMNS}
        exportColumns={EXPORT_COLUMNS}
        provenance={PROVENANCE}
        onExport={vi.fn()}
      />,
    );
    const buttons = container.querySelector('[data-print="hide"]');
    expect(buttons).toBeTruthy();
    // …and the header is NOT chrome: it must survive onto paper.
    expect(container.querySelector(".provenance")?.closest('[data-print="hide"]')).toBeNull();
  });
});

describe("export", () => {
  it("exports every filtered row, not the page on screen", () => {
    const { onExport } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Export CSV" }));

    const [csv, filename] = onExport.mock.calls[0] as [string, string];
    expect(filename).toBe("wealthlens-holdings.csv");
    expect(csv).toContain("Rows: 12");
    for (const row of ROWS) expect(csv).toContain(row.name);
  });

  it("carries the provenance and its warnings into the file", () => {
    const { onExport } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Export CSV" }));
    const csv = (onExport.mock.calls[0] as [string, string])[0];
    expect(csv).toContain("Scope: Family (2 members)");
    expect(csv).toContain("Warning: Excludes Mum: the store is missing");
  });
});

describe("print", () => {
  it("swaps to the whole filtered set when the browser starts printing", () => {
    // CSS cannot print a row the DOM does not contain, so a stylesheet alone would silently produce page
    // one. This is the half that actually satisfies "what leaves is the whole filtered set".
    setup();
    expect(screen.queryByText("Item 12")).toBeNull();

    fireEvent(window, new Event("beforeprint"));
    expect(screen.getByText("Item 12")).toBeTruthy();

    fireEvent(window, new Event("afterprint"));
    expect(screen.queryByText("Item 12")).toBeNull();
  });
});

describe("sorting, filtering and reaching the rest of the rows", () => {
  const setupPaged = () => {
    const onExport = vi.fn();
    render(
      <DataTable
        rows={ROWS}
        columns={COLUMNS}
        exportColumns={EXPORT_COLUMNS}
        provenance={PROVENANCE}
        pageSize={5}
        onExport={onExport}
      />,
    );
    return { onExport };
  };

  it("sorts when a column header is clicked, and says so to a screen reader", () => {
    setupPaged();
    const header = screen.getByRole("button", { name: /Sort by Instrument/ });
    fireEvent.click(header);
    expect(screen.getAllByRole("columnheader")[0]!.getAttribute("aria-sort")).toBe("ascending");
    fireEvent.click(header);
    expect(screen.getAllByRole("columnheader")[0]!.getAttribute("aria-sort")).toBe("descending");
  });

  it("filters across the table, and the count follows the filter", () => {
    setupPaged();
    fireEvent.change(screen.getByLabelText("Filter rows"), { target: { value: "Item 1" } });
    // "Showing N of M" must reflect the FILTER, or the number is describing a table nobody is looking at.
    expect(screen.getByText(/Showing \d+ of \d+ rows/).textContent).not.toContain("of 12 rows");
  });

  it("offers a way to reach the rows it is not showing", () => {
    // The defect this fixes: "Showing 50 of 113 rows" with no control to see the other 63.
    setupPaged();
    expect(screen.getByText("Showing 5 of 12 rows")).toBeTruthy();
    expect(screen.queryByText("Item 12")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText(/Page 2 of 3/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Previous" }).hasAttribute("disabled")).toBe(false);
  });

  it("stops at the ends rather than wrapping silently", () => {
    setupPaged();
    expect(screen.getByRole("button", { name: "Previous" }).hasAttribute("disabled")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByRole("button", { name: "Next" }).hasAttribute("disabled")).toBe(true);
  });

  it("lets a reader ask for every row at once", () => {
    setupPaged();
    fireEvent.change(screen.getByLabelText("Rows per page"), { target: { value: "100" } });
    expect(screen.getByText("Item 12")).toBeTruthy();
  });

  it("exports the whole filtered set regardless of the page on screen", () => {
    // Pagination is a view, never a slice of what leaves.
    const { onExport } = setupPaged();
    fireEvent.click(screen.getByRole("button", { name: "Export CSV" }));
    const csv = (onExport.mock.calls[0] as [string, string])[0];
    expect(csv).toContain("Rows: 12");
    expect(csv).toContain("Item 12");
  });

  it("hides its own controls from a printed page", () => {
    const { container } = render(
      <DataTable
        rows={ROWS}
        columns={COLUMNS}
        exportColumns={EXPORT_COLUMNS}
        provenance={PROVENANCE}
        pageSize={5}
        onExport={vi.fn()}
      />,
    );
    const pager = screen.getByText("Showing 5 of 12 rows").closest('[data-print="hide"]');
    expect(pager).toBeTruthy();
    expect(container.querySelector('input[type="search"]')?.closest('[data-print="hide"]')).toBeTruthy();
  });
});
