import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    // jsdom only where a component test needs it; the bulk of the suite is pure functions with no DOM
    // at all (ADR-0010), and those run faster and fail more informatively without one.
    environment: "node",
    environmentMatchGlobs: [["src/**/*.dom.test.{ts,tsx}", "jsdom"]],
    exclude: ["e2e/**", "node_modules/**"],
  },
});
