import { createHash } from "node:crypto";
import type { PgBoss, WorkOptions } from "pg-boss";

import type { DataContextDb, DataContextRunner } from "@jarv1s/db";
import { MemoryRepository, type EmbeddingProvider, type NewChunkData } from "@jarv1s/memory";
import {
  registerDataContextWorker,
  type ActorScopedJobPayload,
  type QueueDefinition
} from "@jarv1s/jobs";

import { ChatRepository } from "./repository.js";

// ── Queue names ───────────────────────────────────────────────────────────────

export const CHAT_EMBED_TURN_QUEUE = "chat.embed-turn";
export const CHAT_EXTRACT_FACTS_QUEUE = "chat.extract-facts";

export const CHAT_QUEUE_DEFINITIONS: readonly QueueDefinition[] = [
  { name: CHAT_EMBED_TURN_QUEUE, options: { retryLimit: 2, deleteAfterSeconds: 600 } },
  { name: CHAT_EXTRACT_FACTS_QUEUE, options: { retryLimit: 2, deleteAfterSeconds: 600 } }
];

// ── Payloads ──────────────────────────────────────────────────────────────────

export interface EmbedTurnJobPayload extends ActorScopedJobPayload {
  readonly threadId: string;
  readonly messageId: string;
}

export interface ExtractFactsJobPayload extends ActorScopedJobPayload {
  readonly threadId: string;
}

// ── Embed-turn handler ────────────────────────────────────────────────────────

/**
 * Embed the most recent user+assistant turn-pair for a thread into memory_chunks
 * with source_kind='chat'. Idempotent via content hash.
 */
export async function handleEmbedTurnJob(
  scopedDb: DataContextDb,
  ownerUserId: string,
  threadId: string,
  embeddingProvider: EmbeddingProvider,
  memoryRepository: MemoryRepository,
  chatRepository: ChatRepository = new ChatRepository()
): Promise<void> {
  const messages = await chatRepository.listMessages(scopedDb, threadId);
  const stored = messages.filter((m) => m.status === "stored");
  const lastTwo = stored.slice(-2);
  if (lastTwo.length < 2) return;

  const userMsg = lastTwo.find((m) => m.role === "user");
  const assistantMsg = lastTwo.find((m) => m.role === "assistant");
  if (!userMsg || !assistantMsg) return;

  const text = `User: ${userMsg.body}\nAssistant: ${assistantMsg.body}`;
  const contentHash = createHash("sha256").update(text).digest("hex");

  const existing = await memoryRepository.getFileIndex(scopedDb, ownerUserId, "chat", threadId);
  if (existing?.fileHash === contentHash) return;

  const embedding = await embeddingProvider.embedDocument(text);
  const chunk: NewChunkData = {
    sourcePath: threadId,
    lineStart: 0,
    lineEnd: 0,
    contentHash,
    text,
    embedding
  };

  await memoryRepository.upsertFileChunks(
    scopedDb,
    ownerUserId,
    threadId,
    [chunk],
    embeddingProvider.modelName,
    embeddingProvider.modelVersion,
    "chat"
  );

  await memoryRepository.upsertFileIndex(
    scopedDb,
    ownerUserId,
    "chat",
    threadId,
    contentHash,
    1,
    embeddingProvider.modelName,
    embeddingProvider.modelVersion
  );
}

// ── Extract-facts handler ─────────────────────────────────────────────────────

/**
 * LLM-driven fact extraction from recent turns. Stubbed until @jarv1s/ai
 * exposes a clean capability-router call for non-chat completions.
 * The queue is wired and the worker slot is registered — this handler runs
 * but performs no-op extraction until the AI utilities are plumbed through.
 */
export async function handleExtractFactsJob(
  _scopedDb: DataContextDb,
  _ownerUserId: string,
  _threadId: string
): Promise<void> {
  // TODO(phase3-facts): call capability router to extract structured facts
  // from the most recent turn and upsert them into chat_memory_facts.
}

// ── Worker registration ───────────────────────────────────────────────────────

export interface RegisterChatJobWorkersOptions {
  readonly embeddingProvider: EmbeddingProvider;
  readonly workOptions?: WorkOptions;
}

export async function registerChatJobWorkers(
  boss: PgBoss,
  dataContext: DataContextRunner,
  options: RegisterChatJobWorkersOptions
): Promise<string[]> {
  const memoryRepo = new MemoryRepository();
  const chatRepo = new ChatRepository();

  const embedWorkId = await registerDataContextWorker<EmbedTurnJobPayload, void>(
    boss,
    CHAT_EMBED_TURN_QUEUE,
    dataContext,
    async (job, scopedDb) => {
      await handleEmbedTurnJob(
        scopedDb,
        job.data.actorUserId,
        job.data.threadId,
        options.embeddingProvider,
        memoryRepo,
        chatRepo
      );
    },
    options.workOptions
  );

  const extractWorkId = await registerDataContextWorker<ExtractFactsJobPayload, void>(
    boss,
    CHAT_EXTRACT_FACTS_QUEUE,
    dataContext,
    async (job, scopedDb) => {
      await handleExtractFactsJob(scopedDb, job.data.actorUserId, job.data.threadId);
    },
    options.workOptions
  );

  return [embedWorkId, extractWorkId];
}
