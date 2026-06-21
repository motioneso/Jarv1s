/**
 * #367 — auto-register a default chat-capable model on provider login `ready`.
 *
 * After a provider's login settles `ready`, the founder should have a working chat model with ZERO
 * manual entry (no Admin → Add provider → Add model detour). This service, called from the login
 * chokepoint (`persistLoginTerminal` ready branch, wired in @jarv1s/module-registry), idempotently
 * ensures an AI provider config + a default chat model exist for the provider.
 *
 * PROVIDER-AGNOSTIC (CLAUDE.md Hard Invariant): the default lives in the per-provider data map
 * {@link DEFAULT_CHAT_MODELS}; the service is generic over `AiProviderKind`. Adding a provider is a
 * new map entry — no new code path. No provider/model is hardcoded in a code path.
 */

import type { AiModelCapability } from "@jarv1s/shared";
import type { AiModelTier, AiProviderKind, DataContextDb } from "@jarv1s/db";

import type { AiSecretCipher } from "./crypto.js";
import { AiRepository } from "./repository.js";

/** A provider's data-driven default chat model (registered on login `ready`). */
export interface DefaultChatModel {
  /**
   * The provider model id passed to the CLI. The ALIAS, not a pinned full id (decision 2): for
   * anthropic this is `sonnet`, so the default stays current across Sonnet releases instead of
   * going stale on a pinned dated id.
   */
  readonly providerModelId: string;
  /** Display name for the model row. */
  readonly displayName: string;
  /** Display name for the provider config created when none is reused. */
  readonly providerDisplayName: string;
  readonly tier: AiModelTier;
  readonly capabilities: readonly AiModelCapability[];
}

/**
 * Per-provider default chat model registered on login `ready`. Data-driven and provider-agnostic —
 * a provider WITHOUT an entry here is simply not auto-registered (no-op), never an error.
 */
export const DEFAULT_CHAT_MODELS: Partial<Record<AiProviderKind, DefaultChatModel>> = {
  anthropic: {
    providerModelId: "sonnet",
    displayName: "Claude Sonnet",
    providerDisplayName: "Claude",
    tier: "interactive",
    capabilities: ["chat"]
  }
};

/** The seam the login flow calls on `ready`. Generic over `providerKind`. */
export interface AiAutoRegisterPort {
  ensureDefaultChatModel(scopedDb: DataContextDb, providerKind: AiProviderKind): Promise<void>;
}

/**
 * Idempotently ensures a CLI provider config + a default chat model exist for a provider after its
 * login settles `ready`. Idempotency / gate semantics (locked, #367):
 *
 *   - reuse a NON-REVOKED config of this kind if present, else create one (`authMethod: "cli"`,
 *     `status: "active"`, NO real credential — the sealed `{ cli: true }` marker the Admin create
 *     path uses; the provider's auth lives in the cli-runner token store, not here);
 *   - create the default model ONLY when no chat-capable model row (ANY status) exists under a
 *     non-revoked config of this kind. This single gate is correct because models are never
 *     hard-deleted ("remove" = status `disabled`): it (a) avoids duplicates on re-login, (b) never
 *     resurrects a model the founder disabled, and (c) never clobbers a customized model (INSERT-only).
 *
 * Admin gating: the caller invokes this INSIDE the route's owner-admin-asserted, admin-scoped
 * `DataContextDb`; the branded handle + RLS ARE the gate (defense-in-depth), so this does not
 * re-assert. No secret is read, stored, logged, or returned here.
 */
export class AiAutoRegisterService implements AiAutoRegisterPort {
  private readonly repository: AiRepository;
  private readonly cipher: AiSecretCipher;

  constructor(deps: { readonly repository: AiRepository; readonly cipher: AiSecretCipher }) {
    this.repository = deps.repository;
    this.cipher = deps.cipher;
  }

  async ensureDefaultChatModel(
    scopedDb: DataContextDb,
    providerKind: AiProviderKind
  ): Promise<void> {
    const def = DEFAULT_CHAT_MODELS[providerKind];
    if (!def) return; // no catalog default for this provider — nothing to register.

    // Gate: a chat model already exists for this kind (active OR user-disabled) → leave it untouched.
    if (await this.repository.hasChatModelForProviderKind(scopedDb, providerKind)) return;

    // Reuse a non-revoked config of this kind, else create a cli (no-credential) one.
    const existing = await this.repository.findReusableProviderByKind(scopedDb, providerKind);
    const providerConfig =
      existing ??
      (await this.repository.createProvider(scopedDb, {
        providerKind,
        displayName: def.providerDisplayName,
        status: "active",
        authMethod: "cli",
        // CLI providers carry NO real credential — seal the same `{ cli: true }` marker the Admin
        // create path uses (no secret is stored or logged).
        encryptedCredential: this.cipher.encryptJson({ cli: true })
      }));

    await this.repository.createModel(scopedDb, {
      providerConfigId: providerConfig.id,
      providerModelId: def.providerModelId,
      displayName: def.displayName,
      capabilities: def.capabilities,
      status: "active",
      tier: def.tier
    });
  }
}
