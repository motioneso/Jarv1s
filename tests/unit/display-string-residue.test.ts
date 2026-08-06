import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// Static regression guard for #1441 (Moss rename PR1 — display strings).
// The rename lane scoped its greps to `apps/web/src` and therefore MISSED six
// user/model-visible strings that live in `packages/` (app-map-core.ts and
// chat/manifest.ts). Those were hand-fixed; this test makes sure the miss can't
// silently come back. It is intentionally NOT a whole-file grep for "Jarvis":
// these files legitimately contain out-of-scope identifiers such as
// `JarvisModuleManifest`, and a naive whole-file assertion would fail on those
// forever, teaching everyone to ignore the guard. Instead it extracts only the
// `label:`/`description:` string literals — the actual shipped display-string
// surfaces — and checks those for a hardcoded "Jarvis" literal. Per the #1441
// rule, "Jarvis" must become either the product name (`Moss`) or a read of the
// user's configured assistant name (never a hardcoded assistant name).
const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../..");

// Matches `label: "..."` and `description: "..."`, including the multi-line
// form used in packages/chat/src/manifest.ts where the string literal is on
// the line after the colon (`\s` already spans the intervening newline).
const DISPLAY_STRING_PATTERN = /(?:label|description):\s*"((?:[^"\\]|\\.)*)"/g;

function extractDisplayStrings(source: string): string[] {
  return [...source.matchAll(DISPLAY_STRING_PATTERN)].map((match) => match[1]!);
}

describe("display-string residue (static) — #1441", () => {
  it("app-map-core.ts label/description literals carry no hardcoded Jarvis", () => {
    const path = resolve(here, "../../packages/shared/src/app-map-core.ts");
    const source = readFileSync(path, "utf8");
    const strings = extractDisplayStrings(source);

    // Sanity check: the extraction actually found the sections in this file,
    // so a regex that silently matches nothing can't pass this test by default.
    expect(strings.length).toBeGreaterThan(10);

    for (const value of strings) {
      expect(value, `display string must not hardcode "Jarvis": "${value}"`).not.toMatch(/Jarvis/i);
    }
  });

  it("chat manifest.ts label/description literals carry no hardcoded Jarvis", () => {
    const path = resolve(here, "../../packages/chat/src/manifest.ts");
    const source = readFileSync(path, "utf8");
    const strings = extractDisplayStrings(source);

    // The file legitimately contains `JarvisModuleManifest` (a type import/assertion)
    // outside of label/description literals — confirm the extraction is scoped
    // correctly by asserting that identifier is present in the raw source but did
    // not leak into the extracted display strings.
    expect(source).toContain("JarvisModuleManifest");
    expect(strings.length).toBeGreaterThan(5);

    for (const value of strings) {
      expect(value, `display string must not hardcode "Jarvis": "${value}"`).not.toMatch(/Jarvis/i);
    }
  });

  it("live-routes.ts evening interview trusted preamble carries no hardcoded Jarvis", () => {
    // The third #1441 packages/ miss: live-routes.ts:537 read "You are running
    // Jarvis's evening interview." inside buildEveningInterviewSeed's
    // trusted_instructions block. That string is not a label:/description:
    // literal, so DISPLAY_STRING_PATTERN can't see it — extract the block
    // directly, reusing the exact string-concatenated-literal regex idiom from
    // tests/unit/briefings-prompt-isolation.test.ts (which also asserts this
    // same block is a pure literal with zero interpolation).
    //
    // That "pure literal" invariant is exactly why this string can NEVER be
    // fixed by threading the assistant's configured name in — interpolating a
    // name here would reintroduce a non-literal trusted preamble and break the
    // prompt-isolation guard. Identity is supplied by the persona layer, which
    // unconditionally emits "Your name is X." elsewhere in the seed. The only
    // correct fix for a hardcoded name in this block is deletion, as already
    // done ("You are running the evening interview."). Do not "fix" a future
    // regression here by interpolating — that reopens the injection risk.
    const path = resolve(here, "../../packages/chat/src/live-routes.ts");
    const source = readFileSync(path, "utf8");

    const trustedMatch = source.match(
      /"<trusted_instructions>\\n" \+([\s\S]*?)"<\/trusted_instructions>/
    );
    expect(
      trustedMatch,
      "evening interview trusted_instructions block must be present"
    ).not.toBeNull();

    const trustedLiteral = trustedMatch![1]!;
    expect(
      trustedLiteral,
      `evening interview trusted preamble must not hardcode "Jarvis": "${trustedLiteral}"`
    ).not.toMatch(/Jarvis/i);
  });
});

/* The three tests above name individual files, which is how ~50 display strings survived the first
   pass of #1441: a residue check scoped to the files someone already thought of cannot find the
   ones they did not. The sweep below is scoped to a directory tree instead, so a newly added
   package is covered the day it appears rather than the day someone remembers to list it. */

const SOURCE_ROOTS = [resolve(repoRoot, "apps/web/src"), resolve(repoRoot, "packages")];

/* Spellings that are NOT display strings. Each is a repository-level identifier tracked separately
   by #1442-#1444, and most would corrupt data or break a wire contract if renamed here:
   - `<!-- jarvis:...` markers are written into users' real note files on disk; renaming orphans
     every marker in every existing vault.
   - `jarvis.*` localStorage keys hold the user's saved view, theme and colour mode; renaming
     silently discards every existing preference.
   - `jarvis-archive/v1` is stamped into every archive already exported; renaming makes those
     archives unreadable to a future importer that keys on the string.
   - `jarvis_*_runtime` are PostgreSQL roles, which are cluster-global.
   - `mcp__jarvis__*`, `jarvis.module.json`, `x-jarvis-*`, `virtual:jarvis-*` and the
     `Jarvis-*` HTTP user-agents are contracts with clients, the bundler, and third-party servers.
   - `data-jarvis-capture-text` is the page-context opt-in attribute (#1438).
   - `sql/0127_jarvis_*.sql` are applied migration filenames, which are hash-checked and can
     never be edited.
   Add to this list only with a reason, and only when the string genuinely never reaches a user. */
const NON_DISPLAY_SPELLINGS = [
  /@jarv1s\//,
  /[Jj]arvis[A-Z]/, // identifiers: JarvisModuleManifest, JarvisDatabase, jarvisPersonId
  /JsonJarvis/,
  /isJarvis|compareJarvis/,
  /JARVIS_/, // env vars and globals
  /virtual:jarvis-/,
  /x-jarvis-/,
  /data-jarvis-/,
  /mcp__jarvis__/, // MCP tool-name prefix
  /jarvis[._-]/, // storage keys, module ids, role names, filenames, format ids, bundle names
  /jarvis:[a-z]/, // event names and note markers: "jarvis:open-command-palette", "jarvis:people:start"
  /\.jarvis\b/, // dot-directory names: ".jarvis", ".jarvis/cli-tokens"
  /Jarvis-[A-Z]/, // outward network identity: Jarvis-Upgrade-Checker, Jarvis-WebResearch
  /^jarvis$/ // bare identifier: DB role, MCP server name
];

/* Walks the source once, returning the text of every string literal — double-quoted,
   single-quoted, and the literal chunks of a template. Three reasons this is a walker rather
   than the regex the file uses above:
   - It skips comments. Two comments legitimately quote the former name: a GitHub issue title in
     `apps/web/src/chat/page-context.ts`, and Ben's verbatim 2026-07-26 ruling in
     `packages/email/src/manifest.ts`. Editing a quotation to fit a rename falsifies the record,
     so the guard must not ask anyone to.
   - It sees single-quoted strings. Prettier switches to single quotes when a string contains a
     double quote, which is exactly what `TASKS_FIRST_RUN_NOTICE` does — a regex over `"..."`
     cannot see that string at all.
   - It sees templates. `` `Jarvis ${version} is available` `` is a shipped notification title.
   Inside `${...}` the walker skips to the matching brace and keeps whatever text it passes over;
   that text is expression source, not copy, so anything it contributes is an identifier the
   allowlist above already filters. Over-scanning is safe here; under-scanning is not. */
function extractStringLiterals(source: string): string[] {
  const out: string[] = [];
  let i = 0;

  while (i < source.length) {
    const ch = source[i]!;
    const next = source[i + 1];

    if (ch === "/" && next === "/") {
      const end = source.indexOf("\n", i);
      i = end === -1 ? source.length : end + 1;
    } else if (ch === "/" && next === "*") {
      const end = source.indexOf("*/", i + 2);
      i = end === -1 ? source.length : end + 2;
    } else if (ch === '"' || ch === "'") {
      let j = i + 1;
      let value = "";
      while (j < source.length && source[j] !== ch) {
        if (source[j] === "\\") {
          value += source[j + 1] ?? "";
          j += 2;
        } else if (source[j] === "\n") {
          break; // unterminated: not a literal, bail rather than swallow the file
        } else {
          value += source[j];
          j += 1;
        }
      }
      out.push(value);
      i = j + 1;
    } else if (ch === "`") {
      let j = i + 1;
      let value = "";
      while (j < source.length && source[j] !== "`") {
        if (source[j] === "\\") {
          value += source[j + 1] ?? "";
          j += 2;
        } else if (source[j] === "$" && source[j + 1] === "{") {
          let depth = 1;
          j += 2;
          while (j < source.length && depth > 0) {
            if (source[j] === "{") depth += 1;
            else if (source[j] === "}") depth -= 1;
            j += 1;
          }
        } else {
          value += source[j];
          j += 1;
        }
      }
      out.push(value);
      i = j + 1;
    } else {
      i += 1;
    }
  }

  return out;
}

function collectSourceFiles(dir: string, out: string[]): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist" || entry.name === "__tests__") {
        continue;
      }
      collectSourceFiles(full, out);
    } else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

describe("no product-name residue anywhere in shipped source (#1441)", () => {
  it("has no user-visible string that still says the former codename", () => {
    const files = SOURCE_ROOTS.flatMap((root) => collectSourceFiles(root, []));

    /* Guard against a vacuous pass: if the walker silently returned nothing — a moved directory, a
       renamed extension — every assertion below would trivially hold and the guard would read green
       while checking nothing at all. */
    expect(
      files.length,
      "source walk found no files; the roots above are probably wrong"
    ).toBeGreaterThan(200);

    const offenders: string[] = [];
    let stringsScanned = 0;

    for (const file of files) {
      const source = readFileSync(file, "utf8");
      if (!/jarvis/i.test(source)) continue;

      for (const literal of extractStringLiterals(source)) {
        stringsScanned += 1;
        if (!/jarvis/i.test(literal)) continue;
        if (NON_DISPLAY_SPELLINGS.some((pattern) => pattern.test(literal))) continue;
        offenders.push(`${relative(repoRoot, file)}: "${literal}"`);
      }
    }

    expect(stringsScanned, "scanned no string literals at all").toBeGreaterThan(1000);

    expect(
      offenders,
      [
        "These strings still name the former codename and reach a user.",
        "Classify each one, then fix it — do not find-and-replace:",
        '  product (the software, its version, its boundary) -> the literal "Moss"',
        "  assistant (it drafts, schedules, reads, asks for the user) -> useAssistantName() where a",
        '    hook can be called, otherwise the generic noun "your assistant"',
        "  identifier (never reaches a user) -> add it to NON_DISPLAY_SPELLINGS with a reason",
        "Never fix a failure here by interpolating a name into a <trusted_instructions> block.",
        ""
      ].join("\n")
    ).toEqual([]);
  });
});
