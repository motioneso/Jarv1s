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
import type { AnswerProvenanceMetadataV1, AiProviderExecutionMode } from "@jarv1s/shared";
import type { PgBoss } from "pg-boss";

import { sendJob } from "@jarv1s/jobs";

import {
  CHAT_EMBED_TURN_QUEUE,
  CHAT_EXTRACT_FACTS_QUEUE,
  type EmbedTurnJobPayload,
  type ExtractFactsJobPayload
} from "../jobs.js";
import { containsSensitiveMemoryText } from "../memory-distillation.js";
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
  ): Promise<{ provider: ProviderKind; model: string; executionMode: AiProviderExecutionMode }> {
    const model = await this.run(actorUserId, "resolve-provider", (scopedDb) =>
      this.ai.selectChatModelForUser(scopedDb)
    );

    if (!model) {
      throw new Error("No active chat-capable model is configured for this user.");
    }

    return {
      provider: toLiveProvider(model),
      model: model.provider_model_id,
      executionMode: model.provider_execution_mode
    };
  }

  async listPriorTurns(actorUserId: string): Promise<{
    recent: readonly { role: "user" | "assistant"; content: string }[];
    oldSummary: string | null;
  }> {
    return this.run(actorUserId, "list-prior-turns", async (scopedDb) => {
      const thread = await this.chat.getCurrentThread(scopedDb, actorUserId);
      if (!thread) return { recent: [], oldSummary: null };

      const messages = await this.chat.listMessages(scopedDb, thread.id);
      const turns = messages
        .filter((m) => m.status === "stored" && (m.role === "user" || m.role === "assistant"))
        .map((m) => ({ role: m.role as "user" | "assistant", content: m.body }));

      const k = getReplayK();
      if (k <= 0) {
        return { recent: [], oldSummary: null };
      }
      if (turns.length <= k) {
        return { recent: turns, oldSummary: null };
      }

      const recent = turns.slice(-k);
      const oldSummary = thread.conversation_summary ?? buildRollingSummary(turns.slice(0, -k));
      return { recent, oldSummary };
    });
  }

  async recordTurn(
    actorUserId: string,
    userText: string,
    assistantReply: string,
    executed: { provider: ProviderKind; model: string },
    answerProvenance?: AnswerProvenanceMetadataV1
  ): Promise<{ readonly userMessageId: string; readonly assistantMessageId: string } | undefined> {
    return this.run(actorUserId, "record-turn", async (scopedDb) => {
      const thread =
        (await this.chat.getCurrentThread(scopedDb, actorUserId)) ??
        (await this.chat.openNewThread(scopedDb, { title: DEFAULT_CONVERSATION_TITLE }));

      const result = await this.chat.recordCompletedTurn(
        scopedDb,
        thread.id,
        userText,
        assistantReply,
        executed,
        answerProvenance
      );
      await this.chat.touchThread(scopedDb, thread.id);

      // Update rolling summary when stored turns exceed the replay window.
      const k = getReplayK();
      const allMessages = await this.chat.listMessages(scopedDb, thread.id);
      const storedTurns = allMessages.filter(
        (m) => m.status === "stored" && (m.role === "user" || m.role === "assistant")
      );
      // Auto-title the thread from the first user turn (#403).
      if (storedTurns.length === 2 && thread.title === DEFAULT_CONVERSATION_TITLE) {
        await this.chat.updateThreadTitle(scopedDb, thread.id, deriveChatTitle(userText));
      }

      if (k > 0 && storedTurns.length > k) {
        const oldTurns = storedTurns.slice(0, -k).map((m) => ({
          role: m.role as "user" | "assistant",
          content: m.body
        }));
        await this.chat.updateConversationSummary(
          scopedDb,
          thread.id,
          buildRollingSummary(oldTurns)
        );
      }

      if (this.boss && result && !thread.incognito) {
        const messageId = result.assistantMessage.id;
        const embedPayload: EmbedTurnJobPayload = {
          actorUserId,
          threadId: thread.id,
          messageId
        };
        const extractPayload: ExtractFactsJobPayload = {
          actorUserId,
          threadId: thread.id,
          userMessageId: result.userMessage.id,
          assistantMessageId: result.assistantMessage.id
        };
        await sendJob(this.boss, CHAT_EMBED_TURN_QUEUE, embedPayload);
        await sendJob(this.boss, CHAT_EXTRACT_FACTS_QUEUE, extractPayload);
      }
      return result
        ? {
            userMessageId: result.userMessage.id,
            assistantMessageId: result.assistantMessage.id
          }
        : undefined;
    });
  }

  async openNewConversation(actorUserId: string, options?: { incognito?: boolean }): Promise<void> {
    await this.run(actorUserId, "open-new-conversation", (scopedDb) =>
      this.chat.openNewThread(scopedDb, {
        title: DEFAULT_CONVERSATION_TITLE,
        incognito: options?.incognito
      })
    );
  }

  async getThreadContext(
    actorUserId: string
  ): Promise<{ threadTitle: string | null; localTimezone: string | null }> {
    return this.run(actorUserId, "get-thread-context", async (scopedDb) => {
      const thread = await this.chat.getCurrentThread(scopedDb, actorUserId);
      const title = thread?.title ?? null;
      // V1: timezone from thread not yet stored; fall back to instance default via env.
      return {
        threadTitle: title && title !== DEFAULT_CONVERSATION_TITLE ? title : null,
        localTimezone: null
      };
    });
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

function getReplayK(): number {
  const val = process.env.JARVIS_CHAT_REPLAY_K;
  if (!val) return 0;
  const parsed = parseInt(val, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function deriveChatTitle(userText: string): string {
  const first = userText.split(/[.!?\n]/)[0] ?? userText;
  const cleaned = first.replace(/[^\S\r\n]+/g, " ").trim();
  const capped = cleaned.length > 60 ? `${cleaned.slice(0, 57).trimEnd()}…` : cleaned;
  const titled = capped.charAt(0).toUpperCase() + capped.slice(1);
  if (!titled || containsSensitiveMemoryText(titled)) return DEFAULT_CONVERSATION_TITLE;
  return titled;
}

function buildRollingSummary(
  oldTurns: readonly { role: "user" | "assistant"; content: string }[]
): string {
  const assistantContent = oldTurns
    .filter((m) => m.role === "assistant")
    .map((m) => m.content.trim())
    .filter(Boolean)
    .join(" ");
  const raw = `As of turn ${oldTurns.length}: ${assistantContent}`;
  // Cap to 2000 chars so the column stays bounded on very long conversations.
  return raw.length > 2000 ? `...${raw.slice(-2000)}` : raw;
}
