import { randomUUID } from "node:crypto";

import { sql, type Updateable } from "kysely";

import {
  assertDataContextDb,
  type AiAssistantActionRequest,
  type AiAssistantActionRisk,
  type AiAssistantActionStatus,
  type AiAuthMethod,
  type AiConfiguredModelsTable,
  type AiModelStatus,
  type AiProviderConfigsTable,
  type AiProviderKind,
  type AiProviderStatus,
  type DataContextDb
} from "@jarv1s/db";
import type { AiModelCapability } from "@jarv1s/shared";

import type { EncryptedAiSecret } from "./crypto.js";

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
  readonly created_at: Date;
  readonly updated_at: Date;
}

export type AiAssistantActionRequestSafeRow = AiAssistantActionRequest;

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
}

export interface UpdateAiModelInput {
  readonly providerModelId?: string;
  readonly displayName?: string;
  readonly capabilities?: readonly AiModelCapability[];
  readonly status?: AiModelStatus;
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

export class AiRepository {
  async listProviders(scopedDb: DataContextDb): Promise<AiProviderConfigSafeRow[]> {
    assertDataContextDb(scopedDb);

    return this.safeProviderQuery(scopedDb).execute();
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
    capability: AiModelCapability
  ): Promise<AiConfiguredModelSafeRow | undefined> {
    assertDataContextDb(scopedDb);

    return this.safeModelQuery(scopedDb)
      .where("models.status", "=", "active")
      .where("providers.status", "=", "active")
      .where(sql<boolean>`${capability} = any(${sql.ref("models.capabilities")})`)
      .orderBy("models.created_at", "desc")
      .orderBy("models.id", "desc")
      .executeTakeFirst();
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
}
