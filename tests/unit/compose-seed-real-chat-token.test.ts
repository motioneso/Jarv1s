/**
 * #1121 (Coordinator constraint 2): prove `seed` and `jarv1s` mount the identical
 * project-scoped `jarv1s-cli-auth` volume (so a token `seed` persists there is visible to
 * `jarv1s`'s chat launch), while ONLY `seed` can ever receive the opt-in real-chat token
 * env file. Static text assertions against the compose source, no containers — this repo has
 * no YAML-parser dependency at any workspace level, so this reuses the existing plain-text
 * seam (grep-style checks) rather than adding one.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const COMPOSE_PATH = path.resolve(import.meta.dirname, "../../infra/docker-compose.prod.yml");

/** Extracts a top-level service's raw YAML block by 2-space-indented key, ending at the next
 *  sibling key (or EOF). Good enough for this file's fixed, hand-authored shape. */
function extractServiceBlock(source: string, serviceName: string): string {
  const lines = source.split("\n");
  const startIndex = lines.findIndex((line) => line === `  ${serviceName}:`);
  if (startIndex === -1) throw new Error(`service "${serviceName}" not found in compose file`);
  const endIndex = lines.findIndex(
    (line, i) => i > startIndex && /^  \S/.test(line) // next 2-space-indented key
  );
  return lines.slice(startIndex, endIndex === -1 ? lines.length : endIndex).join("\n");
}

describe("docker-compose.prod.yml seed/jarv1s cli-auth wiring", () => {
  const source = readFileSync(COMPOSE_PATH, "utf8");
  const seedBlock = extractServiceBlock(source, "seed");
  const jarv1sBlock = extractServiceBlock(source, "jarv1s");

  it("declares jarv1s-cli-auth exactly once at top level (project-scoped)", () => {
    const topLevelDeclarations = source.match(/^  jarv1s-cli-auth:\s*$/gm) ?? [];
    expect(topLevelDeclarations).toHaveLength(1);
  });

  it("mounts the same jarv1s-cli-auth volume in both seed and jarv1s", () => {
    expect(seedBlock).toMatch(/jarv1s-cli-auth:\/data\/cli-auth/);
    expect(jarv1sBlock).toMatch(/jarv1s-cli-auth:\/data\/cli-auth/);
  });

  it("gives only seed an opt-in real-chat token env file", () => {
    expect(seedBlock).toMatch(/JARVIS_UAT_REAL_CHAT_ENV_FILE/);
    expect(jarv1sBlock).not.toMatch(/JARVIS_UAT_REAL_CHAT_ENV_FILE/);
  });

  it("never lets jarv1s reference the real-chat token env var by name", () => {
    // The token itself only ever lives inside the decrypted temp env file (never in compose
    // source) — the real guarantee is that jarv1s has no conduit to it at all, proven above.
    expect(jarv1sBlock).not.toMatch(/CLAUDE_CODE_OAUTH_TOKEN/);
  });
});
