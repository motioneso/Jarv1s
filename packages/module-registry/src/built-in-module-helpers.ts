import {
  AiRepository,
  HttpApiAdapter,
  createAiSecretCipher,
  parseAiApiKeyCredential,
  type ProviderKind
} from "@jarv1s/ai";
import type { DataContextDb, DataContextRunner } from "@jarv1s/db";
import {
  MemoryRepository,
  MemoryRetriever,
  createEmbeddingProvider,
  getEmbeddingProviderConfig
} from "@jarv1s/memory";
import { HttpError } from "@jarv1s/module-sdk";
import { PreferencesRepository } from "@jarv1s/structured-state";
import type { QuietHoursPort } from "@jarv1s/notifications";
import { renderPersonaText } from "@jarv1s/shared";
import { RuntimeConfigResolver, type PersonaPreviewInput } from "@jarv1s/settings";
import { UsefulnessFeedbackRepository } from "@jarv1s/usefulness-feedback";

export async function createRuntimeEmbeddingProvider(scopedDb: DataContextDb) {
  return createEmbeddingProvider(
    await getEmbeddingProviderConfig(new RuntimeConfigResolver(scopedDb))
  );
}

export const runtimeMemoryRetriever = {
  async retrieve(scopedDb: DataContextDb, query: string, limit?: number, sourceKind?: string) {
    const provider = await createRuntimeEmbeddingProvider(scopedDb);
    return new MemoryRetriever(provider, new MemoryRepository()).retrieve(
      scopedDb,
      query,
      limit,
      sourceKind
    );
  },
  async retrieveRecent(scopedDb: DataContextDb, limit?: number, sourceKind?: string) {
    const provider = await createRuntimeEmbeddingProvider(scopedDb);
    return new MemoryRetriever(provider, new MemoryRepository()).retrieveRecent(
      scopedDb,
      limit,
      sourceKind
    );
  }
};

const _quietHoursPreferencesRepo = new PreferencesRepository();
export const quietHoursPortImpl: QuietHoursPort = {
  getSettings: (scopedDb) => _quietHoursPreferencesRepo.get(scopedDb, "quiet-hours"),
  getLocaleTimezone: async (scopedDb) => {
    const locale = await _quietHoursPreferencesRepo.get(scopedDb, "locale");
    if (!locale || typeof locale !== "object" || Array.isArray(locale)) return null;
    const tz = (locale as Record<string, unknown>).timezone;
    return typeof tz === "string" && tz.length > 0 ? tz : null;
  }
};

export const usefulnessFeedbackRepository = new UsefulnessFeedbackRepository();

const PERSONA_PREVIEW_SAMPLE_TURN =
  "Give me a two-sentence morning check-in for a day with one important task and one slipped commitment.";
const PERSONA_PREVIEW_MAX_OUTPUT_TOKENS = 180;

export function createDefaultPersonaPreview(
  dataContext: DataContextRunner
): (input: PersonaPreviewInput) => Promise<string> {
  const aiRepository = new AiRepository();
  const cipher = createAiSecretCipher();

  return async (input) =>
    dataContext.withDataContext(
      { actorUserId: input.actorUserId, requestId: "settings:persona-preview" },
      async (scopedDb) => {
        const model = await aiRepository.selectModelForCapability(scopedDb, "chat");
        if (!model) {
          throw new HttpError(503, "No active chat-capable model is configured");
        }

        const provider = await aiRepository.selectProviderWithCredential(
          scopedDb,
          model.provider_config_id
        );
        if (!provider?.encrypted_credential) {
          throw new HttpError(503, "Chat model credential is not configured");
        }

        let apiKey: string;
        try {
          const credential = parseAiApiKeyCredential(
            cipher.decryptJson(provider.encrypted_credential)
          );
          if (!credential) {
            throw new Error("missing api key");
          }
          apiKey = credential.apiKey;
        } catch {
          throw new HttpError(503, "Chat model credential is not configured");
        }

        const personaBlock = renderPersonaText({
          assistantName: input.assistantName,
          personaText: input.personaText,
          userName: input.userName
        });
        const adapter = new HttpApiAdapter(model.provider_kind as ProviderKind, apiKey, {
          baseUrl: provider.base_url ?? undefined
        });
        const { text } = await adapter.generateChat({
          model: {
            provider_kind: model.provider_kind,
            provider_model_id: model.provider_model_id
          },
          messages: [
            {
              role: "user",
              content: `${personaBlock}\n\n${PERSONA_PREVIEW_SAMPLE_TURN}`
            }
          ],
          maxOutputTokens: PERSONA_PREVIEW_MAX_OUTPUT_TOKENS
        });
        return text;
      }
    );
}
