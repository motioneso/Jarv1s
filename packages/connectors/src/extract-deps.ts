import type { createAiSecretCipher } from "@jarv1s/ai";
import {
  HttpApiAdapter,
  parseAiApiKeyCredential,
  type AiConfiguredModelSafeRow,
  type AiRepository,
  type ProviderKind
} from "@jarv1s/ai";
import type { DataContextDb } from "@jarv1s/db";

import type { EmailExtractDeps } from "./email-extract.js";

type AiSecretCipher = ReturnType<typeof createAiSecretCipher>;

/**
 * Build the model-selection + chat-call deps for extractEmailSignals against the actor's
 * configured AI providers. Shared by the Google/IMAP sync workers and the live-first
 * source-context triage path so the credential handling exists in exactly one place.
 */
export function buildEmailExtractDeps(
  scopedDb: DataContextDb,
  aiRepo: AiRepository,
  aiCipher: AiSecretCipher
): EmailExtractDeps {
  return {
    selectModel: (tier) => aiRepo.selectModelForCapability(scopedDb, "summarization", tier),
    runChat: async (model, prompt) => {
      // `model` is the AiConfiguredModelSafeRow returned by selectModelForCapability:
      // it carries provider_config_id, provider_kind, and provider_model_id directly.
      // Load + decrypt the provider credential in-process (never logged/forwarded), then
      // call the adapter.
      const row = model as AiConfiguredModelSafeRow;
      const provider = await aiRepo.selectProviderWithCredential(scopedDb, row.provider_config_id);
      if (!provider) return { text: "" };
      const credential = parseAiApiKeyCredential(
        aiCipher.decryptJson(provider.encrypted_credential)
      );
      if (!credential) return { text: "" };
      // HttpApiAdapter supports anthropic/openai-compatible/google (ProviderKind); narrow
      // the wider AiProviderKind at this boundary — the router already selected the model.
      const adapter = new HttpApiAdapter(
        row.provider_kind as ProviderKind,
        credential.apiKey,
        provider.base_url ? { baseUrl: provider.base_url } : {}
      );
      return adapter.generateChat({
        model: {
          provider_kind: row.provider_kind,
          provider_model_id: row.provider_model_id
        },
        messages: [{ role: "user", content: prompt }]
      });
    }
  };
}
