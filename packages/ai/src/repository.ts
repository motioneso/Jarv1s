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
  type JarvisActionAuditLog,
  type JarvisErrorLog,
  type JarvisDatabase
} from "@jarv1s/db";
import type {
  AiCapabilityRouteReason,
  AiModelCapability,
  AiProviderExecutionMode,
  AiServiceBinding
} from "@jarv1s/shared";

import type { EncryptedAiSecret } from "./crypto.js";
import type { JarvisActionPermissionTier } from "@jarv1s/module-sdk";
import { parseCapabilityRouteMap } from "./capability-route-map.js";
import { parseServiceBindingMap } from "./service-binding-map.js";
import {
  CHAT_MODEL_OVERRIDE_PREFERENCE_KEY,
  CHAT_MODEL_OVERRIDE_SETTING_KEY,
  resolveChatModelOverride
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
  readonly execution_mode: AiProviderExecutionMode;
  readonly has_credential: boolean;
  // #870/H1: the single instance-default provider flag (migration 0147).
  readonly is_instance_default: boolean;
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
  readonly provider_execution_mode: AiProviderExecutionMode;
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
  readonly executionMode?: AiProviderExecutionMode;
  readonly encryptedCredential: EncryptedAiSecret;
}

export interface UpdateAiProviderInput {
  readonly providerKind?: AiProviderKind;
  readonly displayName?: string;
  readonly baseUrl?: string | null;
  readonly status?: Exclude<AiProviderStatus, "revoked">;
  readonly authMethod?: AiAuthMethod;
  readonly executionMode?: AiProviderExecutionMode;
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

export interface InsertAuditLogInput {
  readonly id: string;
  readonly ownerUserId: string;
  readonly toolModuleId: string;
  readonly toolName: string;
  readonly actionFamilyId: string | null;
  readonly actionKind: "write" | "destructive";
  readonly approvalMode: "auto" | "yolo" | "confirmed" | "rejected" | "cancelled" | "timeout";
  readonly outcome: "success" | "failed" | "denied" | "cancelled";
  readonly errorClass: string | null;
  readonly requestId: string | null;
  readonly chatSessionId: string | null;
  readonly sourceSurface: "chat" | "proactive" | "scheduled" | "unknown";
}

export interface ListAuditLogOptions {
  readonly since: Date;
  readonly familyFilter?: { moduleId: string; familyId: string } | null;
  readonly limit: number;
}

export interface RecordErrorInput {
  readonly id: string;
  readonly feature: string;
  readonly operation: string;
  readonly errorCategory: string;
  readonly retryable: boolean;
  readonly userMessage: string;
  readonly internalSummary: string;
  readonly requestId: string | null;
}

export interface ListRecentErrorsOptions {
  readonly query?: string;
  readonly since?: Date;
  readonly limit: number;
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

// Legacy key — read-only now (H2 read-through). Never written again after Slice 1 (M2).
export const AI_CAPABILITY_ROUTES_SETTING_KEY = "ai.capability_routes";
// #870 Slice 1: the unified per-service binding blob (Chat/Voice → mode|model).
export const AI_SERVICE_BINDINGS_SETTING_KEY = "ai.service_bindings";
export const AI_ADMIN_PINNED_MODEL_PREFERENCE_KEY = "ai.admin_pinned_model_id";
// #870 (D8): an admin may hard-lock a user to a whole provider instead of a single model.
export const AI_ADMIN_PINNED_PROVIDER_PREFERENCE_KEY = "ai.admin_pinned_provider_id";

// #870 Slice 1: services the admin can bind. Worker capabilities stay cross-provider automatic and
// are never bound — see the resolver's USER_FACING gate.
const USER_FACING_SERVICES = new Set<AiModelCapability>(["chat", "transcription"]);

// #870/H2: retained only for the legacy `ai.capability_routes` read-through (parseCapabilityRouteMap).
// Never written to again — the write path is now service bindings (AiServiceBindingMapDto).
export type AiCapabilityRouteMap = Partial<Record<AiModelCapability, string | null>>;

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

  /** #367: newest ACTIVE provider of this kind; disabled/error rows are intentionally not reused. */
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
        execution_mode: input.executionMode ?? "interactive",
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
    if (input.executionMode !== undefined) {
      updates.execution_mode = input.executionMode;
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

  /**
   * #870 Slice 1 (Step 4, L1): idempotently insert discovered models. INSERT-only with
   * do-nothing on the `UNIQUE(owner_user_id, provider_config_id, provider_model_id)` constraint —
   * an existing row (ANY status) is left untouched, so re-discovery never (a) duplicates, (b)
   * resurrects a model the admin disabled, or (c) clobbers a customized row. Returns the count of
   * newly-inserted rows. Best-effort caller: discovery failure must never block provider creation.
   */
  async upsertDiscoveredModels(
    scopedDb: DataContextDb,
    providerConfigId: string,
    models: readonly {
      readonly providerModelId: string;
      readonly displayName: string;
      readonly capabilities: readonly AiModelCapability[];
      readonly tier: AiModelTier;
      readonly status: AiModelStatus;
    }[]
  ): Promise<number> {
    assertDataContextDb(scopedDb);
    if (models.length === 0) return 0;

    const now = new Date();
    let inserted = 0;
    for (const model of models) {
      const result = await scopedDb.db
        .insertInto("app.ai_configured_models")
        .values({
          id: randomUUID(),
          provider_config_id: providerConfigId,
          owner_user_id: sql<string>`app.current_actor_user_id()`,
          provider_model_id: model.providerModelId,
          display_name: model.displayName,
          capabilities: [...model.capabilities],
          status: model.status,
          tier: model.tier,
          // #870/MED-4 (owner decision) + D8: default discovered models to user-overridable so the
          // kept per-user chat override works out of the box — a user can pick a discovered model as
          // their personal chat model without an admin first flipping the flag. Admin can still lock
          // a specific model non-overridable via updateModel.
          allow_user_override: true,
          created_at: now,
          updated_at: now
        })
        .onConflict((oc) =>
          oc.columns(["owner_user_id", "provider_config_id", "provider_model_id"]).doNothing()
        )
        .executeTakeFirst();
      // numInsertedOrUpdatedRows is 0n when the conflict skipped the row.
      if ((result.numInsertedOrUpdatedRows ?? 0n) > 0n) inserted += 1;
    }
    return inserted;
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
    // #870/D7/M2: the per-user tier PREFERENCE is retired. `tier` is now just the caller's default
    // (workers still pass explicit tiers like "economy"); the effective tier for a user-facing
    // service comes from its service binding, resolved inside `resolveModelForCapability`.
    const resolved = await this.resolveModelForCapability(scopedDb, capability, tier);
    return resolved.model ?? undefined;
  }

  /**
   * #870/H2: legacy read-through. The retired `ai.capability_routes` key is never written again, but
   * an instance upgraded from a prior release may still carry entries. We surface a legacy route as a
   * `{ kind: "model" }` binding ONLY when its model is currently active under an active provider —
   * a stale/disabled/null legacy route is dropped (logged once), never converted, so an upgrade can
   * never manufacture a needs-config chat outage (the no-outage guarantee).
   */
  private async readLegacyCapabilityRoutes(scopedDb: DataContextDb): Promise<AiCapabilityRouteMap> {
    const row = await scopedDb.db
      .selectFrom("app.instance_settings")
      .select("value")
      .where("key", "=", AI_CAPABILITY_ROUTES_SETTING_KEY)
      .executeTakeFirst();
    return parseCapabilityRouteMap(row?.value);
  }

  private loggedStaleLegacyRoutes = new Set<string>();

  /**
   * #870 Slice 1: resolve the effective binding for a user-facing service (Chat/Voice). Order:
   *   1. the stored `ai.service_bindings[service]` (unified knob);
   *   2. else the legacy `ai.capability_routes[service]` read-through (H2, only if still valid);
   *   3. else unbound (the resolver falls back to default-provider auto / needs-config).
   */
  async getServiceBinding(
    scopedDb: DataContextDb,
    service: AiModelCapability
  ): Promise<AiServiceBinding | null> {
    assertDataContextDb(scopedDb);

    const row = await scopedDb.db
      .selectFrom("app.instance_settings")
      .select("value")
      .where("key", "=", AI_SERVICE_BINDINGS_SETTING_KEY)
      .executeTakeFirst();
    const bindings = parseServiceBindingMap(row?.value);
    const bound = bindings[service];
    if (bound) return bound;

    // Legacy read-through (H2).
    const legacy = await this.readLegacyCapabilityRoutes(scopedDb);
    const legacyModelId = legacy[service] ?? null;
    if (!legacyModelId) return null;

    const stillValid = await this.safeModelQuery(scopedDb)
      .where("models.id", "=", legacyModelId)
      .where("models.status", "=", "active")
      .where("providers.status", "=", "active")
      .where(sql<boolean>`${service} = any(${sql.ref("models.capabilities")})`)
      .executeTakeFirst();

    if (stillValid) return { kind: "model", modelId: legacyModelId };

    // Stale legacy route: ignore + log once (per model id) so an upgrade artifact is observable
    // without spamming — do NOT convert it (would resurrect a needs-config outage).
    if (!this.loggedStaleLegacyRoutes.has(legacyModelId)) {
      this.loggedStaleLegacyRoutes.add(legacyModelId);
      console.warn(
        `[ai] ignoring stale legacy capability route for "${service}" (model ${legacyModelId} not active) — falling back to service binding / default provider`
      );
    }
    return null;
  }

  /**
   * #870/M1: write a single service binding. Single-statement JSON merge
   * (`value || excluded.value`) so two admins saving DIFFERENT services concurrently can't lose each
   * other's write (no read-modify-write). `scopedDb.db` is already the withDataContext transaction,
   * so the read paths above stay consistent within a request.
   */
  async setServiceBinding(
    scopedDb: DataContextDb,
    service: AiModelCapability,
    binding: AiServiceBinding,
    actorUserId: string
  ): Promise<AiServiceBinding> {
    assertDataContextDb(scopedDb);
    if (!USER_FACING_SERVICES.has(service)) {
      throw new Error(`Service "${service}" is not bindable (worker capabilities stay automatic).`);
    }

    const now = new Date();
    await scopedDb.db
      .insertInto("app.instance_settings")
      .values({
        key: AI_SERVICE_BINDINGS_SETTING_KEY,
        value: { [service]: binding },
        updated_by_user_id: actorUserId,
        created_at: now,
        updated_at: now
      })
      .onConflict((oc) =>
        oc.column("key").doUpdateSet({
          // M1: merge — keep every other service's binding, overwrite only this one key.
          value: sql<Record<string, unknown>>`instance_settings.value || excluded.value`,
          updated_by_user_id: actorUserId,
          updated_at: now
        })
      )
      .execute();

    return binding;
  }

  /**
   * #870/H1/D2: the effective instance-default provider id, or null (needs-config). A flagged
   * provider wins; a flagged-but-inactive provider is respected as an explicit admin choice and
   * returns null rather than silently auto-picking another. With no flag, exactly one active
   * admin-owned provider is the implicit default; zero or many ⇒ null.
   */
  async resolveDefaultProviderId(scopedDb: DataContextDb): Promise<string | null> {
    assertDataContextDb(scopedDb);

    const flagged = await scopedDb.db
      .selectFrom("app.ai_provider_configs")
      .select(["id", "status"])
      .where("is_instance_default", "=", true)
      .executeTakeFirst();
    if (flagged) return flagged.status === "active" ? flagged.id : null;

    const adminOwned = await scopedDb.db
      .selectFrom("app.ai_provider_configs")
      .select("id")
      .where("status", "=", "active")
      .where(sql<boolean>`app.owner_is_active_admin(owner_user_id)`)
      .execute();
    return adminOwned.length === 1 ? adminOwned[0]!.id : null;
  }

  /**
   * #870/H1: promote a provider to instance-default. Clear-then-set. `scopedDb.db` is the
   * withDataContext transaction, so the two statements are atomic (no transient double-default that
   * would violate the 0147 partial unique index). The 0091 admin UPDATE policy is bare
   * `current_actor_is_admin()` (no owner filter), so the blind clear reaches rows this admin can't
   * otherwise SELECT — preventing a unique slot wedged by an invisible row.
   */
  async setInstanceDefaultProvider(
    scopedDb: DataContextDb,
    providerId: string
  ): Promise<AiProviderConfigSafeRow | undefined> {
    assertDataContextDb(scopedDb);

    const target = await this.safeProviderQuery(scopedDb)
      .where("id", "=", providerId)
      .executeTakeFirst();
    if (!target) return undefined;

    await scopedDb.db
      .updateTable("app.ai_provider_configs")
      .set({ is_instance_default: false, updated_at: new Date() })
      .where("is_instance_default", "=", true)
      .execute();
    await scopedDb.db
      .updateTable("app.ai_provider_configs")
      .set({ is_instance_default: true, updated_at: new Date() })
      .where("id", "=", providerId)
      .execute();

    return this.requireVisibleProvider(scopedDb, providerId);
  }

  /**
   * #870 Slice 1 resolver. Splits by capability class:
   *
   * (1) Admin per-user pin applies to EVERY capability (OWNER decision, #870 locked decision #2 —
   *     overrides the spec-H3 default which scoped the pin to chat): a pin is a HARD routing
   *     constraint on ALL of the actor's traffic (chat + voice + workers), because private data must
   *     stay on the mandated backend. Model pin wins over provider pin (M4a). No cross-provider
   *     escape from a pin.
   * (2) Un-pinned user-facing services (chat/voice) follow their service binding, resolved INSIDE the
   *     instance-default provider for a "mode" binding.
   * (3) Un-pinned worker capabilities keep H3: cross-provider `selectAutomaticModelForCapability`.
   */
  async resolveModelForCapability(
    scopedDb: DataContextDb,
    capability: AiModelCapability,
    tier: AiModelTier = "interactive"
  ): Promise<AiCapabilityRouteResolution> {
    assertDataContextDb(scopedDb);

    const isUserFacing = USER_FACING_SERVICES.has(capability);
    const [pinnedModelId, pinnedProviderId] = await Promise.all([
      this.getAdminPinnedModelId(scopedDb),
      this.getAdminPinnedProviderId(scopedDb)
    ]);

    // (1a) Model pin (wins over provider pin, M4a).
    if (pinnedModelId) {
      const pinnedModel = await this.safeModelQuery(scopedDb)
        .where("models.id", "=", pinnedModelId)
        .where("models.status", "=", "active")
        .where("providers.status", "=", "active")
        .where(sql<boolean>`${capability} = any(${sql.ref("models.capabilities")})`)
        .executeTakeFirst();
      if (pinnedModel) return { model: pinnedModel, reason: "admin-pin" };

      // Pinned model can't serve THIS capability.
      if (isUserFacing) {
        // Chat/Voice hard-lock — preserve the existing reason string, no fallthrough.
        return { model: null, reason: "admin-pin-unavailable" };
      }
      // Worker: the user's traffic must stay on the pinned model's PROVIDER. Resolve the worker
      // capability inside that provider (never cross-provider). needs-config + log if none capable.
      const providerId = await this.providerIdForModel(scopedDb, pinnedModelId);
      if (providerId) {
        const inProvider = await this.selectModelInProviderForCapability(
          scopedDb,
          providerId,
          capability,
          tier
        );
        if (inProvider) return { model: inProvider, reason: "admin-pin" };
      }
      await this.logNeedsConfig(scopedDb, capability);
      return { model: null, reason: "needs-config" };
    }

    // (1b) Provider pin — hard-lock ALL traffic to that provider (chat + voice + workers), M4b.
    if (pinnedProviderId) {
      const inProvider = await this.selectModelInProviderForCapability(
        scopedDb,
        pinnedProviderId,
        capability,
        tier
      );
      if (inProvider) return { model: inProvider, reason: "admin-pin" };
      // #870/MED-4b (Fable MED-1): a wedged/revoked pinned provider is a SYMMETRIC hard-lock —
      // mirror the model-pin miss above, no cross-provider escape. User-facing (chat/voice) returns
      // "admin-pin-unavailable" — the exact reason chat-drawer.tsx:163 + settings-ai-chat-lock-group
      // match to render the lock-unavailable state (bare "needs-config" was invisible to them). Not
      // logged on the user-facing path: it's visible in the UI and readPin resolves chat on every
      // settings/pin read, so logging here would spam jarvis_error_log. Workers stay observable.
      if (isUserFacing) return { model: null, reason: "admin-pin-unavailable" };
      await this.logNeedsConfig(scopedDb, capability);
      return { model: null, reason: "needs-config" };
    }

    // (3) Un-pinned worker capability: cross-provider automatic (H3, unchanged). Observable on miss.
    if (!isUserFacing) {
      const automatic = await this.selectAutomaticModelForCapability(scopedDb, capability, tier);
      if (automatic) return { model: automatic, reason: "matched-active-model" };
      await this.logNeedsConfig(scopedDb, capability);
      return { model: null, reason: "no-active-model" };
    }

    // (2) Un-pinned user-facing service: follow the service binding (incl. legacy read-through).
    const binding = await this.getServiceBinding(scopedDb, capability);
    if (binding?.kind === "model") {
      const model = await this.safeModelQuery(scopedDb)
        .where("models.id", "=", binding.modelId)
        .where("models.status", "=", "active")
        .where("providers.status", "=", "active")
        .where(sql<boolean>`${capability} = any(${sql.ref("models.capabilities")})`)
        .executeTakeFirst();
      return model ? { model, reason: "manual-route" } : { model: null, reason: "needs-config" };
    }

    // "mode" binding OR unbound → resolve inside the instance-default provider.
    const defaultProviderId = await this.resolveDefaultProviderId(scopedDb);
    if (!defaultProviderId) return { model: null, reason: "needs-config" };

    const effectiveTier = binding?.kind === "mode" ? binding.tier : tier;
    const model = await this.selectModelInProviderForCapability(
      scopedDb,
      defaultProviderId,
      capability,
      effectiveTier
    );
    return model
      ? { model, reason: "matched-active-model" }
      : { model: null, reason: "needs-config" };
  }

  /**
   * #870/H5: provider-scoped tier ladder. Only searches models under `providerId`. Sentinel-aware:
   * the CLI `"default"` sentinel is inserted `active` so it wins; statically-discovered concrete ids
   * are inserted `inactive` and can never out-rank it in the `created_at desc` scan.
   */
  private async selectModelInProviderForCapability(
    scopedDb: DataContextDb,
    providerId: string,
    capability: AiModelCapability,
    tier: AiModelTier
  ): Promise<AiConfiguredModelSafeRow | undefined> {
    const TIER_LADDER: AiModelTier[] = ["economy", "interactive", "reasoning"];
    const startIndex = TIER_LADDER.indexOf(tier);
    const tiersToTry = startIndex >= 0 ? TIER_LADDER.slice(startIndex) : TIER_LADDER;

    for (const t of tiersToTry) {
      const model = await this.safeModelQuery(scopedDb)
        .where("providers.id", "=", providerId)
        .where("models.status", "=", "active")
        .where("providers.status", "=", "active")
        .where(sql<boolean>`${capability} = any(${sql.ref("models.capabilities")})`)
        .where("models.tier", "=", t)
        .orderBy("models.created_at", "desc")
        .orderBy("models.id", "desc")
        .executeTakeFirst();
      if (model) return model;
    }

    // Final fallback: any active capable model in this provider (single-model provider setups).
    return this.safeModelQuery(scopedDb)
      .where("providers.id", "=", providerId)
      .where("models.status", "=", "active")
      .where("providers.status", "=", "active")
      .where(sql<boolean>`${capability} = any(${sql.ref("models.capabilities")})`)
      .orderBy("models.created_at", "desc")
      .orderBy("models.id", "desc")
      .executeTakeFirst();
  }

  private async providerIdForModel(
    scopedDb: DataContextDb,
    modelId: string
  ): Promise<string | null> {
    const row = await this.safeModelQuery(scopedDb)
      .where("models.id", "=", modelId)
      .executeTakeFirst();
    return row?.provider_config_id ?? null;
  }

  /**
   * #870/H3: record a needs-config miss for a WORKER capability to jarvis_error_log (0145) so a
   * mis-provisioned instance's silently-skipped distillation/briefings are observable. Only called
   * on worker paths — user-facing needs-config is already visible in the admin UI, so logging there
   * (on every settings/pin read) would spam the log. Best-effort; never breaks resolution.
   */
  private async logNeedsConfig(
    scopedDb: DataContextDb,
    capability: AiModelCapability
  ): Promise<void> {
    try {
      await this.recordError(scopedDb, {
        id: randomUUID(),
        feature: "ai.routing",
        operation: `resolve:${capability}`,
        errorCategory: "needs-config",
        retryable: false,
        userMessage: "No AI model is configured for this capability.",
        internalSummary: `No active capable model resolved for capability=${capability} (needs-config).`,
        requestId: null
      });
    } catch {
      // Observability is best-effort — a logging failure must not fail the caller's work.
    }
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

    const [
      defaultModel,
      models,
      overrideEnabled,
      requestedModelId,
      adminPinnedModelId,
      adminPinnedProviderId
    ] = await Promise.all([
      this.selectModelForCapability(scopedDb, "chat"),
      this.listModels(scopedDb),
      this.getChatModelOverrideEnabled(scopedDb),
      this.getChatModelOverridePreference(scopedDb),
      this.getAdminPinnedModelId(scopedDb),
      this.getAdminPinnedProviderId(scopedDb)
    ]);

    // #870/M4: a per-user pin of EITHER kind (model or provider) is a hard routing constraint, so the
    // per-user chat override is inert — surface the pinned/effective model with no selectable choices.
    if (adminPinnedModelId || adminPinnedProviderId) {
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

    // #870/M4a: model pin and provider pin are mutually exclusive. Setting a model pin clears any
    // provider pin so the two keys can never both be present for one user.
    await scopedDb.db
      .deleteFrom("app.preferences")
      .where("key", "=", AI_ADMIN_PINNED_PROVIDER_PREFERENCE_KEY)
      .execute();

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
   * #870/D8 Slice 1: the admin's per-user PROVIDER pin (id), or null. A provider pin hard-locks ALL
   * of the user's traffic (chat + voice + workers) to that provider — see resolveModelForCapability.
   */
  async getAdminPinnedProviderId(scopedDb: DataContextDb): Promise<string | null> {
    assertDataContextDb(scopedDb);
    const row = await scopedDb.db
      .selectFrom("app.preferences")
      .select("value_json")
      .where("key", "=", AI_ADMIN_PINNED_PROVIDER_PREFERENCE_KEY)
      .executeTakeFirst();
    return typeof row?.value_json === "string" ? row.value_json : null;
  }

  async getAdminPinnedProvider(scopedDb: DataContextDb): Promise<AiProviderConfigSafeRow | null> {
    assertDataContextDb(scopedDb);
    const providerId = await this.getAdminPinnedProviderId(scopedDb);
    if (!providerId) return null;
    return (
      (await this.safeProviderQuery(scopedDb).where("id", "=", providerId).executeTakeFirst()) ??
      null
    );
  }

  async setAdminPinnedProvider(
    scopedDb: DataContextDb,
    providerId: string | null
  ): Promise<AiProviderConfigSafeRow | null> {
    assertDataContextDb(scopedDb);

    if (providerId === null) {
      await scopedDb.db
        .deleteFrom("app.preferences")
        .where("key", "=", AI_ADMIN_PINNED_PROVIDER_PREFERENCE_KEY)
        .execute();
      return null;
    }

    // Only an active, visible provider can be pinned (a hard-lock to a dead provider would strand
    // the user with a permanent needs-config for every capability).
    const provider = await this.safeProviderQuery(scopedDb)
      .where("id", "=", providerId)
      .where("status", "=", "active")
      .executeTakeFirst();
    if (!provider) return null;

    // #870/M4a: clear any model pin — the two pin kinds are mutually exclusive.
    await scopedDb.db
      .deleteFrom("app.preferences")
      .where("key", "=", AI_ADMIN_PINNED_MODEL_PREFERENCE_KEY)
      .execute();

    await scopedDb.db
      .insertInto("app.preferences")
      .values({
        owner_user_id: sql<string>`app.current_actor_user_id()`,
        key: AI_ADMIN_PINNED_PROVIDER_PREFERENCE_KEY,
        value_json: jsonb(providerId),
        updated_at: new Date()
      })
      .onConflict((oc) =>
        oc.columns(["owner_user_id", "key"]).doUpdateSet({
          value_json: jsonb(providerId),
          updated_at: new Date()
        })
      )
      .execute();

    return provider;
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
        "execution_mode",
        sql<boolean>`encrypted_credential IS NOT NULL`.as("has_credential"),
        // #870/H1: keep the sealed-credential row shape in sync with AiProviderConfigSafeRow.
        "is_instance_default",
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
        "execution_mode",
        sql<boolean>`encrypted_credential IS NOT NULL`.as("has_credential"),
        // #870/H1: the single instance-default flag (0147). Serialized into AiProviderConfigDto.
        "is_instance_default",
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
        "providers.execution_mode as provider_execution_mode",
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

  async listActionPolicies(
    scopedDb: DataContextDb
  ): Promise<{ moduleId: string; actionFamilyId: string; tier: JarvisActionPermissionTier }[]> {
    assertDataContextDb(scopedDb);
    const rows = await scopedDb.db
      .selectFrom("app.preferences")
      .select(["key", "value_json"])
      .where("key", "like", "assistant.action_policy.v1.%")
      .execute();

    const prefixLen = "assistant.action_policy.v1.".length;
    return rows.map((r) => {
      const parts = r.key.substring(prefixLen).split(".");
      return {
        moduleId: parts[0]!,
        actionFamilyId: parts.slice(1).join("."),
        tier:
          typeof r.value_json === "string"
            ? (r.value_json as JarvisActionPermissionTier)
            : "ask_each_time"
      };
    });
  }

  async setActionPolicy(
    scopedDb: DataContextDb,
    moduleId: string,
    actionFamilyId: string,
    tier: JarvisActionPermissionTier
  ): Promise<void> {
    assertDataContextDb(scopedDb);
    const key = `assistant.action_policy.v1.${moduleId}.${actionFamilyId}`;
    await scopedDb.db
      .insertInto("app.preferences")
      .values({
        owner_user_id: sql<string>`app.current_actor_user_id()`,
        key,
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
  async insertActionAuditLog(scopedDb: DataContextDb, input: InsertAuditLogInput): Promise<void> {
    assertDataContextDb(scopedDb);
    await scopedDb.db
      .insertInto("app.jarvis_action_audit_log")
      .values({
        id: input.id,
        owner_user_id: input.ownerUserId,
        tool_module_id: input.toolModuleId,
        tool_name: input.toolName,
        action_family_id: input.actionFamilyId ?? null,
        action_kind: input.actionKind,
        approval_mode: input.approvalMode,
        outcome: input.outcome,
        error_class: input.errorClass ?? null,
        request_id: input.requestId ?? null,
        chat_session_id: input.chatSessionId ?? null,
        source_surface: input.sourceSurface
      })
      .execute();
  }

  async listActionAuditLog(
    scopedDb: DataContextDb,
    opts: ListAuditLogOptions
  ): Promise<JarvisActionAuditLog[]> {
    assertDataContextDb(scopedDb);
    let query = scopedDb.db
      .selectFrom("app.jarvis_action_audit_log")
      .selectAll()
      .where("occurred_at", ">=", opts.since)
      .orderBy("occurred_at", "desc")
      .limit(opts.limit);

    if (opts.familyFilter) {
      query = query
        .where("tool_module_id", "=", opts.familyFilter.moduleId)
        .where("action_family_id", "=", opts.familyFilter.familyId);
    }

    return query.execute();
  }

  async purgeActionAuditLog(appDb: Kysely<JarvisDatabase>, olderThan: Date): Promise<number> {
    const result = await sql<{ count: number }>`
      SELECT app.purge_jarvis_action_audit_log(${olderThan}) AS count
    `.execute(appDb);
    return Number(result.rows[0]?.count ?? 0);
  }

  async recordError(scopedDb: DataContextDb, input: RecordErrorInput): Promise<void> {
    assertDataContextDb(scopedDb);
    await scopedDb.db
      .insertInto("app.jarvis_error_log")
      .values({
        id: input.id,
        owner_user_id: sql<string>`app.current_actor_user_id()`,
        feature: input.feature,
        operation: input.operation,
        error_category: input.errorCategory,
        retryable: input.retryable,
        user_message: input.userMessage,
        internal_summary: input.internalSummary,
        request_id: input.requestId
      })
      .execute();
  }

  async recordAnonymousError(
    appDb: Kysely<JarvisDatabase>,
    input: RecordErrorInput
  ): Promise<void> {
    await sql`
      SELECT app.record_anonymous_error(
        ${input.id}::uuid,
        ${input.feature},
        ${input.operation},
        ${input.errorCategory},
        ${input.retryable},
        ${input.userMessage},
        ${input.internalSummary},
        ${input.requestId}
      )
    `.execute(appDb);
  }

  async listRecentErrors(
    scopedDb: DataContextDb,
    opts: ListRecentErrorsOptions
  ): Promise<JarvisErrorLog[]> {
    assertDataContextDb(scopedDb);
    const since = opts.since ?? new Date(Date.now() - 24 * 60 * 60 * 1000);
    const q = opts.query?.trim().toLowerCase();
    let query = scopedDb.db
      .selectFrom("app.jarvis_error_log")
      .selectAll()
      .where("occurred_at", ">=", since)
      .orderBy("occurred_at", "desc")
      .limit(Math.min(opts.limit, 50));

    if (q) {
      query = query.where((eb) =>
        eb.or([
          eb(sql<string>`lower(feature)`, "like", `%${q}%`),
          eb(sql<string>`lower(operation)`, "like", `%${q}%`),
          eb(sql<string>`lower(error_category)`, "like", `%${q}%`),
          eb(sql<string>`lower(user_message)`, "like", `%${q}%`)
        ])
      );
    }

    return query.execute();
  }

  async purgeErrorLog(appDb: Kysely<JarvisDatabase>, olderThan: Date): Promise<number> {
    const result = await sql<{ count: number }>`
      SELECT app.purge_jarvis_error_log(${olderThan}) AS count
    `.execute(appDb);
    return Number(result.rows[0]?.count ?? 0);
  }
}

function toOverrideCandidate(model: AiConfiguredModelSafeRow) {
  return {
    ...model,
    providerStatus: model.provider_status,
    allowUserOverride: model.allow_user_override
  };
}
