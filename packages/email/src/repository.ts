import { randomUUID } from "node:crypto";

import { sql } from "kysely";

import { assertDataContextDb, type DataContextDb, type EmailMessage } from "@jarv1s/db";

export interface CreateCachedEmailMessageInput {
  readonly id?: string;
  readonly connectorAccountId: string;
  readonly sender: string;
  readonly recipients?: readonly string[];
  readonly subject: string;
  readonly snippet?: string | null;
  readonly bodyExcerpt?: string | null;
  readonly receivedAt: Date | string;
  readonly externalId: string;
  readonly externalMetadata?: Record<string, unknown>;
  readonly summary?: string | null;
  readonly signals?: Record<string, unknown>;
}

export class EmailRepository {
  /** Hard cap on any persisted body excerpt — a preview, never a full body. */
  static readonly MAX_BODY_EXCERPT_CHARS = 500;
  static readonly BRIEFING_RECENT_LIMIT = 200;
  static readonly BRIEFING_OLDER_UNRESOLVED_LIMIT = 25;

  async listVisible(scopedDb: DataContextDb): Promise<EmailMessage[]> {
    assertDataContextDb(scopedDb);

    return scopedDb.db
      .selectFrom("app.email_messages")
      .selectAll()
      .orderBy("received_at", "desc")
      .orderBy("id")
      .execute();
  }

  async listVisibleForBriefing(scopedDb: DataContextDb): Promise<EmailMessage[]> {
    assertDataContextDb(scopedDb);

    const recent = await scopedDb.db
      .selectFrom("app.email_messages")
      .selectAll()
      .orderBy("received_at", "desc")
      .orderBy("id")
      .limit(EmailRepository.BRIEFING_RECENT_LIMIT)
      .execute();

    const recentIds = recent.map((message) => message.id);
    const olderUnresolved = await scopedDb.db
      .selectFrom("app.email_messages")
      .selectAll()
      .$if(recentIds.length > 0, (qb) => qb.where("id", "not in", recentIds))
      .where(
        sql<boolean>`concat_ws(' ',
          coalesce(sender, ''),
          coalesce(subject, ''),
          coalesce(snippet, ''),
          coalesce(summary, ''),
          coalesce(signals::text, '')
        ) ~* '(reply|respond|let me know|can you|please review|follow up|question|action)'`
      )
      .orderBy("received_at", "desc")
      .orderBy("id")
      .limit(EmailRepository.BRIEFING_OLDER_UNRESOLVED_LIMIT)
      .execute();

    return [...recent, ...olderUnresolved];
  }

  async getById(scopedDb: DataContextDb, messageId: string): Promise<EmailMessage | undefined> {
    assertDataContextDb(scopedDb);

    // Visibility is intentionally enforced by forced RLS; unauthorized rows read as absent.
    return scopedDb.db
      .selectFrom("app.email_messages")
      .selectAll()
      .where("id", "=", messageId)
      .executeTakeFirst();
  }

  /**
   * external_id is unique only per connector account (UNIQUE (connector_account_id,
   * external_id) — see 0012_email_module.sql), never globally: two different accounts can
   * share the same provider message id. Both columns are required so this never resolves
   * the wrong account's row.
   */
  async getByConnectorAccountAndExternalId(
    scopedDb: DataContextDb,
    connectorAccountId: string,
    externalId: string
  ): Promise<EmailMessage | undefined> {
    assertDataContextDb(scopedDb);

    // Visibility is intentionally enforced by forced RLS; unauthorized rows read as absent.
    return scopedDb.db
      .selectFrom("app.email_messages")
      .selectAll()
      .where("connector_account_id", "=", connectorAccountId)
      .where("external_id", "=", externalId)
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
        sender: input.sender,
        recipients: [...(input.recipients ?? [])],
        subject: input.subject,
        snippet: input.snippet ?? null,
        body_excerpt: input.bodyExcerpt ?? null,
        received_at: input.receivedAt,
        external_id: input.externalId,
        external_metadata: input.externalMetadata ?? {},
        summary: input.summary ?? null,
        signals: input.signals ?? {},
        created_at: now,
        updated_at: now
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async upsertCachedMessage(
    scopedDb: DataContextDb,
    input: CreateCachedEmailMessageInput
  ): Promise<EmailMessage> {
    assertDataContextDb(scopedDb);

    const now = new Date();
    const bodyExcerpt =
      input.bodyExcerpt != null
        ? input.bodyExcerpt.slice(0, EmailRepository.MAX_BODY_EXCERPT_CHARS)
        : null;

    return scopedDb.db
      .insertInto("app.email_messages")
      .values({
        id: input.id ?? randomUUID(),
        connector_account_id: input.connectorAccountId,
        owner_user_id: sql<string>`app.current_actor_user_id()`,
        sender: input.sender,
        recipients: [...(input.recipients ?? [])],
        subject: input.subject,
        snippet: input.snippet ?? null,
        body_excerpt: bodyExcerpt,
        received_at: input.receivedAt,
        external_id: input.externalId,
        external_metadata: input.externalMetadata ?? {},
        summary: input.summary ?? null,
        signals: input.signals ?? {},
        created_at: now,
        updated_at: now
      })
      .onConflict((oc) =>
        oc.columns(["connector_account_id", "external_id"]).doUpdateSet({
          sender: input.sender,
          recipients: [...(input.recipients ?? [])],
          subject: input.subject,
          snippet: input.snippet ?? null,
          body_excerpt: bodyExcerpt,
          received_at: input.receivedAt,
          external_metadata: input.externalMetadata ?? {},
          summary: input.summary ?? null,
          signals: input.signals ?? {},
          updated_at: now
        })
      )
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  /**
   * Lightweight per-account sync markers for skip-unchanged: external_id, the stored Gmail
   * historyId (read from external_metadata), AND whether a non-null summary already exists.
   * The handler skips the (costly) LLM pass ONLY when historyId is unchanged AND a usable
   * summary is already stored — so a message first cached before any model was configured (or
   * after a failed extraction, summary=null) is correctly RE-summarized once a model exists.
   * RLS-scoped to the actor via the worker SELECT grant (0068); returns only this account's rows.
   */
  async listSyncMarkers(
    scopedDb: DataContextDb,
    connectorAccountId: string
  ): Promise<Array<{ externalId: string; historyId: string | null; hasSummary: boolean }>> {
    assertDataContextDb(scopedDb);
    const rows = await scopedDb.db
      .selectFrom("app.email_messages")
      .select(["external_id", "external_metadata", "summary"])
      .where("connector_account_id", "=", connectorAccountId)
      .execute();
    return rows.map((r) => ({
      externalId: r.external_id,
      historyId: (r.external_metadata as { historyId?: string | null } | null)?.historyId ?? null,
      hasSummary: r.summary !== null
    }));
  }
}
