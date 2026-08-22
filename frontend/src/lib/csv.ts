/**
 * Taking a table out of the app.
 *
 * Pure: rows in, a string out. No DOM, no download, no clipboard — so every rule below is asserted by
 * calling a function, which is the whole reason egress lives here rather than inside a button handler
 * (ADR-0010).
 *
 * What it must get right, from the export-and-print spec:
 *
 * - the **whole** filtered set, never the rendered page — enforced by the caller passing the full set,
 *   and by `rowCount` in the header making a slice visible if one ever happened;
 * - **context travels with the data**: the provenance header, composed by the bridge, sits above the rows;
 * - **money keeps its currency**, never a bare number;
 * - **nothing that leaves can execute**.
 */

/** A cell's value as it arrives from the API. Money is `{amount, currency}`; everything else is scalar. */
export type Cell = string | number | boolean | null | undefined | { amount: string; currency: string };

export type Column<Row> = {
  /** The header text. Already translated by the caller — this module does no i18n. */
  readonly header: string;
  readonly value: (row: Row) => Cell;
};

export type ProvenanceHeader = {
  readonly title: string;
  readonly scope: string;
  readonly as_of?: string | null;
  readonly reporting_currency: string;
  readonly stores?: readonly string[];
  readonly filters?: readonly string[];
  readonly warnings?: readonly string[];
  readonly row_count?: number | null;
};

/**
 * Prefixes that make a spreadsheet treat a cell as a formula rather than as text.
 *
 * This is a real attack surface, not hygiene: statement narrations and instrument names come from PDFs
 * nobody here wrote, and the target is the household's own spreadsheet application. A narration beginning
 * `=` would be evaluated by Excel, Sheets and LibreOffice alike.
 */
const FORMULA_PREFIXES = ["=", "+", "-", "@", "\t", "\r"];

function neutralize(text: string): string {
  // A leading apostrophe is the mitigation every major spreadsheet honours: the cell is read as text and
  // the apostrophe itself is not part of the value.
  return FORMULA_PREFIXES.some((p) => text.startsWith(p)) ? `'${text}` : text;
}

function quote(text: string): string {
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function render(cell: Cell): string {
  if (cell === null || cell === undefined) return "";
  if (typeof cell === "object" && "amount" in cell) {
    // Money never leaves as a bare number: the currency travels in its own column (see `moneyColumns`).
    return cell.amount;
  }
  if (typeof cell === "boolean") return cell ? "true" : "false";
  return String(cell);
}

export function escapeCell(cell: Cell): string {
  return quote(neutralize(render(cell)));
}

/**
 * Expand a money column into value + currency, so an amount is never separated from its unit by a
 * spreadsheet user sorting or deleting a column.
 */
export function moneyColumns<Row>(
  header: string,
  value: (row: Row) => { amount: string; currency: string } | null | undefined,
): Column<Row>[] {
  return [
    { header, value: (row) => value(row) ?? null },
    { header: `${header} currency`, value: (row) => value(row)?.currency ?? null },
  ];
}

function headerLines(p: ProvenanceHeader, rowsExported: number): string[] {
  const lines = [
    `WealthLens — ${p.title}`,
    `Scope: ${p.scope}`,
    `As of: ${p.as_of ?? "not specified"} · Reporting currency: ${p.reporting_currency}`,
  ];
  if (p.filters?.length) lines.push(`Filters: ${p.filters.join(" · ")}`);
  if (p.stores?.length) lines.push(`Stores: ${p.stores.join(", ")}`);
  for (const warning of p.warnings ?? []) lines.push(`Warning: ${warning}`);
  // Stating both numbers is what makes a silent slice impossible to hide: if they ever disagree, the
  // artifact says so rather than reading as "everything".
  const claimed = p.row_count ?? rowsExported;
  lines.push(
    claimed === rowsExported
      ? `Rows: ${rowsExported}`
      : `Rows: ${rowsExported} of ${claimed} — THIS EXPORT IS PARTIAL`,
  );
  return lines;
}

export type CsvOptions = {
  /** Prepend a byte-order mark so Excel on Windows renders non-ASCII names instead of mojibake. */
  readonly bom?: boolean;
};

export function toCsv<Row>(
  rows: readonly Row[],
  columns: readonly Column<Row>[],
  provenance: ProvenanceHeader,
  options: CsvOptions = {},
): string {
  const out: string[] = [];
  // The header is comment-like but written as ordinary single-column rows: CSV has no comment syntax, and
  // a reader who opens this in a spreadsheet should SEE the context rather than have it hidden.
  for (const line of headerLines(provenance, rows.length)) out.push(escapeCell(line));
  out.push("");
  out.push(columns.map((c) => escapeCell(c.header)).join(","));
  for (const row of rows) out.push(columns.map((c) => escapeCell(c.value(row))).join(","));

  const body = out.join("\r\n") + "\r\n"; // CRLF: what every spreadsheet expects from a .csv
  return (options.bom ?? true) ? `\uFEFF${body}` : body;
}
