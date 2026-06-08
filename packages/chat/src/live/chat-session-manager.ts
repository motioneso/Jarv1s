/**
 * ChatSessionManager — the per-user live-session orchestrator.
 *
 * This is the integration core of the live chat runtime: it owns at most ONE
 * live CLI engine per user, lazily launching it, replaying the user's prior
 * conversation turns into a freshly-spawned or provider-switched engine, fanning
 * transcript records out to subscribers (multi-tab), persisting completed turns,
 * and reaping idle engines.
 *
 * Every side-effect is injected (engine factory, persistence/provider-routing,
 * persona filesystem, clock) so the orchestration logic is unit-testable without
 * a real tmux session, Postgres, or disk. Task 8 supplies the real adapters.
 */
import type { ProviderKind } from "@jarv1s/ai";

import { renderPersona, type PersonaFs } from "./persona.js";
import type { CliChatEngine, TranscriptRecord } from "./types.js";

/** Monotonic-ish wall clock, injected so idle reaping is testable. */
export interface Clock {
  now(): number;
}

/**
 * Persistence + provider-routing port. The real impl (Task 8) wraps
 * ChatRepository + DataContextRunner + the capability router.
 */
export interface ChatPersistencePort {
  /** The active "chat" provider+model for this user (router-selected). */
  resolveActiveProvider(actorUserId: string): Promise<{ provider: ProviderKind; model: string }>;
  /** Prior stored turns of the user's CURRENT conversation, oldest-first. */
  listPriorTurns(actorUserId: string): Promise<{ role: "user" | "assistant"; content: string }[]>;
  /** Persist a completed turn (user text + assistant reply + executing provider/model). */
  recordTurn(
    actorUserId: string,
    userText: string,
    assistantReply: string,
    executed: { provider: ProviderKind; model: string }
  ): Promise<void>;
  /** Close the current conversation and open a fresh one (for /clear). */
  openNewConversation(actorUserId: string): Promise<void>;
}

export interface ChatSessionManagerDeps {
  readonly engineFactory: (provider: ProviderKind, sessionKey: string) => CliChatEngine;
  readonly persistence: ChatPersistencePort;
  readonly personaFs: PersonaFs;
  readonly clock: Clock;
  readonly idleMs: number;
  /** Base dir for renderPersona (per-user neutral dirs are created under it). */
  readonly neutralBase: string;
  /** Persona text (may contain a {{userName}} token). */
  readonly persona: string;
  /** Delay between readNew polls (default 25ms; tests pass 0). */
  readonly pollMs?: number;
}

/** A subscriber receives every emitted transcript record for its user. */
type Subscriber = (record: TranscriptRecord) => void;

interface UserSession {
  engine: CliChatEngine;
  provider: ProviderKind;
  model: string;
  lastActivity: number;
  transcriptOffset: number;
}

/** Cap on readNew polls per turn so a never-completing engine can't hang us. */
const MAX_POLLS = 2_000;

export class ChatSessionManager {
  private readonly sessions = new Map<string, UserSession>();
  private readonly subscribers = new Map<string, Set<Subscriber>>();
  /** In-flight ensureSession promises, keyed by user, to serialize launches. */
  private readonly launching = new Map<string, Promise<UserSession>>();
  private readonly pollMs: number;

  constructor(private readonly deps: ChatSessionManagerDeps) {
    this.pollMs = deps.pollMs ?? 25;
  }

  /**
   * Ensure a live engine exists for the user. If absent, resolve the active
   * provider, render the persona, launch a fresh engine, and replay the current
   * conversation's prior turns as seed context. One engine per user; concurrent
   * calls share a single launch.
   */
  async ensureSession(actorUserId: string, userName: string): Promise<UserSession> {
    const existing = this.sessions.get(actorUserId);
    if (existing) return existing;

    const inFlight = this.launching.get(actorUserId);
    if (inFlight) return inFlight;

    const launch = this.launchSession(actorUserId, userName);
    this.launching.set(actorUserId, launch);
    try {
      return await launch;
    } finally {
      this.launching.delete(actorUserId);
    }
  }

  private async launchSession(actorUserId: string, userName: string): Promise<UserSession> {
    const { provider, model } = await this.deps.persistence.resolveActiveProvider(actorUserId);

    const { neutralDir, personaPath } = await renderPersona(this.deps.personaFs, {
      userId: actorUserId,
      userName,
      provider,
      baseDir: this.deps.neutralBase,
      persona: this.deps.persona
    });

    const sessionKey = actorUserId;
    const engine = this.deps.engineFactory(provider, sessionKey);
    await engine.launch({ neutralDir, personaPath });

    const session: UserSession = {
      engine,
      provider,
      model,
      lastActivity: this.deps.clock.now(),
      transcriptOffset: 0
    };
    this.sessions.set(actorUserId, session);

    // Replay prior turns of the current conversation so a respawned or
    // provider-switched engine continues seamlessly.
    const priorTurns = await this.deps.persistence.listPriorTurns(actorUserId);
    if (priorTurns.length > 0) {
      await engine.submit(renderReplayBlock(priorTurns));
      // Drain (and discard) the replay's transcript so the real turn's records
      // start from a clean offset — replay context is not echoed to the user.
      session.transcriptOffset = await this.drain(engine, session.transcriptOffset);
    }

    return session;
  }

  /**
   * Submit one user turn: echo it to subscribers, send it to the engine, fan out
   * every new transcript record until the engine reports complete, persist the
   * completed turn, and return the assistant reply.
   */
  async submitTurn(
    actorUserId: string,
    userName: string,
    text: string
  ): Promise<{ reply: string }> {
    const session = await this.ensureSession(actorUserId, userName);

    this.emit(actorUserId, { kind: "user", text });
    await session.engine.submit(text);

    let reply = "";
    let polls = 0;
    for (;;) {
      const { records, offset, complete } = await session.engine.readNew(session.transcriptOffset);
      session.transcriptOffset = offset;
      for (const record of records) {
        this.emit(actorUserId, record);
        if (record.kind === "reply") reply = record.text;
      }
      if (complete) break;
      if (++polls >= MAX_POLLS) break;
      if (this.pollMs > 0) await delay(this.pollMs);
    }

    await this.deps.persistence.recordTurn(actorUserId, text, reply, {
      provider: session.provider,
      model: session.model
    });
    session.lastActivity = this.deps.clock.now();

    return { reply };
  }

  /**
   * /clear: reset the live engine's in-session history (if any) and open a fresh
   * stored conversation. The engine process survives; the offset is reset.
   */
  async clear(actorUserId: string): Promise<void> {
    const session = this.sessions.get(actorUserId);
    if (session) {
      await session.engine.clear();
      session.transcriptOffset = 0;
    }
    await this.deps.persistence.openNewConversation(actorUserId);
  }

  /**
   * Switch to the user's now-changed active provider: kill the current engine,
   * drop cached state, and re-ensure (which resolves the new provider and
   * replays prior turns into the new provider's engine). Same conversation.
   */
  async switchProvider(actorUserId: string, userName: string): Promise<void> {
    const session = this.sessions.get(actorUserId);
    if (session) {
      await session.engine.kill();
      this.sessions.delete(actorUserId);
    }
    await this.ensureSession(actorUserId, userName);
  }

  /**
   * Register a subscriber for the user's transcript records. Returns an
   * unsubscribe handle. Multiple subscribers (multi-tab) all receive records.
   */
  subscribe(actorUserId: string, fn: Subscriber): () => void {
    let set = this.subscribers.get(actorUserId);
    if (!set) {
      set = new Set();
      this.subscribers.set(actorUserId, set);
    }
    set.add(fn);
    return () => {
      const current = this.subscribers.get(actorUserId);
      current?.delete(fn);
      if (current && current.size === 0) this.subscribers.delete(actorUserId);
    };
  }

  /**
   * Kill and drop any engine idle longer than idleMs. The conversation persists,
   * so the next submitTurn respawns the engine and replays prior turns.
   */
  async reapIdle(): Promise<void> {
    const now = this.deps.clock.now();
    for (const [userId, session] of this.sessions) {
      if (now - session.lastActivity > this.deps.idleMs) {
        await session.engine.kill();
        this.sessions.delete(userId);
      }
    }
  }

  // ─── helpers ───────────────────────────────────────────────────────────────

  private emit(actorUserId: string, record: TranscriptRecord): void {
    const set = this.subscribers.get(actorUserId);
    if (!set) return;
    for (const fn of set) fn(record);
  }

  /** Poll readNew until complete, discarding records; returns the new offset. */
  private async drain(engine: CliChatEngine, fromOffset: number): Promise<number> {
    let offset = fromOffset;
    let polls = 0;
    for (;;) {
      const { offset: next, complete } = await engine.readNew(offset);
      offset = next;
      if (complete) break;
      if (++polls >= MAX_POLLS) break;
      if (this.pollMs > 0) await delay(this.pollMs);
    }
    return offset;
  }
}

/**
 * Render prior turns as a compact <conversation> seed block so a freshly-spawned
 * or switched engine continues the conversation with full context.
 */
function renderReplayBlock(
  priorTurns: readonly { role: "user" | "assistant"; content: string }[]
): string {
  const lines = priorTurns.map((t) => `${t.role === "user" ? "User" : "Assistant"}: ${t.content}`);
  return [
    "<conversation>",
    "The following is the prior conversation so far. Continue it; do not respond to this message.",
    ...lines,
    "</conversation>"
  ].join("\n");
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
