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
import { HostPinningViolationError } from "@jarv1s/host-fetch";
import { assertModuleJobPayload, type ExternalModuleJobPayload } from "@jarv1s/jobs";
import type { ExternalModuleDiscovery } from "@jarv1s/module-registry";
import type {
  ExternalModuleAiRequest,
  ExternalModuleAiResult,
  ExternalModuleAttachmentText,
  ExternalModuleWorkerRuntime
} from "@jarv1s/module-registry/node";
import type { ExternalModuleQueueDeclaration } from "@jarv1s/module-sdk";
import type { CreateNotificationInput } from "@jarv1s/notifications";
import type { ModuleCredentialCipher } from "@jarv1s/settings";

import { createVerifiedExternalModuleInvoker } from "./external-module-invoke.js";

// ---------------------------------------------------------------------------
// #1306 Task 22: a host-only, opt-in fetch bypass for UAT/e2e runs.
//
// Generic on purpose — keyed on nothing about job-search, so any external
// module's UAT spec can turn it on. Lives here (rather than in
// external-module-invoke.ts, which owns the actual `createExternalModuleRpcHandler`
// construction site) because this is the file the worker composes a queue
// handler from — see registerWorker in worker.ts, which calls
// createExternalModuleJobHandler() exactly once per queue at boot time inside
// externalReconciler.reconcileAll(). "Read at handler construction" therefore
// means read once at worker startup, never per-job.
//
// Three routes to a deterministic fixture were considered and rejected (full
// reasoning in docs/superpowers/handoffs/2026-07-27-job-search/parts/27-task22-e2e.md):
// ctx.fetch itself refuses a Compose-network 10.x address before the allowlist
// is even consulted; Playwright route interception can't see a worker child
// process's requests; and a module-side env read is dead code because a worker
// child's environment is exactly three keys (LANG, LC_ALL, TZ) — none of them
// this one. Injecting `createFetch` at the host, in the worker app, is the only
// seam that leaves the module's shipped bytes identical between UAT and prod.
// ---------------------------------------------------------------------------

/**
 * Decides whether the fixture-fetch bypass is active this process, and fails
 * loudly if it is half-configured.
 *
 * The guard is POSITIVE and `NODE_ENV` plays no part. `process.env.NODE_ENV
 * !== "production"` is fail-OPEN: NODE_ENV is unset in a plain `node
 * dist/index.js`, in a container that forgot to set it, and in most systemd
 * units, and `undefined !== "production"` is true — a bypass whose guard
 * defaults to "on" is not a guard. JARVIS_RUNTIME_MODE is net-new (nothing
 * else in the tree reads it); unset never opens the seam.
 *
 * Returns an object with a `createFetch` key ONLY when the bypass is active —
 * callers must spread the result (`...resolveE2eFetchOverride()`) rather than
 * read a possibly-undefined property, so a stray `createFetch: undefined`
 * can never slip past a `??` further down the chain undetected.
 */
export function resolveE2eFetchOverride(env: NodeJS.ProcessEnv = process.env): {
  readonly createFetch?: (allowedHosts: readonly string[]) => typeof fetch;
} {
  const e2eMode = env.JARVIS_RUNTIME_MODE === "e2e";
  const fixtureBase = env.JARVIS_E2E_MODULE_FETCH_BASE;

  if (fixtureBase && !e2eMode) {
    throw new Error(
      'JARVIS_E2E_MODULE_FETCH_BASE is set but JARVIS_RUNTIME_MODE is not "e2e". ' +
        "This variable enables a host-fetch bypass and must never be set outside the UAT harness."
    );
  }

  if (!e2eMode || !fixtureBase) {
    return {};
  }

  return { createFetch: createE2eFixtureFetch(fixtureBase) };
}

/**
 * Builds a `createFetch` override with the exact shape
 * `createExternalModuleRpcHandler`'s `createFetch` option expects
 * (`(allowedHosts) => typeof fetch`, see worker-rpc-host.ts's `fetch.request`
 * RPC method) — answers from a static fixture origin (`base`) instead of the
 * real internet.
 *
 * Still enforces the module's declared `fetchHosts` BEFORE rewriting the
 * origin, exactly as `createHostPinnedFetch` enforces them for a real fetch:
 * a fixture fetch that answered every hostname would silently disable the one
 * check `fetchHosts` exists to make, handing the module the open internet in
 * disguise. `base` must already be reachable from inside the worker container
 * — this function does no container-vs-host address translation of its own,
 * it only rewrites the path+query onto whatever origin it is given.
 */
export function createE2eFixtureFetch(
  base: string
): (allowedHosts: readonly string[]) => typeof fetch {
  const baseUrl = new URL(base);
  return (allowedHosts: readonly string[]) => {
    const allowed = new Set(allowedHosts);
    return (async (input, init) => {
      const requestedUrl = new URL(
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url
      );
      if (!allowed.has(requestedUrl.hostname)) {
        throw new HostPinningViolationError(requestedUrl.hostname, "host_not_declared");
      }
      const rewritten = new URL(`${requestedUrl.pathname}${requestedUrl.search}`, baseUrl);
      return fetch(rewritten, init);
    }) as typeof fetch;
  };
}

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
  // ctx.attachments.readText (#109 parity fix): threaded straight through to the shared
  // trust gate below, same optional-pass-through shape as `postNotification` above — see
  // external-module-invoke.ts's own comment on VerifiedExternalModuleInvokerDeps for why
  // this was missing.
  readonly readAttachmentText?: (
    access: AccessContext,
    attachmentId: string
  ) => Promise<ExternalModuleAttachmentText | null>;
  // Passed to the shared trust gate so a REJECTED job says so in the worker log. Without
  // it a gate refusal is a `completed` pg-boss row with NULL output and total log silence
  // — see external-module-invoke.ts's own note on this dep. Optional so existing test
  // callers keep compiling unchanged.
  readonly logger?: {
    readonly warn: (obj: Record<string, unknown>, msg?: string) => void;
  };
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
    postNotification: deps.postNotification,
    readAttachmentText: deps.readAttachmentText,
    logger: deps.logger,
    ...resolveE2eFetchOverride()
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
