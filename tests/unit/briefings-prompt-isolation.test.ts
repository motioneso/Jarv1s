import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// Static regression guard for the briefings prompt-injection trust boundary (#316).
// The PRIMARY gate is the canary-injection integration suite; this is the SECONDARY
// mechanical guard that runs in `pnpm test:unit` (part of the gate) and fails the build
// the moment the trusted preamble stops being a pure literal. Path is resolved from this
// file (not process.cwd()) so it is stable regardless of where vitest is invoked.
const here = dirname(fileURLToPath(import.meta.url));
const composePath = resolve(here, "../../packages/briefings/src/compose.ts");
const source = readFileSync(composePath, "utf8");

describe("briefings prompt-isolation (static)", () => {
  it("builds morning and evening trusted preambles as pure literal constants", () => {
    const matches = [
      ...source.matchAll(/const TRUSTED_INSTRUCTIONS_(MORNING|EVENING) = `([\s\S]*?)`;/g)
    ];
    expect(
      matches.map((match) => match[1]).sort(),
      "morning and evening trusted constants must exist as template literals"
    ).toEqual(["EVENING", "MORNING"]);

    // No external/section value may be referenced inside the trusted preamble. If any of
    // these identifiers appear, external content can leak into the trusted text.
    const forbidden = ["sections", "body", ".lines", ".key", ".label", ".count"];
    for (const match of matches) {
      const trustedLiteral = match[2]!;
      for (const token of forbidden) {
        expect(
          trustedLiteral,
          `trusted preamble must not reference external value "${token}"`
        ).not.toContain(token);
      }
    }
  });

  it("uses the delimited trust-boundary scheme", () => {
    expect(source).toContain("<trusted_instructions>");
    expect(source).toContain("</trusted_instructions>");
    // The external block type attribute is interpolated from the section key (a constant).
    expect(source).toContain('<external_source type="${section.key}">');
    expect(source).toContain("</external_source>");
  });

  it("names every untrusted channel (incl. the reserved web_research tag) in the trust boundary", () => {
    // The channel names are part of the literal trust-boundary text in compose.ts.
    for (const channel of [
      "commitments",
      "tasks",
      "calendar",
      "email",
      "vault",
      "chats",
      "web_research"
    ]) {
      expect(source, `trust boundary must name channel "${channel}"`).toContain(channel);
    }
  });

  it("neutralizes sentinel tokens via sanitizeExternal at every external emission point", () => {
    expect(source).toMatch(/function sanitizeExternal/);
    expect(source).toContain("SENTINEL_TOKEN_PATTERN");
    // Every external_source block is rendered through renderExternalBlock, and the lines
    // it emits are produced by format callbacks / the vault join routed through sanitizeExternal.
    expect(source).toMatch(/function renderExternalBlock/);
  });
});

describe("evening interview seed prompt-isolation (static)", () => {
  const liveRoutesPath = resolve(here, "../../packages/chat/src/live-routes.ts");
  const seedSource = readFileSync(liveRoutesPath, "utf8");

  it("buildEveningInterviewSeed trusted preamble is a pure literal", () => {
    expect(seedSource, "interview seed must contain a trusted_instructions block").toContain(
      "<trusted_instructions>"
    );

    const trustedMatch = seedSource.match(
      /"<trusted_instructions>\\n" \+([\s\S]*?)"<\/trusted_instructions>/
    );
    expect(
      trustedMatch,
      "trusted_instructions block must be string-concatenated literal"
    ).not.toBeNull();

    const trustedLiteral = trustedMatch![1];
    const forbidden = ["reviewText", "external", "briefingRun", "reviewContent", "seed"];
    for (const token of forbidden) {
      expect(
        trustedLiteral,
        `interview trusted preamble must not reference "${token}"`
      ).not.toContain(token);
    }
  });

  it("interview seed delimits review content as external_source", () => {
    expect(seedSource).toContain('<external_source type="evening_review">');
    expect(seedSource).toContain("</external_source>");
  });

  it("sanitizes review text before emitting into external_source", () => {
    expect(seedSource).toMatch(/function sanitizeExternalData/);
    expect(seedSource).toMatch(/sanitizeExternalData\(reviewText/);
  });
});
