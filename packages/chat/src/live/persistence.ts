/**
 * DataContextChatPersistence — the REAL ChatPersistencePort backing the live
 * ChatSessionManager.
 *
 * Every method builds an AccessContext { actorUserId, requestId } and runs its
 * queries through the DataContextRunner so RLS scopes all reads/writes to the
 * acting owner. Provider routing reuses the AI capability router; turn recording
 * reuses ChatRepository's recency + completed-turn helpers and then enqueues the
 * episodic-embed job (unless the thread is incognito).
 */
import type { AiConfiguredModelSafeRow, AiRepository, ProviderKind } from "@jarv1s/ai";
import { assertDataContextDb, type DataContextDb, type DataContextRunner } from "@jarv1s/db";
import type { PgBoss } from "pg-boss";

import { CHAT_EMBED_TURN_QUEUE, CHAT_EXTRACT_FACTS_QUEUE, type EmbedTurnJobPayload, type ExtractFactsJobPayload } from "../jobs.js";
import type { ChatPersistencePort } from "./chat-session-manager.js";
import type { ChatRepository } from "../repository.js";

/** Provider-kinds the live CLI runtime can drive (the narrow ProviderKind set). */
const LIVE_PROVIDER_KINDS: readonly ProviderKind[] = ["anthropic", "openai-compatible", "google"];

/** Title used when the live runtime has to open a user's first conversation. */
const DEFAULT_CONVERSATION_TITLE = "Conversation";

export interface DataContextChatPersistenceDeps {
  readonly dataContext: DataContextRunner;
  readonly chatRepository: ChatRepository;
  readonly aiRepository: AiRepository;
  readonly boss?: PgBoss;
}

export class DataContextChatPersistence implements ChatPersistencePort {
  private readonly dataContext: DataContextRunner;
  private readonly chat: ChatRepository;
  private readonly ai: AiRepository;
  private readonly boss: PgBoss | undefined;

  constructor(deps: DataContextChatPersistenceDeps) {
    this.dataContext = deps.dataContext;
    this.chat = deps.chatRepository;
    this.ai = deps.aiRepository;
    this.boss = deps.boss;
  }

  async resolveActiveProvider(
    actorUserId: string
  ): Promise<{ provider: ProviderKind; model: string }> {
    const model = await this.run(actorUserId, "resolve-provider", (scopedDb) =>
      this.ai.selectModelForCapability(scopedDb, "chat")
    );

    if (!model) {
      throw new Error("No active chat-capable model is configured for this user.");
    }

    return { provider: toLiveProvider(model), model: model.provider_model_id };
  }

  async listPriorTurns(
    actorUserId: string
  ): Promise<{ role: "user" | "assistant"; content: string }[]> {
    return this.run(actorUserId, "list-prior-turns", async (scopedDb) => {
      const thread = await this.chat.getCurrentThread(scopedDb, actorUserId);
      if (!thread) return [];

      const messages = await this.chat.listMessages(scopedDb, thread.id);
      return messages
        .filter(
          (message) =>
            message.status === "stored" && (message.role === "user" || message.role === "assistant")
        )
        .map((message) => ({
          role: message.role as "user" | "assistant",
          content: message.body
        }));
    });
  }

  async recordTurn(
    actorUserId: string,
    userText: string,
    assistantReply: string,
    executed: { provider: ProviderKind; model: string }
  ): Promise<void> {
    await this.run(actorUserId, "record-turn", async (scopedDb) => {
      const thread =
        (await this.chat.getCurrentThread(scopedDb, actorUserId)) ??
        (await this.chat.openNewThread(scopedDb, { title: DEFAULT_CONVERSATION_TITLE }));

      const result = await this.chat.recordCompletedTurn(
        scopedDb,
        thread.id,
        userText,
        assistantReply,
        executed
      );
      await this.chat.touchThread(scopedDb, thread.id);

      if (this.boss && result && !thread.incognito) {
        const messageId = result.assistantMessage.id;
        const embedPayload: EmbedTurnJobPayload = {
          actorUserId,
          threadId: thread.id,
          messageId
        };
        const extractPayload: ExtractFactsJobPayload = {
          actorUserId,
          threadId: thread.id
        };
        await this.boss.send(CHAT_EMBED_TURN_QUEUE, embedPayload);
        await this.boss.send(CHAT_EXTRACT_FACTS_QUEUE, extractPayload);
      }
    });
  }

  async openNewConversation(
    actorUserId: string,
    options?: { incognito?: boolean }
  ): Promise<void> {
    await this.run(actorUserId, "open-new-conversation", (scopedDb) =>
      this.chat.openNewThread(scopedDb, {
        title: DEFAULT_CONVERSATION_TITLE,
        incognito: options?.incognito
      })
    );
  }

  /**
   * Resolve the acting user's display name (for persona rendering). Reads the
   * foundation app.users row under the actor's data context; falls back to the
   * actorUserId when the name is empty/missing. Not part of ChatPersistencePort —
   * the live routes call it to seed renderPersona's {{userName}} token.
   */
  async resolveUserName(actorUserId: string): Promise<string> {
    return this.run(actorUserId, "resolve-user-name", async (scopedDb) => {
      assertDataContextDb(scopedDb);
      const row = await scopedDb.db
        .selectFrom("app.users")
        .select("name")
        .where("id", "=", actorUserId)
        .executeTakeFirst();
      const name = row?.name?.trim();
      return name && name.length > 0 ? name : actorUserId;
    });
  }

  private run<T>(
    actorUserId: string,
    operation: string,
    fn: (scopedDb: DataContextDb) => Promise<T>
  ): Promise<T> {
    return this.dataContext.withDataContext(
      { actorUserId, requestId: `chat-live:${operation}` },
      fn
    );
  }
}

/**
 * Map the router's broad AiProviderKind onto the narrow live ProviderKind the CLI
 * engines support. ollama/custom have no live CLI engine in Phase 1 → throw a
 * clear error rather than silently dispatching an unsupported provider.
 */
function toLiveProvider(model: AiConfiguredModelSafeRow): ProviderKind {
  const kind = model.provider_kind;
  if ((LIVE_PROVIDER_KINDS as readonly string[]).includes(kind)) {
    return kind as ProviderKind;
  }
  throw new Error(
    `Active chat model uses provider kind "${kind}", which has no live CLI engine in Phase 1.`
  );
}
