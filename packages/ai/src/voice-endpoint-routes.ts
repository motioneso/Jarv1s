import type { FastifyInstance } from "fastify";

import { HttpError, handleRouteError as handleModuleRouteError } from "@jarv1s/module-sdk";
import {
  getVoiceEndpointRouteSchema,
  putVoiceEndpointRouteSchema,
  type AiVoiceEndpointDto,
  type PutVoiceEndpointRequest
} from "@jarv1s/shared";

import type { AiSecretCipher } from "./crypto.js";
import {
  VoiceEndpointKeyRequiredError,
  type AiRepository,
  type VoiceEndpointRow
} from "./repository.js";
import { assertInstanceAdmin, type AiRoutesDependencies } from "./routes.js";

/**
 * #874 — dedicated Voice (STT) admin endpoint routes.
 *
 * This is deliberately its OWN route pair, NOT the generic provider-create handler:
 *   - CRIT-1: creating/updating the voice endpoint runs NO auto-discovery. `upsertVoiceEndpoint`
 *     writes exactly one `purpose='voice'` provider row + one `transcription` model row and stops —
 *     it never probes /models and never touches assistant routing.
 *   - The endpoint is a single instance-wide OpenAI-compatible transcription target (base URL +
 *     API key + free-text model name). No vendor catalog, no per-user config.
 *   - Both GET and PUT are admin-gated (`assertInstanceAdmin`) — this is an instance-admin config
 *     surface, not a per-user one.
 *   - The API key is WRITE-ONLY: it is accepted on PUT (encrypted at rest via the same
 *     AiSecretCipher used for LLM providers) and NEVER returned in any DTO. `hasKey` reports only
 *     whether a credential is stored. On edit the key is omit-means-keep (MED-8).
 */
export function registerAiVoiceEndpointRoutes(
  server: FastifyInstance,
  dependencies: AiRoutesDependencies,
  repository: AiRepository,
  secretCipher: AiSecretCipher
): void {
  server.get(
    "/api/ai/voice-endpoint",
    { schema: getVoiceEndpointRouteSchema },
    async (request, reply) => {
      try {
        const accessContext = await dependencies.resolveAccessContext(request);
        const endpoint = await dependencies.dataContext.withDataContext(
          accessContext,
          async (scopedDb) => {
            await assertInstanceAdmin(repository, scopedDb, accessContext.actorUserId);
            return repository.getVoiceEndpoint(scopedDb);
          }
        );
        return { endpoint: toVoiceEndpointDto(endpoint) };
      } catch (error) {
        return handleRouteError(error, reply);
      }
    }
  );

  server.put(
    "/api/ai/voice-endpoint",
    { schema: putVoiceEndpointRouteSchema },
    async (request, reply) => {
      try {
        const accessContext = await dependencies.resolveAccessContext(request);
        const body = request.body as PutVoiceEndpointRequest;

        // Encrypt the API key at the edge — the repository only ever sees the sealed credential, and
        // the plaintext key never lives past this scope. Omitted apiKey => omit-means-keep (the
        // repository leaves the stored credential untouched); a present key replaces it.
        const encryptedCredential =
          body.apiKey === undefined ? undefined : secretCipher.encryptJson({ apiKey: body.apiKey });

        const endpoint = await dependencies.dataContext.withDataContext(
          accessContext,
          async (scopedDb) => {
            await assertInstanceAdmin(repository, scopedDb, accessContext.actorUserId);
            return repository.upsertVoiceEndpoint(scopedDb, {
              baseUrl: body.baseUrl,
              modelName: body.modelName,
              // #886 NIT: pass the toggle through as-is. Omitted => omit-means-keep (create defaults
              // to enabled; edit leaves the current status untouched) — an absent toggle never
              // silently re-enables a disabled endpoint.
              enabled: body.enabled,
              encryptedCredential
            });
          }
        );
        return { endpoint: toVoiceEndpointDto(endpoint) };
      } catch (error) {
        if (error instanceof VoiceEndpointKeyRequiredError) {
          // Creating a fresh voice endpoint with no key => 400 (a keyless endpoint can never
          // transcribe). Distinct from the omit-means-keep edit path, which is allowed.
          return handleRouteError(
            new HttpError(400, "An API key is required to configure the voice endpoint"),
            reply
          );
        }
        return handleRouteError(error, reply);
      }
    }
  );
}

/**
 * Map the repository view to the wire DTO. This is the sole place the voice endpoint crosses the
 * API boundary — and it drops the credential entirely: only `hasKey` (whether one is stored) is
 * exposed, never the key itself (plaintext or ciphertext).
 */
function toVoiceEndpointDto(endpoint: VoiceEndpointRow | null): AiVoiceEndpointDto {
  if (!endpoint) {
    return { configured: false, enabled: false, baseUrl: null, modelName: null, hasKey: false };
  }
  return {
    configured: true,
    enabled: endpoint.provider.status === "active",
    baseUrl: endpoint.provider.base_url,
    modelName: endpoint.modelName,
    hasKey: endpoint.provider.has_credential
  };
}

function handleRouteError(error: unknown, reply: Parameters<typeof handleModuleRouteError>[1]) {
  return handleModuleRouteError(error, reply, {
    invalidRequestMessage: "Voice endpoint request is invalid"
  });
}
