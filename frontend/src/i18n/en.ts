/**
 * The shipped message catalog.
 *
 * Every user-visible string lives here, not in a component (data-conventions). That is what makes a new
 * locale a file somebody hands us rather than a sweep through the UI — and it has a second effect worth
 * having: the wording of an honesty message is reviewable in one place, next to its siblings, instead of
 * scattered across the screens that happen to show it.
 */
export const en = {
  "app.name": "WealthLens",
  "app.tagline": "Your money, on your machine.",

  "nav.overview": "Overview",
  "nav.reports": "Reports",

  "overview.title": "Is this picture trustworthy right now?",
  "overview.netWorth": "Net worth",
  "overview.asOf": "as of {date}",
  "overview.noDate": "today",
  "overview.reportingIn": "in {currency}",
  "overview.membersTable": "Per member",

  "overview.trusted": "Everything declared is included and current.",
  "overview.partial": "This total is missing {count} of {total} members.",
  "overview.stale": "{count} member(s) are answering from older evidence.",

  "column.member": "Member",
  "column.total": "Total",
  "column.evidence": "Evidence to",
  "column.status": "Status",

  "status.ok": "Current",
  "status.excluded": "Not included",
  "status.stale": "Older evidence",

  "engine.missing": "WealthLens-core is not installed, so no store can be read.",
  "engine.detail": "Details: {detail}",

  "error.load": "Could not load this view.",
  "error.retry": "Try again",

  "empty.noEntities": "No family members are declared yet.",
  "empty.noData": "Nothing has been imported for this member yet.",
  "empty.filtered": "No rows match the current filter. {total} exist without it.",
  "empty.unavailable": "This cannot be shown: {reason}",

  "nav.import": "Import",

  "reports.title": "Reports",
  "reports.holdings": "Holdings",
  "reports.asOfLabel": "Show figures as of",
  "reports.apply": "Apply",
  "column.instrument": "Instrument",
  "column.identifier": "ISIN",
  "column.whose": "Whose",
  "column.units": "Units",
  "column.value": "Value",
  "column.basis": "Valued by",
  "identifier.none": "not applicable",

  "import.title": "Import statements",
  "import.chooseEntity": "For",
  "import.drop": "Choose statement files",
  "import.uploading": "Uploading {name}…",
  "import.uploaded": "{name} is in the inbox.",
  "import.renamed": "{name} was already there, so this one was kept as {saved}.",
  "import.run": "Import now",
  "import.running": "Importing…",
  "import.watch": "Progress",
  "import.verdict": "What WealthLens-core made of each file",
  "import.imported": "{count} imported",
  "import.attention": "{count} need attention",
  "import.nothingChanged": "Nothing was changed. {reason}",
  "import.refusedBy": "Refused at the {gate} check.",
  "import.failed": "That did not run: {reason}",
  "import.whereFrom": "Where do these come from?",
  "import.whereFromBody":
    "You download them yourself, from each institution: NSDL or CDSL for the consolidated demat statement, net-banking for accounts and cards, your broker's portal for contract notes. WealthLens never signs in to anything on your behalf.",

  "file.status.imported": "Imported",
  "file.status.locked": "Password needed",
  "file.status.unrecognized": "Not recognised",
  "file.status.skipped": "Skipped",
  "file.status.unknown": "Needs attention",
  "column.file": "File",
  "column.outcome": "Outcome",
  "column.rows": "Rows",
  "column.warnings": "Warnings",

  "table.export": "Export CSV",
  "table.print": "Print",
  "table.showing": "Showing {shown} of {total} rows",
} as const;

export type MessageKey = keyof typeof en;
