import { createHash } from "node:crypto";

import type { FastifyBaseLogger } from "fastify";
import type { PgBoss, WorkOptions } from "pg-boss";

import {
  AiRepository,
  createAiSecretCipher,
  HttpApiAdapter,
  parseAiApiKeyCredential
} from "@jarv1s/ai";
import type { AiSecretCipher, GenerateChatInput, ProviderKind } from "@jarv1s/ai";
import type { DataContextDb, DataContextRunner } from "@jarv1s/db";
import {
  ChatMemoryFactsRepository,
  ChatMemorySuppressionsRepository,
  MemoryRepository,
  createMemoryFactSignature,
  type EmbeddingProvider,
  type FactCategory,
  type FactProvenance,
  type NewChunkData
} from "@jarv1s/memory";
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

const FACT_CATEGORIES: ReadonlySet<FactCategory> = new Set([
  "preference",
  "fact",
  "profile",
  "goal"
]);
const EXTRACT_FACT_PROVENANCE: ReadonlySet<FactProvenance> = new Set(["volunteered", "inferred"]);
const MAX_FACTS_PER_TURN = 8;
// Economy output budget for the extraction call — bounds cost on a side-effect job
// that must never dominate a chat turn's spend (clamped by the adapter, see A5b).
const EXTRACT_MAX_OUTPUT_TOKENS = 512;

export interface ExtractFactsDeps {
  readonly aiRepository: AiRepository;
  readonly cipher: AiSecretCipher;
  readonly factsRepository: ChatMemoryFactsRepository;
  readonly suppressionsRepository?: ChatMemorySuppressionsRepository;
  /**
   * Structured logger for extraction-failure observability
   * (chat_extract_facts_failed). Optional; production injects a module logger
   * (observability spec: no console.* in prod).
   */
  readonly logger?: Pick<FastifyBaseLogger, "error">;
  // Use the real GenerateChatInput so `maxOutputTokens` typechecks (no excess-property error).
  readonly createAdapter?: (
    kind: ProviderKind,
    apiKey: string,
    baseUrl: string | null
  ) => { generateChat: (input: GenerateChatInput) => Promise<{ readonly text: string }> };
}

/**
 * LLM-driven durable-fact extraction from the most recent turn-pair. Synthesizes
 * structured facts via the provider-agnostic capability router (summarization /
 * economy tier), decrypts the credential in-process (never logged/forwarded), and
 * upserts into chat_memory_facts. Idempotent (dedupes by normalized content within
 * a category, F10) and grounded (supersedes ONLY a real, actor-owned active id, F11).
 * No-op degrade: any failure (no model, no credential, throw, non-JSON) writes nothing
 * and never throws — a flaky extraction must not block the chat turn.
 */
export async function handleExtractFactsJob(
  scopedDb: DataContextDb,
  ownerUserId: string,
  threadId: string,
  deps: ExtractFactsDeps,
  chatRepository: ChatRepository = new ChatRepository()
): Promise<void> {
  try {
    const suppressionsRepository =
      deps.suppressionsRepository ?? new ChatMemorySuppressionsRepository();
    const messages = await chatRepository.listMessages(scopedDb, threadId);
    const stored = messages.filter((m) => m.status === "stored");
    const lastTwo = stored.slice(-2);
    const userMsg = lastTwo.find((m) => m.role === "user");
    const assistantMsg = lastTwo.find((m) => m.role === "assistant");
    if (!userMsg || !assistantMsg) return;

    const model = await deps.aiRepository.selectModelForCapability(
      scopedDb,
      "summarization",
      "economy"
    );
    if (!model) return;

    const provider = await deps.aiRepository.selectProviderWithCredential(
      scopedDb,
      model.provider_config_id
    );
    if (!provider?.encrypted_credential) return;
    const credential = parseAiApiKeyCredential(
      deps.cipher.decryptJson(provider.encrypted_credential)
    );
    if (!credential) return;

    // Ground supersession + dedupe against the actor's CURRENT active facts (F10/F11).
    const activeFacts = await deps.factsRepository.listActiveFacts(scopedDb, ownerUserId);
    const activeIds = new Set(activeFacts.map((f) => f.id));
    const normalize = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
    const existingByContent = new Set(
      activeFacts.map((f) => `${f.category}::${normalize(f.content)}`)
    );
    // Expose ONLY the actor's real active-fact ids (bounded) so the model can supersede
    // a grounded fact instead of inventing an arbitrary id.
    const supersedableList = activeFacts
      .slice(0, 30)
      .map((f) => `${f.id} :: ${f.content.slice(0, 120)}`)
      .join("\n");

    const prompt =
      "Extract durable facts about the user from this conversation turn. Return ONLY a JSON array; " +
      'each item: {"category": "preference|fact|profile|goal", "content": string, ' +
      '"importance": number 0..1, "provenance": "volunteered|inferred", "supersedes": optional id, ' +
      '"correction": optional {"supersedes": id, "before": string, "after": string}}. ' +
      'Use "volunteered" only when the user directly stated the fact; otherwise use "inferred". ' +
      "Use correction ONLY when the user explicitly corrects an existing listed belief and the replacement content should become the new durable fact. " +
      "The OPTIONAL supersedes id MUST be one " +
      "of the EXISTING FACT IDS listed below (omit it otherwise — never invent an id). No prose, no code fences.\n\n" +
      `EXISTING FACT IDS (id :: content):\n${supersedableList || "(none)"}\n\n` +
      `User: ${userMsg.body}\nAssistant: ${assistantMsg.body}`;

    const adapter = (
      deps.createAdapter ??
      ((k, key, base) => new HttpApiAdapter(k, key, base ? { baseUrl: base } : {}))
    )(model.provider_kind as ProviderKind, credential.apiKey, provider.base_url);
    const { text } = await adapter.generateChat({
      model: { provider_kind: model.provider_kind, provider_model_id: model.provider_model_id },
      messages: [{ role: "user", content: prompt }],
      maxOutputTokens: EXTRACT_MAX_OUTPUT_TOKENS
    });

    const parsed = parseFacts(text);
    for (const fact of parsed.slice(0, MAX_FACTS_PER_TURN)) {
      const signature = createMemoryFactSignature(fact.category, fact.content);
      if (
        fact.provenance === "inferred" &&
        (await suppressionsRepository.isSuppressed(scopedDb, ownerUserId, signature))
      ) {
        continue;
      }

      // Dedupe: skip a fact whose (category, normalized content) already exists active (F10).
      const contentKey = `${fact.category}::${normalize(fact.content)}`;
      if (existingByContent.has(contentKey)) {
        continue;
      }
      const supersedesId = fact.correction?.supersedes ?? fact.supersedes;
      const oldFact =
        typeof supersedesId === "string" && activeIds.has(supersedesId)
          ? activeFacts.find((candidate) => candidate.id === supersedesId)
          : undefined;

      // Supersede ONLY a grounded, actor-owned active id (ignore hallucinated ids — F11).
      if (oldFact) {
        await deps.factsRepository.supersedeFact(scopedDb, oldFact.id);
      }
      const inserted = await deps.factsRepository.insertFact(scopedDb, ownerUserId, {
        category: fact.category,
        content: fact.content,
        sourceThreadId: threadId,
        importance: fact.importance,
        provenance: fact.provenance
      });
      if (oldFact && fact.correction) {
        await suppressionsRepository.insertCorrection(scopedDb, ownerUserId, {
          signature: createMemoryFactSignature(oldFact.category, oldFact.content),
          category: oldFact.category,
          content: oldFact.content,
          factId: oldFact.id,
          beforeContent: fact.correction.before,
          afterContent: fact.correction.after || inserted.content
        });
      }
      existingByContent.add(contentKey); // also dedupe within this same batch
    }
  } catch (error) {
    const e = error instanceof Error ? error : new Error(String(error));
    deps.logger?.error(
      {
        event: "chat_extract_facts_failed",
        threadId,
        error: e.name,
        message: e.message.slice(0, 200)
      },
      "chat fact extraction failed"
    );
    // No-op degrade: never throw — a flaky extraction must not block the chat turn.
  }
}

interface ParsedFact {
  readonly category: FactCategory;
  readonly content: string;
  readonly importance: number;
  readonly provenance: FactProvenance;
  readonly supersedes?: string;
  readonly correction?: ParsedCorrection;
}

interface ParsedCorrection {
  readonly supersedes: string;
  readonly before: string;
  readonly after: string;
}

function parseFacts(text: string): ParsedFact[] {
  let json: unknown;
  try {
    json = JSON.parse(text.trim());
  } catch {
    return [];
  }
  if (!Array.isArray(json)) return [];
  const out: ParsedFact[] = [];
  for (const raw of json) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const category = r.category;
    const content = r.content;
    if (typeof category !== "string" || !FACT_CATEGORIES.has(category as FactCategory)) continue;
    if (typeof content !== "string" || content.trim().length === 0) continue;
    let importance = typeof r.importance === "number" ? r.importance : 0.5;
    importance = Math.min(1, Math.max(0, importance));
    const provenance = EXTRACT_FACT_PROVENANCE.has(r.provenance as FactProvenance)
      ? (r.provenance as FactProvenance)
      : "inferred";
    const correction = parseCorrection(r.correction);
    out.push({
      category: category as FactCategory,
      content: content.trim(),
      importance,
      provenance,
      supersedes: typeof r.supersedes === "string" ? r.supersedes : undefined,
      correction
    });
  }
  return out;
}

function parseCorrection(value: unknown): ParsedCorrection | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const correction = value as Record<string, unknown>;
  if (typeof correction.supersedes !== "string" || correction.supersedes.trim().length === 0) {
    return undefined;
  }
  if (typeof correction.before !== "string" || correction.before.trim().length === 0) {
    return undefined;
  }
  if (typeof correction.after !== "string" || correction.after.trim().length === 0) {
    return undefined;
  }
  return {
    supersedes: correction.supersedes,
    before: correction.before.trim(),
    after: correction.after.trim()
  };
}

// ── Worker registration ───────────────────────────────────────────────────────

export interface RegisterChatJobWorkersOptions {
  readonly embeddingProviderFactory: (scopedDb: DataContextDb) => Promise<EmbeddingProvider>;
  /**
   * AI deps for the extract-facts worker. Optional here so the module registry can
   * land its injection in a follow-up (A13) without breaking this signature; when
   * absent we build the real deps in-process (capability router + cipher + facts repo),
   * mirroring the briefings worker's `composeDeps` default.
   */
  readonly extractFactsDeps?: ExtractFactsDeps;
  readonly workOptions?: WorkOptions;
  /**
   * Structured logger for worker-path diagnostics (chat_extract_facts_failed).
   * Optional for back-compat; production injects a module-tagged child of the
   * worker logger (observability spec: no console.* in prod).
   */
  readonly logger?: FastifyBaseLogger;
}

function defaultExtractFactsDeps(): ExtractFactsDeps {
  return {
    aiRepository: new AiRepository(),
    cipher: createAiSecretCipher(),
    factsRepository: new ChatMemoryFactsRepository()
  };
}

export async function registerChatJobWorkers(
  boss: PgBoss,
  dataContext: DataContextRunner,
  options: RegisterChatJobWorkersOptions
): Promise<string[]> {
  const memoryRepo = new MemoryRepository();
  const chatRepo = new ChatRepository();
  const extractFactsDeps = options.extractFactsDeps ?? defaultExtractFactsDeps();
  // Thread the worker logger into the extract-facts deps if the caller did not
  // supply its own extractFactsDeps with a logger (observability spec).
  if (!options.extractFactsDeps && options.logger) {
    (extractFactsDeps as { logger?: Pick<FastifyBaseLogger, "error"> }).logger = options.logger;
  }

  const embedWorkId = await registerDataContextWorker<EmbedTurnJobPayload, void>(
    boss,
    CHAT_EMBED_TURN_QUEUE,
    dataContext,
    async (job, scopedDb) => {
      const embeddingProvider = await options.embeddingProviderFactory(scopedDb);
      await handleEmbedTurnJob(
        scopedDb,
        job.data.actorUserId,
        job.data.threadId,
        embeddingProvider,
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
      await handleExtractFactsJob(
        scopedDb,
        job.data.actorUserId,
        job.data.threadId,
        extractFactsDeps,
        chatRepo
      );
    },
    options.workOptions
  );

  return [embedWorkId, extractWorkId];
}
