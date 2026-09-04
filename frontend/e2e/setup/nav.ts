import type { Page } from "@playwright/test";

/**
 * Open one of the operations screens (Import / Operations / Raw parse / Activity).
 *
 * The header groups them under a single "Operation Detail ▾" tab; the per-screen buttons live in a
 * sub-navigation that only renders once that group is entered. A spec that clicks "Operations" straight
 * from the header waits forever for a button that is not there — which is exactly how the daily e2e run
 * went red for the first time on 2026-09-05, after the nav was regrouped.
 */
export async function openOperationsTab(page: Page, name: "Import" | "Operations" | "Raw parse" | "Activity") {
  await page.getByRole("button", { name: /^Operation Detail/ }).click();
  await page.getByRole("navigation", { name: "Operation Detail" }).getByRole("button", { name, exact: true }).click();
}
