import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  filterUnallowed,
  globToRegExp,
  parseAllowlist,
  parseGrepOutput,
  type GrepHit
} from "../../scripts/check-jarv-allowlist.js";

describe("globToRegExp", () => {
  it("matches an exact path", () => {
    expect(globToRegExp("scripts/backup-full.sh").test("scripts/backup-full.sh")).toBe(true);
    expect(globToRegExp("scripts/backup-full.sh").test("scripts/other.sh")).toBe(false);
  });

  it("matches ** across directory segments", () => {
    const re = globToRegExp("docs/superpowers/specs/**");
    expect(re.test("docs/superpowers/specs/2026-08-05-moss-rename-design.md")).toBe(true);
    expect(re.test("docs/superpowers/specs/nested/deep/file.md")).toBe(true);
    expect(re.test("docs/superpowers/plans/other.md")).toBe(false);
  });

  it("matches * within one directory segment only", () => {
    const re = globToRegExp("packages/*/sql/**");
    expect(re.test("packages/ai/sql/0145_jarvis_error_log.sql")).toBe(true);
    // A `*` must not cross a `/` — this must not match a deeper package path.
    expect(re.test("packages/ai/extra/sql/0001_x.sql")).toBe(false);
  });
});

describe("parseAllowlist", () => {
  it("ignores blank lines and comments", () => {
    const patterns = parseAllowlist("# a comment\n\npath:foo/**\n");
    expect(patterns).toHaveLength(1);
    expect(patterns[0]).toMatchObject({ kind: "path", raw: "foo/**" });
  });

  it("parses content patterns", () => {
    const patterns = parseAllowlist("content:jarvis_mod_\n");
    expect(patterns).toHaveLength(1);
    expect(patterns[0]).toMatchObject({ kind: "content", raw: "jarvis_mod_" });
  });

  it("rejects a line with neither prefix", () => {
    expect(() => parseAllowlist("foo/bar.ts\n")).toThrow(/Unrecognized allowlist line/);
  });
});

describe("filterUnallowed", () => {
  const allowlist = parseAllowlist(
    [
      "path:docs/superpowers/specs/**",
      "content:jarvis_mod_",
      "content:jarvis_migration_owner"
    ].join("\n")
  );

  it("excludes a hit whose whole file is path-allowlisted", () => {
    const hits: GrepHit[] = [
      { path: "docs/superpowers/specs/2026-08-05-moss-rename-design.md", line: 10, text: "jarvis" }
    ];
    expect(filterUnallowed(hits, allowlist)).toEqual([]);
  });

  it("excludes a hit whose line matches a content pattern, in an otherwise unlisted file", () => {
    const hits: GrepHit[] = [
      {
        path: "packages/db/src/module-role-broker.ts",
        line: 32,
        text: "jarvis_mod_${slug}_runtime"
      }
    ];
    expect(filterUnallowed(hits, allowlist)).toEqual([]);
  });

  it("excludes the frozen runtime role name anywhere it appears", () => {
    const hits: GrepHit[] = [
      { path: "packages/db/src/role-bootstrap.ts", line: 24, text: "jarvis_migration_owner" }
    ];
    expect(filterUnallowed(hits, allowlist)).toEqual([]);
  });

  it("fails a newly introduced unfrozen occurrence — not path- or content-allowlisted", () => {
    const hits: GrepHit[] = [
      { path: "packages/goals/src/new-feature.ts", line: 5, text: "// TODO: rename Jarvis widget" }
    ];
    expect(filterUnallowed(hits, allowlist)).toEqual(hits);
  });

  it("does not let a content pattern leak into an unrelated substring context incorrectly", () => {
    // Sanity: content matching is substring-based, so a pattern only excuses lines that
    // actually contain it — a line naming a different, unlisted identifier still fails.
    const hits: GrepHit[] = [
      { path: "packages/settings/src/repository.ts", line: 900, text: "jarvis_unlisted_role" }
    ];
    expect(filterUnallowed(hits, allowlist)).toEqual(hits);
  });
});

describe("parseGrepOutput", () => {
  it("parses path:line:text triples from git grep -n output", () => {
    const hits = parseGrepOutput(
      'packages/db/src/role-bootstrap.ts:24:  { role: "jarvis_migration_owner", url: "migration" },\n'
    );
    expect(hits).toEqual([
      {
        path: "packages/db/src/role-bootstrap.ts",
        line: 24,
        text: '  { role: "jarvis_migration_owner", url: "migration" },'
      }
    ]);
  });

  it("ignores trailing blank lines", () => {
    expect(parseGrepOutput("\n")).toEqual([]);
    expect(parseGrepOutput("")).toEqual([]);
  });
});

describe("the committed allowlist file", () => {
  it("parses without error and freezes the four runtime role names per #1444", async () => {
    const path = join(dirname(fileURLToPath(import.meta.url)), "../../.github/jarv-allowlist.txt");
    const content = await readFile(path, "utf8");
    const patterns = parseAllowlist(content); // throws on a malformed line
    const contentRaws = patterns.filter((p) => p.kind === "content").map((p) => p.raw);
    for (const role of [
      "jarvis_migration_owner",
      "jarvis_app_runtime",
      "jarvis_worker_runtime",
      "jarvis_auth_runtime"
    ]) {
      expect(contentRaws).toContain(role);
    }
  });
});
