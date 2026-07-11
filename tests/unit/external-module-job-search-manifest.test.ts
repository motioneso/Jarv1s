// tests/unit/external-module-job-search-manifest.test.ts
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { validateExternalModuleManifest } from "@jarv1s/module-registry";

// JS-01 (#930): the REAL shipped manifest must pass the merged external ABI, and
// targeted mutations must fail closed. Spec deltas (coordinator 2026-07-10): plain
// kebab id `job-search` (dotted ids are rejected by MODULE_ID_RE) and
// permissionId == tool name (unique-per-tool rule).
const manifestPath = fileURLToPath(
  new URL("../../external-modules/job-search/jarvis.module.json", import.meta.url)
);
const loadManifest = (): Record<string, unknown> =>
  JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, unknown>;

describe("job-search manifest contract (#930)", () => {
  it("accepts the shipped manifest against the merged ABI", () => {
    const result = validateExternalModuleManifest(loadManifest(), "job-search", "0.1.0");
    expect(result.ok, JSON.stringify(!result.ok ? result.errors : [])).toBe(true);
    if (!result.ok) return;
    expect(result.manifest.id).toBe("job-search");
    expect(result.manifest.web).toEqual({ entrypoint: "dist/web/index.js", contractVersion: 1 });
    expect(result.manifest.runtime).toEqual({
      workerEntrypoint: "dist/worker.js",
      workerContractVersion: 1
    });
    expect(result.manifest.assistantTools).toHaveLength(13);
    // Spec delta 2: one permission per tool, equal to the tool name.
    for (const tool of result.manifest.assistantTools ?? []) {
      expect(tool.permissionId).toBe(tool.name);
      expect(tool.name.startsWith("job-search.")).toBe(true);
    }
    // Seven user-scoped KV namespaces from the parent design.
    expect(result.manifest.storage?.map((entry) => entry.namespace)).toEqual([
      "job-search.onboarding",
      "job-search.profile",
      "job-search.resume",
      "job-search.monitors",
      "job-search.opportunities",
      "job-search.runs",
      "job-search.feed"
    ]);
    expect(result.manifest.storage?.every((entry) => entry.scopes.length === 1)).toBe(true);
    expect(result.manifest.storage?.every((entry) => entry.scopes[0] === "user")).toBe(true);
    // No MVP credentials: the auth section must be absent entirely.
    expect(result.manifest.auth).toBeUndefined();
    expect(result.manifest.fetchHosts).toEqual([
      "boards-api.greenhouse.io",
      "api.lever.co",
      "api.ashbyhq.com"
    ]);
    expect(result.manifest.worker?.queues).toEqual([
      { name: "job-search.monitor-run", handler: "monitor.run", retryLimit: 3 }
    ]);
    expect(result.manifest.worker?.schedules).toEqual([
      {
        id: "job-search.monitor-sweep",
        cron: "*/15 * * * *",
        scope: "user",
        jobKind: "job-search.monitor-sweep",
        queue: "job-search.monitor-run"
      }
    ]);
  });

  it("rejects the design's original dotted id (spec delta 1)", () => {
    const mutated = { ...loadManifest(), id: "jarv1s.job-search" };
    const result = validateExternalModuleManifest(mutated, "jarv1s.job-search", "0.1.0");
    expect(result.ok).toBe(false);
  });

  it("rejects duplicated permission ids (spec delta 2 guard)", () => {
    const manifest = loadManifest();
    const tools = manifest.assistantTools as Array<Record<string, unknown>>;
    // Simulate the design's shared-permission model: two tools, one permission id.
    const mutated = {
      ...manifest,
      assistantTools: [
        { ...tools[0], permissionId: "job-search.read" },
        { ...tools[1], permissionId: "job-search.read" }
      ]
    };
    const result = validateExternalModuleManifest(mutated, "job-search", "0.1.0");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(" ")).toContain("unique");
  });

  it("rejects a wrong schemaVersion", () => {
    const result = validateExternalModuleManifest(
      { ...loadManifest(), schemaVersion: 2 },
      "job-search",
      "0.1.0"
    );
    expect(result.ok).toBe(false);
  });

  it("rejects forbidden executable-surface fields", () => {
    const result = validateExternalModuleManifest(
      { ...loadManifest(), permissions: [] },
      "job-search",
      "0.1.0"
    );
    expect(result.ok).toBe(false);
  });

  it("fails closed on a compound compatibility range", () => {
    const result = validateExternalModuleManifest(
      { ...loadManifest(), compatibility: { jarv1s: ">=0.1.0 <0.2.0" } },
      "job-search",
      "0.1.0"
    );
    expect(result.ok).toBe(false);
  });
});
