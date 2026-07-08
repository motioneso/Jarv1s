import { randomUUID } from "node:crypto";

import { sql } from "kysely";

import {
  assertDataContextDb,
  type ChatMessage,
  type ChatMessageStatus,
  type ChatThread,
  type DataContextDb
} from "@jarv1s/db";
import type { AnswerProvenanceMetadataV1, SourceFreshnessV1 } from "@jarv1s/shared";

export interface CreateChatThreadInput {
  readonly title: string;
  readonly incognito?: boolean;
}

/**
 * Chat persistence for the live drawer runtime: thread reads + the born-complete
 * turn recording the in-process CLI runtime needs. The legacy worker-backed
 * methods (create/append/status/activity/complete) and the pg-boss enqueue were
 * removed in the retire-legacy-chat-model change.
 */
export class ChatRepository {
  async listThreads(scopedDb: DataContextDb): Promise<ChatThread[]> {
    assertDataContextDb(scopedDb);

    return scopedDb.db
      .selectFrom("app.chat_threads")
      .selectAll()
      .where("incognito", "=", false)
      .orderBy("last_active_at", "desc")
      .orderBy("id")
      .execute();
  }

  /**
   * Threads ordered by REAL activity (last_active_at, bumped on every turn via
   * touchThread), most-active first, capped at `limit`. Used by the briefing's
   * today's-chats scan so a long-lived thread active today is never dropped — the
   * existing listThreads orders by updated_at, which is NOT bumped on a turn.
   */
  async listThreadsByActivity(scopedDb: DataContextDb, limit: number): Promise<ChatThread[]> {
    assertDataContextDb(scopedDb);

    return scopedDb.db
      .selectFrom("app.chat_threads")
      .selectAll()
      .orderBy("last_active_at", "desc")
      .orderBy("id")
      .limit(limit)
      .execute();
  }

  async getThreadById(scopedDb: DataContextDb, threadId: string): Promise<ChatThread | undefined> {
    assertDataContextDb(scopedDb);

    return scopedDb.db
      .selectFrom("app.chat_threads")
      .selectAll()
      .where("id", "=", threadId)
      .executeTakeFirst();
  }

  async listMessages(scopedDb: DataContextDb, threadId: string): Promise<ChatMessage[]> {
    assertDataContextDb(scopedDb);

    return scopedDb.db
      .selectFrom("app.chat_messages")
      .selectAll()
      .where("thread_id", "=", threadId)
      .orderBy("created_at")
      .orderBy(sql<number>`CASE WHEN role = 'user' THEN 0 ELSE 1 END`)
      .orderBy("id")
      .execute();
  }

  async getMessageById(
    scopedDb: DataContextDb,
    messageId: string
  ): Promise<ChatMessage | undefined> {
    assertDataContextDb(scopedDb);

    return scopedDb.db
      .selectFrom("app.chat_messages")
      .selectAll()
      .where("id", "=", messageId)
      .executeTakeFirst();
  }

  private async insertMessage(
    scopedDb: DataContextDb,
    input: {
      readonly thread: ChatThread;
      readonly role: ChatMessage["role"];
      readonly status: ChatMessageStatus;
      readonly body: string;
      readonly modelMetadata: Record<string, unknown>;
      readonly toolMetadata: Record<string, unknown>;
      readonly now: Date;
    }
  ): Promise<ChatMessage> {
    return scopedDb.db
      .insertInto("app.chat_messages")
      .values({
        id: randomUUID(),
        thread_id: input.thread.id,
        owner_user_id: sql<string>`app.current_actor_user_id()`,
        role: input.role,
        status: input.status,
        body: input.body,
        model_metadata: input.modelMetadata,
        tool_metadata: input.toolMetadata,
        created_at: input.now,
        updated_at: input.now
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  /**
   * Returns the owner's most-recent thread by last_active_at (the conversation the
   * live drawer should open to), or undefined when the owner has no threads. RLS
   * scopes rows to the owner; we still bind to the actor's ownership explicitly.
   */
  async getCurrentThread(
    scopedDb: DataContextDb,
    actorUserId: string
  ): Promise<ChatThread | undefined> {
    assertDataContextDb(scopedDb);

    return scopedDb.db
      .selectFrom("app.chat_threads")
      .selectAll()
      .where("owner_user_id", "=", actorUserId)
      .orderBy("last_active_at", "desc")
      .orderBy("id")
      .limit(1)
      .executeTakeFirst();
  }

  /**
   * Creates a new chat thread stamped active now, making it the most-recent (and
   * therefore "current") conversation for the owner.
   */
  async openNewThread(scopedDb: DataContextDb, input: CreateChatThreadInput): Promise<ChatThread> {
    assertDataContextDb(scopedDb);

    const now = new Date();

    return scopedDb.db
      .insertInto("app.chat_threads")
      .values({
        id: randomUUID(),
        owner_user_id: sql<string>`app.current_actor_user_id()`,
        title: input.title,
        incognito: input.incognito ?? false,
        created_at: now,
        updated_at: now,
        last_active_at: now
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  /**
   * Records a completed live-chat turn WITHOUT enqueuing a pg-boss job: a `stored`
   * user message followed by a `stored` assistant message whose body is the final
   * reply and whose model_metadata stamps the executing provider+model under
   * `executed`. The live runtime drives the CLI in-process and bypasses the worker,
   * so no job is enqueued and the assistant message is born complete.
   */
  async recordCompletedTurn(
    scopedDb: DataContextDb,
    threadId: string,
    userText: string,
    assistantReply: string,
    executed: { readonly provider: string; readonly model: string },
    opts?: {
      readonly sourceFreshness?: SourceFreshnessV1 | null;
      readonly answerProvenance?: AnswerProvenanceMetadataV1;
    }
  ): Promise<{ userMessage: ChatMessage; assistantMessage: ChatMessage } | undefined> {
    assertDataContextDb(scopedDb);

    const thread = await this.getThreadById(scopedDb, threadId);

    if (!thread) {
      return undefined;
    }
    if (thread.incognito) {
      return undefined;
    }

    const now = new Date();
    const userMessage = await this.insertMessage(scopedDb, {
      thread,
      role: "user",
      status: "stored",
      body: userText,
      modelMetadata: {},
      toolMetadata: { selectedTools: [] },
      now
    });
    const assistantMessage = await this.insertMessage(scopedDb, {
      thread,
      role: "assistant",
      status: "stored",
      body: assistantReply,
      modelMetadata: { executed: { provider: executed.provider, model: executed.model } },
      toolMetadata: {
        selectedTools: [],
        ...(opts?.sourceFreshness ? { sourceFreshness: opts.sourceFreshness } : {}),
        ...(opts?.answerProvenance !== undefined
          ? { answerProvenanceV1: opts.answerProvenance }
          : {})
      },
      now
    });

    return { userMessage, assistantMessage };
  }

  async updateConversationSummary(
    scopedDb: DataContextDb,
    threadId: string,
    summary: string
  ): Promise<void> {
    assertDataContextDb(scopedDb);
    await scopedDb.db
      .updateTable("app.chat_threads")
      .set({ conversation_summary: summary })
      .where("id", "=", threadId)
      .execute();
  }

  async updateThreadTitle(scopedDb: DataContextDb, threadId: string, title: string): Promise<void> {
    assertDataContextDb(scopedDb);
    await scopedDb.db
      .updateTable("app.chat_threads")
      .set({ title })
      .where("id", "=", threadId)
      .execute();
  }

  /**
   * Bumps a thread's last_active_at to now so it becomes the current conversation.
   * Owner-scoped via RLS; app_runtime holds UPDATE on chat_threads.
   */
  async touchThread(scopedDb: DataContextDb, threadId: string): Promise<ChatThread | undefined> {
    assertDataContextDb(scopedDb);

    return scopedDb.db
      .updateTable("app.chat_threads")
      .set({ last_active_at: new Date() })
      .where("id", "=", threadId)
      .returningAll()
      .executeTakeFirst();
  }

  async deleteThread(scopedDb: DataContextDb, threadId: string): Promise<void> {
    assertDataContextDb(scopedDb);
    await scopedDb.db.deleteFrom("app.chat_threads").where("id", "=", threadId).execute();
  }
}
