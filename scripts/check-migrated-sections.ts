import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { BANNED_VISUAL_PROPERTIES } from "./check-design-tokens.js";

/**
 * Guards 5 and 6 (#1388 Foundation, docs/superpowers/specs/2026-08-03-ui-consolidation.md).
 *
 * Guard 1 (check-ui-classes.ts) only checks that a literal `jds-*` class is DEFINED somewhere —
 * `className="jds-btn jds-btn--primary"` passes it even though the point of a section's migration
 * is to render `<Button>` from @jarv1s/ui instead of hand-typing the class. Guard 5 forbids ANY
 * raw `jds-*` string in a migrated section's TSX.
 *
 * Guard 6 covers the same section's inline styles (`style={{...}}`), which evade both guard 1 (not
 * a className) and check-design-tokens.ts (not a CSS file) — a migrated section could otherwise
 * hard-code a colour in JSX and pass every other guard. Reuses BANNED_VISUAL_PROPERTIES (D2):
 * layout properties (position, spacing, grid, flex) stay legal inline.
 *
 * MIGRATED_SECTION_PATHS starts empty: Foundation converts no screens (spec "Section 1 —
 * Foundation... No screen changes"). Each section's own task issue (calendar first per D7) adds
 * its TSX file paths here once that section's migration PR lands — same day-one-empty,
 * burn-down-owned-by-each-section treatment as check-ui-classes.ts's guards 1/2.
 */

const rootDirectory = process.cwd();

export const MIGRATED_SECTION_PATHS: readonly string[] = [
  "apps/web/src/calendar/calendar-page.tsx",
  "apps/web/src/calendar/calendar-month.tsx",
  "apps/web/src/calendar/calendar-time-grid.tsx",
  "apps/web/src/calendar/calendar-peek.tsx"
];

export interface RawClassViolation {
  readonly path: string;
  readonly line: number;
  readonly className: string;
  readonly text: string;
}

export interface InlineStylePropertyViolation {
  readonly path: string;
  readonly line: number;
  readonly property: string;
  readonly text: string;
}

function kebabToCamel(property: string): string {
  return property.replace(/-([a-z])/g, (_match, letter: string) => letter.toUpperCase());
}

const BANNED_INLINE_STYLE_PROPERTIES = new Set(BANNED_VISUAL_PROPERTIES.map(kebabToCamel));

export async function checkRawClasses(
  root: string,
  migratedPaths: readonly string[] = MIGRATED_SECTION_PATHS
): Promise<RawClassViolation[]> {
  const violations: RawClassViolation[] = [];
  const tokenPattern = /\bjds-[a-zA-Z0-9-]+/g;

  for (const relativeFile of migratedPaths) {
    const contents = await readFileSafe(join(root, relativeFile));
    if (contents === undefined) continue;
    const lines = stripJsComments(contents).split(/\r\n|\r|\n/);
    const originalLines = contents.split(/\r\n|\r|\n/);

    lines.forEach((line, index) => {
      tokenPattern.lastIndex = 0;
      let match;
      while ((match = tokenPattern.exec(line)) !== null) {
        violations.push({
          path: normalizePath(relativeFile),
          line: index + 1,
          className: match[0],
          text: originalLines[index]?.trim() ?? ""
        });
      }
    });
  }

  return violations;
}

export async function checkInlineStyleProperties(
  root: string,
  migratedPaths: readonly string[] = MIGRATED_SECTION_PATHS
): Promise<InlineStylePropertyViolation[]> {
  const violations: InlineStylePropertyViolation[] = [];

  for (const relativeFile of migratedPaths) {
    const contents = await readFileSafe(join(root, relativeFile));
    if (contents === undefined) continue;
    const stripped = stripJsComments(contents);

    for (const styleBlock of extractStyleObjects(stripped)) {
      const keyPattern = /([a-zA-Z]+)\s*:/g;
      let match;
      while ((match = keyPattern.exec(styleBlock.content)) !== null) {
        const property = match[1];
        if (property && BANNED_INLINE_STYLE_PROPERTIES.has(property)) {
          const line = lineOf(stripped, styleBlock, match.index);
          const originalLines = contents.split(/\r\n|\r|\n/);
          violations.push({
            path: normalizePath(relativeFile),
            line,
            property,
            text: originalLines[line - 1]?.trim() ?? ""
          });
        }
      }
    }
  }

  return violations;
}

// Finds each `style={{...}}` occurrence and returns the balanced-brace inner content. Not a full
// JS parser — adequate for a guard scoped to a small, manually curated migrated-file list.
function extractStyleObjects(source: string): Array<{ content: string; offset: number }> {
  const blocks: Array<{ content: string; offset: number }> = [];
  const marker = "style={{";
  let searchFrom = 0;

  while (true) {
    const start = source.indexOf(marker, searchFrom);
    if (start === -1) break;
    const contentStart = start + marker.length - 1; // keep one opening brace for balance counting
    let depth = 0;
    let end = -1;
    for (let i = contentStart; i < source.length; i++) {
      const ch = source[i];
      if (ch === "{") depth++;
      if (ch === "}") {
        depth--;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    if (end === -1) break;
    blocks.push({ content: source.slice(contentStart + 1, end), offset: contentStart + 1 });
    searchFrom = end + 1;
  }

  return blocks;
}

function lineOf(fullSource: string, block: { offset: number }, indexInBlock: number): number {
  const absoluteIndex = block.offset + indexInBlock;
  return fullSource.slice(0, absoluteIndex).split(/\r\n|\r|\n/).length;
}

async function readFileSafe(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return undefined;
  }
}

function stripJsComments(contents: string): string {
  return contents
    .replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\r\n]/g, " "))
    .replace(/\/\/[^\r\n]*/g, (comment) => comment.replace(/[^\r\n]/g, " "));
}

function normalizePath(path: string): string {
  return path.replaceAll("\\", "/");
}

function selfTest(): void {
  const tokenPattern = /\bjds-[a-zA-Z0-9-]+/g;
  if (!tokenPattern.test('className="jds-btn"')) {
    console.error("Self-test failed: raw-class guard did not catch jds-btn");
    process.exit(1);
  }

  const blocks = extractStyleObjects('<div style={{ color: "red", display: "flex" }} />');
  if (blocks.length !== 1 || !blocks[0]!.content.includes("color")) {
    console.error("Self-test failed: inline-style extraction did not find the style object");
    process.exit(1);
  }
  if (
    !BANNED_INLINE_STYLE_PROPERTIES.has("color") ||
    BANNED_INLINE_STYLE_PROPERTIES.has("display")
  ) {
    console.error("Self-test failed: inline-style banned-property set is wrong (color/display)");
    process.exit(1);
  }
}

async function main(): Promise<void> {
  selfTest();

  const [rawClassViolations, inlineStyleViolations] = await Promise.all([
    checkRawClasses(rootDirectory),
    checkInlineStyleProperties(rootDirectory)
  ]);

  if (rawClassViolations.length === 0 && inlineStyleViolations.length === 0) {
    console.log("No migrated-section violations found.");
    return;
  }

  if (rawClassViolations.length > 0) {
    console.error(
      "Raw jds-* class in a migrated section (use the @jarv1s/ui component instead of a hand-typed class):"
    );
    for (const violation of rawClassViolations) {
      console.error(
        `- ${violation.path}:${violation.line} ${violation.className} — ${violation.text}`
      );
    }
  }

  if (inlineStyleViolations.length > 0) {
    console.error(
      "Banned visual property in a migrated section's inline style (D2: layout only; colour/type/border/radius/shadow come from a component or token):"
    );
    for (const violation of inlineStyleViolations) {
      console.error(
        `- ${violation.path}:${violation.line} ${violation.property} — ${violation.text}`
      );
    }
  }

  process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
