// tests/unit/external-module-job-search-manifest.test.ts
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { assertModuleJobPayload } from "@jarv1s/jobs";
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
    // JS-05 (#934): run-now enablement + hourly tick (KV due-check bounds real work).
    expect(result.manifest.worker?.queues).toEqual([
      {
        name: "job-search.monitor-run",
        handler: "monitor.run",
        retryLimit: 3,
        allowManualRun: true,
        paramsSchema: { type: "object", fields: { monitorId: { type: "identifier" } } }
      }
    ]);
    expect(result.manifest.worker?.schedules).toEqual([
      {
        id: "job-search.monitor-sweep",
        cron: "0 * * * *",
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

// JS-03 (#932) Task 11: implemented tools declare strict input schemas that
// mirror their handler validation (additionalProperties:false so the gateway rejects
// unknown keys before dispatch). JS-08 (#937) implemented the last three, so ALL
// manifest tools are now strict — the stub-placeholder carve-out is gone.
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
    "job-search.capture.url",
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

// JS-08 (#937) Task 5: the three opportunity tools go live. Input schemas pin the
// handler contracts (view/limit/offset, identityHash, decision enum + 500-byte
// reason). Output schemas matter for SECURITY: sanitizeAssistantToolResult
// projects results to schema-declared keys only, so (a) every emitted field must
// be declared or it silently vanishes from assistant/web responses, and (b) the
// wrap.ts error envelope keys (status/code/message/question) must be declared on
// every tool or error envelopes get stripped down to nothing.
describe("job-search manifest opportunity tool schemas (#937)", () => {
  const toolFor = (toolName: string): Record<string, unknown> => {
    const tools = loadManifest().assistantTools as Array<Record<string, unknown>>;
    const tool = tools.find((entry) => entry.name === toolName);
    expect(tool, toolName).toBeDefined();
    return tool!;
  };
  const propsOf = (schema: unknown): Record<string, Record<string, unknown>> =>
    (schema as { properties: Record<string, Record<string, unknown>> }).properties;

  it("opportunities.list input pins view enum + limit/offset bounds", () => {
    const schema = toolFor("job-search.opportunities.list").inputSchema as Record<string, unknown>;
    const props = propsOf(schema);
    expect(schema.required).toBeUndefined();
    expect(Object.keys(props).sort()).toEqual(["limit", "offset", "view"]);
    expect(props.view?.enum).toEqual(["new", "saved", "passed", "stale"]);
    expect(props.limit).toMatchObject({ type: "integer", minimum: 1, maximum: 15 });
    expect(props.offset).toMatchObject({ type: "integer", minimum: 0 });
  });

  it("opportunities.get input requires identityHash only", () => {
    const schema = toolFor("job-search.opportunities.get").inputSchema as Record<string, unknown>;
    expect(schema.required).toEqual(["identityHash"]);
    expect(Object.keys(propsOf(schema))).toEqual(["identityHash"]);
  });

  it("opportunity.decide input pins the enum, required keys, and reason cap", () => {
    const tool = toolFor("job-search.opportunity.decide");
    expect(tool.risk).toBe("write");
    const schema = tool.inputSchema as Record<string, unknown>;
    const props = propsOf(schema);
    expect(schema.required).toEqual(["identityHash", "decision"]);
    expect(Object.keys(props).sort()).toEqual(["decision", "identityHash", "reason"]);
    expect(props.decision?.enum).toEqual(["saved", "passed"]);
    // Advisory (validator enforces bytes, not chars) — but the cap must be visible
    // to the model so the assistant doesn't compose an over-long reason.
    expect(props.reason).toMatchObject({ type: "string", maxLength: 500 });
  });

  it("all three outputSchemas declare the error-envelope keys with required status only", () => {
    for (const name of [
      "job-search.opportunities.list",
      "job-search.opportunities.get",
      "job-search.opportunity.decide"
    ]) {
      const schema = toolFor(name).outputSchema as Record<string, unknown>;
      expect(schema, name).toBeDefined();
      expect(schema.type, name).toBe("object");
      expect(schema.required, name).toEqual(["status"]);
      const props = propsOf(schema);
      for (const key of ["status", "code", "message", "question"]) {
        expect(props[key]?.type, `${name}.${key}`).toBe("string");
      }
    }
  });

  it("list outputSchema declares every card field (allow-list projection)", () => {
    const schema = toolFor("job-search.opportunities.list").outputSchema as Record<string, unknown>;
    const props = propsOf(schema);
    expect(props.total?.type).toBe("integer");
    const items = (props.opportunities as { items: Record<string, unknown> }).items;
    expect(items.type).toBe("object");
    expect(Object.keys(items.properties as Record<string, unknown>).sort()).toEqual(
      [
        "company",
        "confidence",
        "eligibility",
        "evaluationPending",
        "fitBand",
        "firstSeenAt",
        "freshness",
        "identityHash",
        "location",
        "publishedAt",
        "source",
        "status",
        "title",
        "topEvidence",
        "topGap",
        "workMode"
      ].sort()
    );
  });

  it("get outputSchema declares decisionReason + nested posting/evaluation fields", () => {
    const schema = toolFor("job-search.opportunities.get").outputSchema as Record<string, unknown>;
    const opportunity = propsOf(schema).opportunity as Record<string, unknown>;
    const oppProps = propsOf(opportunity);
    // Coordinator ruling 2026-07-11: decisionReason IS exposed on the owner-only
    // get read — if it's not declared here the projection strips it silently.
    expect(oppProps.decisionReason?.type).toBe("string");
    const posting = oppProps.posting as unknown as Record<string, unknown>;
    expect(Object.keys(propsOf(posting)).sort()).toEqual([
      "company",
      "compensation",
      "description",
      "descriptionClipped",
      "descriptionTruncated",
      "employmentType",
      "location",
      "publishedAt",
      "title",
      "url",
      "workMode"
    ]);
    const evaluation = oppProps.evaluation as unknown as Record<string, unknown>;
    const evalProps = propsOf(evaluation);
    expect(Object.keys(evalProps).sort()).toEqual([
      "blockers",
      "createdAt",
      "evidence",
      "fitBand",
      "gaps",
      "inputs",
      "outdated",
      "overallConfidence",
      "postingConfidence",
      "preferenceConflicts",
      "preferenceMatches",
      "recommendation",
      "summary",
      "unknowns"
    ]);
    const evidenceItems = (evalProps.evidence as { items: Record<string, unknown> }).items;
    expect(Object.keys(evidenceItems.properties as Record<string, unknown>).sort()).toEqual([
      "evidence",
      "requirement",
      "source"
    ]);
    expect(
      Object.keys(propsOf(evalProps.inputs as unknown as Record<string, unknown>)).sort()
    ).toEqual(["opportunityContentHash", "profileRevisionId", "resumeRevisionId"]);
  });

  it("decide outputSchema declares the ack fields and NOT the reason", () => {
    const schema = toolFor("job-search.opportunity.decide").outputSchema as Record<string, unknown>;
    const props = propsOf(schema);
    expect(Object.keys(props).sort()).toEqual([
      "code",
      "decision",
      "identityHash",
      "message",
      "question",
      "status",
      "statusAt"
    ]);
    // The reason is deliberately absent: decide responses never echo it, and an
    // undeclared key is stripped by projection even if a future handler slipped.
    expect(props.reason).toBeUndefined();
  });
});

// JS-05 (#934) Task 5: the manifest alone enables run-now — allowManualRun exposes the
// #915 manual-enqueue route, and the monitorId-only paramsSchema is the fail-closed gate
// that keeps job content (titles/URLs/prose) out of pg-boss payloads.
describe("job-search manifest monitoring worker surface (#934)", () => {
  const validated = () => {
    const result = validateExternalModuleManifest(loadManifest(), "job-search", "0.1.0");
    expect(result.ok, JSON.stringify(!result.ok ? result.errors : [])).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    return result.manifest;
  };

  it("declares an hourly sweep and a manually runnable queue with a monitorId params schema", () => {
    const manifest = validated();
    const queue = manifest.worker?.queues?.[0];
    expect(queue).toMatchObject({
      name: "job-search.monitor-run",
      handler: "monitor.run",
      retryLimit: 3,
      allowManualRun: true,
      paramsSchema: { type: "object", fields: { monitorId: { type: "identifier" } } }
    });
    expect(manifest.worker?.schedules?.[0]).toMatchObject({
      id: "job-search.monitor-sweep",
      cron: "0 * * * *",
      scope: "user",
      jobKind: "job-search.monitor-sweep",
      queue: "job-search.monitor-run"
    });
  });

  it("payloads pass the platform metadata-only gate (sweep, run-now) and reject prose", () => {
    const queue = validated().worker!.queues![0]!;
    const base = {
      actorUserId: "11111111-1111-4111-8111-111111111111",
      moduleId: "job-search",
      manifestHash: `sha256:${"a".repeat(64)}`
    };
    expect(() =>
      assertModuleJobPayload(queue, { ...base, jobKind: "job-search.monitor-sweep" })
    ).not.toThrow();
    expect(() =>
      assertModuleJobPayload(queue, {
        ...base,
        jobKind: "job-search.monitor-run-now",
        params: { monitorId: "mon-1" }
      })
    ).not.toThrow();
    // Undeclared param keys (e.g. smuggled content) are rejected by the schema.
    expect(() =>
      assertModuleJobPayload(queue, {
        ...base,
        jobKind: "job-search.monitor-run-now",
        params: { title: "Senior Engineer — apply now!" }
      })
    ).toThrow();
  });
});
