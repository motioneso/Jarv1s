// apps/worker/src/external-module-invoke.ts
//
// #1282 Task 2: the shared trust gate for calling into an external (JSON-manifest) module's
// worker process. ExternalModuleWorkerRuntime.invoke() verifies NOTHING by itself — it just
// takes a discovery and starts it (worker-runtime.ts:55). Every check (active-user
// membership, status, and both manifest_hash and package_hash against the on-disk
// discovery) used to live inline in createExternalModuleJobHandler, the only caller. Now
// there are two callers (the job queue path, and the briefing composer's worker invoker), so
// the gate is extracted into this one helper and the job handler is rewritten to call it — a
// refactor of the job path, not an addition beside it. Two copies of a trust gate is one
// copy that rots.
import type { Kysely } from "kysely";

import type { ExternalBriefingInvoker } from "@jarv1s/briefings";
import type { AccessContext, DataContextDb, DataContextRunner, JarvisDatabase } from "@jarv1s/db";
import {
  createRuntimeEmbeddingProvider,
  type ExternalModuleDiscovery
} from "@jarv1s/module-registry";
import type { CreateNotificationInput } from "@jarv1s/notifications";
import { createExternalModuleRpcHandler } from "@jarv1s/module-registry/node";
import type {
  ExternalModuleAiRequest,
  ExternalModuleAiResult,
  ExternalModuleWorkerRuntime
} from "@jarv1s/module-registry/node";
import type { ModuleCredentialCipher } from "@jarv1s/settings";
import type { WorkerLane } from "@jarv1s/module-registry/node";

export interface VerifiedExternalModuleInvokeArgs {
  readonly moduleId: string;
  readonly handler: string;
  readonly actorUserId: string;
  readonly requestId: string;
  readonly jobKind: string;
  readonly idempotencyKey: string;
  readonly params: Record<string, unknown>;
  // #1286 Task 2e: which of the module's three separate child processes this call
  // runs on. Required, not defaulted — every caller (job handler, briefing invoker)
  // must say explicitly which actor/lane isolation boundary it wants; a silent
  // default here is exactly the kind of ambiguity that let two lanes share one
  // process before this task.
  readonly lane: WorkerLane;
  readonly toolRisk: "read" | "write";
  // Per-call override of the runtime's hard invocation ceiling (#1286 Task 2e); a
  // queue's manifest-declared, already-clamped timeoutMs flows through here.
  readonly timeoutMs?: number;
}

export type VerifiedExternalModuleInvokeResult =
  | { readonly ok: true; readonly result: unknown }
  | {
      readonly ok: false;
      readonly reason: "not-active" | "not-discovered" | "not-enabled" | "hash-mismatch";
    };

export type VerifiedInvoke = (
  args: VerifiedExternalModuleInvokeArgs
) => Promise<VerifiedExternalModuleInvokeResult>;

export interface VerifiedExternalModuleInvokerDeps {
  readonly workerDb: Kysely<JarvisDatabase>;
  readonly discoveryById: ReadonlyMap<string, ExternalModuleDiscovery>;
  readonly dataContext: DataContextRunner;
  readonly cipher: ModuleCredentialCipher;
  // Structural pick so tests can stub invoke while worker.ts passes the real runtime.
  readonly runtime: Pick<ExternalModuleWorkerRuntime, "invoke">;
  readonly listActiveUserIds: (moduleId: string) => Promise<readonly string[]>;
  // 3-arg app-level bridge (see external-module-ai-bridge.ts); bound to the module id inside
  // the constructed rpc handler below. Optional: not every caller wires AI.
  readonly ai?: (
    scopedDb: DataContextDb,
    moduleId: string,
    request: ExternalModuleAiRequest
  ) => Promise<ExternalModuleAiResult>;
  // ctx.notify (Task 2b, #1283): optional, mirroring `ai` above — a briefing
  // invocation always runs at toolRisk "read" (see createExternalBriefingInvoker
  // below), so notify.post fails closed there via worker-rpc-host.ts's own risk
  // gate regardless of whether this is wired; threading it through anyway keeps
  // one rpc-handler construction site for both callers, exactly like `ai`.
  readonly postNotification?: (
    access: AccessContext,
    input: CreateNotificationInput
  ) => Promise<void>;
}

export function createVerifiedExternalModuleInvoker(
  deps: VerifiedExternalModuleInvokerDeps
): VerifiedInvoke {
  return async (args) => {
    if (!(await deps.listActiveUserIds(args.moduleId)).includes(args.actorUserId)) {
      return { ok: false, reason: "not-active" };
    }
    const current = deps.discoveryById.get(args.moduleId);
    if (!current) {
      return { ok: false, reason: "not-discovered" };
    }
    const state = await deps.workerDb
      .selectFrom("app.external_modules")
      .select(["status", "manifest_hash", "package_hash"])
      .where("id", "=", args.moduleId)
      .executeTakeFirst();
    if (state?.status !== "enabled") {
      return { ok: false, reason: "not-enabled" };
    }
    // Compare package_hash, not manifest_hash alone (F10): manifest_hash goes stale on a
    // core change alone, so package_hash is the only real content anchor. Both are still
    // checked (parity with the pre-extraction job handler) — this is "not manifest_hash
    // alone", not "drop manifest_hash".
    if (
      state.manifest_hash !== current.manifestHash ||
      state.package_hash !== current.packageHash
    ) {
      return { ok: false, reason: "hash-mismatch" };
    }
    const rpc = createExternalModuleRpcHandler({
      module: current,
      toolRisk: args.toolRisk,
      actorUserId: args.actorUserId,
      requestId: args.requestId,
      workerDataContext: deps.dataContext,
      cipher: deps.cipher,
      // ctx.embed (#1281): threaded here too, same as the job path, so a briefing
      // invocation can embed exactly like a scheduled job can.
      embeddingProvider: () =>
        deps.dataContext.withDataContext(
          { actorUserId: args.actorUserId, requestId: args.requestId },
          (scopedDb) => createRuntimeEmbeddingProvider(scopedDb)
        ),
      isActorAdmin: () =>
        deps.dataContext.withDataContext(
          { actorUserId: args.actorUserId, requestId: args.requestId },
          async (scopedDb) =>
            (
              await scopedDb.db
                .selectFrom("app.users")
                .select("is_instance_admin")
                .where("id", "=", args.actorUserId)
                .executeTakeFirst()
            )?.is_instance_admin === true
        ),
      // ctx.notify (Task 2b, #1283): passed through as-is — unlike `ai` below, the
      // signature already matches what createExternalModuleRpcHandler expects, so
      // no per-call moduleId-binding wrapper is needed.
      postNotification: deps.postNotification,
      ...(deps.ai ? { ai: (scopedDb, request) => deps.ai!(scopedDb, args.moduleId, request) } : {})
    });
    const result = await deps.runtime.invoke(
      current,
      args.handler,
      {
        actorUserId: args.actorUserId,
        jobKind: args.jobKind,
        idempotencyKey: args.idempotencyKey,
        params: args.params
      },
      rpc,
      { lane: args.lane, timeoutMs: args.timeoutMs }
    );
    return { ok: true, result };
  };
}

// #1282 Task 2: adapts the shared trust gate above to the narrower ExternalBriefingInvoker
// shape collectExternalBriefingContributions calls (packages/briefings/src/external-contributions.ts).
// A briefing invocation is read-risk (it fetches a summary, it never writes), so toolRisk is
// fixed here rather than threaded through from the composer, which has no concept of it.
// A non-ok gate outcome is thrown, not returned — collectExternalBriefingContributions already
// swallows a rejection into "no contribution from this module" (J3), so the failure reason only
// ever reaches worker logs, never the composed briefing.
export function createExternalBriefingInvoker(
  deps: VerifiedExternalModuleInvokerDeps
): ExternalBriefingInvoker {
  const invoke = createVerifiedExternalModuleInvoker(deps);
  return async (args) => {
    const outcome = await invoke({
      moduleId: args.moduleId,
      handler: args.handler,
      actorUserId: args.actorUserId,
      requestId: args.requestId,
      jobKind: "briefing",
      idempotencyKey: `briefing:${args.section}:${args.moduleId}:${args.actorUserId}:${args.requestId}`,
      params: { section: args.section },
      toolRisk: "read",
      // #1286 Task 2e: briefings get their own lane/child process, separate from a
      // scheduled job or a same-tick tool call for the same module.
      lane: "briefing"
    });
    if (!outcome.ok) {
      throw new Error(`external module briefing invoke declined: ${outcome.reason}`);
    }
    return outcome.result;
  };
}
