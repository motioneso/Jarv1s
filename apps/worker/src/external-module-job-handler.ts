// apps/worker/src/external-module-job-handler.ts
//
// Per-job handler for external-module queues, extracted verbatim from the
// inline closure in worker.ts (JS-07 Step 0) so the queue path is testable
// with real deps in tests/integration/module-worker-queue-ai.test.ts.
// #1282 Task 2: the trust gate this handler used to inline (active-user
// membership, status/manifest_hash/package_hash, actor-scoped rpc construction)
// is now shared with the briefing composer's worker invoker via
// createVerifiedExternalModuleInvoker (external-module-invoke.ts) — this file
// is a thin adapter from a pg-boss Job onto that shared gate, not a second
// copy of it. Behavior is unchanged: any non-ok gate result resolves to
// `undefined` exactly as the inline early-returns did.
import type { Job } from "pg-boss";
import type { Kysely } from "kysely";

import type { AccessContext, DataContextDb, DataContextRunner, JarvisDatabase } from "@jarv1s/db";
import { assertModuleJobPayload, type ExternalModuleJobPayload } from "@jarv1s/jobs";
import type { ExternalModuleDiscovery } from "@jarv1s/module-registry";
import type {
  ExternalModuleAiRequest,
  ExternalModuleAiResult,
  ExternalModuleWorkerRuntime
} from "@jarv1s/module-registry/node";
import type { ExternalModuleQueueDeclaration } from "@jarv1s/module-sdk";
import type { CreateNotificationInput } from "@jarv1s/notifications";
import type { ModuleCredentialCipher } from "@jarv1s/settings";

import { createVerifiedExternalModuleInvoker } from "./external-module-invoke.js";

export interface ExternalModuleJobHandlerDeps {
  readonly module: ExternalModuleDiscovery;
  readonly queue: ExternalModuleQueueDeclaration;
  // Structural pick so tests can stub invoke while worker.ts passes the real runtime.
  readonly runtime: Pick<ExternalModuleWorkerRuntime, "invoke">;
  readonly workerDb: Kysely<JarvisDatabase>;
  readonly dataContext: DataContextRunner;
  readonly cipher: ModuleCredentialCipher;
  readonly discoveryById: ReadonlyMap<string, ExternalModuleDiscovery>;
  readonly listActiveUserIds: (moduleId: string) => Promise<readonly string[]>;
  // 3-arg app-level bridge (see external-module-ai-bridge.ts); bound to the
  // module id below so the rpc host stays module-agnostic. Optional: only the
  // module-job registration gains it — every other handler path stays without.
  readonly ai?: (
    scopedDb: DataContextDb,
    moduleId: string,
    request: ExternalModuleAiRequest
  ) => Promise<ExternalModuleAiResult>;
  // ctx.notify (Task 2b, #1283): threaded through to the shared trust gate below,
  // same optional-pass-through shape as `ai` above — a queue job runs write-risk
  // by default (see toolRisk: "write" below), so this is the one worker path
  // where notify.post can actually succeed.
  readonly postNotification?: (
    access: AccessContext,
    input: CreateNotificationInput
  ) => Promise<void>;
}

export function createExternalModuleJobHandler(
  deps: ExternalModuleJobHandlerDeps
): (job: Job<ExternalModuleJobPayload>) => Promise<unknown> {
  const { module, queue } = deps;
  const invoke = createVerifiedExternalModuleInvoker({
    workerDb: deps.workerDb,
    discoveryById: deps.discoveryById,
    dataContext: deps.dataContext,
    cipher: deps.cipher,
    runtime: deps.runtime,
    listActiveUserIds: deps.listActiveUserIds,
    ai: deps.ai,
    postNotification: deps.postNotification
  });
  return async (job) => {
    assertModuleJobPayload(queue, job.data);
    const outcome = await invoke({
      moduleId: module.id,
      handler: queue.handler,
      actorUserId: job.data.actorUserId,
      requestId: `module-job:${job.id}`,
      jobKind: job.data.jobKind,
      idempotencyKey: `${job.data.moduleId}:${job.data.jobKind}:${job.id}`,
      params: job.data.params ?? {},
      // A queue job runs write-risk work by default (parity with the pre-extraction
      // inline gate, which always passed toolRisk: "write" here).
      toolRisk: "write",
      // #1286 Task 2e: the queue lane gets its own child process, separate from the
      // tool and briefing lanes, so a scheduled job can never share process state
      // (secrets, actor identity, AI-call budget) with a same-tick tool call or
      // briefing invocation for the same module.
      lane: "queue",
      // A queue's manifest-declared timeoutMs (already clamped to MAX_INVOCATION_MS
      // by validate.ts) becomes this invocation's hard ceiling; undefined falls back
      // to the runtime's own default.
      timeoutMs: queue.timeoutMs
    });
    if (!outcome.ok) return;
    return outcome.result;
  };
}
