import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Custodian/presenter boundary (constitution #10) — the UI computes no reported money.
 *
 * This guards the 2026-08-24 regression class: the Performance charts had summed money for a headline total
 * and divided it for a share percent, in the browser. The bridge now pre-sums; the UI only renders. This is
 * NOT an exhaustive proof (mapping a Money to a pixel fraction — `Number(m.amount) / axisMax` — is legitimate
 * rendering and stays allowed); it bans the two shapes that actually regressed: summing money, and computing a
 * share percent. Reintroducing either fails here.
 */
const DIRS = ["src/screens", "src/components"];

const BANNED: [RegExp, string][] = [
  [/\.reduce\([^)]*\.(amount|value)\b/, "summing money (.reduce over .amount/.value) — pre-sum it in the bridge"],
  [/\(\s*100\s*\*[^)]*\)\s*\/\s*\w+/, "computing a share percent in the UI — the bridge sends `share`"],
];

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(path));
    else if (/\.tsx?$/.test(entry.name) && !/\.test\./.test(entry.name)) out.push(path);
  }
  return out;
}

describe("the UI computes no money (constitution #10)", () => {
  it("has no money-summation or share-percent computation in screens/components", () => {
    const offenders: string[] = [];
    for (const dir of DIRS) {
      for (const file of sourceFiles(dir)) {
        const src = readFileSync(file, "utf8");
        for (const [re, why] of BANNED) {
          if (re.test(src)) offenders.push(`${file}: ${why}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
