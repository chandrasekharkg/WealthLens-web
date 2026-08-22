import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// This package is ESM, where __dirname does not exist.
const HERE = path.dirname(fileURLToPath(import.meta.url));

/**
 * Build the throwaway workspace before the server starts, and fail loudly if the engine is absent.
 *
 * A silent skip here would turn "WealthLens-core is not installed" into "the end-to-end flow passes",
 * which is the one result this suite must never produce.
 */
export default function globalSetup() {
  const frontend = path.resolve(HERE, "..", "..");
  const repo = path.resolve(frontend, "..");
  const python = path.join(repo, ".venv", "bin", "python");

  if (!existsSync(python)) {
    throw new Error(
      `no interpreter at ${python} — run: python -m venv .venv && .venv/bin/pip install -e "bridge[dev]"`,
    );
  }

  const built = execFileSync(python, [path.join(frontend, "e2e", "setup", "workspace.py")], {
    encoding: "utf8",
    env: { ...process.env, PYTHONPATH: path.join(repo, "bridge") },
    // stdin closed, always: anything that decides to prompt must fail fast rather than hang a CI run.
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 120_000,
  }).trim();

  if (!existsSync(built)) throw new Error(`the workspace was not created at ${built}`);
}
