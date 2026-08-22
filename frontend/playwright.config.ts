import { defineConfig } from "@playwright/test";

// ADR-0010 caps browser tests at three flows, and each is here because a WRONG outcome is unrecoverable
// or dangerous — not because the flow is important. Adding a fourth requires justifying why no cheaper
// layer can catch that failure. Playwright, not Selenium.
export default defineConfig({
  testDir: "./e2e",
  forbidOnly: !!process.env.CI,
  use: { baseURL: "http://127.0.0.1:7788" },
});
