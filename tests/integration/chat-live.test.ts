import { beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import type { Kysely } from "kysely";

import {
  DataContextRunner,
  createDatabase,
  type AccessContext,
  type JarvisDatabase
} from "@jarv1s/db";
import {
  ChatRepository,
  ChatUserMemorySettingsRepository,
  PassiveContextRetriever,
  chatModuleManifest,
  handleExtractFactsJob
} from "@jarv1s/chat";
import { AiRepository, createAiSecretCipher, type GenerateChatInput } from "@jarv1s/ai";
import {
  ChatMemoryFactsRepository,
  ChatMemorySuppressionsRepository,
  GraphMemoryRecallService,
  StubEmbeddingProvider,
  createMemoryFactSignature
} from "@jarv1s/memory";
import { connectionStrings, ids, resetFoundationDatabase } from "./test-database.js";
const { Client } = pg;

describe("chat live runtime migration (0038)", () => {
  beforeAll(async () => {
    await resetFoundationDatabase();
  });
  it("0038: chat_threads has last_active_at", async () => {
    const client = new Client({ connectionString: connectionStrings.migration });
    await client.connect();
    try {
      const col = await client.query(
        `SELECT 1 FROM information_schema.columns
         WHERE table_schema='app' AND table_name='chat_threads' AND column_name='last_active_at'`
      );
      expect(col.rowCount).toBe(1);
    } finally {
      await client.end();
    }
  });
});

describe("chat live runtime repository (recency + executed-model stamp)", () => {
  let appDb: Kysely<JarvisDatabase>;
  let dataContext: DataContextRunner;
  let repository: ChatRepository;

  beforeAll(async () => {
    appDb = createDatabase({
      connectionString: connectionStrings.app,
      maxConnections: 1
    });
    dataContext = new DataContextRunner(appDb);
    repository = new ChatRepository();
  });

  it("openNewThread creates a thread that getCurrentThread returns", async () => {
    const created = await dataContext.withDataContext(userAContext(), (scopedDb) =>
      repository.openNewThread(scopedDb, { title: "First live thread" })
    );
    const current = await dataContext.withDataContext(userAContext(), (scopedDb) =>
      repository.getCurrentThread(scopedDb, ids.userA)
    );

    expect(created.owner_user_id).toBe(ids.userA);
    expect(created.last_active_at).toBeTruthy();
    expect(current?.id).toBe(created.id);
  });

  it("a newer thread becomes the current one", async () => {
    const first = await dataContext.withDataContext(userAContext(), (scopedDb) =>
      repository.openNewThread(scopedDb, { title: "Recency thread one" })
    );
    // Ensure a strictly later last_active_at for the second thread.
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = await dataContext.withDataContext(userAContext(), (scopedDb) =>
      repository.openNewThread(scopedDb, { title: "Recency thread two" })
    );

    const current = await dataContext.withDataContext(userAContext(), (scopedDb) =>
      repository.getCurrentThread(scopedDb, ids.userA)
    );

    expect(first.id).not.toBe(second.id);
    expect(current?.id).toBe(second.id);
  });

  it("touchThread on an older thread makes it current again", async () => {
    const older = await dataContext.withDataContext(userAContext(), (scopedDb) =>
      repository.openNewThread(scopedDb, { title: "Touch older" })
    );
    await new Promise((resolve) => setTimeout(resolve, 5));
    const newer = await dataContext.withDataContext(userAContext(), (scopedDb) =>
      repository.openNewThread(scopedDb, { title: "Touch newer" })
    );

    const beforeTouch = await dataContext.withDataContext(userAContext(), (scopedDb) =>
      repository.getCurrentThread(scopedDb, ids.userA)
    );
    expect(beforeTouch?.id).toBe(newer.id);

    await new Promise((resolve) => setTimeout(resolve, 5));
    const touched = await dataContext.withDataContext(userAContext(), (scopedDb) =>
      repository.touchThread(scopedDb, older.id)
    );

    const afterTouch = await dataContext.withDataContext(userAContext(), (scopedDb) =>
      repository.getCurrentThread(scopedDb, ids.userA)
    );

    expect(touched?.id).toBe(older.id);
    expect(afterTouch?.id).toBe(older.id);
  });

  it("getCurrentThread returns undefined for an owner with no threads", async () => {
    const current = await dataContext.withDataContext(userBContext(), (scopedDb) =>
      repository.getCurrentThread(scopedDb, ids.userB)
    );
    expect(current).toBeUndefined();
  });
});

describe("passive context retrieval integration", () => {
  let appDb: Kysely<JarvisDatabase>;
  let dataContext: DataContextRunner;
  let graphRecall: GraphMemoryRecallService;

  beforeAll(async () => {
    await resetFoundationDatabase();
    appDb = createDatabase({
      connectionString: connectionStrings.app,
      maxConnections: 1
    });
    dataContext = new DataContextRunner(appDb);
    graphRecall = new GraphMemoryRecallService(new StubEmbeddingProvider());
  });

  it("renders graph memory for a context-dependent turn and hides private ids", async () => {
    const write = await dataContext.withDataContext(userAContext(), (scopedDb) =>
      graphRecall.remember(scopedDb, ids.userA, {
        predicate: "decided",
        objectText: "House project uses option A for cabinets",
        confidence: 0.94,
        provenance: "confirmed",
        importance: 0.9,
        source: {
          sourceKind: "chat",
          sourceRef: "chat:passive-private",
          sourceLabel: "Chat 2026-06-27",
          excerpt: "House project uses option A"
        }
      })
    );
    const retriever = new PassiveContextRetriever({ dataContext, graphRecall });

    const block = await retriever.retrieve({
      actorUserId: ids.userA,
      userText: "remember House project uses option A for cabinets",
      threadTitle: null,
      recentTurns: []
    });

    expect(block).toContain("<retrieved_context>");
    expect(block).toContain("House project uses option A");
    expect(block).not.toContain(write.fact.id);
    expect(block).not.toContain("chat:passive-private");
  });

  it("respects existing recall and facts settings", async () => {
    const settings = new ChatUserMemorySettingsRepository();
    await dataContext.withDataContext(userAContext(), (scopedDb) =>
      settings.update(scopedDb, ids.userA, { recallEnabled: false })
    );
    const retriever = new PassiveContextRetriever({ dataContext, graphRecall });

    const disabled = await retriever.retrieve({
      actorUserId: ids.userA,
      userText: "remember House project uses option A for cabinets",
      threadTitle: null,
      recentTurns: []
    });
    expect(disabled).toBe("");

    await dataContext.withDataContext(userAContext(), (scopedDb) =>
      settings.update(scopedDb, ids.userA, { recallEnabled: true, factsEnabled: false })
    );
    const factsDisabled = await retriever.retrieve({
      actorUserId: ids.userA,
      userText: "remember House project uses option A for cabinets",
      threadTitle: null,
      recentTurns: []
    });
    expect(factsDisabled).toBe("");
  });
});

describe("chat.listTodaysTurns read tool + listThreadsByActivity", () => {
  let appDb: Kysely<JarvisDatabase>;
  let dataContext: DataContextRunner;
  let repository: ChatRepository;

  beforeAll(async () => {
    appDb = createDatabase({
      connectionString: connectionStrings.app,
      maxConnections: 1
    });
    dataContext = new DataContextRunner(appDb);
    repository = new ChatRepository();
  });

  it("listThreadsByActivity orders by last_active_at (active-today thread ahead of idle threads)", async () => {
    // An idle thread created/touched now, then an older thread re-activated AFTER it
    // via touchThread — the re-activated (older-created) thread must sort first.
    const idle = await dataContext.withDataContext(userAContext(), (scopedDb) =>
      repository.openNewThread(scopedDb, { title: "Idle-by-activity" })
    );
    await new Promise((resolve) => setTimeout(resolve, 5));
    const activeToday = await dataContext.withDataContext(userAContext(), (scopedDb) =>
      repository.openNewThread(scopedDb, { title: "Active-today-by-activity" })
    );
    // Touch the idle one LAST so it has the most-recent last_active_at.
    await new Promise((resolve) => setTimeout(resolve, 5));
    await dataContext.withDataContext(userAContext(), (scopedDb) =>
      repository.touchThread(scopedDb, idle.id)
    );

    const threads = await dataContext.withDataContext(userAContext(), (scopedDb) =>
      repository.listThreadsByActivity(scopedDb, 20)
    );
    const idleIndex = threads.findIndex((t) => t.id === idle.id);
    const activeIndex = threads.findIndex((t) => t.id === activeToday.id);
    expect(idleIndex).toBeGreaterThanOrEqual(0);
    expect(activeIndex).toBeGreaterThanOrEqual(0);
    // idle was touched most recently, so it sorts before the earlier-touched thread.
    expect(idleIndex).toBeLessThan(activeIndex);
  });

  it("exposes chat.listTodaysTurns as a read tool excluding incognito threads", async () => {
    const tool = (chatModuleManifest.assistantTools ?? []).find(
      (t) => t.name === "chat.listTodaysTurns"
    );
    expect(tool?.risk).toBe("read");
    expect(tool?.permissionId).toBe("chat.view");

    await dataContext.withDataContext(userAContext(), async (scopedDb) => {
      const normal = await repository.openNewThread(scopedDb, { title: "Today-tool-normal" });
      const secret = await repository.openNewThread(scopedDb, {
        title: "Today-tool-secret",
        incognito: true
      });
      await repository.recordCompletedTurn(scopedDb, normal.id, "hello today", "hi back", {
        provider: "anthropic",
        model: "claude-economy"
      });
      await repository.recordCompletedTurn(scopedDb, secret.id, "secret question", "secret reply", {
        provider: "anthropic",
        model: "claude-economy"
      });

      const result = await tool!.execute!(
        scopedDb,
        {},
        {
          actorUserId: ids.userA,
          requestId: "request:user-a-chat-live",
          chatSessionId: ""
        }
      );
      const turns = (result.data as { turns: Array<{ threadTitle: string; role: string }> }).turns;
      expect(turns.some((t) => t.threadTitle === "Today-tool-normal")).toBe(true);
      expect(turns.some((t) => t.threadTitle === "Today-tool-secret")).toBe(false);
      // both roles of the visible turn are present
      expect(turns.some((t) => t.threadTitle === "Today-tool-normal" && t.role === "user")).toBe(
        true
      );
      expect(
        turns.some((t) => t.threadTitle === "Today-tool-normal" && t.role === "assistant")
      ).toBe(true);
    });
  });
});

describe("handleExtractFactsJob — durable fact upsert + no-op degrade", () => {
  let appDb: Kysely<JarvisDatabase>;
  let dataContext: DataContextRunner;
  let repository: ChatRepository;
  let aiRepository: AiRepository;
  let factsRepository: ChatMemoryFactsRepository;

  // A summarization/economy model + credentialed provider so the handler reaches the
  // (injected) adapter path instead of returning early on a missing model/credential.
  async function seedEconomyModel(label: string): Promise<void> {
    const provider = await dataContext.withDataContext(adminContext(), (scopedDb) =>
      aiRepository.createProvider(scopedDb, {
        providerKind: "anthropic",
        displayName: `Facts summarizer ${label}`,
        encryptedCredential: createAiSecretCipher().encryptJson({ apiKey: "facts-extract-key" })
      })
    );
    await dataContext.withDataContext(adminContext(), (scopedDb) =>
      aiRepository.createModel(scopedDb, {
        providerConfigId: provider.id,
        providerModelId: `facts-summarizer-${label}`,
        displayName: "Facts Summarizer",
        capabilities: ["summarization"],
        tier: "economy"
      })
    );
  }

  // Build ExtractFactsDeps with an injected fake adapter so no real HTTP call happens.
  function makeDeps(generate: (input: GenerateChatInput) => Promise<{ readonly text: string }>) {
    return {
      aiRepository,
      cipher: createAiSecretCipher(),
      factsRepository,
      createAdapter: () => ({ generateChat: generate })
    };
  }

  beforeAll(async () => {
    await resetFoundationDatabase();
    appDb = createDatabase({
      connectionString: connectionStrings.app,
      maxConnections: 1
    });
    dataContext = new DataContextRunner(appDb);
    repository = new ChatRepository();
    aiRepository = new AiRepository();
    factsRepository = new ChatMemoryFactsRepository();
  });

  it("extracts JSON facts and upserts active rows with sourceThreadId set", async () => {
    await seedEconomyModel("extract");
    await dataContext.withDataContext(userAContext(), async (scopedDb) => {
      const thread = await repository.openNewThread(scopedDb, { title: "Facts-extract" });
      await repository.recordCompletedTurn(
        scopedDb,
        thread.id,
        "I am a vegetarian and I want to run a marathon.",
        "Noted — I'll keep that in mind.",
        { provider: "anthropic", model: "claude-economy" }
      );

      const deps = makeDeps(async () => ({
        text: JSON.stringify([
          {
            category: "preference",
            content: "Eats vegetarian",
            importance: 0.8,
            provenance: "volunteered"
          },
          { category: "goal", content: "Run a marathon", importance: 0.7 }
        ])
      }));
      await handleExtractFactsJob(scopedDb, ids.userA, thread.id, deps);

      const facts = await factsRepository.listActiveFacts(scopedDb, ids.userA);
      const veggie = facts.find(
        (f) => f.content === "Eats vegetarian" && f.sourceThreadId === thread.id
      );
      const marathon = facts.find(
        (f) => f.content === "Run a marathon" && f.sourceThreadId === thread.id
      );
      expect(veggie?.category).toBe("preference");
      expect(veggie?.provenance).toBe("volunteered");
      expect(veggie?.importance).toBeGreaterThan(0);
      expect(veggie?.importance).toBeLessThanOrEqual(1);
      expect(veggie?.sourceThreadId).toBe(thread.id);
      expect(marathon?.category).toBe("goal");
      expect(marathon?.provenance).toBe("inferred");
    });
  });

  it("does not write rows and does not throw when generateChat throws", async () => {
    await seedEconomyModel("degrade-throw");
    await dataContext.withDataContext(userAContext(), async (scopedDb) => {
      const thread = await repository.openNewThread(scopedDb, { title: "Facts-degrade-throw" });
      await repository.recordCompletedTurn(
        scopedDb,
        thread.id,
        "Some uniquely worded throwaway sentence about kayaking gear.",
        "Got it.",
        { provider: "anthropic", model: "claude-economy" }
      );

      const before = await factsRepository.listActiveFacts(scopedDb, ids.userA);
      const deps = makeDeps(async () => {
        throw new Error("provider down");
      });
      await expect(
        handleExtractFactsJob(scopedDb, ids.userA, thread.id, deps)
      ).resolves.toBeUndefined();
      const after = await factsRepository.listActiveFacts(scopedDb, ids.userA);
      expect(after.length).toBe(before.length);
    });
  });

  it("does not write rows when generateChat returns non-JSON (no-op degrade)", async () => {
    await seedEconomyModel("degrade-nonjson");
    await dataContext.withDataContext(userAContext(), async (scopedDb) => {
      const thread = await repository.openNewThread(scopedDb, { title: "Facts-degrade-nonjson" });
      await repository.recordCompletedTurn(
        scopedDb,
        thread.id,
        "Another distinct sentence about sourdough starter maintenance.",
        "Understood.",
        { provider: "anthropic", model: "claude-economy" }
      );

      const before = await factsRepository.listActiveFacts(scopedDb, ids.userA);
      const deps = makeDeps(async () => ({ text: "Here are some facts: not json at all." }));
      await handleExtractFactsJob(scopedDb, ids.userA, thread.id, deps);
      const after = await factsRepository.listActiveFacts(scopedDb, ids.userA);
      expect(after.length).toBe(before.length);
    });
  });

  it("idempotency (F10): the same fact content twice writes only one active row", async () => {
    await seedEconomyModel("idempotent");
    await dataContext.withDataContext(userAContext(), async (scopedDb) => {
      const thread = await repository.openNewThread(scopedDb, { title: "Facts-idempotent" });
      await repository.recordCompletedTurn(
        scopedDb,
        thread.id,
        "Please remember I prefer dark roast coffee in the morning.",
        "Sure thing.",
        { provider: "anthropic", model: "claude-economy" }
      );

      const generate = async () => ({
        text: JSON.stringify([
          // Whitespace/casing differs across runs to prove normalized dedupe.
          { category: "preference", content: "Prefers dark roast coffee", importance: 0.6 }
        ])
      });
      const deps = makeDeps(generate);
      await handleExtractFactsJob(scopedDb, ids.userA, thread.id, deps);
      // Second run returns the SAME content (differently cased/spaced) — must dedupe.
      const deps2 = makeDeps(async () => ({
        text: JSON.stringify([
          { category: "preference", content: "  prefers   DARK roast coffee ", importance: 0.9 }
        ])
      }));
      await handleExtractFactsJob(scopedDb, ids.userA, thread.id, deps2);

      const facts = await factsRepository.listActiveFacts(scopedDb, ids.userA);
      const matching = facts.filter(
        (f) =>
          f.category === "preference" &&
          f.content.trim().toLowerCase().replace(/\s+/g, " ") === "prefers dark roast coffee"
      );
      expect(matching.length).toBe(1);
    });
  });

  it("grounded supersession (F11): supersedes a real active id, ignores a hallucinated id", async () => {
    await seedEconomyModel("supersede");
    await dataContext.withDataContext(userAContext(), async (scopedDb) => {
      const thread = await repository.openNewThread(scopedDb, { title: "Facts-supersede" });
      await repository.recordCompletedTurn(
        scopedDb,
        thread.id,
        "Update my dietary note.",
        "Done.",
        { provider: "anthropic", model: "claude-economy" }
      );

      // Seed one real active fact (capture its real id) and one unrelated active fact.
      const real = await factsRepository.insertFact(scopedDb, ids.userA, {
        category: "fact",
        content: "Old dietary note F11 target",
        sourceThreadId: thread.id,
        importance: 0.5
      });
      const unrelated = await factsRepository.insertFact(scopedDb, ids.userA, {
        category: "fact",
        content: "Unrelated standing fact F11",
        sourceThreadId: thread.id,
        importance: 0.5
      });

      // (a) supersedes a REAL active id -> that fact becomes superseded.
      const depsReal = makeDeps(async () => ({
        text: JSON.stringify([
          {
            category: "fact",
            content: "New dietary note F11 replacement",
            importance: 0.7,
            supersedes: real.id
          }
        ])
      }));
      await handleExtractFactsJob(scopedDb, ids.userA, thread.id, depsReal);

      let active = await factsRepository.listActiveFacts(scopedDb, ids.userA);
      expect(active.some((f) => f.id === real.id)).toBe(false); // superseded
      expect(active.some((f) => f.content === "New dietary note F11 replacement")).toBe(true);

      // (b) supersedes a RANDOM uuid NOT in the active set -> nothing is superseded.
      const hallucinated = "11111111-1111-4111-8111-111111111111";
      const depsFake = makeDeps(async () => ({
        text: JSON.stringify([
          {
            category: "fact",
            content: "Tries to supersede a hallucinated id F11",
            importance: 0.7,
            supersedes: hallucinated
          }
        ])
      }));
      await handleExtractFactsJob(scopedDb, ids.userA, thread.id, depsFake);

      active = await factsRepository.listActiveFacts(scopedDb, ids.userA);
      expect(active.some((f) => f.id === unrelated.id)).toBe(true); // still active
    });
  });

  it("logs a corrected row only when a grounded active fact is superseded and replaced", async () => {
    await seedEconomyModel("corrected");
    await dataContext.withDataContext(userAContext(), async (scopedDb) => {
      const thread = await repository.openNewThread(scopedDb, { title: "Facts-corrected" });
      const old = await factsRepository.insertFact(scopedDb, ids.userA, {
        category: "preference",
        content: "Prefers tea",
        sourceThreadId: thread.id,
        provenance: "volunteered"
      });
      await repository.recordCompletedTurn(
        scopedDb,
        thread.id,
        "No, I prefer coffee, not tea.",
        "Got it.",
        { provider: "anthropic", model: "claude-economy" }
      );

      await handleExtractFactsJob(
        scopedDb,
        ids.userA,
        thread.id,
        makeDeps(async () => ({
          text: JSON.stringify([
            {
              category: "preference",
              content: "Prefers coffee",
              importance: 0.8,
              provenance: "volunteered",
              correction: {
                supersedes: old.id,
                before: "Prefers tea",
                after: "Prefers coffee"
              }
            }
          ])
        }))
      );

      const active = await factsRepository.listActiveFacts(scopedDb, ids.userA);
      expect(active.some((fact) => fact.id === old.id)).toBe(false);
      expect(active.some((fact) => fact.content === "Prefers coffee")).toBe(true);

      const corrections = await new ChatMemorySuppressionsRepository().listCorrections(
        scopedDb,
        ids.userA,
        { limit: 10, offset: 0 }
      );
      expect(corrections).toContainEqual(
        expect.objectContaining({
          reason: "corrected",
          source: "chat",
          factId: old.id,
          beforeContent: "Prefers tea",
          afterContent: "Prefers coffee"
        })
      );
    });
  });

  it("does not log a correction for hallucinated correction ids", async () => {
    await seedEconomyModel("correction-hallucinated");
    await dataContext.withDataContext(userAContext(), async (scopedDb) => {
      const thread = await repository.openNewThread(scopedDb, { title: "Facts-correction-fake" });
      await repository.recordCompletedTurn(scopedDb, thread.id, "Maybe I like coffee.", "Noted.", {
        provider: "anthropic",
        model: "claude-economy"
      });

      await handleExtractFactsJob(
        scopedDb,
        ids.userA,
        thread.id,
        makeDeps(async () => ({
          text: JSON.stringify([
            {
              category: "preference",
              content: "May like coffee",
              correction: {
                supersedes: "11111111-1111-4111-8111-111111111111",
                before: "Prefers tea",
                after: "May like coffee"
              }
            }
          ])
        }))
      );

      const corrections = await new ChatMemorySuppressionsRepository().listCorrections(
        scopedDb,
        ids.userA,
        { limit: 10, offset: 0 }
      );
      expect(corrections.some((row) => row.factId === "11111111-1111-4111-8111-111111111111")).toBe(
        false
      );
    });
  });

  it("skips suppressed inferred facts by stable signature", async () => {
    await seedEconomyModel("suppressed-inferred");
    await dataContext.withDataContext(userAContext(), async (scopedDb) => {
      const thread = await repository.openNewThread(scopedDb, { title: "Facts-suppressed" });
      await repository.recordCompletedTurn(
        scopedDb,
        thread.id,
        "I keep accepting 8am meetings.",
        "Noted.",
        { provider: "anthropic", model: "claude-economy" }
      );
      const suppressions = new ChatMemorySuppressionsRepository();
      await suppressions.insertSuppression(scopedDb, ids.userA, {
        signature: createMemoryFactSignature("preference", "Accepts 8am meetings"),
        category: "preference",
        content: "Accepts 8am meetings",
        reason: "rejected"
      });
      await handleExtractFactsJob(
        scopedDb,
        ids.userA,
        thread.id,
        makeDeps(async () => ({
          text: JSON.stringify([
            {
              category: "preference",
              content: "  accepts   8AM meetings ",
              importance: 0.6,
              provenance: "inferred"
            }
          ])
        }))
      );
      const suppressedSignature = createMemoryFactSignature("preference", "Accepts 8am meetings");
      const facts = await factsRepository.listActiveFacts(scopedDb, ids.userA);
      expect(
        facts.some((f) => createMemoryFactSignature(f.category, f.content) === suppressedSignature)
      ).toBe(false);
    });
  });

  it("does not let another user's suppression block extraction", async () => {
    await seedEconomyModel("suppressed-other-user");
    await dataContext.withDataContext(userBContext(), async (scopedDb) => {
      const suppressions = new ChatMemorySuppressionsRepository();
      await suppressions.insertSuppression(scopedDb, ids.userB, {
        signature: createMemoryFactSignature("goal", "Run a 10k"),
        category: "goal",
        content: "Run a 10k",
        reason: "rejected"
      });
    });
    await dataContext.withDataContext(userAContext(), async (scopedDb) => {
      const thread = await repository.openNewThread(scopedDb, { title: "Facts-other-user" });
      await repository.recordCompletedTurn(scopedDb, thread.id, "I want to run a 10k.", "Noted.", {
        provider: "anthropic",
        model: "claude-economy"
      });
      await handleExtractFactsJob(
        scopedDb,
        ids.userA,
        thread.id,
        makeDeps(async () => ({
          text: JSON.stringify([{ category: "goal", content: "Run a 10k", provenance: "inferred" }])
        }))
      );
      const facts = await factsRepository.listActiveFacts(scopedDb, ids.userA);
      expect(
        facts.some(
          (f) =>
            f.category === "goal" && f.content === "Run a 10k" && f.sourceThreadId === thread.id
        )
      ).toBe(true);
    });
  });
});

function userAContext(): AccessContext {
  return {
    actorUserId: ids.userA,
    requestId: "request:user-a-chat-live"
  };
}

function userBContext(): AccessContext {
  return {
    actorUserId: ids.userB,
    requestId: "request:user-b-chat-live"
  };
}

function adminContext(): AccessContext {
  return {
    actorUserId: ids.adminUser,
    requestId: "request:admin-chat-live"
  };
}
