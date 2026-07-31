import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PgBoss } from "pg-boss";

import { AiRepository, createAiSecretCipher } from "@jarv1s/ai";
import { composeBriefing, type BriefingsRepository } from "@jarv1s/briefings";
import type { DataContextRunner } from "@jarv1s/db";
import {
  makeComposeDeps,
  setupBriefingsHarness,
  structuredRowManifest,
  teardownBriefingsHarness,
  userAHeaders,
  userAContext,
  type BriefingsTestHarness
} from "./briefings.helpers.js";

describe("Briefings structured action rows (P3 real-briefings)", () => {
  let appDb: BriefingsTestHarness["appDb"];
  let workerDb: BriefingsTestHarness["workerDb"];
  let dataContext: DataContextRunner;
  let repository: BriefingsRepository;
  let appBoss: PgBoss;
  let workerBoss: PgBoss;
  let server: BriefingsTestHarness["server"];

  beforeAll(async () => {
    const harness = await setupBriefingsHarness();
    appDb = harness.appDb;
    workerDb = harness.workerDb;
    dataContext = harness.dataContext;
    repository = harness.repository;
    appBoss = harness.appBoss;
    workerBoss = harness.workerBoss;
    server = harness.server;
  });

  afterAll(async () => {
    await teardownBriefingsHarness({ server, appBoss, workerBoss, appDb, workerDb });
  });

  it("trusted literals interpolate no structured row content", async () => {
    const captured: string[] = [];
    const taskManifest = structuredRowManifest({
      id: "structured-row-synthesis-test",
      title: "STRUCTURED-ROW-CONTENT",
      category: "needs_action",
      cacheMessageId: "opaque-cache-message"
    });
    const definition = await dataContext.withDataContext(userAContext(), (scopedDb) =>
      repository.createDefinition(scopedDb, {
        title: "Structured row trust boundary",
        selectedToolNames: ["tasks.list"]
      })
    );
    const cipher = createAiSecretCipher();
    const composed = await dataContext.withDataContext(userAContext(), (scopedDb) =>
      composeBriefing(
        scopedDb,
        definition,
        { runKind: "manual", runId: "structured-row-trust", now: new Date() },
        {
          ...makeComposeDeps(
            async (input) => {
              captured.push(input.messages[0]!.content);
              return { text: "synth narrative" };
            },
            [taskManifest]
          ),
          sourceBehaviorPolicy: undefined,
          cipher,
          aiRepository: {
            selectModelForCapability: async () => ({
              id: "structured-row-model",
              provider_config_id: "structured-row-provider",
              provider_kind: "anthropic",
              provider_model_id: "structured-row-model",
              display_name: "Structured row model",
              tier: "economy"
            }),
            selectProviderWithCredential: async () => ({
              id: "structured-row-provider",
              base_url: null,
              encrypted_credential: cipher.encryptJson({ apiKey: "test-key" })
            })
          } as unknown as AiRepository
        }
      )
    );
    const trusted = captured[0]!.match(
      /<trusted_instructions>([\s\S]*?)<\/trusted_instructions>/
    )![1]!;
    expect(trusted).not.toContain("STRUCTURED-ROW-CONTENT");
    expect(composed.structuredPayload.actionRows[0]?.title).toBe("STRUCTURED-ROW-CONTENT");
  });

  it("omits a structured row and count when its cache message id is missing", async () => {
    const taskManifest = structuredRowManifest({
      id: "structured-row-missing-cache-test",
      title: "MISSING-CACHE-ROW",
      category: "time_sensitive_info",
      cacheMessageId: null
    });
    const definition = await dataContext.withDataContext(userAContext(), (scopedDb) =>
      repository.createDefinition(scopedDb, {
        title: "Missing cache row",
        selectedToolNames: ["tasks.list"]
      })
    );
    const composed = await dataContext.withDataContext(userAContext(), (scopedDb) =>
      composeBriefing(
        scopedDb,
        definition,
        { runKind: "manual", runId: "structured-row-missing-cache", now: new Date() },
        { ...makeComposeDeps(undefined, [taskManifest]), sourceBehaviorPolicy: undefined }
      )
    );

    expect(composed.structuredPayload.actionRows).toEqual([]);
  });

  it("persists and serializes structured payload without sourceMetadata duplication", async () => {
    const taskManifest = structuredRowManifest({
      id: "structured-row-persistence-test",
      title: "Persisted row",
      category: "needs_reply",
      cacheMessageId: "cache-message"
    });
    const definition = await dataContext.withDataContext(userAContext(), (scopedDb) =>
      repository.createDefinition(scopedDb, {
        title: "Structured row persistence",
        selectedToolNames: ["tasks.list"]
      })
    );
    const outcome = await dataContext.withDataContext(userAContext(), (scopedDb) =>
      repository.generateRun(scopedDb, definition.id, {
        moduleManifests: [taskManifest],
        runKind: "manual",
        composeDeps: makeComposeDeps(undefined, [taskManifest])
      })
    );
    expect(outcome?.run.source_metadata).toHaveProperty("structuredPayload");

    const response = await server.inject({
      method: "GET",
      url: `/api/briefings/definitions/${definition.id}/runs`,
      headers: userAHeaders()
    });
    expect(response.statusCode).toBe(200);
    const returned = response
      .json<{ runs: Array<Record<string, unknown>> }>()
      .runs.find((run) => run.id === outcome?.run.id);
    expect(returned?.structuredPayload).toMatchObject({
      version: 1,
      actionRows: [expect.objectContaining({ title: "Persisted row" })]
    });
    expect(returned?.sourceMetadata).not.toHaveProperty("structuredPayload");
  });
});
