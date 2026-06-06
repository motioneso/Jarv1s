import { randomUUID } from "node:crypto";

import { sql } from "kysely";

import {
  assertDataContextDb,
  type DataContextDb,
  type EmailMessage,
  type EmailMessageVisibility
} from "@jarv1s/db";

export interface CreateCachedEmailMessageInput {
  readonly id?: string;
  readonly connectorAccountId: string;
  readonly workspaceId?: string | null;
  readonly visibility?: EmailMessageVisibility;
  readonly sender: string;
  readonly recipients?: readonly string[];
  readonly subject: string;
  readonly snippet?: string | null;
  readonly bodyExcerpt?: string | null;
  readonly receivedAt: Date | string;
  readonly externalId: string;
  readonly externalMetadata?: Record<string, unknown>;
}

export class EmailRepository {
  async listVisible(scopedDb: DataContextDb): Promise<EmailMessage[]> {
    assertDataContextDb(scopedDb);

    return scopedDb.db
      .selectFrom("app.email_messages")
      .selectAll()
      .orderBy("received_at", "desc")
      .orderBy("id")
      .execute();
  }

  async getById(scopedDb: DataContextDb, messageId: string): Promise<EmailMessage | undefined> {
    assertDataContextDb(scopedDb);

    return scopedDb.db
      .selectFrom("app.email_messages")
      .selectAll()
      .where("id", "=", messageId)
      .executeTakeFirst();
  }

  async createCachedMessageForTest(
    scopedDb: DataContextDb,
    input: CreateCachedEmailMessageInput
  ): Promise<EmailMessage> {
    assertDataContextDb(scopedDb);

    const now = new Date();

    return scopedDb.db
      .insertInto("app.email_messages")
      .values({
        id: input.id ?? randomUUID(),
        connector_account_id: input.connectorAccountId,
        owner_user_id: sql<string>`app.current_actor_user_id()`,
        workspace_id: input.workspaceId ?? null,
        visibility: input.visibility ?? "private",
        sender: input.sender,
        recipients: [...(input.recipients ?? [])],
        subject: input.subject,
        snippet: input.snippet ?? null,
        body_excerpt: input.bodyExcerpt ?? null,
        received_at: input.receivedAt,
        external_id: input.externalId,
        external_metadata: input.externalMetadata ?? {},
        created_at: now,
        updated_at: now
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }
}
