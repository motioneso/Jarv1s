import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
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
