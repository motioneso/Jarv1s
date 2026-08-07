// apps/worker/src/external-module-ai-bridge.ts
//
// ctx.ai bridge for the queued-jobs path (JS-07 Step 0, spec D6 fold ruled by
// Coordinator 2026-07-11). Mirrors apps/api/src/external-module-ai-bridge.ts:
// it lives in the app (not module-registry) so worker.ts stays the only
// composition point and module-registry never imports @moss/ai. The bridge
// runs on the actor-scoped DataContextDb the rpc host hands it — provider
// credentials resolve worker-side via AiRepository + AiSecretCipher and never
// touch the pg-boss payload.
import type { FastifyBaseLogger } from "fastify";

import { createAiSecretCipher, generateStructured, type AiRepository } from "@moss/ai";
import type { DataContextDb } from "@moss/db";
import { createCliStructuredAdapterFactory } from "@moss/module-registry";
import type { ExternalModuleAiRequest, ExternalModuleAiResult } from "@moss/module-registry/node";

export function createModuleWorkerAiBridge(input: {
  readonly aiRepository: AiRepository;
  readonly logger: Pick<FastifyBaseLogger, "info" | "warn">;
}): (
  scopedDb: DataContextDb,
  moduleId: string,
  request: ExternalModuleAiRequest
) => Promise<ExternalModuleAiResult> {
  // The AiSecretCipher is process-env keyed and stateless, so one instance
  // serves every invocation. (The ModuleCredentialCipher in worker.ts is a
  // different key domain — AI provider secrets use JARVIS_AI_SECRET_KEY.)
  const cipher = createAiSecretCipher();
  // Without this, every module worker AI call fails `needs_config` the moment the user's AI
  // provider is CLI-authenticated. `generateStructured` branches on `provider.auth_method`: a
  // "cli" provider holds a sealed marker rather than an API key, so there is nothing to decrypt
  // and the only way to reach the model is this adapter — and the function returns needs_config
  // outright when the factory is absent. apps/api's bridge has always supplied one; this one did
  // not, so structured work was silently API-only. A live Job Search run crawled 89 real postings
  // and scored none of them, reporting "No model is configured" against an account with three
  // active models, because both of its providers authenticate through the CLI.
  //
  // No engine is threaded in here, unlike apps/api which passes its configured `chatEngineFactory`
  // for test substitution: the worker has no such option and no @moss/chat dependency, and the
  // factory's own default (`selectEngineFactory()`) performs exactly the same transport selection
  // the API would arrive at. Imported from @moss/module-registry, which re-exports it, so this
  // stays inside the worker's existing package graph.
  const createCliStructuredAdapter = createCliStructuredAdapterFactory();
  return async (scopedDb, moduleId, request) => {
    try {
      const result = await generateStructured(
        scopedDb,
        { service: `module.${moduleId}`, ...request },
        { repository: input.aiRepository, cipher, logger: input.logger, createCliStructuredAdapter }
      );
      return result.ok
        ? // Drop usage: module workers never see token counts, model or provider ids.
          { ok: true, object: result.object }
        : { ok: false, error: result.error };
    } catch {
      // Bounds violations and unexpected throws stay opaque to modules.
      return { ok: false, error: "provider_error" };
    }
  };
}
