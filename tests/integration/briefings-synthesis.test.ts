import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PgBoss } from "pg-boss";

import { AiRepository, createAiSecretCipher } from "@jarv1s/ai";
import {
  BRIEFINGS_RUN_QUEUE,
  type BriefingRunPayload,
  type BriefingsRepository
} from "@jarv1s/briefings";
import type { DataContextRunner } from "@jarv1s/db";
import type { NotificationsRepository } from "@jarv1s/notifications";
import { getBuiltInModuleManifests } from "@jarv1s/module-registry";
import type { JarvisModuleManifest } from "@jarv1s/module-sdk";
import { ids } from "./test-database.js";
import {
  handleNextBriefingJobWithNotifications,
  makeComposeDeps,
  setupBriefingsHarness,
  teardownBriefingsHarness,
  adminContext,
  userAContext,
  userBContext,
  type BriefingsTestHarness
} from "./briefings.helpers.js";

describe("Briefings synthesis, scheduling, and notification path (P3 real-briefings)", () => {
  let appDb: BriefingsTestHarness["appDb"];
  let workerDb: BriefingsTestHarness["workerDb"];
  let dataContext: DataContextRunner;
  let repository: BriefingsRepository;
  let notificationsRepository: NotificationsRepository;
  let appBoss: PgBoss;
  let workerBoss: PgBoss;
  let server: BriefingsTestHarness["server"];

  beforeAll(async () => {
    const harness = await setupBriefingsHarness();
    appDb = harness.appDb;
    workerDb = harness.workerDb;
    dataContext = harness.dataContext;
    repository = harness.repository;
    notificationsRepository = harness.notificationsRepository;
    appBoss = harness.appBoss;
    workerBoss = harness.workerBoss;
    server = harness.server;
  });

  afterAll(async () => {
    await teardownBriefingsHarness({
      server,
      appBoss,
      workerBoss,
      appDb,
      workerDb
    });
  });

  it("falls back deterministically (degraded, status succeeded) when no model is configured", async () => {
    // No AI model configured yet (clean DB from beforeAll reset) → compose takes the
    // deterministic degraded fallback. Status stays "succeeded" (there is no
    // "degraded" enum value — degraded is a source_metadata boolean).
    const definition = await dataContext.withDataContext(userBContext(), (scopedDb) =>
      repository.createDefinition(scopedDb, {
        title: "Degraded briefing",
        selectedToolNames: ["tasks.list"]
      })
    );
    const outcome = await dataContext.withDataContext(userBContext(), (scopedDb) =>
      repository.generateRun(scopedDb, definition.id, {
        moduleManifests: getBuiltInModuleManifests(),
        runKind: "manual",
        composeDeps: makeComposeDeps(async () => {
          throw new Error("synthesis must not be called when there is no model");
        })
      })
    );
    const run = outcome?.run;
    const meta = run?.source_metadata as {
      degraded: boolean;
      degradedReason: string;
      aiModel: unknown;
    };

    expect(run?.status).toBe("succeeded");
    expect(meta.degraded).toBe(true);
    expect(meta.degradedReason).toBe("no_model");
    expect(meta.aiModel).toBeNull();
  });

  it("records economy-tier AI model in source_metadata when configured", async () => {
    const aiRepository = new AiRepository();
    const providerRow = await dataContext.withDataContext(adminContext(), (scopedDb) =>
      aiRepository.createProvider(scopedDb, {
        providerKind: "anthropic",
        displayName: "Economy summarizer",
        encryptedCredential: createAiSecretCipher().encryptJson({ apiKey: "briefing-econ-key" })
      })
    );
    const modelRow = await dataContext.withDataContext(adminContext(), (scopedDb) =>
      aiRepository.createModel(scopedDb, {
        providerConfigId: providerRow.id,
        providerModelId: "econ-summarizer",
        displayName: "Economy Summarizer",
        capabilities: ["summarization"],
        tier: "economy"
      })
    );

    const definition = await dataContext.withDataContext(userAContext(), (scopedDb) =>
      repository.createDefinition(scopedDb, {
        title: "Economy tier briefing",
        selectedToolNames: ["tasks.list"]
      })
    );

    const outcome = await dataContext.withDataContext(userAContext(), (scopedDb) =>
      repository.generateRun(scopedDb, definition.id, {
        moduleManifests: getBuiltInModuleManifests(),
        runKind: "manual",
        composeDeps: makeComposeDeps(async () => ({ text: "synth narrative" }))
      })
    );
    const run = outcome?.run;

    expect(run?.status).toBe("succeeded");
    const meta = run?.source_metadata as {
      aiModel: { id: string; tier: string } | null;
      degraded: boolean;
    };
    expect(meta.degraded).toBe(false);
    expect(meta.aiModel).not.toBeNull();
    expect(meta.aiModel?.id).toBe(modelRow.id);
    expect(meta.aiModel?.tier).toBe("economy");
  });

  it("briefing tool execute receives a non-empty actorUserId and requestId in ToolContext", async () => {
    // compose gathers from a FIXED set of read tools (commitments/tasks/calendar/email/
    // chats). To assert the ToolContext compose passes to a tool's execute, supply ONLY a
    // capturing manifest that owns one of those names — so it is the sole match compose
    // finds and executes exactly once.
    const capturedContexts: { actorUserId: string; requestId: string }[] = [];
    const capturingManifest: JarvisModuleManifest = {
      id: "ctx-check",
      name: "CtxCheck",
      version: "0.0.0",
      publisher: "test",
      lifecycle: "optional",
      compatibility: { jarv1s: "*" },
      assistantTools: [
        {
          name: "commitments.listVisible",
          description: "Captures ToolContext for assertion.",
          permissionId: "commitments.view",
          risk: "read" as const,
          execute: async (_db, _input, ctx) => {
            capturedContexts.push({ actorUserId: ctx.actorUserId, requestId: ctx.requestId });
            return { data: { commitments: [] } };
          }
        }
      ]
    };

    const def = await dataContext.withDataContext(
      { actorUserId: ids.userA, requestId: "r:briefing-ctx-test" },
      (scopedDb) =>
        repository.createDefinition(scopedDb, {
          title: "ToolContext check",
          selectedToolNames: ["commitments.listVisible"]
        })
    );

    const outcome = await dataContext.withDataContext(
      { actorUserId: ids.userA, requestId: "r:briefing-ctx-run" },
      (scopedDb) =>
        repository.generateRun(scopedDb, def.id, {
          moduleManifests: [capturingManifest],
          runKind: "manual",
          composeDeps: makeComposeDeps(undefined, [capturingManifest])
          // omit runId — let repository generate a UUID
        })
    );

    expect(outcome?.run).toBeDefined();
    expect(capturedContexts).toHaveLength(1);
    expect(capturedContexts[0]!.actorUserId).toBe(ids.userA);
    expect(capturedContexts[0]!.requestId).not.toBe("");
    expect(capturedContexts[0]!.requestId).toMatch(/^briefing:|^pgboss:/);
  });

  it("never leaks the decrypted provider credential into a synthesized run", async () => {
    const aiRepository = new AiRepository();
    const provider = await dataContext.withDataContext(adminContext(), (scopedDb) =>
      aiRepository.createProvider(scopedDb, {
        providerKind: "anthropic",
        displayName: "Secret summarizer",
        encryptedCredential: createAiSecretCipher().encryptJson({ apiKey: "sk-SECRET-123" })
      })
    );
    await dataContext.withDataContext(adminContext(), (scopedDb) =>
      aiRepository.createModel(scopedDb, {
        providerConfigId: provider.id,
        providerModelId: "secret-summarizer",
        displayName: "Secret Summarizer",
        capabilities: ["summarization"],
        tier: "economy"
      })
    );
    const definition = await dataContext.withDataContext(userBContext(), (scopedDb) =>
      repository.createDefinition(scopedDb, {
        title: "Secrets briefing",
        selectedToolNames: ["tasks.list"]
      })
    );

    const outcome = await dataContext.withDataContext(userBContext(), (scopedDb) =>
      repository.generateRun(scopedDb, definition.id, {
        moduleManifests: getBuiltInModuleManifests(),
        runKind: "manual",
        // The fake adapter echoing the secret would be the worst case; prove the secret
        // never reaches summary_text or source_metadata regardless of synthesis output.
        composeDeps: makeComposeDeps(async () => ({ text: "synth narrative" }))
      })
    );
    const run = outcome?.run;

    expect(run?.status).toBe("succeeded");
    expect(run?.summary_text ?? "").not.toContain("sk-SECRET-123");
    expect(JSON.stringify(run?.source_metadata)).not.toContain("sk-SECRET-123");
  });

  it("is idempotent for scheduled runs on the same local day", async () => {
    const definition = await dataContext.withDataContext(userAContext(), (scopedDb) =>
      repository.createDefinition(scopedDb, {
        title: "Scheduled idempotency briefing",
        cadence: "daily",
        scheduleMetadata: { targetTime: "06:00", timezone: "UTC" },
        selectedToolNames: ["tasks.list"]
      })
    );

    const first = await dataContext.withDataContext(userAContext(), (scopedDb) =>
      repository.generateRun(scopedDb, definition.id, {
        moduleManifests: getBuiltInModuleManifests(),
        runKind: "scheduled",
        composeDeps: makeComposeDeps(async () => ({ text: "synth narrative" }))
      })
    );
    const second = await dataContext.withDataContext(userAContext(), (scopedDb) =>
      repository.generateRun(scopedDb, definition.id, {
        moduleManifests: getBuiltInModuleManifests(),
        runKind: "scheduled",
        composeDeps: makeComposeDeps(async () => ({ text: "synth narrative" }))
      })
    );

    expect(first?.created).toBe(true);
    expect(second?.created).toBe(false);
    expect(second?.run.id).toBe(first?.run.id);

    const runs = await dataContext.withDataContext(userAContext(), (scopedDb) =>
      repository.listRuns(scopedDb, definition.id)
    );
    expect(runs.filter((r) => r.run_kind === "scheduled")).toHaveLength(1);
  });

  it("scheduled worker job without a briefingRunId mints one, persists the run, and notifies the owner", async () => {
    const definition = await dataContext.withDataContext(userAContext(), (scopedDb) =>
      repository.createDefinition(scopedDb, {
        title: "Scheduled notify briefing",
        cadence: "daily",
        scheduleMetadata: { targetTime: "06:00", timezone: "UTC" },
        selectedToolNames: ["tasks.list"]
      })
    );

    const resultPromise = handleNextBriefingJobWithNotifications(workerBoss);
    // A scheduled cron fire carries NO briefingRunId — pure metadata only. In production
    // the cron schedule keys the job by definition id (reconcileSchedule), so give this
    // direct send a unique singletonKey so the `exclusive` queue actually enqueues it
    // (a keyless send would collapse onto another keyless job under `exclusive`).
    await appBoss.send(
      BRIEFINGS_RUN_QUEUE,
      {
        actorUserId: ids.userA,
        definitionId: definition.id,
        runKind: "scheduled"
      } satisfies BriefingRunPayload,
      { singletonKey: `${definition.id}:sched:1` }
    );
    const result = await resultPromise;

    expect(result.status).toBe("succeeded");
    expect(result.created).toBe(true);
    // The worker minted a run id even though the payload carried none.
    expect(result.runId).toMatch(/^[0-9a-f-]{36}$/);

    const runs = await dataContext.withDataContext(userAContext(), (scopedDb) =>
      repository.listRuns(scopedDb, definition.id)
    );
    expect(runs.filter((r) => r.run_kind === "scheduled")).toHaveLength(1);
    expect(runs[0]?.id).toBe(result.runId);

    const { notifications } = await dataContext.withDataContext(userAContext(), (scopedDb) =>
      notificationsRepository.listVisible(scopedDb)
    );
    const briefingNotifications = notifications.filter(
      (n) => n.title === "Your morning briefing is ready"
    );
    expect(briefingNotifications).toHaveLength(1);
    const notification = briefingNotifications[0]!;
    expect(notification.recipient_user_id).toBe(ids.userA);
    // Metadata-only: definition + run ids, never briefing content.
    expect(notification.metadata).toEqual({
      definitionId: definition.id,
      briefingRunId: result.runId
    });
    expect(notification.body).toBeNull();
  });

  it("manual worker job does not create a briefing-ready notification", async () => {
    const definition = await dataContext.withDataContext(userAContext(), (scopedDb) =>
      repository.createDefinition(scopedDb, {
        title: "Manual no-notify briefing",
        selectedToolNames: ["tasks.list"]
      })
    );

    const resultPromise = handleNextBriefingJobWithNotifications(workerBoss);
    await appBoss.send(
      BRIEFINGS_RUN_QUEUE,
      {
        actorUserId: ids.userA,
        definitionId: definition.id,
        briefingRunId: "7d000000-0000-4000-8000-000000000001",
        runKind: "manual",
        idempotencyKey: "briefing-manual-no-notify"
      } satisfies BriefingRunPayload,
      { singletonKey: `${definition.id}:key:briefing-manual-no-notify` }
    );
    const result = await resultPromise;

    expect(result.status).toBe("succeeded");
    expect(result.created).toBe(true);

    const { notifications } = await dataContext.withDataContext(userAContext(), (scopedDb) =>
      notificationsRepository.listVisible(scopedDb)
    );
    expect(
      notifications.filter(
        (n) =>
          n.title === "Your morning briefing is ready" &&
          (n.metadata as { briefingRunId?: string }).briefingRunId ===
            "7d000000-0000-4000-8000-000000000001"
      )
    ).toHaveLength(0);
  });

  it("does not re-notify on an idempotent same-day scheduled re-fire (exactly one notification)", async () => {
    const definition = await dataContext.withDataContext(userAContext(), (scopedDb) =>
      repository.createDefinition(scopedDb, {
        title: "Scheduled dedupe-notify briefing",
        cadence: "daily",
        scheduleMetadata: { targetTime: "06:00", timezone: "UTC" },
        selectedToolNames: ["tasks.list"]
      })
    );

    const firstPromise = handleNextBriefingJobWithNotifications(workerBoss);
    await appBoss.send(
      BRIEFINGS_RUN_QUEUE,
      {
        actorUserId: ids.userA,
        definitionId: definition.id,
        runKind: "scheduled"
      } satisfies BriefingRunPayload,
      // Distinct singletonKeys so BOTH fires enqueue and reach the worker — the dedupe
      // under test is the repository's local-day idempotency, NOT pg-boss singleton.
      { singletonKey: `${definition.id}:sched:dedupe:1` }
    );
    const first = await firstPromise;
    expect(first.created).toBe(true);

    const secondPromise = handleNextBriefingJobWithNotifications(workerBoss);
    await appBoss.send(
      BRIEFINGS_RUN_QUEUE,
      {
        actorUserId: ids.userA,
        definitionId: definition.id,
        runKind: "scheduled"
      } satisfies BriefingRunPayload,
      { singletonKey: `${definition.id}:sched:dedupe:2` }
    );
    const second = await secondPromise;
    // The second fire is an idempotent same-local-day skip.
    expect(second.created).toBe(false);
    expect(second.runId).toBe(first.runId);

    const { notifications } = await dataContext.withDataContext(userAContext(), (scopedDb) =>
      notificationsRepository.listVisible(scopedDb)
    );
    expect(
      notifications.filter(
        (n) =>
          n.title === "Your morning briefing is ready" &&
          (n.metadata as { definitionId?: string }).definitionId === definition.id
      )
    ).toHaveLength(1);
  });
});
