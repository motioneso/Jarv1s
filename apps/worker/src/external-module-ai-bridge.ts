// apps/worker/src/external-module-ai-bridge.ts
//
// ctx.ai bridge for the queued-jobs path (JS-07 Step 0, spec D6 fold ruled by
// Coordinator 2026-07-11). Mirrors apps/api/src/external-module-ai-bridge.ts:
// it lives in the app (not module-registry) so worker.ts stays the only
// composition point and module-registry never imports @jarv1s/ai. The bridge
// runs on the actor-scoped DataContextDb the rpc host hands it — provider
// credentials resolve worker-side via AiRepository + AiSecretCipher and never
// touch the pg-boss payload.
import type { FastifyBaseLogger } from "fastify";

import { createAiSecretCipher, generateStructured, type AiRepository } from "@jarv1s/ai";
import type { DataContextDb } from "@jarv1s/db";
import type { ExternalModuleAiRequest, ExternalModuleAiResult } from "@jarv1s/module-registry/node";

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
  return async (scopedDb, moduleId, request) => {
    try {
      const result = await generateStructured(
        scopedDb,
        { service: `module.${moduleId}`, ...request },
        { repository: input.aiRepository, cipher, logger: input.logger }
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
