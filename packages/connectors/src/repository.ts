import { randomUUID } from "node:crypto";

import { sql, type Updateable } from "kysely";

import {
  assertDataContextDb,
  type ConnectorAccountStatus,
  type ConnectorAccountsTable,
  type ConnectorProvider,
  type ConnectorProviderStatus,
  type ConnectorProviderType,
  type ConnectorSyncStatus,
  type DataContextDb
} from "@jarv1s/db";
import type { ConnectorSyncCounts } from "@jarv1s/shared";

import type { EncryptedConnectorSecret } from "./crypto.js";

export const GOOGLE_PROVIDER_ID = "google";

export interface GooglePendingRow {
  readonly id: string;
  readonly state: string;
  readonly encryptedSecret: EncryptedConnectorSecret;
}

export interface ConnectorAccountSafeRow {
  readonly id: string;
  readonly provider_id: string;
  readonly provider_type: ConnectorProviderType;
  readonly provider_display_name: string;
  readonly provider_status: ConnectorProviderStatus;
  readonly owner_user_id: string;
  readonly scopes: string[];
  readonly status: ConnectorAccountStatus;
  readonly has_secret: boolean;
  readonly revoked_at: Date | null;
  readonly created_at: Date;
  readonly updated_at: Date;
  readonly last_sync_started_at: Date | null;
  readonly last_sync_finished_at: Date | null;
  readonly last_sync_status: ConnectorSyncStatus | null;
  readonly last_sync_error: string | null;
  readonly last_sync_counts: ConnectorSyncCounts | null;
}

export interface CreateConnectorAccountInput {
  readonly providerId: string;
  readonly scopes: readonly string[];
  readonly status?: Exclude<ConnectorAccountStatus, "revoked">;
  readonly encryptedSecret: EncryptedConnectorSecret;
}

export interface UpdateConnectorAccountInput {
  readonly scopes?: readonly string[];
  readonly status?: Exclude<ConnectorAccountStatus, "revoked">;
  readonly encryptedSecret?: EncryptedConnectorSecret;
}

export interface AdminUserCheckRow {
  readonly id: string;
  readonly is_instance_admin: boolean;
}

export class ConnectorsRepository {
  /**
   * Look up the actor's admin flag through the branded DataContextDb handle (never a
   * root Kysely instance — DataContextDb-only invariant). `app.get_user_by_id` is a
   * SECURITY DEFINER helper granted to the runtime role, so it resolves the row inside
   * the actor's scoped transaction. Returns undefined when no such user exists.
   */
  async getUserById(
    scopedDb: DataContextDb,
    userId: string
  ): Promise<AdminUserCheckRow | undefined> {
    assertDataContextDb(scopedDb);

    const result = await sql<AdminUserCheckRow>`
      SELECT id, is_instance_admin FROM app.get_user_by_id(${userId}::uuid)
    `.execute(scopedDb.db);

    return result.rows[0];
  }

  async listProviders(scopedDb: DataContextDb): Promise<ConnectorProvider[]> {
    assertDataContextDb(scopedDb);

    return scopedDb.db
      .selectFrom("app.connector_definitions")
      .selectAll()
      .orderBy("provider_type")
      .orderBy("display_name")
      .execute();
  }

  async listAccounts(scopedDb: DataContextDb): Promise<ConnectorAccountSafeRow[]> {
    assertDataContextDb(scopedDb);

    return this.safeAccountQuery(scopedDb.db).execute();
  }

  async listAdminSafeAccounts(scopedDb: DataContextDb): Promise<ConnectorAccountSafeRow[]> {
    assertDataContextDb(scopedDb);

    const result =
      await sql<ConnectorAccountSafeRow>`select * from app.list_connector_account_safe_metadata()`.execute(
        scopedDb.db
      );

    return result.rows;
  }

  async createAccount(
    scopedDb: DataContextDb,
    input: CreateConnectorAccountInput
  ): Promise<ConnectorAccountSafeRow> {
    assertDataContextDb(scopedDb);

    const now = new Date();
    const inserted = await scopedDb.db
      .insertInto("app.connector_accounts")
      .values({
        id: randomUUID(),
        provider_id: input.providerId,
        owner_user_id: sql<string>`app.current_actor_user_id()`,
        scopes: [...input.scopes],
        status: input.status ?? "active",
        encrypted_secret: input.encryptedSecret,
        revoked_at: null,
        created_at: now,
        updated_at: now
      })
      .returning("id")
      .executeTakeFirstOrThrow();

    return this.requireVisibleAccount(scopedDb, inserted.id);
  }

  async updateAccount(
    scopedDb: DataContextDb,
    accountId: string,
    input: UpdateConnectorAccountInput
  ): Promise<ConnectorAccountSafeRow | undefined> {
    assertDataContextDb(scopedDb);

    const updates: Updateable<ConnectorAccountsTable> = {
      updated_at: new Date()
    };

    if (input.scopes !== undefined) {
      updates.scopes = [...input.scopes];
    }
    if (input.status !== undefined) {
      // `status` is `Exclude<…, "revoked">`, so a provided status is always a
      // reactivation. Clearing `revoked_at` ONLY here (not unconditionally) stops
      // an unrelated PATCH — e.g. a scope change — from silently un-revoking a
      // revoked account (#143). Revocation itself stays owned by revokeAccount.
      updates.status = input.status;
      updates.revoked_at = null;
    }
    if (input.encryptedSecret !== undefined) {
      updates.encrypted_secret = input.encryptedSecret;
    }

    const updated = await scopedDb.db
      .updateTable("app.connector_accounts")
      .set(updates)
      .where("id", "=", accountId)
      .returning("id")
      .executeTakeFirst();

    return updated ? this.requireVisibleAccount(scopedDb, updated.id) : undefined;
  }

  async revokeAccount(
    scopedDb: DataContextDb,
    accountId: string,
    encryptedSecret: EncryptedConnectorSecret
  ): Promise<ConnectorAccountSafeRow | undefined> {
    assertDataContextDb(scopedDb);

    const updated = await scopedDb.db
      .updateTable("app.connector_accounts")
      .set({
        encrypted_secret: encryptedSecret,
        status: "revoked",
        revoked_at: new Date(),
        updated_at: new Date()
      })
      .where("id", "=", accountId)
      .returning("id")
      .executeTakeFirst();

    return updated ? this.requireVisibleAccount(scopedDb, updated.id) : undefined;
  }

  /**
   * Stamp the start of a sync run on the actor's own account row. Touches only the
   * health/`updated_at` columns — never `status` or `revoked_at`, so an in-flight sync can
   * never silently un-revoke a revoked account. The `id` predicate runs under owner RLS, so
   * only the actor's visible row is affected.
   */
  async markSyncStarted(
    scopedDb: DataContextDb,
    accountId: string,
    startedAt: Date
  ): Promise<void> {
    assertDataContextDb(scopedDb);
    await scopedDb.db
      .updateTable("app.connector_accounts")
      .set({
        last_sync_started_at: startedAt,
        last_sync_status: null,
        updated_at: startedAt
      })
      .where("id", "=", accountId)
      .execute();
  }

  /**
   * Stamp the outcome of a sync run with aggregate-only health. Writes the bounded status,
   * a bounded error label (or null), and the small counts object. Like markSyncStarted it
   * never touches `status`/`revoked_at`.
   */
  async markSyncFinished(
    scopedDb: DataContextDb,
    accountId: string,
    input: {
      finishedAt: Date;
      status: ConnectorSyncStatus;
      error: string | null;
      counts: Record<string, number | boolean>;
    }
  ): Promise<void> {
    assertDataContextDb(scopedDb);
    await scopedDb.db
      .updateTable("app.connector_accounts")
      .set({
        last_sync_finished_at: input.finishedAt,
        last_sync_status: input.status,
        last_sync_error: input.error,
        last_sync_counts: input.counts,
        updated_at: input.finishedAt
      })
      .where("id", "=", accountId)
      .execute();
  }

  async upsertGooglePending(
    scopedDb: DataContextDb,
    input: { state: string; encryptedSecret: EncryptedConnectorSecret }
  ): Promise<void> {
    assertDataContextDb(scopedDb);
    await scopedDb.db
      .deleteFrom("app.connector_oauth_pending")
      .where("provider_id", "=", GOOGLE_PROVIDER_ID)
      .execute();
    await scopedDb.db
      .insertInto("app.connector_oauth_pending")
      .values({
        id: randomUUID(),
        owner_user_id: sql<string>`app.current_actor_user_id()`,
        provider_id: GOOGLE_PROVIDER_ID,
        state: input.state,
        encrypted_secret: input.encryptedSecret,
        created_at: new Date()
      })
      .execute();
  }

  async getGooglePending(scopedDb: DataContextDb): Promise<GooglePendingRow | undefined> {
    assertDataContextDb(scopedDb);
    const row = await scopedDb.db
      .selectFrom("app.connector_oauth_pending")
      .select(["id", "state", "encrypted_secret"])
      .where("provider_id", "=", GOOGLE_PROVIDER_ID)
      .executeTakeFirst();
    if (!row) return undefined;
    return {
      id: row.id,
      state: row.state,
      encryptedSecret: row.encrypted_secret as EncryptedConnectorSecret
    };
  }

  async deleteGooglePending(scopedDb: DataContextDb): Promise<void> {
    assertDataContextDb(scopedDb);
    await scopedDb.db
      .deleteFrom("app.connector_oauth_pending")
      .where("provider_id", "=", GOOGLE_PROVIDER_ID)
      .execute();
  }

  async upsertGoogleAccount(
    scopedDb: DataContextDb,
    input: { scopes: readonly string[]; encryptedSecret: EncryptedConnectorSecret }
  ): Promise<ConnectorAccountSafeRow> {
    assertDataContextDb(scopedDb);
    const existing = await scopedDb.db
      .selectFrom("app.connector_accounts")
      .select("id")
      .where("provider_id", "=", GOOGLE_PROVIDER_ID)
      .executeTakeFirst();
    if (existing) {
      const updated = await this.updateAccount(scopedDb, existing.id, {
        scopes: [...input.scopes],
        status: "active",
        encryptedSecret: input.encryptedSecret
      });
      if (!updated) throw new Error("Failed to update google account");
      return updated;
    }
    return this.createAccount(scopedDb, {
      providerId: GOOGLE_PROVIDER_ID,
      scopes: [...input.scopes],
      status: "active",
      encryptedSecret: input.encryptedSecret
    });
  }

  async getActiveGoogleAccountSecret(
    scopedDb: DataContextDb
  ): Promise<{ id: string; encryptedSecret: EncryptedConnectorSecret } | undefined> {
    assertDataContextDb(scopedDb);
    const row = await scopedDb.db
      .selectFrom("app.connector_accounts")
      .select(["id", "encrypted_secret"])
      .where("provider_id", "=", GOOGLE_PROVIDER_ID)
      .where("status", "=", "active")
      .executeTakeFirst();
    if (!row) return undefined;
    return { id: row.id, encryptedSecret: row.encrypted_secret as EncryptedConnectorSecret };
  }

  /**
   * Read-only, owner-scoped check: does the active google account hold the calendar
   * write scope? Reads `accounts.scopes` (already owner-RLS-scoped). Returns false when
   * there is no active google account. Never decrypts the secret bundle.
   */
  async hasCalendarWriteScope(scopedDb: DataContextDb): Promise<boolean> {
    return (await this.getCalendarWriteScopeState(scopedDb))?.hasScope ?? false;
  }

  async getCalendarWriteScopeState(
    scopedDb: DataContextDb
  ): Promise<{ accountId: string; hasScope: boolean } | undefined> {
    assertDataContextDb(scopedDb);
    const row = await scopedDb.db
      .selectFrom("app.connector_accounts")
      .select(["id", "scopes"])
      .where("provider_id", "=", GOOGLE_PROVIDER_ID)
      .where("status", "=", "active")
      .executeTakeFirst();
    if (!row) return undefined;
    return {
      accountId: row.id,
      hasScope: row.scopes.includes("https://www.googleapis.com/auth/calendar")
    };
  }

  private async requireVisibleAccount(
    scopedDb: DataContextDb,
    accountId: string
  ): Promise<ConnectorAccountSafeRow> {
    const account = await this.safeAccountQuery(scopedDb.db)
      .where("accounts.id", "=", accountId)
      .executeTakeFirst();

    if (!account) {
      throw new Error("Connector account is not visible after write");
    }

    return account;
  }

  private safeAccountQuery(db: DataContextDb["db"]) {
    return db
      .selectFrom("app.connector_accounts as accounts")
      .innerJoin(
        "app.connector_definitions as definitions",
        "definitions.provider_id",
        "accounts.provider_id"
      )
      .select([
        "accounts.id as id",
        "accounts.provider_id as provider_id",
        "definitions.provider_type as provider_type",
        "definitions.display_name as provider_display_name",
        "definitions.status as provider_status",
        "accounts.owner_user_id as owner_user_id",
        "accounts.scopes as scopes",
        "accounts.status as status",
        sql<boolean>`accounts.encrypted_secret IS NOT NULL`.as("has_secret"),
        "accounts.revoked_at as revoked_at",
        "accounts.created_at as created_at",
        "accounts.updated_at as updated_at",
        "accounts.last_sync_started_at as last_sync_started_at",
        "accounts.last_sync_finished_at as last_sync_finished_at",
        "accounts.last_sync_status as last_sync_status",
        "accounts.last_sync_error as last_sync_error",
        "accounts.last_sync_counts as last_sync_counts"
      ])
      .orderBy("accounts.created_at", "desc")
      .orderBy("accounts.id");
  }
}
