import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const resolver = fileURLToPath(
  new URL("../../.claude/skills/coordinate/resolve-uat-triggers.sh", import.meta.url)
);
const expected = "blocking\ttests/uat/specs/job-search-install.uat.spec.ts";

function resolve(path: string): string {
  const result = spawnSync("bash", [resolver], { input: `${path}\n`, encoding: "utf8" });
  expect(result.status).toBe(0);
  return result.stdout.trim();
}

describe("coordinate UAT trigger lookup (#1027/#1000)", () => {
  it("exists as a runnable lookup", () => {
    expect(existsSync(resolver)).toBe(true);
  });

  it.each([
    "packages/module-registry/src/distribution/extract.ts",
    "scripts/module-reconcile.ts",
    "scripts/start-jarv1s.ts",
    "apps/web/src/settings/settings-module-registry-section.tsx"
  ])("maps runtime path %s to the blocking job-search UAT", (path) => {
    if (!existsSync(resolver)) return;
    expect(resolve(path)).toBe(expected);
  });

  it("does not invent a UAT for an unmapped path", () => {
    if (!existsSync(resolver)) return;
    expect(resolve("README.md")).toBe("");
  });
});
