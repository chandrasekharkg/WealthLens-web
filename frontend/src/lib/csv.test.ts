import { describe, expect, it } from "vitest";

import { type Column, escapeCell, moneyColumns, type ProvenanceHeader, toCsv } from "./csv";

type Row = { name: string; value: { amount: string; currency: string }; qty: number | null };

const PROVENANCE: ProvenanceHeader = {
  title: "Holdings",
  scope: "Family (2 members)",
  as_of: "2026-07-31",
  reporting_currency: "INR",
  stores: ["alpha-WealthLens-data", "beta-WealthLens-data"],
  filters: ["class in (equity)"],
  warnings: [],
  row_count: 2,
};

const ROWS: Row[] = [
  { name: "A Share", value: { amount: "1000.00", currency: "INR" }, qty: 10 },
  { name: "A Deposit", value: { amount: "2500.50", currency: "INR" }, qty: null },
];

const COLUMNS: Column<Row>[] = [
  { header: "Instrument", value: (r) => r.name },
  ...moneyColumns<Row>("Value", (r) => r.value),
  { header: "Units", value: (r) => r.qty },
];

const lines = (csv: string) => csv.replace(/^\uFEFF/, "").split("\r\n");
/** A cell as a spreadsheet would read it: outer CSV quoting removed, escaped quotes unescaped. */
const unquote = (cell: string) =>
  cell.startsWith('"') && cell.endsWith('"') ? cell.slice(1, -1).replace(/""/g, '"') : cell;
const headerRow = (csv: string) => lines(csv).find((l) => l.startsWith("Instrument"))!;
const bodyRows = (csv: string) => {
  const all = lines(csv).filter(Boolean);
  return all.slice(all.indexOf(headerRow(csv)) + 1);
};

describe("formula injection", () => {
  it.each(["=", "+", "-", "@", "\t", "\r"])(
    "neutralises a cell beginning %j so a spreadsheet reads it as text",
    (prefix) => {
      // Narrations come from PDFs nobody here wrote, and the target is the household's own spreadsheet.
      // \r also forces CSV quoting, so compare what a spreadsheet actually sees, not the raw field.
      expect(unquote(escapeCell(`${prefix}SUM(A1:A9)`)).startsWith("'")).toBe(true);
      expect(unquote(escapeCell(`${prefix}cmd|' /c calc'!A1`)).startsWith("'")).toBe(true);
    },
  );

  it("leaves ordinary text alone", () => {
    expect(escapeCell("UPI/ATOM/123")).toBe("UPI/ATOM/123");
  });

  it("still quotes a neutralised cell that also contains a comma", () => {
    const got = escapeCell("=A1,B2");
    expect(got).toBe(`"'=A1,B2"`);
  });
});

describe("csv mechanics", () => {
  it("quotes commas, quotes and newlines", () => {
    expect(escapeCell("a,b")).toBe('"a,b"');
    expect(escapeCell('say "hi"')).toBe('"say ""hi"""');
    expect(escapeCell("two\nlines")).toBe('"two\nlines"');
  });

  it("writes a BOM by default so Excel on Windows shows Indian names correctly", () => {
    expect(toCsv(ROWS, COLUMNS, PROVENANCE).startsWith("\uFEFF")).toBe(true);
    expect(toCsv(ROWS, COLUMNS, PROVENANCE, { bom: false }).startsWith("\uFEFF")).toBe(false);
  });

  it("uses CRLF, which is what a .csv reader expects", () => {
    expect(toCsv(ROWS, COLUMNS, PROVENANCE)).toContain("\r\n");
  });

  it("renders an absent value as empty rather than as the word null", () => {
    expect(escapeCell(null)).toBe("");
    expect(escapeCell(undefined)).toBe("");
  });
});

describe("money", () => {
  it("never leaves as a bare number — the currency gets its own column", () => {
    const csv = toCsv(ROWS, COLUMNS, PROVENANCE);
    expect(headerRow(csv)).toBe("Instrument,Value,Value currency,Units");
    expect(bodyRows(csv)[0]).toBe("A Share,1000.00,INR,10");
  });

  it("keeps the exact decimal the bridge sent", () => {
    // A JSON number would have been an IEEE double; the string crosses the wire exactly and must survive.
    expect(toCsv(ROWS, COLUMNS, PROVENANCE)).toContain("2500.50");
  });
});

describe("the provenance header", () => {
  it("puts the scope, date and currency above the rows", () => {
    const out = lines(toCsv(ROWS, COLUMNS, PROVENANCE));
    expect(out[0]).toBe("WealthLens — Holdings");
    expect(out[1]).toBe("Scope: Family (2 members)");
    expect(out[2]).toContain("As of: 2026-07-31");
    expect(out[2]).toContain("Reporting currency: INR");
  });

  it("carries every warning, so a caveat survives the trip to a spreadsheet", () => {
    const csv = toCsv(ROWS, COLUMNS, {
      ...PROVENANCE,
      warnings: ["Excludes Mum: the store is missing", "Dad: evidence only to 2026-02-28"],
    });
    expect(csv).toContain("Warning: Excludes Mum: the store is missing");
    expect(csv).toContain("Warning: Dad: evidence only to 2026-02-28");
  });

  it("states the row count so a full export reads as full", () => {
    expect(toCsv(ROWS, COLUMNS, PROVENANCE)).toContain("Rows: 2");
  });

  it("says PARTIAL when fewer rows were written than the view claimed", () => {
    // The classic defect in this feature is exporting page 1 while reading as "everything". Stating both
    // numbers makes a slice impossible to hide.
    const csv = toCsv(ROWS.slice(0, 1), COLUMNS, { ...PROVENANCE, row_count: 2 });
    expect(csv).toContain("Rows: 1 of 2 — THIS EXPORT IS PARTIAL");
  });

  it("says the date is unspecified rather than printing an empty one", () => {
    expect(toCsv(ROWS, COLUMNS, { ...PROVENANCE, as_of: null })).toContain("As of: not specified");
  });
});

describe("the whole set", () => {
  it("writes one row per input row, in the order given", () => {
    const body = bodyRows(toCsv(ROWS, COLUMNS, PROVENANCE));
    expect(body).toHaveLength(2);
    expect(body[0]).toContain("A Share");
    expect(body[1]).toContain("A Deposit");
  });

  it("handles an empty table without pretending it had content", () => {
    const csv = toCsv([], COLUMNS, { ...PROVENANCE, row_count: 0 });
    expect(csv).toContain("Rows: 0");
    expect(lines(csv).filter((l) => l.includes("A Share"))).toHaveLength(0);
  });
});
