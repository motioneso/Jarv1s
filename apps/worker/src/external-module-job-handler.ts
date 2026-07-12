// apps/worker/src/external-module-job-handler.ts
//
// Per-job handler for external-module queues, extracted verbatim from the
// inline closure in worker.ts (JS-07 Step 0) so the queue path is testable
// with real deps in tests/integration/module-worker-queue-ai.test.ts.
// Behavior is identical to the pre-extraction closure; the only addition is
// the optional `ai` dep, adapted to the rpc host's 2-arg shape exactly like
// apps/api/src/external-module-tools.ts does for assistant tools. Handlers
// built without `ai` keep failing closed (host throws `invalid_rpc`).
import type { Job } from "pg-boss";
import type { Kysely } from "kysely";

import type { DataContextDb, DataContextRunner, JarvisDatabase } from "@jarv1s/db";
import { assertModuleJobPayload, type ExternalModuleJobPayload } from "@jarv1s/jobs";
import type { ExternalModuleDiscovery } from "@jarv1s/module-registry";
import { createExternalModuleRpcHandler } from "@jarv1s/module-registry/node";
import type {
  ExternalModuleAiRequest,
  ExternalModuleAiResult,
  ExternalModuleWorkerRuntime
} from "@jarv1s/module-registry/node";
import type { ExternalModuleQueueDeclaration } from "@jarv1s/module-sdk";
import type { ModuleCredentialCipher } from "@jarv1s/settings";

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
}

export function createExternalModuleJobHandler(
  deps: ExternalModuleJobHandlerDeps
): (job: Job<ExternalModuleJobPayload>) => Promise<unknown> {
  const { module, queue, runtime, workerDb, dataContext, cipher, ai } = deps;
  return async (job) => {
    assertModuleJobPayload(queue, job.data);
    if (!(await deps.listActiveUserIds(module.id)).includes(job.data.actorUserId)) return;
    const current = deps.discoveryById.get(module.id);
    if (!current) return;
    const state = await workerDb
      .selectFrom("app.external_modules")
      .select(["status", "manifest_hash", "package_hash"])
      .where("id", "=", module.id)
      .executeTakeFirst();
    if (
      state?.status !== "enabled" ||
      state.manifest_hash !== current.manifestHash ||
      state.package_hash !== current.packageHash
    ) {
      return;
    }
    const requestId = `module-job:${job.id}`;
    const rpc = createExternalModuleRpcHandler({
      module: current,
      toolRisk: "write",
      actorUserId: job.data.actorUserId,
      requestId,
      workerDataContext: dataContext,
      cipher,
      isActorAdmin: () =>
        dataContext.withDataContext(
          { actorUserId: job.data.actorUserId, requestId },
          async (scopedDb) =>
            (
              await scopedDb.db
                .selectFrom("app.users")
                .select("is_instance_admin")
                .where("id", "=", job.data.actorUserId)
                .executeTakeFirst()
            )?.is_instance_admin === true
        ),
      ...(ai ? { ai: (scopedDb, request) => ai(scopedDb, module.id, request) } : {})
    });
    return runtime.invoke(
      current,
      queue.handler,
      {
        actorUserId: job.data.actorUserId,
        jobKind: job.data.jobKind,
        idempotencyKey: `${job.data.moduleId}:${job.data.jobKind}:${job.id}`,
        params: job.data.params ?? {}
      },
      rpc
    );
  };
}
