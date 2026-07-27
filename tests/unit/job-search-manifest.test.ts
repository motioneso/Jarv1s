// tests/unit/job-search-manifest.test.ts
//
// Task 3 (#1287): the manifest every later Job Search task registers into. Every case here
// asserts through validateExternalModuleManifest()'s validated output, never the raw JSON —
// the validator reconstructs the manifest from an allow-list and silently drops fields it does
// not know (F1), so a test reading the JSON file directly would pass for a manifest the real
// loader strips to pieces.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { validateExternalModuleManifest } from "@jarv1s/module-registry";

import { JOB_SEARCH_TABLES } from "../../external-modules/job-search/src/db/tables.js";

const manifestPath = fileURLToPath(
  new URL("../../external-modules/job-search/jarvis.module.json", import.meta.url)
);
const loadManifest = (): Record<string, unknown> =>
  JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, unknown>;

describe("job-search manifest scaffold (#1287)", () => {
  it("validates against the real loader", () => {
    const result = validateExternalModuleManifest(loadManifest(), "job-search", "0.1.0");
    expect(result.ok, JSON.stringify(!result.ok ? result.errors : [])).toBe(true);
  });

  it("declares only hosts that serve public postings", () => {
    const result = validateExternalModuleManifest(loadManifest(), "job-search", "0.1.0");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // A third host appearing here is a scope change, not a typo — Indeed is cut from v1 (L1).
    expect(result.manifest.fetchHosts).toEqual(["www.linkedin.com", "freehire.me"]);
  });

  it("owns exactly the tables JOB_SEARCH_TABLES names, in the same order", () => {
    const result = validateExternalModuleManifest(loadManifest(), "job-search", "0.1.0");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // THE seam (F2): the JSON literal in jarvis.module.json and the TS constant in
    // src/db/tables.ts are two independent copies of one list — this deep equality,
    // including order, is the only thing in the toolchain that relates them. A table added
    // to one and forgotten in the other produces a module that installs happily and then has
    // an unprotected or a non-existent table.
    expect(result.manifest.database?.ownedTables).toEqual(
      JOB_SEARCH_TABLES.map((table: string) => `app.${table}`)
    );
  });

  it("names five tables", () => {
    // Pinned separately so that "fixing" the case above by editing both lists at once still
    // fails and forces the spec conversation, rather than silently accepting a drifted count.
    expect(JOB_SEARCH_TABLES).toHaveLength(5);
  });

  it("survives reconstruction with its briefing block and nav badge intact", () => {
    const result = validateExternalModuleManifest(loadManifest(), "job-search", "0.1.0");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Both fields are new to the validator (Tasks 2 and 2d): this is the assertion that
    // catches a validator that accepts but does not re-emit (F1).
    expect(result.manifest.briefing).toEqual({
      handler: "briefing.contribute",
      sections: ["morning", "evening"],
      toolName: "job-search.briefing"
    });
    expect(result.manifest.navigation?.[0]?.badge).toEqual({ source: "notifications" });
  });

  it("keeps the briefing handler out of the chat tool registry", () => {
    const result = validateExternalModuleManifest(loadManifest(), "job-search", "0.1.0");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // A briefing handler is a worker handler, which is what keeps it invisible to chat. The
    // validator never enumerates handlers, so this asserts the negative directly: no
    // assistantTools entry and no queue routes to briefing.contribute.
    expect(result.manifest.assistantTools ?? []).toEqual([]);
    const queueHandlers = (result.manifest.worker?.queues ?? []).map((queue) => queue.handler);
    expect(queueHandlers).not.toContain("briefing.contribute");
  });

  it("exposes no blended score through any tool schema", () => {
    const result = validateExternalModuleManifest(loadManifest(), "job-search", "0.1.0");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // L9: two axes (Fit and Want) are never blended into one score. Cheap, and it fails the
    // moment someone adds a convenience field in a later task.
    const serialized = JSON.stringify(result.manifest);
    for (const forbidden of ["overall", "combinedScore", "totalScore", "matchScore"]) {
      expect(serialized).not.toContain(forbidden);
    }
  });
});
