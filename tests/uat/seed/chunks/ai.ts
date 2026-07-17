import type { DataContextRunner } from "@jarv1s/db";
import { AiRepository, createAiSecretCipher } from "@jarv1s/ai";

/**
 * #1025 spec §4.4: without an active provider+model bound to module.news, the
 * news settings UI 503s ("Topic checking is unavailable right now" —
 * packages/news/src/settings/index.tsx). A fake, non-functional provider is
 * enough for UAT — Playwright only asserts the settings surface stops 503ing,
 * it never calls the real upstream AI API.
 */
export async function seedAiProviderChunk(
  runner: DataContextRunner,
  actorUserId: string,
  options: { readonly bindNews: boolean } = { bindNews: true }
): Promise<void> {
  if (!options.bindNews) return; // #1110: no default provider at all ⇒ hasJsonModel()
  // genuinely false — see resolveModelForService's implicit-default-provider fallback
  // (packages/ai/src/repository.ts resolveDefaultProviderId): merely leaving module.news
  // unbound is NOT enough, the provider still wins as instance-default otherwise.
  const repo = new AiRepository();
  const cipher = createAiSecretCipher();

  await runner.withDataContext({ actorUserId }, async (scopedDb) => {
    const provider = await repo.createProvider(scopedDb, {
      providerKind: "custom",
      displayName: "UAT Fake Provider",
      encryptedCredential: cipher.encryptJson({ cli: true }) // #1025: never a real credential
    });
    const model = await repo.createModel(scopedDb, {
      providerConfigId: provider.id,
      providerModelId: "uat-fake-json-model",
      displayName: "UAT Fake JSON Model",
      capabilities: ["json"]
    });
    await repo.setServiceBinding(
      scopedDb,
      "module.news",
      { kind: "model", modelId: model.id },
      actorUserId
    );
  });
}
