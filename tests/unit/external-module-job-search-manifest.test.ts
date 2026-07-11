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
    // 13 from JS-01..03 + the three JS-04 capture-surface tools.
    expect(result.manifest.assistantTools).toHaveLength(16);
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

// JS-03 (#932) Task 11: the 10 implemented tools declare strict input schemas that
// mirror their handler validation (additionalProperties:false so the gateway rejects
// unknown keys before dispatch); the 3 JS-05/06 stubs stay permissive until built.
describe("job-search manifest strict input schemas (#932)", () => {
  const IMPLEMENTED = [
    "job-search.onboarding.get-state",
    "job-search.profile.get",
    "job-search.profile.save-draft",
    "job-search.profile.approve",
    "job-search.resume.get",
    "job-search.resume.save-draft",
    "job-search.resume.approve",
    "job-search.monitor.list",
    "job-search.monitor.get",
    "job-search.monitor.save",
    "job-search.sources.list",
    "job-search.capture.paste",
    "job-search.capture.url"
  ];
  const STUBS = [
    "job-search.opportunities.list",
    "job-search.opportunities.get",
    "job-search.opportunity.decide"
  ];

  const schemaFor = (toolName: string): Record<string, unknown> => {
    const tools = loadManifest().assistantTools as Array<Record<string, unknown>>;
    const tool = tools.find((entry) => entry.name === toolName);
    expect(tool, toolName).toBeDefined();
    return tool!.inputSchema as Record<string, unknown>;
  };

  it("every implemented tool rejects unknown input keys", () => {
    for (const name of IMPLEMENTED) {
      const schema = schemaFor(name);
      expect(schema.type, name).toBe("object");
      expect(schema.additionalProperties, name).toBe(false);
    }
  });

  it("JS-05/06 stubs keep the permissive placeholder schema", () => {
    for (const name of STUBS) {
      expect(schemaFor(name)).toEqual({ type: "object" });
    }
  });

  it("resume.save-draft declares mode + the seven-kind confirmedClaims enum", () => {
    const schema = schemaFor("job-search.resume.save-draft");
    const props = schema.properties as Record<string, Record<string, unknown>>;
    expect(schema.required).toEqual(["mode"]);
    expect(props.mode?.enum).toEqual(["manual", "critique"]);
    expect(Object.keys(props).sort()).toEqual([
      "baseRevisionId",
      "confirmedClaims",
      "content",
      "instructions",
      "mode",
      "parentRevisionId"
    ]);
    const items = (props.confirmedClaims as { items: Record<string, unknown> }).items;
    expect(items.additionalProperties).toBe(false);
    expect(items.required).toEqual(["kind", "text"]);
    expect((items.properties as Record<string, Record<string, unknown>>).kind?.enum).toEqual([
      "employer",
      "role",
      "date",
      "skill",
      "credential",
      "metric",
      "outcome"
    ]);
  });

  it("resume.get declares optional revisionId + includeDiff only", () => {
    const schema = schemaFor("job-search.resume.get");
    const props = schema.properties as Record<string, Record<string, unknown>>;
    expect(schema.required).toBeUndefined();
    expect(Object.keys(props).sort()).toEqual(["includeDiff", "revisionId"]);
    expect(props.includeDiff?.type).toBe("boolean");
  });

  it("approvals require revisionId; reads without inputs stay empty-strict", () => {
    for (const name of ["job-search.profile.approve", "job-search.resume.approve"]) {
      const schema = schemaFor(name);
      expect(schema.required, name).toEqual(["revisionId"]);
      expect(Object.keys(schema.properties as Record<string, unknown>), name).toEqual([
        "revisionId"
      ]);
    }
    // getProfileHandler ignores input entirely (active + draft ids only), so its
    // schema is empty-strict like get-state and list — the plan's "optional
    // revisionId" note predates the implemented Task 6 handler.
    for (const name of [
      "job-search.onboarding.get-state",
      "job-search.profile.get",
      "job-search.monitor.list"
    ]) {
      const schema = schemaFor(name);
      expect(schema.properties, name).toBeUndefined();
      expect(schema.required, name).toBeUndefined();
    }
  });

  it("profile.save-draft requires provenance + fields; monitor tools mirror handlers", () => {
    const profile = schemaFor("job-search.profile.save-draft");
    expect(profile.required).toEqual(["provenance", "fields"]);
    const profileProps = profile.properties as Record<string, Record<string, unknown>>;
    expect(profileProps.provenance?.enum).toEqual(["user", "inferred"]);
    expect(profileProps.fields?.type).toBe("object");

    const get = schemaFor("job-search.monitor.get");
    expect(get.required).toEqual(["monitorId"]);

    const save = schemaFor("job-search.monitor.save");
    expect(save.required).toEqual(["monitorId", "adapterId", "query"]);
    const saveProps = save.properties as Record<string, Record<string, unknown>>;
    // JS-05 (#934): timezone/dueTime are optional schedule fields (not required).
    expect(Object.keys(saveProps).sort()).toEqual([
      "adapterId",
      "dueTime",
      "enabled",
      "monitorId",
      "query",
      "timezone"
    ]);
    expect(saveProps.enabled?.type).toBe("boolean");
    expect(saveProps.timezone?.type).toBe("string");
    expect(saveProps.dueTime?.type).toBe("string");
  });
});
