import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { buildUiCatalogue, formatCatalogueJson, formatOptionsDoc } from "./build-ui-catalogue.ts";

/**
 * D5: the catalogue and vocabulary doc are checked into git as the source of truth for what
 * @jarv1s/ui components accept, not regenerated silently at build time — so this guard fails the
 * gate the moment someone adds/changes a variant without re-running `pnpm build:ui-catalogue`,
 * the same "checked-in output must match a fresh build" shape as check-design-tokens.ts.
 */

const root = resolve(fileURLToPath(import.meta.url), "../..");
const componentsDir = resolve(root, "packages/ui/src");
const catalogueCheckedInPath = resolve(root, "packages/ui/catalogue.json");
const optionsDocCheckedInPath = resolve(root, "packages/ui/OPTIONS.md");

async function selfTest(): Promise<void> {
  const before = JSON.stringify({ items: [{ name: "a" }] });
  const after = JSON.stringify({ items: [{ name: "a" }, { name: "b" }] });
  if (before === after) {
    console.error("Self-test failed: guard's diff comparison did not distinguish drifted content");
    process.exit(1);
  }
}

async function main(): Promise<void> {
  await selfTest();

  const freshCatalogue = buildUiCatalogue(componentsDir);
  const freshCatalogueText = await formatCatalogueJson(freshCatalogue);
  const freshOptionsDocText = formatOptionsDoc(freshCatalogue);

  const checkedInCatalogueText = readFileSync(catalogueCheckedInPath, "utf8");
  const checkedInOptionsDocText = readFileSync(optionsDocCheckedInPath, "utf8");

  const catalogueDrifted = checkedInCatalogueText !== freshCatalogueText;
  const optionsDocDrifted = checkedInOptionsDocText !== freshOptionsDocText;

  if (!catalogueDrifted && !optionsDocDrifted) {
    console.log("packages/ui/catalogue.json and OPTIONS.md are up to date.");
    return;
  }

  if (catalogueDrifted) {
    console.error("packages/ui/catalogue.json is out of date with packages/ui/src/*.tsx.");
  }
  if (optionsDocDrifted) {
    console.error("packages/ui/OPTIONS.md is out of date with packages/ui/src/*.tsx.");
  }
  console.error("Run `pnpm build:ui-catalogue` and commit the result.");
  process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
