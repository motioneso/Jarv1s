import type { PgBoss, WorkOptions } from "pg-boss";

import type { DataContextRunner } from "@jarv1s/db";
import { registerDataContextWorker, type ActorScopedJobPayload, type QueueDefinition } from "@jarv1s/jobs";
import {
  AiRepository,
  createAiSecretCipher,
  createChatAdapter as defaultCreateChatAdapter,
  type AiProviderConfigSafeRow,
  type ChatActivityEvent,
  type ChatTurn,
  type CreateChatAdapterDeps
} from "@jarv1s/ai";
import type { ChatProviderAdapter } from "@jarv1s/ai";

import { CHAT_EXECUTION_QUEUE } from "./manifest.js";
import { ChatRepository } from "./repository.js";

export interface ChatExecutionPayload extends ActorScopedJobPayload {
  readonly threadId: string;
  readonly assistantMessageId: string;
}

export interface ChatWorkerResult {
  readonly status: "stored" | "error";
  readonly body: string;
  readonly activity: readonly ChatActivityEvent[];
}

export type CreateChatAdapterFn = (
  provider: AiProviderConfigSafeRow,
  deps: CreateChatAdapterDeps
) => ChatProviderAdapter;

export interface RegisterChatJobWorkersOptions {
  readonly repository?: ChatRepository;
  readonly workOptions?: WorkOptions;
  readonly createChatAdapter?: CreateChatAdapterFn;
}

export const CHAT_QUEUE_DEFINITIONS: readonly QueueDefinition[] = [
  {
    name: CHAT_EXECUTION_QUEUE,
    options: {
      retryLimit: 0,
      deleteAfterSeconds: 300,
      retentionSeconds: 300
    }
  }
];

const CHAT_EXECUTION_PAYLOAD_KEYS = ["actorUserId", "threadId", "assistantMessageId"] as const;

function isChatExecutionPayloadMetadataOnly(payload: Record<string, unknown>): boolean {
  const allowedKeys = new Set<string>(CHAT_EXECUTION_PAYLOAD_KEYS);

  return Object.keys(payload).every((key) => allowedKeys.has(key));
}

/**
 * Directly invokable worker handler — exported so integration tests can call it
 * without a live pg-boss instance, while the real worker uses registerChatJobWorkers.
 */
export async function invokeChatWorkerHandler(
  dataContext: DataContextRunner,
  payload: ChatExecutionPayload,
  options: Pick<RegisterChatJobWorkersOptions, "createChatAdapter" | "repository"> = {}
): Promise<ChatWorkerResult> {
  const repository = options.repository ?? new ChatRepository();
  const aiRepository = new AiRepository();
  const secretCipher = createAiSecretCipher();
  const adapterFactory = options.createChatAdapter ?? defaultCreateChatAdapter;

  // Phase 1: mark working — outer transaction
  await dataContext.withDataContext(
    { actorUserId: payload.actorUserId, requestId: `chat-worker:${payload.assistantMessageId}:working` },
    async (scopedDb) => {
      await repository.updateMessageStatus(scopedDb, payload.assistantMessageId, "working");
    }
  );

  // Phase 2: load context + call adapter — inner transaction
  const activity: ChatActivityEvent[] = [];

  try {
    const result = await dataContext.withDataContext(
      { actorUserId: payload.actorUserId, requestId: `chat-worker:${payload.assistantMessageId}:exec` },
      async (scopedDb) => {
        // Load thread history (user messages + prior stored assistant messages)
        const messages = await repository.listMessages(scopedDb, payload.threadId);

        if (messages.length === 0) {
          throw new Error(`Chat thread ${payload.threadId} not found or has no messages`);
        }

        // Resolve the active model for the "chat" capability
        const model = await aiRepository.selectModelForCapability(scopedDb, "chat");

        if (!model) {
          throw new Error("No active chat-capable model is configured");
        }

        // Fetch provider config with raw encrypted credential for in-process decryption
        const provider = await aiRepository.selectProviderWithCredential(
          scopedDb,
          model.provider_config_id
        );

        if (!provider) {
          throw new Error(`Provider ${model.provider_config_id} not found`);
        }

        // Decrypt the credential in-process; the decrypted key never leaves this scope
        let decryptedKey: string | undefined;

        if (provider.auth_method === "api_key" && provider.encrypted_credential) {
          const decrypted = secretCipher.decryptJson(provider.encrypted_credential);

          decryptedKey =
            typeof decrypted.apiKey === "string" ? decrypted.apiKey : undefined;
        }

        // Build the conversation turns (all stored messages except the pending assistant one)
        const turns: ChatTurn[] = messages
          .filter((m) => m.id !== payload.assistantMessageId && m.status === "stored")
          .map((m) => ({ role: m.role as "user" | "assistant", content: m.body }));

        // Construct the adapter and call generateChat
        const adapter = adapterFactory(provider, {
          threadKey: payload.threadId,
          decryptedKey
        });

        const chatResult = await adapter.generateChat({
          model: {
            provider_kind: model.provider_kind,
            provider_model_id: model.provider_model_id
          },
          messages: turns,
          onActivity: (event) => {
            activity.push(event);
          }
        });

        return chatResult.text;
      }
    );

    // Phase 3: persist activity + final reply
    await dataContext.withDataContext(
      { actorUserId: payload.actorUserId, requestId: `chat-worker:${payload.assistantMessageId}:store` },
      async (scopedDb) => {
        for (const event of activity) {
          await repository.appendActivity(scopedDb, payload.assistantMessageId, event);
        }

        await repository.updateMessageComplete(scopedDb, payload.assistantMessageId, result);
      }
    );

    // Read back the final state to return from the handler
    const finalMessage = await dataContext.withDataContext(
      { actorUserId: payload.actorUserId, requestId: `chat-worker:${payload.assistantMessageId}:read` },
      async (scopedDb) => repository.listMessages(scopedDb, payload.threadId)
    );

    const msg = finalMessage.find((m) => m.id === payload.assistantMessageId);

    return {
      status: "stored",
      body: msg?.body ?? result,
      activity
    };
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);

    // Persist error state — never let this crash the process
    try {
      await dataContext.withDataContext(
        { actorUserId: payload.actorUserId, requestId: `chat-worker:${payload.assistantMessageId}:error` },
        async (scopedDb) => {
          await repository.updateMessageStatus(
            scopedDb,
            payload.assistantMessageId,
            "error",
            `Chat execution failed: ${errorMessage}`
          );
        }
      );
    } catch {
      // Swallow error-state persistence failure to avoid crashing the worker
    }

    return {
      status: "error",
      body: `Chat execution failed: ${errorMessage}`,
      activity
    };
  }
}

export async function registerChatJobWorkers(
  boss: PgBoss,
  dataContext: DataContextRunner,
  options: RegisterChatJobWorkersOptions = {}
): Promise<string[]> {
  // Guard: boss may be null/undefined in test environments — skip registration gracefully
  if (!boss) {
    return [];
  }

  const workId = await registerDataContextWorker<ChatExecutionPayload, ChatWorkerResult>(
    boss,
    CHAT_EXECUTION_QUEUE,
    dataContext,
    async (job, _scopedDb) => {
      if (!isChatExecutionPayloadMetadataOnly(job.data as unknown as Record<string, unknown>)) {
        throw new Error(`Chat job ${job.id} contains non-metadata payload fields`);
      }

      return invokeChatWorkerHandler(dataContext, job.data, options);
    },
    options.workOptions
  );

  return [workId];
}
