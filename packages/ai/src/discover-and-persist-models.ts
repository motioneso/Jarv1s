import type { DataContextDb } from "@jarv1s/db";
import type { AiAuthMethod, AiProviderKind } from "@jarv1s/shared";

import { hasCliStaticModels, type ModelDiscoveryService } from "./model-discovery.js";
import type { AiRepository } from "./repository.js";

export interface DiscoverAndPersistModelsInput {
  readonly actorUserId: string;
  readonly providerId: string;
  readonly providerKind: AiProviderKind;
  readonly authMethod: AiAuthMethod;
  readonly baseUrl: string | null;
  readonly credential: unknown;
}

/**
 * #982/#869 D2/D6: one discovery path for create, update, login-ready, and list self-heal.
 * CLI providers backed by curated data are intentionally replaced, not merged: Ben requested a
 * clean slate that deletes stale/manual rows while preserving the #367 sentinel. API-key providers
 * keep insert-only behavior because their live `/models` response must not erase admin choices.
 */
export async function discoverAndPersistModels(
  scopedDb: DataContextDb,
  input: DiscoverAndPersistModelsInput,
  deps: { readonly repository: AiRepository; readonly modelDiscovery: ModelDiscoveryService }
): Promise<void> {
  const discovered = await deps.modelDiscovery.discoverModels(
    `${input.actorUserId}:${input.providerId}`,
    {
      providerKind: input.providerKind,
      authMethod: input.authMethod,
      baseUrl: input.baseUrl,
      credential: input.credential
    }
  );
  const replaceCliModels = input.authMethod === "cli" && hasCliStaticModels(input.providerKind);

  if (replaceCliModels) {
    await deps.repository.deleteModelsForProviderExceptSentinel(scopedDb, input.providerId);
  }
  if (!replaceCliModels && discovered.fromFallback) return;

  await deps.repository.upsertDiscoveredModels(
    scopedDb,
    input.providerId,
    discovered.models.map((model) => ({ ...model, status: "active" as const }))
  );
}
