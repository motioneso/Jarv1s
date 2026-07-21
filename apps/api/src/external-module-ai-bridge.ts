// apps/api/src/external-module-ai-bridge.ts
//
// ctx.ai bridge for module workers (#932, spec D6): adapts @jarv1s/ai
// generateStructured to the module-registry `ai` callback. Lives here (not in
// module-registry) so server.ts stays the only composition point and
// module-registry never imports @jarv1s/ai; the queued-jobs handler
// (apps/worker) is built without this bridge and fails closed.
import type { FastifyBaseLogger } from "fastify";

import {
  createAiSecretCipher,
  generateStructured,
  type AiRepository,
  type GenerateStructuredDeps
} from "@jarv1s/ai";
import type { DataContextDb } from "@jarv1s/db";
import type { ExternalModuleAiRequest, ExternalModuleAiResult } from "@jarv1s/module-registry/node";

export function createModuleAiBridge(input: {
  readonly aiRepository: AiRepository;
  readonly logger: Pick<FastifyBaseLogger, "info" | "warn">;
  readonly createCliStructuredAdapter: NonNullable<
    GenerateStructuredDeps["createCliStructuredAdapter"]
  >;
}): (
  scopedDb: DataContextDb,
  moduleId: string,
  request: ExternalModuleAiRequest
) => Promise<ExternalModuleAiResult> {
  // The AiSecretCipher is process-env keyed and stateless, so one instance
  // serves every invocation.
  const cipher = createAiSecretCipher();
  return async (scopedDb, moduleId, request) => {
    try {
      const result = await generateStructured(
        scopedDb,
        { service: `module.${moduleId}`, ...request },
        {
          repository: input.aiRepository,
          cipher,
          logger: input.logger,
          createCliStructuredAdapter: input.createCliStructuredAdapter
        }
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
