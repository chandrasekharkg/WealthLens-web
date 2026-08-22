# Export and print

Taking data out of the app — into a spreadsheet, or onto paper. One boundary, one set of rules
(ADR-0013), because the moment a figure leaves, every honesty cue around it stays behind.

## ADDED Requirements

### Requirement: Every table can be exported, and every report page can be printed

Export and print SHALL be properties of the shipped table and page components, not features added per
view. Any table the app renders — including one declared by an extension (ADR-0011) — SHALL offer export
without its author implementing anything.

#### Scenario: A new view is added
- **WHEN** a contributor adds a view using the shipped table
- **THEN** export and print work there with no additional code, and inherit the escaping and provenance
  rules below

### Requirement: What leaves is the whole filtered set, never the visible page

Export and print SHALL cover the complete set the user's current sort and filters select — not the
rendered page, and not a capped prefix. Where any part cannot be included, the artifact SHALL state that
in its own header rather than omitting it silently.

#### Scenario: A long table is exported while paginated
- **WHEN** a user exports a table showing page 1 of many
- **THEN** the file contains every row matching the active filters, in the active sort order

#### Scenario: Something genuinely cannot be included
- **WHEN** rows are unavailable to the client at export time
- **THEN** the artifact says how many rows it covers and that it is partial — a silent slice is a defect

### Requirement: Context travels with the data

Every exported file and every printed page SHALL carry a provenance header stating: scope (entity or
family), as-of date, reporting currency, the filters in effect, the source store and its schema version,
generation timestamp, and any warning currently attached to that scope (staleness, footing break,
incomplete units).

#### Scenario: A stale entity is exported
- **WHEN** a scope carrying a freshness or footing warning is exported or printed
- **THEN** that warning appears in the artifact's header, so the caveat survives the trip to a spreadsheet
  or a printout

#### Scenario: A printout is handed to someone outside the household
- **WHEN** a page is printed
- **THEN** a reader who has never seen the app can tell whose money it is, as of when, in what currency,
  and under what filters

#### Scenario: A family artifact spans several stores
- **WHEN** a family view is exported or printed
- **THEN** the header carries the **single** point-in-time date the view was computed at (ADR-0016), the
  reporting currency, which entities were unreachable, and which were answering from older evidence — never
  a list of competing as-of dates and never one date standing in for many

### Requirement: Money keeps its currency on the way out

Monetary values SHALL export with their currency, never as bare numbers (data-conventions). A total SHALL
appear in an artifact only where it was legitimate on screen; amounts in differing currencies SHALL NOT be
combined into one exported figure.

#### Scenario: A mixed-currency holdings table is exported
- **WHEN** the table spans currencies
- **THEN** each amount carries its currency, and any total is the reporting-currency figure with the
  reporting currency named

### Requirement: Exported cells cannot execute

Cell text SHALL be neutralized against spreadsheet formula injection: a value beginning `=`, `+`, `-`,
`@`, tab or carriage return SHALL be escaped so that Excel, Google Sheets and LibreOffice treat it as
text. This applies to all document-derived strings — narrations, instrument names, filenames.

#### Scenario: A statement narration begins with an equals sign
- **WHEN** a row whose description begins with `=` is exported
- **THEN** opening the file in a spreadsheet displays the literal text and evaluates nothing

### Requirement: The CSV is portable by default

Exports SHALL be UTF-8 **with a byte-order mark** (so Excel on Windows renders non-ASCII names correctly),
with dates as ISO 8601 so no spreadsheet reinterprets them by locale.

> Stated limitation: CSV carries no column types, so an identifier that looks numeric — a folio, an
> account number with leading zeros — may still be reinterpreted by the receiving application. This is the
> known cost of the format and the trigger for the XLSX graduation in ADR-0013, not a defect to work
> around with per-cell tricks.

#### Scenario: A name with non-ASCII characters is exported
- **WHEN** the file is opened in Excel on Windows
- **THEN** the name renders correctly rather than as mojibake

### Requirement: Printing uses the browser, and the print layout is designed

Print SHALL be the browser's own print path — no server-side PDF renderer and no second rendering path
(ADR-0013). The print stylesheet SHALL: print all rows rather than the paginated page; repeat table
headers on every page and avoid splitting a row across a break; omit navigation, buttons and filter
controls; force the light palette regardless of the active theme; number the pages; and where a wide table
cannot fit, drop columns **and name the dropped columns in the header**.

#### Scenario: A long table is printed
- **WHEN** a table spanning several pages is printed
- **THEN** every page carries the column headers, no row is split across a break, and no UI chrome appears

#### Scenario: The app is in dark theme
- **WHEN** a user prints while the dark theme is active
- **THEN** the output is light-on-white

#### Scenario: A chart is printed
- **WHEN** a page containing a chart is printed
- **THEN** the chart appears in the output

### Requirement: What leaves is computed by pure functions shared by both paths

Row selection, column selection, cell formatting, escaping and the provenance header SHALL be pure
functions used by both export and print, tested without a DOM (ADR-0010). Print SHALL NOT add an
end-to-end browser test — it does not meet ADR-0010's bar for a fourth flow.

#### Scenario: Escaping is proven without a spreadsheet
- **WHEN** the escaping function is tested
- **THEN** the hostile prefixes are asserted directly, with no file written and no application opened

### Requirement: Egress is recorded, without values

Each export or print SHALL be recorded in Activity as an event naming the scope, the view and the row
count — never any exported value.

#### Scenario: An export is recorded
- **WHEN** a user exports a holdings view
- **THEN** Activity shows that it happened, for which scope and how many rows, and contains no figures
