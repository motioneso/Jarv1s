import type { DataContextRunner } from "@jarv1s/db";
import { AiRepository, createAiSecretCipher } from "@jarv1s/ai";

/**
 * N42 (rulings-ledger.md#n42), Task 22's #57: job-search's scoring stage (external-modules/
 * job-search/src/worker/stages/score.ts) calls ctx.ai.generateStructured against whatever
 * provider/model is bound to the `module.job-search` service key. Gating the whole UAT spec
 * behind a real Anthropic token (REAL_CHAT_CONFIGURED) would leave scoring untested by default —
 * this seeds a real, working `openai-compatible` provider instead, pointed at
 * job-search-fixture-server.ts's POST /v1/chat/completions route (baseUrl), so scoring runs for
 * real over HTTP with zero external cost or token requirement.
 *
 * Mirrors seedAiProviderChunk's (./ai.ts) exact shape — same fake-credential pattern
 * (encryptedCredential is never a real secret, `providerKind`/`capabilities` are the only fields
 * that matter to the caller) — but binds `module.job-search` instead of `module.news`, and uses
 * `providerKind: "openai-compatible"` with a real `baseUrl` rather than `"custom"`, since this
 * provider actually has to answer a request instead of merely existing to unblock a settings 503.
 *
 * Opt-in only (see tests/uat/provisioner.ts's UatProvisionOptions.withJobSearchFixture and
 * tests/uat/seed/levels.ts's seedLevel): absent a baseUrl, this is never called at all. It is
 * deliberately NOT one of levels.ts's ADMIN_DATA_CHUNKS (N33) — creating an AI provider/model/
 * binding row is data-plane only (no external_modules row), but job-search's own UAT ruling is
 * that nothing job-search-shaped joins the default ladder, seed chunk or otherwise.
 */
export async function seedJobSearchAiProviderChunk(
  runner: DataContextRunner,
  actorUserId: string,
  baseUrl: string
): Promise<void> {
  const repo = new AiRepository();
  const cipher = createAiSecretCipher();

  await runner.withDataContext({ actorUserId }, async (scopedDb) => {
    const provider = await repo.createProvider(scopedDb, {
      providerKind: "openai-compatible",
      displayName: "UAT Job Search Fixture Provider",
      encryptedCredential: cipher.encryptJson({ apiKey: "uat-fixture-not-a-real-key" }),
      baseUrl
    });
    const model = await repo.createModel(scopedDb, {
      providerConfigId: provider.id,
      providerModelId: "uat-job-search-fixture-model",
      displayName: "UAT Job Search Fixture Model",
      capabilities: ["json"]
    });
    await repo.setServiceBinding(
      scopedDb,
      "module.job-search",
      { kind: "model", modelId: model.id },
      actorUserId
    );
  });
}
