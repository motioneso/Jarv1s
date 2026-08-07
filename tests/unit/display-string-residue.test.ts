import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  extractStringLiterals,
  FILE_SCOPED_EXCEPTIONS,
  isAllowedNonDisplaySpelling,
  isFileScopedException,
  NON_DISPLAY_SPELLINGS
} from "./helpers/display-string-guard.js";

// Static regression guard for #1441 (Moss rename PR1 — display strings).
// The rename lane scoped its greps to `apps/web/src` and therefore MISSED six
// user/model-visible strings that live in `packages/` (app-map-core.ts and
// chat/manifest.ts). Those were hand-fixed; this test makes sure the miss can't
// silently come back. It is intentionally NOT a whole-file grep for "Jarvis":
// these files legitimately contain out-of-scope identifiers such as
// `MossModuleManifest`, and a naive whole-file assertion would fail on those
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

describe("display-string residue (static) — #1441 / #1456", () => {
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

    // The file legitimately contains `MossModuleManifest` (a type import/assertion)
    // outside of label/description literals — confirm the extraction is scoped
    // correctly by asserting that identifier is present in the raw source but did
    // not leak into the extracted display strings.
    expect(source).toContain("MossModuleManifest");
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

  it("data-export-async-routes.ts JSON download filename carries no hardcoded Jarvis", () => {
    // #1456: the user's JSON data-export download filename is a `const filename = \`...\`;`
    // template literal, not a label:/description: field, so DISPLAY_STRING_PATTERN can't see it,
    // and it is not swallowed by the narrowed NON_DISPLAY_SPELLINGS below because it ends in a
    // file-extension shape (see display-string-guard.ts). The file has TWO `const filename = ...`
    // template literals (the wellness HTML export's is first) — anchor on the `date` identifier
    // used only by the JSON branch so this test targets the right one. It fails against the
    // pre-#1456 source, which read `jarvis-export-${date}.json`.
    const path = resolve(here, "../../packages/settings/src/data-export-async-routes.ts");
    const source = readFileSync(path, "utf8");

    const filenameMatch = source.match(/const filename = `([^`]*\$\{date\}[^`]*)`;/);
    expect(filenameMatch, "JSON export filename literal must be present").not.toBeNull();

    const filenameLiteral = filenameMatch![1]!;
    expect(
      filenameLiteral,
      `JSON export download filename must not hardcode "Jarvis": "${filenameLiteral}"`
    ).not.toMatch(/Jarvis/i);
  });

  it("plaid.ts link token client_name carries no hardcoded Jarvis", () => {
    // #1456: `client_name` is rendered inside Plaid Link's own dialog, mid-flow, while the user is
    // connecting a bank account. Confirmed via Plaid's /link/token/create docs that client_name is
    // free-form Link display text (max 30 chars) with no Plaid Dashboard registration requirement,
    // so renaming it carries no external-dependency risk. This test fails against the pre-#1456
    // source, which read `client_name: "Jarvis"`.
    const path = resolve(here, "../../external-modules/finance/src/adapters/plaid.ts");
    const source = readFileSync(path, "utf8");

    const clientNameMatch = source.match(/client_name:\s*"([^"]*)"/);
    expect(clientNameMatch, "client_name literal must be present").not.toBeNull();

    const clientNameLiteral = clientNameMatch![1]!;
    expect(
      clientNameLiteral,
      `Plaid Link client_name must not hardcode "Jarvis": "${clientNameLiteral}"`
    ).not.toMatch(/Jarvis/i);
  });
});

describe("display-string residue guard classification (unit) — #1456", () => {
  // Direct unit tests of the NON_DISPLAY_SPELLINGS patterns themselves, independent of what the
  // live source tree currently contains. The prior guard allowlisted the whole `/jarvis[._-]/`
  // class — broad enough that its own comment named "filenames" among the internal identifiers it
  // was meant to exempt, which is exactly how the #1456 export filename survived tier A. Run
  // against that prior pattern, the first assertion below fails: the literal below is allowlisted
  // when it must be flagged. That is the guard's teeth.
  it("flags a user-visible filename shape as an offender, not an allowed identifier", () => {
    expect(isAllowedNonDisplaySpelling("jarvis-export-2026-08-06.json")).toBe(false);
    expect(isAllowedNonDisplaySpelling("moss-branding-notes.csv")).toBe(false);
  });

  it("still allowlists the legitimate internal identifiers the old catch-all protected", () => {
    // Dotted namespace identifiers: localStorage keys, module/event ids, manifest filename.
    expect(isAllowedNonDisplaySpelling("jarvis.settings:v1")).toBe(true);
    expect(isAllowedNonDisplaySpelling("jarvis.goals")).toBe(true);
    expect(isAllowedNonDisplaySpelling("jarvis.module.json")).toBe(true);
    // Snake_case Postgres roles/tables/columns and migration/queue references.
    expect(isAllowedNonDisplaySpelling("jarvis_migration_owner")).toBe(true);
    expect(isAllowedNonDisplaySpelling("app.jarvis_action_audit_log")).toBe(true);
    // Hyphenated identifiers with no file-extension ending: window target name, frozen archive
    // format marker (the wire contract this PR must NOT touch).
    expect(isAllowedNonDisplaySpelling("jarvis-google-consent")).toBe(true);
    expect(isAllowedNonDisplaySpelling("jarvis-archive/v1")).toBe(true);
  });

  it("no longer carries a file-scoped exception for the Plaid client_name string", () => {
    // #1456 fixed the string instead of exempting it; the exception mechanism stays available
    // for a genuine future case, but must not currently list this one.
    expect(isFileScopedException("external-modules/finance/src/adapters/plaid.ts", "Jarvis")).toBe(
      false
    );
  });

  it("NON_DISPLAY_SPELLINGS no longer contains a blanket jarvis[._-] pattern", () => {
    // Guards against silently re-widening the allowlist back to the old catch-all: a pattern that
    // matches the export-filename shape without requiring the extension-ending distinction would
    // reopen exactly the hole #1456 closed.
    expect(
      NON_DISPLAY_SPELLINGS.some((pattern) => pattern.test("jarvis-export-2026-08-06.json"))
    ).toBe(false);
  });
});

/* The three tests above name individual files, which is how ~50 display strings survived the first
   pass of #1441: a residue check scoped to the files someone already thought of cannot find the
   ones they did not. The sweep below is scoped to a directory tree instead, so a newly added
   package is covered the day it appears rather than the day someone remembers to list it. */

const SOURCE_ROOTS = [
  resolve(repoRoot, "apps/web/src"),
  resolve(repoRoot, "packages"),
  resolve(repoRoot, "external-modules")
];

// NON_DISPLAY_SPELLINGS, FILE_SCOPED_EXCEPTIONS and extractStringLiterals live in
// ./helpers/display-string-guard.ts (imported above) so the classification patterns can be
// unit-tested directly — see the "display-string residue guard classification" describe block.

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
      const relativePath = relative(repoRoot, file);

      for (const literal of extractStringLiterals(source)) {
        stringsScanned += 1;
        if (!/jarvis/i.test(literal)) continue;
        if (NON_DISPLAY_SPELLINGS.some((pattern) => pattern.test(literal))) continue;
        if (
          FILE_SCOPED_EXCEPTIONS.some(
            (exception) => exception.file === relativePath && exception.literal === literal
          )
        )
          continue;
        offenders.push(`${relativePath}: "${literal}"`);
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
