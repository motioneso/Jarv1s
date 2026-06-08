import { randomUUID } from "node:crypto";

import { sql } from "kysely";

import { AiRepository, type AiConfiguredModelSafeRow } from "@jarv1s/ai";
import {
  assertDataContextDb,
  type ChatMessage,
  type ChatMessageStatus,
  type ChatThread,
  type DataContextDb
} from "@jarv1s/db";
import type {
  ChatModelRouteMetadataDto,
  ChatSelectedToolMetadataDto,
  AiConfiguredModelDto
} from "@jarv1s/shared";

import { CHAT_EXECUTION_QUEUE } from "./manifest.js";

export interface ChatExecutionJobPayload {
  readonly actorUserId: string;
  readonly threadId: string;
  readonly assistantMessageId: string;
}

export interface ChatEnqueueFn {
  (queueName: string, payload: ChatExecutionJobPayload): Promise<string | null>;
}

export interface CreateChatThreadInput {
  readonly title: string;
}

export interface AppendChatUserMessageInput {
  readonly body: string;
  readonly selectedTools?: readonly ChatSelectedToolMetadataDto[];
}

export interface AppendChatUserMessageResult {
  readonly thread: ChatThread;
  readonly messages: readonly [ChatMessage, ChatMessage];
}

export interface ChatCapabilityRouter {
  selectModelForCapability(
    scopedDb: DataContextDb,
    capability: "chat"
  ): Promise<AiConfiguredModelSafeRow | undefined>;
}

export class ChatRepository {
  constructor(
    private readonly capabilityRouter: ChatCapabilityRouter = new AiRepository(),
    private readonly enqueue: ChatEnqueueFn | null = null
  ) {}

  async listThreads(scopedDb: DataContextDb): Promise<ChatThread[]> {
    assertDataContextDb(scopedDb);

    return scopedDb.db
      .selectFrom("app.chat_threads")
      .selectAll()
      .orderBy("updated_at", "desc")
      .orderBy("id")
      .execute();
  }

  async createThread(scopedDb: DataContextDb, input: CreateChatThreadInput): Promise<ChatThread> {
    assertDataContextDb(scopedDb);

    const now = new Date();

    return scopedDb.db
      .insertInto("app.chat_threads")
      .values({
        id: randomUUID(),
        owner_user_id: sql<string>`app.current_actor_user_id()`,
        title: input.title,
        created_at: now,
        updated_at: now
      })
      .returningAll()
      .executeTakeFirstOrThrow();
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
      .orderBy("id")
      .execute();
  }

  async appendUserMessage(
    scopedDb: DataContextDb,
    threadId: string,
    input: AppendChatUserMessageInput,
    actorUserId?: string
  ): Promise<AppendChatUserMessageResult | undefined> {
    assertDataContextDb(scopedDb);

    const thread = await this.getThreadById(scopedDb, threadId);

    if (!thread) {
      return undefined;
    }

    const selectedTools = input.selectedTools ?? [];
    const route = await this.resolveChatRoute(scopedDb);
    const assistantStatus = selectAssistantStatus(route, selectedTools);
    const now = new Date();
    const userMessage = await this.insertMessage(scopedDb, {
      thread,
      role: "user",
      status: "stored",
      body: input.body,
      modelMetadata: {},
      toolMetadata: { selectedTools },
      now
    });
    const assistantMessage = await this.insertMessage(scopedDb, {
      thread,
      role: "assistant",
      status: assistantStatus,
      body: assistantBodyForStatus(assistantStatus),
      modelMetadata: { route },
      toolMetadata: { selectedTools },
      now
    });
    const updatedThread = await scopedDb.db
      .updateTable("app.chat_threads")
      .set({ updated_at: now })
      .where("id", "=", thread.id)
      .returningAll()
      .executeTakeFirstOrThrow();

    if (assistantStatus === "pending" && this.enqueue && actorUserId) {
      const payload: ChatExecutionJobPayload = {
        actorUserId,
        threadId: thread.id,
        assistantMessageId: assistantMessage.id
      };

      await this.enqueue(CHAT_EXECUTION_QUEUE, payload);
    }

    return {
      thread: updatedThread,
      messages: [userMessage, assistantMessage]
    };
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
   * Transitions the assistant message to the given status and updates body/updated_at.
   * Used by the pg-boss worker to move through: pending → working → stored | error.
   */
  async updateMessageStatus(
    scopedDb: DataContextDb,
    messageId: string,
    status: ChatMessageStatus,
    body?: string
  ): Promise<ChatMessage | undefined> {
    assertDataContextDb(scopedDb);

    const updates: Record<string, unknown> = { status, updated_at: new Date() };

    if (body !== undefined) {
      updates.body = body;
    }

    return scopedDb.db
      .updateTable("app.chat_messages")
      .set(updates)
      .where("id", "=", messageId)
      .returningAll()
      .executeTakeFirst();
  }

  /**
   * Appends an activity event to model_metadata.activity array in Postgres.
   * Uses a JSON concatenation so concurrent appends don't stomp each other.
   */
  async appendActivity(
    scopedDb: DataContextDb,
    messageId: string,
    event: { readonly kind: string; readonly text: string }
  ): Promise<void> {
    assertDataContextDb(scopedDb);

    await scopedDb.db
      .updateTable("app.chat_messages")
      .set({
        model_metadata: sql<Record<string, unknown>>`
          jsonb_set(
            coalesce(model_metadata, '{}'::jsonb),
            '{activity}',
            coalesce(model_metadata->'activity', '[]'::jsonb) || ${JSON.stringify([event])}::jsonb
          )
        `,
        updated_at: new Date()
      })
      .where("id", "=", messageId)
      .execute();
  }

  /**
   * Writes the final reply text and sets status to "stored".
   * Preserves the existing model_metadata (route + activity) by merging body only.
   */
  async updateMessageComplete(
    scopedDb: DataContextDb,
    messageId: string,
    body: string
  ): Promise<ChatMessage | undefined> {
    assertDataContextDb(scopedDb);

    return scopedDb.db
      .updateTable("app.chat_messages")
      .set({ status: "stored", body, updated_at: new Date() })
      .where("id", "=", messageId)
      .returningAll()
      .executeTakeFirst();
  }

  private async resolveChatRoute(scopedDb: DataContextDb): Promise<ChatModelRouteMetadataDto> {
    const model = await this.capabilityRouter.selectModelForCapability(scopedDb, "chat");

    return {
      capability: "chat",
      available: Boolean(model),
      reason: model ? "matched-active-model" : "no-active-model",
      model: model ? serializeModel(model) : null
    };
  }
}

function selectAssistantStatus(
  route: ChatModelRouteMetadataDto,
  selectedTools: readonly ChatSelectedToolMetadataDto[]
): ChatMessageStatus {
  if (selectedTools.some((tool) => tool.risk !== "read")) {
    return "blocked";
  }

  return route.available ? "pending" : "no_model";
}

function assistantBodyForStatus(status: ChatMessageStatus): string {
  if (status === "blocked") {
    return "Tool request recorded but blocked pending confirmation and audit in a later slice.";
  }
  if (status === "no_model") {
    return "No active chat-capable model is configured.";
  }

  return "Chat model route is configured. Provider execution is disabled in this slice.";
}

function serializeModel(model: AiConfiguredModelSafeRow): AiConfiguredModelDto {
  return {
    id: model.id,
    providerConfigId: model.provider_config_id,
    providerKind: model.provider_kind,
    providerDisplayName: model.provider_display_name,
    providerStatus: model.provider_status,
    providerModelId: model.provider_model_id,
    displayName: model.display_name,
    capabilities: model.capabilities as AiConfiguredModelDto["capabilities"],
    status: model.status,
    createdAt: serializeDate(model.created_at),
    updatedAt: serializeDate(model.updated_at)
  };
}

function serializeDate(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}
