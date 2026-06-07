import { randomUUID } from "node:crypto";

import { sql, type Updateable } from "kysely";

import {
  assertDataContextDb,
  type ConnectorAccountStatus,
  type ConnectorAccountsTable,
  type ConnectorProvider,
  type ConnectorProviderStatus,
  type ConnectorProviderType,
  type DataContextDb
} from "@jarv1s/db";

import type { EncryptedConnectorSecret } from "./crypto.js";

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

export class ConnectorsRepository {
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
      updated_at: new Date(),
      revoked_at: null
    };

    if (input.scopes !== undefined) {
      updates.scopes = [...input.scopes];
    }
    if (input.status !== undefined) {
      updates.status = input.status;
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
        "accounts.updated_at as updated_at"
      ])
      .orderBy("accounts.created_at", "desc")
      .orderBy("accounts.id");
  }
}
