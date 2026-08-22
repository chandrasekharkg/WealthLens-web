import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

// Linting from the first commit rather than retrofitted. The rules below are the ones that catch real
// defects in this codebase's shape — a UI whose correctness is supposed to live in pure functions.
export default tseslint.config(
  { ignores: ["dist", "node_modules", "playwright-report", "test-results"] },
  js.configs.recommended,
  {
    // Type-aware rules apply to the app's TypeScript only. Config files (this one included) live outside
    // the type graph, and pointing typed rules at them fails before a single source file is read.
    files: ["**/*.{ts,tsx}"],
    extends: [...tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: { project: ["./tsconfig.json"], tsconfigRootDir: import.meta.dirname },
    },
    plugins: { "react-hooks": reactHooks, "react-refresh": reactRefresh },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],

      // Money and identifiers are modelled so a bare number cannot reach a component (data-conventions).
      // These rules are what stop that modelling being cast away rather than honoured.
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unsafe-assignment": "error",
      "@typescript-eslint/no-unsafe-member-access": "error",
      "@typescript-eslint/consistent-type-definitions": ["error", "type"],

      // A floating promise in a data-fetching UI is a silently missing number on screen.
      "@typescript-eslint/no-floating-promises": "error",
    },
  },
  {
    // E2E specs run under Playwright's own runner and are not part of the app's type graph.
    files: ["e2e/**/*.ts"],
    rules: { "@typescript-eslint/no-unsafe-call": "off" },
  },
);
