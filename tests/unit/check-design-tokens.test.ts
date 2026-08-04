import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  checkBannedProperties,
  MIGRATED_SECTION_CSS_FILES
} from "../../scripts/check-design-tokens.ts";

/**
 * Guard 4 regression test (#1388 Foundation, D2). The guard's own module-load self-test proves
 * the banned-property detector fires on a synthetic bad case; this file adds a real fixture tree
 * and the day-one-empty-list acceptance bar the spec sets: the guard must not red the tree before
 * any section has migrated.
 */

const fixtureRoots: string[] = [];

afterEach(async () => {
  await Promise.all(fixtureRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function buildFixture(cssContents: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "check-design-tokens-"));
  fixtureRoots.push(root);
  await mkdir(join(root, "apps/web/src/styles"), { recursive: true });
  await writeFile(join(root, "apps/web/src/styles/kit-example.css"), cssContents);
  return root;
}

describe("check-design-tokens banned-property guard (#1388 Foundation guard 4)", () => {
  it("flags a banned visual property in a migrated section's CSS file", async () => {
    const root = await buildFixture(".kit-example { background-color: #fff; }\n");

    const violations = await checkBannedProperties(root, ["apps/web/src/styles/kit-example.css"]);

    expect(violations).toHaveLength(1);
    expect(violations[0]?.property).toBe("background-color");
  });

  it("does not flag layout properties in a migrated section's CSS file", async () => {
    const root = await buildFixture(
      ".kit-example { position: relative; display: flex; gap: var(--space-2); }\n"
    );

    const violations = await checkBannedProperties(root, ["apps/web/src/styles/kit-example.css"]);

    expect(violations).toEqual([]);
  });

  it("does not flag a banned property in a file that is not in the migrated list", async () => {
    const root = await buildFixture(".kit-example { color: red; }\n");

    const violations = await checkBannedProperties(root, []);

    expect(violations).toEqual([]);
  });

  it("passes against the real repo tree with the real (currently empty) migrated-sections list", async () => {
    expect(MIGRATED_SECTION_CSS_FILES).toEqual([]);

    const repoRoot = join(import.meta.dirname, "../..");
    const violations = await checkBannedProperties(repoRoot);

    expect(violations).toEqual([]);
  });
});
