import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test } from "@playwright/test";

import { openOperationsTab } from "./setup/nav";

/**
 * Upload → import → a number appears.
 *
 * One of exactly THREE sanctioned browser tests (ADR-0010). It is here because a wrong outcome is
 * unrecoverable or dangerous, not because the flow is important: this is the only test that proves the
 * whole custody chain works end to end — a file the browser sent reaches a real WealthLens-core import,
 * and the figure it produces reaches the screen. Every layer below is asserted more cheaply elsewhere;
 * nothing below can prove they are wired together.
 *
 * The fixture is a hand-authored `real_estate.json` — an overlay the engine genuinely ingests, PII-free,
 * and safe to commit. A synthetic PDF would not parse, and a real statement could not be committed.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));   // ESM: no __dirname
const FIXTURE = path.join(HERE, "fixtures", "real_estate.json");
const ACQ_COST = "25,00,000"; // pii-ok — the fixture's own invented figure, grouped for en-IN

test("a statement uploaded in the browser becomes a figure on the dashboard", async ({ page }) => {
  await page.goto("/");

  // A brand-new workspace holds nothing. Establishing that FIRST is what makes the later assertion mean
  // something: without it, a stale figure from a previous run would pass.
  await expect(page.getByRole("heading", { name: /trustworthy/i })).toBeVisible();
  await expect(page.getByTestId("net-worth-total")).not.toContainText(ACQ_COST);

  await openOperationsTab(page, "Import");
  // the dropzone label IS the file input's label (Import.tsx `htmlFor="files"`)
  await page.getByLabel("Drop statements here, or click to choose").setInputFiles(FIXTURE);
  await expect(page.getByText(/is in the inbox/)).toBeVisible();

  await page.getByRole("button", { name: "Import now" }).click();

  // The engine's own verdict, rendered verbatim — and the file must be reported as imported rather than
  // merely "handled".
  const verdict = page.getByRole("table");
  await expect(verdict).toBeVisible({ timeout: 45_000 });
  await expect(verdict).toContainText("real_estate.json");
  await expect(verdict).toContainText("Imported");

  await page.getByRole("button", { name: "Overview" }).click();
  await expect(page.getByTestId("net-worth-total")).toContainText(ACQ_COST);
});
