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

  "nav.operations": "Operations",

  "ops.title": "Operations",
  "ops.workspace": "Workspace",
  "ops.schema": "Schema",
  "ops.availability": "Store",
  "ops.rebuild": "Rebuild",
  "ops.rebuilding": "Rebuilding…",
  "ops.rebuildWhy":
    "Replays every source document into a fresh store beside the live one, and tallies the two. Nothing is replaced until you promote.",
  "ops.tally": "What a rebuild would change",
  "ops.tallyTable": "Table",
  "ops.tallyCurrent": "Live",
  "ops.tallyRebuilt": "Rebuilt",
  "ops.tallyDelta": "Difference",
  "ops.noChange": "No differences — the live store already matches its sources.",
  "ops.regressions": "{count} table(s) reproduced FEWER rows. That is how a parser gap looks — investigate before promoting.",
  "ops.promote": "Promote this rebuild",
  "ops.promoteWarning":
    "This replaces {label}'s live store. It cannot be undone. The previous store is kept as a backup.",
  "ops.confirmLabel": "Type {id} to confirm",
  "ops.promoted": "Promoted. {label}'s store is now the rebuilt one.",
  "ops.needsRebuild": "Rebuild first, and read the tally — there is nothing to promote until you have.",

  "activity.title": "Activity",
  "activity.forgotten":
    "Jobs are remembered only while the app is running, so this list is empty after a restart. Your stores are unaffected: a rebuild never touches the live one, and promotion is atomic.",
  "activity.none": "Nothing has run in this session.",

  "nav.workspace": "Workspace",
  "nav.activity": "Activity",

  "ws.title": "Workspace",
  "ws.where": "Where this store lives",
  "ws.schema": "Schema {version}",
  "ws.collateral": "What this store was built from",
  "ws.noDocuments": "Nothing has been imported into this workspace yet.",
  "ws.settings": "Identity and passwords",
  "ws.settingsWhere": "These belong to this workspace alone. Editing saves to {path}.",
  "ws.holderNames": "Name as it appears on statements",
  "ws.pan": "PAN",
  "ws.panSet": "Set — stored in its own file, never shown here.",
  "ws.panUnset": "Not set. It unlocks CAS and many statements.",
  "ws.panPlaceholder": "Enter to replace",
  "ws.organize": "Tidy the inbox after import",
  "ws.ring": "Statement passwords",
  "ws.ringEmpty": "None configured. Import will ask when a file is locked.",
  "ws.addSecret": "Add a password",
  "ws.secretName": "Name",
  "ws.secretValue": "Password",
  "ws.save": "Save",
  "ws.saved": "Saved.",

  "column.document": "Document",
  "column.opensWith": "Opens with",
  "password.named": "{name}",
  "password.unnamed": "an unnamed password",
  "password.none": "nothing has opened it",

  "secret.copy": "Copy",
  "secret.copied": "Copied — it will not be shown here.",
  "secret.copyFailed": "Could not reach the clipboard. {reason}",
  "secret.keyNever":
    "Your store key is never shown here. It cannot be re-obtained, so it stays in its file — back that file up.",

  "locked.title": "This file needs a password",
  "locked.name": "Call it",
  "locked.value": "Password",
  "locked.save": "Save and try again",
  "locked.explain":
    "It is kept in its own file and tried against future statements too. WealthLens-core proves it worked by opening the file — nothing here reads your statement.",
  "locked.retrying": "Trying again…",

  "reports.pick": "Reports",
  "reports.sectionTotal": "{count} · {total}",
  "reports.sectionEmpty": "Nothing in this group.",
  "reports.excludedHeading": "Not included",

  "table.filter": "Filter rows",
  "table.filterPlaceholder": "Type to narrow…",
  "table.prev": "Previous",
  "table.next": "Next",
  "table.page": "Page {page} of {pages}",
  "table.sortBy": "Sort by {column}",
  "table.perPage": "Rows per page",
  "table.allRows": "All",

  "table.export": "Export CSV",
  "table.print": "Print",
  "table.showing": "Showing {shown} of {total} rows",
} as const;

export type MessageKey = keyof typeof en;
