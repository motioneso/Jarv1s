import { execFileSync } from "node:child_process";

// #1444 residue guard. `git grep -Ii jarv` returns thousands of hits across the tree —
// most of them legitimately frozen (see docs/superpowers/specs/2026-08-05-moss-rename-
// design.md §2.3, §8): dated historical docs, hash-checked applied migrations that can
// never be edited, the four runtime role names (role rename dropped from #1444), the MCP
// tool-name prefix, module IDs, advisory-lock strings, docker volume names, and so on.
//
// This script does NOT assert the tree is jarv-free — it asserts the tree's residue is
// EXACTLY the allowlisted set. Anything outside it is a newly introduced, unfrozen
// occurrence and a defect: seeding the allowlist from a raw dump of current hits would
// silently accept every future accidental "jarv" too, which is why §8 says to seed from
// the frozen categories in the spec, not from current state.
//
// NOT wired into `pnpm verify:foundation`. Large parts of the codebase (role name
// constants, image names, ~187 URL references, migration 0182) are still un-renamed
// pending later PRs in #1444; wiring this into the gate now would redline every other
// branch. It becomes a gate step once the rest of #1444 lands.

export interface AllowlistPattern {
  readonly kind: "path" | "content";
  readonly raw: string;
  readonly regex: RegExp;
}

export interface GrepHit {
  readonly path: string;
  readonly line: number;
  readonly text: string;
}

/** Convert a `path:` glob (supporting `**` and `*`) into an anchored RegExp. */
export function globToRegExp(pattern: string): RegExp {
  let out = "^";
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === "*" && pattern[i + 1] === "*") {
      out += ".*";
      i++;
    } else if (c === "*") {
      out += "[^/]*";
    } else if (c === "?") {
      out += "[^/]";
    } else {
      out += c!.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(out + "$");
}

/** Parse the allowlist file. Blank lines and lines starting with `#` are ignored. */
export function parseAllowlist(content: string): AllowlistPattern[] {
  const patterns: AllowlistPattern[] = [];
  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    if (line.startsWith("path:")) {
      const raw = line.slice("path:".length).trim();
      patterns.push({ kind: "path", raw, regex: globToRegExp(raw) });
    } else if (line.startsWith("content:")) {
      const raw = line.slice("content:".length).trim();
      patterns.push({
        kind: "content",
        raw,
        regex: new RegExp(raw.replace(/[.+^${}()|[\]\\]/g, "\\$&"), "i")
      });
    } else {
      throw new Error(
        `Unrecognized allowlist line (must start with "path:" or "content:"): ${line}`
      );
    }
  }
  return patterns;
}

/** True if this hit is covered by a path pattern (whole file) or a content pattern (the line). */
export function isAllowed(hit: GrepHit, allowlist: readonly AllowlistPattern[]): boolean {
  return allowlist.some((p) =>
    p.kind === "path" ? p.regex.test(hit.path) : p.regex.test(hit.text)
  );
}

/** The hits that are NOT covered by any allowlist pattern — a non-empty result is a defect. */
export function filterUnallowed(
  hits: readonly GrepHit[],
  allowlist: readonly AllowlistPattern[]
): GrepHit[] {
  return hits.filter((h) => !isAllowed(h, allowlist));
}

/** Parse `git grep -Ii -n jarv` output into structured hits. */
export function parseGrepOutput(output: string): GrepHit[] {
  const hits: GrepHit[] = [];
  for (const line of output.split("\n")) {
    if (!line) continue;
    const match = /^(.+?):(\d+):(.*)$/s.exec(line);
    if (!match) continue;
    hits.push({ path: match[1]!, line: Number(match[2]), text: match[3]! });
  }
  return hits;
}

async function main(): Promise<void> {
  const { readFile } = await import("node:fs/promises");
  const { fileURLToPath } = await import("node:url");
  const { dirname, join } = await import("node:path");

  const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
  const allowlistPath = join(repoRoot, ".github", "jarv-allowlist.txt");
  const allowlistContent = await readFile(allowlistPath, "utf8");
  const allowlist = parseAllowlist(allowlistContent);

  let output: string;
  try {
    output = execFileSync("git", ["grep", "-Ii", "-n", "jarv"], {
      cwd: repoRoot,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024
    });
  } catch (error) {
    // git grep exits 1 when there are zero matches at all — that's a clean tree, not a failure.
    const err = error as { status?: number; stdout?: string };
    if (err.status === 1 && !err.stdout) {
      console.log("check-jarv-allowlist: no matches, clean.");
      return;
    }
    throw error;
  }

  const hits = parseGrepOutput(output);
  const unallowed = filterUnallowed(hits, allowlist);

  if (unallowed.length === 0) {
    console.log(`check-jarv-allowlist: ${hits.length} hits, all allowlisted.`);
    return;
  }

  console.error(`check-jarv-allowlist: ${unallowed.length} unallowlisted "jarv" occurrence(s):\n`);
  for (const hit of unallowed) {
    console.error(`  ${hit.path}:${hit.line}: ${hit.text.trim()}`);
  }
  console.error(
    "\nEach of these is either a newly introduced unfrozen occurrence (fix it) or a " +
      "legitimately frozen one missing from .github/jarv-allowlist.txt (add it, with a " +
      "reason)."
  );
  process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
