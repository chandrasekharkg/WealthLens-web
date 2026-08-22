import { defineConfig } from "@playwright/test";

/**
 * ADR-0010 caps browser tests at three flows, and each is here because a WRONG outcome is unrecoverable
 * or dangerous — not because the flow is important. Adding a fourth requires justifying why no cheaper
 * layer can catch that failure. Playwright, not Selenium.
 *
 * These run on demand (`npm run e2e`) and once a day in CI — never in the push hook, where they would be
 * too slow to keep. The bridge is started here against a THROWAWAY workspace built by globalSetup, so a
 * run never touches a household's real stores.
 */
const PORT = 7799; // deliberately not the app's usual 7788, so a run cannot collide with a live instance

export default defineConfig({
  testDir: "./e2e",
  testIgnore: ["**/setup/**", "**/fixtures/**"],
  globalSetup: "./e2e/setup/global-setup.ts",
  forbidOnly: !!process.env.CI,
  timeout: 60_000,
  use: { baseURL: `http://127.0.0.1:${PORT}` },
  webServer: {
    command: [
      "cd .. &&",
      "PYTHONPATH=bridge",
      `WLW_MANIFEST=frontend/e2e/.tmp/family.toml`,
      // The app must believe it is on the port uvicorn binds, or the Host check refuses everything.
      `WLW_HOST=127.0.0.1 WLW_PORT=${PORT}`,
      ".venv/bin/python -m uvicorn wealthlens_web.serve:app",
      `--host 127.0.0.1 --port ${PORT}`,
    ].join(" "),
    url: `http://127.0.0.1:${PORT}/api/version`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
