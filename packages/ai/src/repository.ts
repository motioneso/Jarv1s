import { randomUUID } from "node:crypto";

import { sql, type Kysely, type Updateable } from "kysely";

import {
  assertDataContextDb,
  type AiAssistantActionRequest,
  type AiAssistantActionRisk,
  type AiAssistantActionStatus,
  type AiAuthMethod,
  type AiConfiguredModelsTable,
  type AiModelStatus,
  type AiModelTier,
  type AiProviderConfigsTable,
  type AiProviderKind,
  type AiProviderStatus,
  type DataContextDb,
  type JarvisDatabase
} from "@jarv1s/db";
import type { AiCapabilityRouteReason, AiModelCapability } from "@jarv1s/shared";

import type { EncryptedAiSecret } from "./crypto.js";
import { parseCapabilityRouteMap } from "./capability-route-map.js";
import {
  CHAT_MODEL_OVERRIDE_PREFERENCE_KEY,
  CHAT_MODEL_OVERRIDE_SETTING_KEY,
  resolveChatModelOverride,
  type ChatModelOverrideCandidate
} from "./chat-model-override.js";

function jsonb(value: unknown) {
  return sql<Record<string, unknown>>`${JSON.stringify(value)}::jsonb`;
}

export interface AiProviderConfigSafeRow {
  readonly id: string;
  readonly owner_user_id: string;
  readonly provider_kind: AiProviderKind;
  readonly display_name: string;
  readonly base_url: string | null;
  readonly status: AiProviderStatus;
  readonly auth_method: AiAuthMethod;
  readonly has_credential: boolean;
  readonly revoked_at: Date | null;
  readonly created_at: Date;
  readonly updated_at: Date;
}

declare const aiSealedCredentialBrand: unique symbol;

export interface AiProviderWithSealedCredential extends AiProviderConfigSafeRow {
  readonly [aiSealedCredentialBrand]: true;
  readonly encrypted_credential: EncryptedAiSecret;
}

export interface AiConfiguredModelSafeRow {
  readonly id: string;
  readonly provider_config_id: string;
  readonly owner_user_id: string;
  readonly provider_kind: AiProviderKind;
  readonly provider_display_name: string;
  readonly provider_status: AiProviderStatus;
  readonly provider_model_id: string;
  readonly display_name: string;
  readonly capabilities: string[];
  readonly status: AiModelStatus;
  readonly tier: AiModelTier;
  readonly allow_user_override: boolean;
  readonly created_at: Date;
  readonly updated_at: Date;
}

export type AiAssistantActionRequestSafeRow = AiAssistantActionRequest;

export interface AiAdminUserCheckRow {
  readonly id: string;
  readonly is_instance_admin: boolean;
}

export interface CreateAiProviderInput {
  readonly providerKind: AiProviderKind;
  readonly displayName: string;
  readonly baseUrl?: string | null;
  readonly status?: Exclude<AiProviderStatus, "revoked">;
  readonly authMethod?: AiAuthMethod;
  readonly encryptedCredential: EncryptedAiSecret;
}

export interface UpdateAiProviderInput {
  readonly providerKind?: AiProviderKind;
  readonly displayName?: string;
  readonly baseUrl?: string | null;
  readonly status?: Exclude<AiProviderStatus, "revoked">;
  readonly authMethod?: AiAuthMethod;
  readonly encryptedCredential?: EncryptedAiSecret;
}

export interface CreateAiModelInput {
  readonly providerConfigId: string;
  readonly providerModelId: string;
  readonly displayName: string;
  readonly capabilities: readonly AiModelCapability[];
  readonly status?: AiModelStatus;
  readonly tier?: AiModelTier;
  readonly allowUserOverride?: boolean;
}

export interface UpdateAiModelInput {
  readonly providerModelId?: string;
  readonly displayName?: string;
  readonly capabilities?: readonly AiModelCapability[];
  readonly status?: AiModelStatus;
  readonly tier?: AiModelTier;
  readonly allowUserOverride?: boolean;
}

export interface CreateAiAssistantActionInput {
  readonly toolModuleId: string;
  readonly toolModuleName: string;
  readonly toolName: string;
  readonly permissionId: string;
  readonly risk: AiAssistantActionRisk;
  readonly inputSummary: Record<string, unknown>;
  readonly requestId?: string | null;
}

export interface ResolveAiAssistantActionInput {
  readonly status: Exclude<AiAssistantActionStatus, "pending">;
}

export interface ChatModelOverrideSettings {
  readonly overrideEnabled: boolean;
  readonly currentOverrideModelId: string | null;
  readonly effectiveOverrideModelId: string | null;
  readonly defaultModel: AiConfiguredModelSafeRow | null;
  readonly selectedModel: AiConfiguredModelSafeRow | null;
  /** All models shown in the UI (includes the instance default even if not user-overridable). */
  readonly allowedModels: readonly AiConfiguredModelSafeRow[];
  /** Models the user may actually select as an override (allowUserOverride=true only). */
  readonly selectableOverrideModels: readonly AiConfiguredModelSafeRow[];
}

export const AI_CAPABILITY_ROUTES_SETTING_KEY = "ai.capability_routes";
export const AI_ADMIN_PINNED_MODEL_PREFERENCE_KEY = "ai.admin_pinned_model_id";

export type AiCapabilityRouteMap = Partial<Record<AiModelCapability, string | null>>;

export interface SetAiCapabilityRouteInput {
  readonly capability: AiModelCapability;
  readonly modelId: string | null;
  readonly actorUserId: string;
}

export interface AiCapabilityRouteResolution {
  readonly model: AiConfiguredModelSafeRow | null;
  readonly reason: AiCapabilityRouteReason;
}

export class AiRepository {
  async getUserById(
    scopedDb: DataContextDb,
    userId: string
  ): Promise<AiAdminUserCheckRow | undefined> {
    assertDataContextDb(scopedDb);

    const result = await sql<AiAdminUserCheckRow>`
      SELECT id, is_instance_admin FROM app.get_user_by_id(${userId}::uuid)
    `.execute(scopedDb.db);

    return result.rows[0];
  }

  async listProviders(scopedDb: DataContextDb): Promise<AiProviderConfigSafeRow[]> {
    assertDataContextDb(scopedDb);

    return this.safeProviderQuery(scopedDb).execute();
  }

  async hasPersonalProvider(scopedDb: DataContextDb, userId: string): Promise<boolean> {
    assertDataContextDb(scopedDb);

    const row = await scopedDb.db
      .selectFrom("app.ai_provider_configs")
      .select(sql<boolean>`true`.as("has_it"))
      .where("owner_user_id", "=", userId)
      .where("status", "!=", "revoked")
      .executeTakeFirst();

    return row?.has_it ?? false;
  }

  /**
   * #367: the newest ACTIVE provider config of a given kind, or undefined. Used by the login
   * auto-register seam to REUSE an existing usable config rather than duplicate one. Must match
   * ACTIVE only (not merely non-revoked): `selectChatModelForUser` requires `providers.status =
   * 'active'`, so reusing a `disabled`/`error` config would insert a model that can never be
   * resolved (permanent dead chat, B1). A disabled/error config falls through so the caller creates
   * a fresh ACTIVE config instead. `safeProviderQuery` orders by created_at desc, so
   * `executeTakeFirst` returns the newest active match.
   */
  async findReusableProviderByKind(
    scopedDb: DataContextDb,
    providerKind: AiProviderKind
  ): Promise<AiProviderConfigSafeRow | undefined> {
    assertDataContextDb(scopedDb);

    return this.safeProviderQuery(scopedDb)
      .where("provider_kind", "=", providerKind)
      .where("status", "=", "active")
      .executeTakeFirst();
  }

  /**
   * #367: true if ANY chat-capable model row (ANY model status — active OR user-disabled) exists
   * under an ACTIVE provider config of this kind. The login auto-register seam gates on this:
   *   - a model under an ACTIVE config (active OR user-disabled) ⇒ true ⇒ skip — never duplicate an
   *     active model, never resurrect a model the founder disabled in Admin (models are never
   *     hard-deleted — "remove" sets status `disabled`);
   *   - a model under a `disabled`/`error` config ⇒ NOT counted, so a re-login can recover (create a
   *     fresh active config + selectable model) rather than be permanently blocked (B1). This mirrors
   *     `selectChatModelForUser`'s active-provider requirement — only a SELECTABLE model "exists".
   */
  async hasChatModelForProviderKind(
    scopedDb: DataContextDb,
    providerKind: AiProviderKind
  ): Promise<boolean> {
    assertDataContextDb(scopedDb);

    const row = await scopedDb.db
      .selectFrom("app.ai_configured_models as models")
      .innerJoin(
        "app.ai_provider_configs as providers",
        "providers.id",
        "models.provider_config_id"
      )
      .select(sql<boolean>`true`.as("has_it"))
      .where("providers.provider_kind", "=", providerKind)
      .where("providers.status", "=", "active")
      .where(sql<boolean>`'chat' = any(${sql.ref("models.capabilities")})`)
      .executeTakeFirst();

    return row?.has_it ?? false;
  }

  async createProvider(
    scopedDb: DataContextDb,
    input: CreateAiProviderInput
  ): Promise<AiProviderConfigSafeRow> {
    assertDataContextDb(scopedDb);

    const now = new Date();
    const inserted = await scopedDb.db
      .insertInto("app.ai_provider_configs")
      .values({
        id: randomUUID(),
        owner_user_id: sql<string>`app.current_actor_user_id()`,
        provider_kind: input.providerKind,
        display_name: input.displayName,
        base_url: input.baseUrl ?? null,
        status: input.status ?? "active",
        auth_method: input.authMethod ?? "api_key",
        encrypted_credential: input.encryptedCredential,
        revoked_at: null,
        created_at: now,
        updated_at: now
      })
      .returning("id")
      .executeTakeFirstOrThrow();

    return this.requireVisibleProvider(scopedDb, inserted.id);
  }

  async updateProvider(
    scopedDb: DataContextDb,
    providerId: string,
    input: UpdateAiProviderInput
  ): Promise<AiProviderConfigSafeRow | undefined> {
    assertDataContextDb(scopedDb);

    const updates: Updateable<AiProviderConfigsTable> = {
      updated_at: new Date()
    };

    if (input.providerKind !== undefined) {
      updates.provider_kind = input.providerKind;
    }
    if (input.displayName !== undefined) {
      updates.display_name = input.displayName;
    }
    if (input.baseUrl !== undefined) {
      updates.base_url = input.baseUrl;
    }
    if (input.status !== undefined) {
      updates.status = input.status;
      updates.revoked_at = null;
    }
    if (input.authMethod !== undefined) {
      updates.auth_method = input.authMethod;
    }
    if (input.encryptedCredential !== undefined) {
      updates.encrypted_credential = input.encryptedCredential;
    }

    const updated = await scopedDb.db
      .updateTable("app.ai_provider_configs")
      .set(updates)
      .where("id", "=", providerId)
      .returning("id")
      .executeTakeFirst();

    return updated ? this.requireVisibleProvider(scopedDb, updated.id) : undefined;
  }

  async revokeProvider(
    scopedDb: DataContextDb,
    providerId: string,
    encryptedCredential: EncryptedAiSecret
  ): Promise<AiProviderConfigSafeRow | undefined> {
    assertDataContextDb(scopedDb);

    const updated = await scopedDb.db
      .updateTable("app.ai_provider_configs")
      .set({
        encrypted_credential: encryptedCredential,
        status: "revoked",
        revoked_at: new Date(),
        updated_at: new Date()
      })
      .where("id", "=", providerId)
      .returning("id")
      .executeTakeFirst();

    return updated ? this.requireVisibleProvider(scopedDb, updated.id) : undefined;
  }

  async listModels(scopedDb: DataContextDb): Promise<AiConfiguredModelSafeRow[]> {
    assertDataContextDb(scopedDb);

    return this.safeModelQuery(scopedDb).execute();
  }

  async createModel(
    scopedDb: DataContextDb,
    input: CreateAiModelInput
  ): Promise<AiConfiguredModelSafeRow> {
    assertDataContextDb(scopedDb);

    const now = new Date();
    const inserted = await scopedDb.db
      .insertInto("app.ai_configured_models")
      .values({
        id: randomUUID(),
        provider_config_id: input.providerConfigId,
        owner_user_id: sql<string>`app.current_actor_user_id()`,
        provider_model_id: input.providerModelId,
        display_name: input.displayName,
        capabilities: [...input.capabilities],
        status: input.status ?? "active",
        tier: input.tier ?? "interactive",
        allow_user_override: input.allowUserOverride ?? true,
        created_at: now,
        updated_at: now
      })
      .returning("id")
      .executeTakeFirstOrThrow();

    return this.requireVisibleModel(scopedDb, inserted.id);
  }

  async updateModel(
    scopedDb: DataContextDb,
    modelId: string,
    input: UpdateAiModelInput
  ): Promise<AiConfiguredModelSafeRow | undefined> {
    assertDataContextDb(scopedDb);

    const updates: Updateable<AiConfiguredModelsTable> = {
      updated_at: new Date()
    };

    if (input.providerModelId !== undefined) {
      updates.provider_model_id = input.providerModelId;
    }
    if (input.displayName !== undefined) {
      updates.display_name = input.displayName;
    }
    if (input.capabilities !== undefined) {
      updates.capabilities = [...input.capabilities];
    }
    if (input.status !== undefined) {
      updates.status = input.status;
    }
    if (input.tier !== undefined) {
      updates.tier = input.tier;
    }
    if (input.allowUserOverride !== undefined) {
      updates.allow_user_override = input.allowUserOverride;
    }

    const updated = await scopedDb.db
      .updateTable("app.ai_configured_models")
      .set(updates)
      .where("id", "=", modelId)
      .returning("id")
      .executeTakeFirst();

    return updated ? this.requireVisibleModel(scopedDb, updated.id) : undefined;
  }

  async selectModelForCapability(
    scopedDb: DataContextDb,
    capability: AiModelCapability,
    tier: AiModelTier = "interactive"
  ): Promise<AiConfiguredModelSafeRow | undefined> {
    assertDataContextDb(scopedDb);
    const userTier = await this.readCapabilityTierPreference(scopedDb, capability);
    const resolved = await this.resolveModelForCapability(scopedDb, capability, userTier ?? tier);
    return resolved.model ?? undefined;
  }

  private async readCapabilityTierPreference(
    scopedDb: DataContextDb,
    capability: AiModelCapability
  ): Promise<AiModelTier | null> {
    const row = await scopedDb.db
      .selectFrom("app.preferences")
      .select("value_json")
      .where("key", "=", `ai.capability_tier.${capability}`)
      .executeTakeFirst();
    const v = row?.value_json as unknown;
    if (v === "reasoning" || v === "interactive" || v === "economy") return v;
    return null;
  }

  async listCapabilityTierPreferences(
    scopedDb: DataContextDb
  ): Promise<Partial<Record<AiModelCapability, AiModelTier>>> {
    assertDataContextDb(scopedDb);
    const rows = await scopedDb.db
      .selectFrom("app.preferences")
      .select(["key", "value_json"])
      .where("key", "like", "ai.capability_tier.%")
      .execute();
    const result: Partial<Record<AiModelCapability, AiModelTier>> = {};
    for (const row of rows) {
      const capability = row.key.replace("ai.capability_tier.", "") as AiModelCapability;
      const v = row.value_json as unknown;
      if (v === "reasoning" || v === "interactive" || v === "economy") {
        result[capability] = v;
      }
    }
    return result;
  }

  async setCapabilityTierPreference(
    scopedDb: DataContextDb,
    capability: AiModelCapability,
    tier: AiModelTier
  ): Promise<void> {
    assertDataContextDb(scopedDb);
    await scopedDb.db
      .insertInto("app.preferences")
      .values({
        owner_user_id: sql<string>`app.current_actor_user_id()`,
        key: `ai.capability_tier.${capability}`,
        value_json: jsonb(tier),
        updated_at: new Date()
      })
      .onConflict((oc) =>
        oc.columns(["owner_user_id", "key"]).doUpdateSet({
          value_json: jsonb(tier),
          updated_at: new Date()
        })
      )
      .execute();
  }

  async listCapabilityRoutes(scopedDb: DataContextDb): Promise<AiCapabilityRouteMap> {
    assertDataContextDb(scopedDb);

    const row = await scopedDb.db
      .selectFrom("app.instance_settings")
      .select("value")
      .where("key", "=", AI_CAPABILITY_ROUTES_SETTING_KEY)
      .executeTakeFirst();

    return parseCapabilityRouteMap(row?.value);
  }

  async setCapabilityRoute(
    scopedDb: DataContextDb,
    input: SetAiCapabilityRouteInput
  ): Promise<AiCapabilityRouteMap> {
    assertDataContextDb(scopedDb);

    const current = await this.listCapabilityRoutes(scopedDb);
    const next = { ...current, [input.capability]: input.modelId };
    const now = new Date();

    await scopedDb.db
      .insertInto("app.instance_settings")
      .values({
        key: AI_CAPABILITY_ROUTES_SETTING_KEY,
        value: next,
        updated_by_user_id: input.actorUserId,
        created_at: now,
        updated_at: now
      })
      .onConflict((oc) =>
        oc.column("key").doUpdateSet({
          value: next,
          updated_by_user_id: input.actorUserId,
          updated_at: now
        })
      )
      .execute();

    return next;
  }

  async resolveModelForCapability(
    scopedDb: DataContextDb,
    capability: AiModelCapability,
    tier: AiModelTier = "interactive"
  ): Promise<AiCapabilityRouteResolution> {
    assertDataContextDb(scopedDb);

    const adminPinnedModelId = await this.getAdminPinnedModelId(scopedDb);
    if (adminPinnedModelId) {
      const adminPinnedModel = await this.safeModelQuery(scopedDb)
        .where("models.id", "=", adminPinnedModelId)
        .where("models.status", "=", "active")
        .where("providers.status", "=", "active")
        .where(sql<boolean>`${capability} = any(${sql.ref("models.capabilities")})`)
        .executeTakeFirst();

      if (adminPinnedModel) {
        return { model: adminPinnedModel, reason: "admin-pin" };
      }
    }

    const routes = await this.listCapabilityRoutes(scopedDb);
    const manualModelId = routes[capability] ?? null;

    if (manualModelId) {
      const manualModel = await this.safeModelQuery(scopedDb)
        .where("models.id", "=", manualModelId)
        .where("models.status", "=", "active")
        .where("providers.status", "=", "active")
        .where(sql<boolean>`${capability} = any(${sql.ref("models.capabilities")})`)
        .executeTakeFirst();

      if (manualModel) {
        return { model: manualModel, reason: "manual-route" };
      }
    }

    const automatic = await this.selectAutomaticModelForCapability(scopedDb, capability, tier);
    return {
      model: automatic ?? null,
      reason: adminPinnedModelId
        ? "admin-pin-unavailable-fallback"
        : manualModelId
          ? "manual-route-unavailable-fallback"
          : automatic
            ? "matched-active-model"
            : "no-active-model"
    };
  }

  private async selectAutomaticModelForCapability(
    scopedDb: DataContextDb,
    capability: AiModelCapability,
    tier: AiModelTier
  ): Promise<AiConfiguredModelSafeRow | undefined> {
    const TIER_LADDER: AiModelTier[] = ["economy", "interactive", "reasoning"];
    const startIndex = TIER_LADDER.indexOf(tier);
    const tiersToTry = TIER_LADDER.slice(startIndex);

    for (const t of tiersToTry) {
      const model = await this.safeModelQuery(scopedDb)
        .where("models.status", "=", "active")
        .where("providers.status", "=", "active")
        .where(sql<boolean>`${capability} = any(${sql.ref("models.capabilities")})`)
        .where("models.tier", "=", t)
        .orderBy("models.created_at", "desc")
        .orderBy("models.id", "desc")
        .executeTakeFirst();

      if (model) return model;
    }

    // Final fallback: any active model matching the capability (single-model setups)
    return this.safeModelQuery(scopedDb)
      .where("models.status", "=", "active")
      .where("providers.status", "=", "active")
      .where(sql<boolean>`${capability} = any(${sql.ref("models.capabilities")})`)
      .orderBy("models.created_at", "desc")
      .orderBy("models.id", "desc")
      .executeTakeFirst();
  }

  /**
   * Canonical entrypoint for selecting the effective chat model for the current user.
   * Resolves the user's override preference against the admin-configured allowable set
   * and falls back to the instance default. Call sites that need only the resolved model
   * (not the full override settings) should use this rather than
   * `getChatModelOverrideSettings(...).selectedModel` directly.
   */
  async selectChatModelForUser(scopedDb: DataContextDb): Promise<AiConfiguredModelSafeRow | null> {
    const settings = await this.getChatModelOverrideSettings(scopedDb);
    return settings.selectedModel;
  }

  async getChatModelOverrideSettings(scopedDb: DataContextDb): Promise<ChatModelOverrideSettings> {
    assertDataContextDb(scopedDb);

    const [defaultModel, models, overrideEnabled, requestedModelId, adminPinnedModelId] =
      await Promise.all([
        this.selectModelForCapability(scopedDb, "chat"),
        this.listModels(scopedDb),
        this.getChatModelOverrideEnabled(scopedDb),
        this.getChatModelOverridePreference(scopedDb),
        this.getAdminPinnedModelId(scopedDb)
      ]);

    if (adminPinnedModelId) {
      return {
        overrideEnabled,
        currentOverrideModelId: requestedModelId,
        effectiveOverrideModelId: null,
        defaultModel: defaultModel ?? null,
        selectedModel: defaultModel ?? null,
        allowedModels: models,
        selectableOverrideModels: []
      };
    }

    const resolved = resolveChatModelOverride({
      defaultModel: defaultModel ? toOverrideCandidate(defaultModel) : null,
      requestedModelId,
      overrideEnabled,
      models: models.map(toOverrideCandidate)
    });

    return {
      overrideEnabled,
      currentOverrideModelId: requestedModelId,
      effectiveOverrideModelId: resolved.effectiveOverrideModelId,
      defaultModel: defaultModel ?? null,
      selectedModel: resolved.selectedModel,
      allowedModels: resolved.allowedModels,
      selectableOverrideModels: resolved.selectableOverrideModels
    };
  }

  async setChatModelOverrideEnabled(
    scopedDb: DataContextDb,
    input: { readonly enabled: boolean; readonly actorUserId: string }
  ): Promise<ChatModelOverrideSettings> {
    assertDataContextDb(scopedDb);

    await scopedDb.db
      .insertInto("app.instance_settings")
      .values({
        key: CHAT_MODEL_OVERRIDE_SETTING_KEY,
        value: { value: input.enabled },
        updated_by_user_id: input.actorUserId,
        created_at: new Date(),
        updated_at: new Date()
      })
      .onConflict((oc) =>
        oc.column("key").doUpdateSet({
          value: { value: input.enabled },
          updated_by_user_id: input.actorUserId,
          updated_at: new Date()
        })
      )
      .execute();

    return this.getChatModelOverrideSettings(scopedDb);
  }

  async setChatModelOverridePreference(
    scopedDb: DataContextDb,
    modelId: string | null
  ): Promise<ChatModelOverrideSettings> {
    assertDataContextDb(scopedDb);

    if (modelId === null) {
      await scopedDb.db
        .deleteFrom("app.preferences")
        .where("key", "=", CHAT_MODEL_OVERRIDE_PREFERENCE_KEY)
        .execute();
    } else {
      await scopedDb.db
        .insertInto("app.preferences")
        .values({
          owner_user_id: sql<string>`app.current_actor_user_id()`,
          key: CHAT_MODEL_OVERRIDE_PREFERENCE_KEY,
          value_json: jsonb(modelId),
          updated_at: new Date()
        })
        .onConflict((oc) =>
          oc.columns(["owner_user_id", "key"]).doUpdateSet({
            value_json: jsonb(modelId),
            updated_at: new Date()
          })
        )
        .execute();
    }

    return this.getChatModelOverrideSettings(scopedDb);
  }

  async getAdminPinnedModelId(scopedDb: DataContextDb): Promise<string | null> {
    assertDataContextDb(scopedDb);
    const row = await scopedDb.db
      .selectFrom("app.preferences")
      .select("value_json")
      .where("key", "=", AI_ADMIN_PINNED_MODEL_PREFERENCE_KEY)
      .executeTakeFirst();
    return typeof row?.value_json === "string" ? row.value_json : null;
  }

  async getAdminPinnedModel(scopedDb: DataContextDb): Promise<AiConfiguredModelSafeRow | null> {
    assertDataContextDb(scopedDb);
    const modelId = await this.getAdminPinnedModelId(scopedDb);
    if (!modelId) return null;
    return (
      (await this.safeModelQuery(scopedDb).where("models.id", "=", modelId).executeTakeFirst()) ??
      null
    );
  }

  async setAdminPinnedModel(
    scopedDb: DataContextDb,
    modelId: string | null
  ): Promise<AiConfiguredModelSafeRow | null> {
    assertDataContextDb(scopedDb);

    if (modelId === null) {
      await scopedDb.db
        .deleteFrom("app.preferences")
        .where("key", "=", AI_ADMIN_PINNED_MODEL_PREFERENCE_KEY)
        .execute();
      return null;
    }

    const model = await this.safeModelQuery(scopedDb)
      .where("models.id", "=", modelId)
      .where("models.status", "=", "active")
      .where("providers.status", "=", "active")
      .executeTakeFirst();

    if (!model) return null;

    await scopedDb.db
      .insertInto("app.preferences")
      .values({
        owner_user_id: sql<string>`app.current_actor_user_id()`,
        key: AI_ADMIN_PINNED_MODEL_PREFERENCE_KEY,
        value_json: jsonb(modelId),
        updated_at: new Date()
      })
      .onConflict((oc) =>
        oc.columns(["owner_user_id", "key"]).doUpdateSet({
          value_json: jsonb(modelId),
          updated_at: new Date()
        })
      )
      .execute();

    return model;
  }

  /**
   * Returns the provider config row including the raw encrypted credential for use
   * in the pg-boss worker (credential is decrypted in-process; never logged or forwarded).
   */
  async selectProviderWithCredential(
    scopedDb: DataContextDb,
    providerId: string
  ): Promise<AiProviderWithSealedCredential | undefined> {
    assertDataContextDb(scopedDb);

    return scopedDb.db
      .selectFrom("app.ai_provider_configs")
      .select([
        "id",
        "owner_user_id",
        "provider_kind",
        "display_name",
        "base_url",
        "status",
        "auth_method",
        sql<boolean>`encrypted_credential IS NOT NULL`.as("has_credential"),
        "revoked_at",
        "created_at",
        "updated_at",
        "encrypted_credential"
      ])
      .where("id", "=", providerId)
      .executeTakeFirst() as Promise<AiProviderWithSealedCredential | undefined>;
  }

  async listAssistantActions(scopedDb: DataContextDb): Promise<AiAssistantActionRequestSafeRow[]> {
    assertDataContextDb(scopedDb);

    return this.safeAssistantActionQuery(scopedDb).execute();
  }

  async createPendingAssistantAction(
    scopedDb: DataContextDb,
    input: CreateAiAssistantActionInput
  ): Promise<AiAssistantActionRequestSafeRow> {
    assertDataContextDb(scopedDb);

    const now = new Date();

    return scopedDb.db
      .insertInto("app.ai_assistant_action_requests")
      .values({
        id: randomUUID(),
        owner_user_id: sql<string>`app.current_actor_user_id()`,
        tool_module_id: input.toolModuleId,
        tool_module_name: input.toolModuleName,
        tool_name: input.toolName,
        permission_id: input.permissionId,
        risk: input.risk,
        status: "pending",
        input_summary: input.inputSummary,
        request_id: input.requestId ?? null,
        requested_at: now,
        resolved_at: null,
        updated_at: now
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async resolveAssistantAction(
    scopedDb: DataContextDb,
    actionId: string,
    input: ResolveAiAssistantActionInput
  ): Promise<AiAssistantActionRequestSafeRow | undefined> {
    assertDataContextDb(scopedDb);

    const now = new Date();

    return scopedDb.db
      .updateTable("app.ai_assistant_action_requests")
      .set({
        status: input.status,
        resolved_at: now,
        updated_at: now
      })
      .where("id", "=", actionId)
      .where("status", "=", "pending")
      .returningAll()
      .executeTakeFirst();
  }

  async cancelStalePendingAssistantActions(
    appDb: Kysely<JarvisDatabase>,
    input: { readonly olderThan: Date }
  ): Promise<number> {
    const result = await sql<{ count: number }>`
      SELECT app.cancel_stale_ai_assistant_action_requests(${input.olderThan}) AS count
    `.execute(appDb);
    return Number(result.rows[0]?.count ?? 0);
  }

  private async requireVisibleProvider(
    scopedDb: DataContextDb,
    providerId: string
  ): Promise<AiProviderConfigSafeRow> {
    const provider = await this.safeProviderQuery(scopedDb)
      .where("id", "=", providerId)
      .executeTakeFirst();

    if (!provider) {
      throw new Error("AI provider config is not visible after write");
    }

    return provider;
  }

  private async requireVisibleModel(
    scopedDb: DataContextDb,
    modelId: string
  ): Promise<AiConfiguredModelSafeRow> {
    const model = await this.safeModelQuery(scopedDb)
      .where("models.id", "=", modelId)
      .executeTakeFirst();

    if (!model) {
      throw new Error("AI model config is not visible after write");
    }

    return model;
  }

  private safeProviderQuery(scopedDb: DataContextDb) {
    return scopedDb.db
      .selectFrom("app.ai_provider_configs")
      .select([
        "id",
        "owner_user_id",
        "provider_kind",
        "display_name",
        "base_url",
        "status",
        "auth_method",
        sql<boolean>`encrypted_credential IS NOT NULL`.as("has_credential"),
        "revoked_at",
        "created_at",
        "updated_at"
      ])
      .orderBy("created_at", "desc")
      .orderBy("id");
  }

  private safeModelQuery(scopedDb: DataContextDb) {
    return scopedDb.db
      .selectFrom("app.ai_configured_models as models")
      .innerJoin(
        "app.ai_provider_configs as providers",
        "providers.id",
        "models.provider_config_id"
      )
      .select([
        "models.id as id",
        "models.provider_config_id as provider_config_id",
        "models.owner_user_id as owner_user_id",
        "providers.provider_kind as provider_kind",
        "providers.display_name as provider_display_name",
        "providers.status as provider_status",
        "models.provider_model_id as provider_model_id",
        "models.display_name as display_name",
        "models.capabilities as capabilities",
        "models.status as status",
        "models.tier as tier",
        "models.allow_user_override as allow_user_override",
        "models.created_at as created_at",
        "models.updated_at as updated_at"
      ])
      .orderBy("models.created_at", "desc")
      .orderBy("models.id");
  }

  private safeAssistantActionQuery(scopedDb: DataContextDb) {
    return scopedDb.db
      .selectFrom("app.ai_assistant_action_requests")
      .selectAll()
      .orderBy("requested_at", "desc")
      .orderBy("id");
  }

  private async getChatModelOverrideEnabled(scopedDb: DataContextDb): Promise<boolean> {
    const row = await scopedDb.db
      .selectFrom("app.instance_settings")
      .select("value")
      .where("key", "=", CHAT_MODEL_OVERRIDE_SETTING_KEY)
      .executeTakeFirst();
    const value = (row?.value as { value?: unknown } | undefined)?.value;
    return typeof value === "boolean" ? value : false;
  }

  private async getChatModelOverridePreference(scopedDb: DataContextDb): Promise<string | null> {
    const row = await scopedDb.db
      .selectFrom("app.preferences")
      .select("value_json")
      .where("key", "=", CHAT_MODEL_OVERRIDE_PREFERENCE_KEY)
      .executeTakeFirst();
    return typeof row?.value_json === "string" ? row.value_json : null;
  }
}

function toOverrideCandidate(
  model: AiConfiguredModelSafeRow
): AiConfiguredModelSafeRow & ChatModelOverrideCandidate {
  return {
    ...model,
    providerStatus: model.provider_status,
    allowUserOverride: model.allow_user_override
  };
}
