import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// jsdom only where a component test needs it; the bulk of the suite is pure functions with no DOM at all
// (ADR-0010), and those run faster and fail more informatively without one. Vitest 3 deprecated (and 4 removed)
// `environmentMatchGlobs`, which drew that line by filename; `projects` draws the same line: `*.dom.test.*` → jsdom,
// every other `*.test.*` → node.
const DOM_TESTS = "src/**/*.dom.test.{ts,tsx}";

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    projects: [
      {
        extends: true,
        test: {
          name: "node",
          environment: "node",
          include: ["src/**/*.test.{ts,tsx}"],
          exclude: [DOM_TESTS, "e2e/**", "node_modules/**"],
        },
      },
      {
        extends: true,
        test: { name: "dom", environment: "jsdom", include: [DOM_TESTS] },
      },
    ],
  },
});
