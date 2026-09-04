import { expect, test } from "@playwright/test";

import { openOperationsTab } from "./setup/nav";

/**
 * Promotion is unreachable without its completed check (ADR-0005/0006).
 *
 * One of exactly THREE sanctioned browser tests (ADR-0010), and it is here for the strongest reason any of
 * them has: promotion replaces a household's live store and cannot be undone.
 *
 * It asserts the guard from BOTH sides, and the second is the load-bearing one. The UI must not offer
 * promotion before a rebuild has produced a tally — but a disabled button is not a guard, because anything
 * that can reach the endpoint can ignore it. So the test also fires the request directly, past the UI
 * entirely, and requires the server to refuse.
 */

test("promotion cannot be reached, or requested, without a reviewed rebuild", async ({ page, request }) => {
  await page.goto("/");
  await openOperationsTab(page, "Operations");

  // 1. The UI does not offer it. There is no confirmation field to fill in, because there is nothing to
  //    have agreed to.
  await expect(page.getByText(/Rebuild first, and read the tally/)).toBeVisible();
  await expect(page.getByLabel(/Type .* to confirm/)).toHaveCount(0);

  // 2. The server refuses it anyway. This is the assertion that matters: it holds for any caller, not
  //    only for one that renders our buttons.
  const token = await page.locator('meta[name="wlw-token"]').getAttribute("content");
  const refused = await request.post("/api/jobs", {
    headers: { "x-wlw-token": token ?? "", origin: page.url().replace(/\/$/, "") },
    data: { verb: "promote", entity: "e2e", confirm: "e2e" },
  });
  expect(refused.status()).toBe(409);
  expect(await refused.text()).toContain("nothing has been rebuilt");
});

test("a rebuild makes promotion available, and the confirmation still has to be typed", async ({ page }) => {
  await page.goto("/");
  await openOperationsTab(page, "Operations");
  await page.getByRole("button", { name: "Rebuild" }).click();

  const confirm = page.getByLabel("Type e2e to confirm");
  await expect(confirm).toBeVisible({ timeout: 45_000 });
  await expect(page.getByText(/cannot be undone/)).toBeVisible();

  const promote = page.getByRole("button", { name: "Promote this rebuild" });
  await expect(promote).toBeDisabled();

  await confirm.fill("e2");
  await expect(promote).toBeDisabled();

  await confirm.fill("e2e");
  await expect(promote).toBeEnabled();
});
