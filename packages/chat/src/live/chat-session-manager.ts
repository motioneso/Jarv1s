import type { ProviderKind } from "@jarv1s/ai";
import type {
  AnswerProvenanceMetadataV1,
  AiProviderExecutionMode,
  SourceFreshnessV1
} from "@jarv1s/shared";
import type { MemoryRecallItem } from "@jarv1s/memory";

import type { RecallPort } from "../recall-port.js";
import { finalizeProvenance, parseAnswerMarkers } from "./answer-provenance.js";
import { renderReplayBlock, renderSummaryBlock } from "./chat-context-blocks.js";
import type { CrossToolReadRunner } from "./cross-tool-reasoning.js";
import { buildEngineText } from "./engine-text.js";
import { CliChatDeliveryUnknownError, CliChatUnavailableError } from "./errors.js";
import { renderPersona, type PersonaFs } from "./persona.js";
import { renderMemorySeedBlock } from "./recall-seed.js";
import type { CliChatEngine, EngineKillOpts, TranscriptRecord } from "./types.js";
import type { PriorityModelPreferenceV1 } from "@jarv1s/priority";

export {
  combineHiddenContextBlocks,
  renderReplayBlock,
  renderSummaryBlock
} from "./chat-context-blocks.js";

/** Monotonic-ish wall clock, injected so idle reaping is testable. */
export interface Clock {
  now(): number;
}

export interface ChatPersistencePort {
  /** The active "chat" provider+model for this user (router-selected). */
  resolveActiveProvider(
    actorUserId: string
  ): Promise<{ provider: ProviderKind; model: string; executionMode?: AiProviderExecutionMode }>;
  /** Prior stored turns split into recent verbatim turns + older rolling summary. */
  listPriorTurns(
    actorUserId: string,
    opts?: { readonly forceReplay?: boolean }
  ): Promise<{
    recent: readonly { role: "user" | "assistant"; content: string }[];
    oldSummary: string | null;
  }>;
  /** Persist a completed turn (user text + assistant reply + executing provider/model). */
  recordTurn(
    actorUserId: string,
    userText: string,
    assistantReply: string,
    executed: { provider: ProviderKind; model: string },
    opts?: {
      readonly invokedToolNames?: ReadonlySet<string>;
      readonly answerProvenance?: AnswerProvenanceMetadataV1;
    }
  ): Promise<
    | {
        readonly userMessageId: string;
        readonly assistantMessageId: string;
        readonly sourceFreshness?: SourceFreshnessV1 | null;
      }
    | undefined
  >;
  /** Close the current conversation and open a fresh one (for /clear). */
  openNewConversation(actorUserId: string, options?: { incognito?: boolean }): Promise<void>;
  getCurrentThreadState?(
    actorUserId: string
  ): Promise<{ readonly id: string; readonly incognito: boolean } | undefined>;
  listIncognitoThreadStates?(): Promise<readonly PrivateThreadState[]>;
  deleteThread?(actorUserId: string, threadId: string): Promise<void>;
  /** Return the current thread title and the user's persisted timezone (null if unset). */
  getThreadContext(
    actorUserId: string
  ): Promise<{ threadTitle: string | null; localTimezone: string | null }>;
  /**
   * Make threadId the current thread for actorUserId (for resume). Returns true if
   * the thread was found and touched; false if it does not exist or belongs to another user.
   */
  touchExistingThread(actorUserId: string, threadId: string): Promise<boolean>;
}

export interface PassiveRetrievalPort {
  retrieve(input: {
    readonly actorUserId: string;
    readonly userText: string;
    readonly threadTitle: string | null;
    readonly recentTurns: readonly { role: "user" | "assistant"; content: string }[];
  }): Promise<string>;
  retrieveWithItems?(input: {
    readonly actorUserId: string;
    readonly userText: string;
    readonly threadTitle: string | null;
    readonly recentTurns: readonly { role: "user" | "assistant"; content: string }[];
  }): Promise<{ block: string; items: MemoryRecallItem[] }>;
}

export interface ChatSessionManagerDeps {
  readonly engineFactory: (
    provider: ProviderKind,
    sessionKey: string,
    opts?: { readonly executionMode?: AiProviderExecutionMode }
  ) => CliChatEngine;
  readonly persistence: ChatPersistencePort;
  readonly personaFs: PersonaFs;
  readonly clock: Clock;
  readonly idleMs: number;
  /** Base dir for renderPersona (per-user neutral dirs are created under it). */
  readonly neutralBase: string;
  /** Persona text (may contain a {{userName}} token). */
  readonly persona: string | ((actorUserId: string, userName: string) => Promise<string>);
  /** Delay between readNew polls (default 25ms; tests pass 0). */
  readonly pollMs?: number;
  /**
   * #456 — idle/heartbeat watchdog window (ms). The deadline resets whenever readNew yields new
   * transcript records; only a turn that emits NOTHING for this window trips it (accurate status
   * record, NOT the old broken TIMEOUT_MESSAGE). Default 180000 (3 min); composition root resolves
   * JARVIS_CHAT_IDLE_WATCHDOG_MS. This is NOT a duration cap — an actively-producing turn (multi-tool,
   * 3+ min) never trips it.
   */
  readonly idleWatchdogMs?: number;
  readonly mintMcpToken?: (
    actorUserId: string,
    chatSessionId: string
  ) => Promise<{ token: string; mcpServerUrl: string }>;
  readonly revokeMcpToken?: (chatSessionId: string) => void;
  /** Refresh the session token's TTL on activity, so a live session's token never
   *  expires under the registry backstop (mirrors lastActivity / idle reaping). */
  readonly touchMcpToken?: (chatSessionId: string) => void;
  /**
   * #342 (§5.3 step 2) — revoke every MCP token whose chatSessionId is NOT in the live set.
   * Wraps SessionTokenRegistry.reconcile(liveSessionIds). The ONE source for orphan-token
   * revocation: it works off the token registry, so it sweeps orphaned tokens even when
   * `sessions` is empty (an api restart). Absent ⇒ reconciliation skips the token sweep
   * (host/in-process path that mints no tokens).
   */
  readonly reconcileMcpTokens?: (liveSessionIds: Set<string>) => void;
  /**
   * #342 (§5.3 steps 2/4) — every chatSessionId the token registry currently holds a token
   * for (SessionTokenRegistry.listSessionIds). After an api restart the `sessions` Map is
   * empty, so this — not the Map — is what tells reconciliation which orphaned mux sessions
   * to reap by name. Absent ⇒ reconciliation reaps only sessions the Map knows about.
   */
  readonly listMcpTokenSessionIds?: () => string[];
  /**
   * #342 (§4.5 / §5.3 step 4) — issue a `kill` for a sessionKey the manager has NO engine
   * object for (an api-unknown live mux session after an api restart). The RPC client kills
   * BY MUX NAME over the socket; the in-process path can no-op (a host install has no
   * separate cli-runner to hold orphans). Idempotent. Absent ⇒ orphan-by-name reaping is
   * skipped (only Map-known sessions are killed via their engine).
   */
  readonly killSession?: (sessionKey: string, opts?: EngineKillOpts) => Promise<void>;
  readonly purgePrivateTranscripts?: (sessionKey: string) => Promise<void>;
  /** Phase 3: optional recall service — injects <memory> seed before replay. */
  readonly recall?: RecallPort;
  /** Optional per-turn hidden context retrieval. Empty/failed result submits the raw turn. */
  readonly passiveRetrieval?: PassiveRetrievalPort;
  readonly crossToolRead?: CrossToolReadRunner;
  readonly priorityModel?: { getModel(actorUserId: string): Promise<PriorityModelPreferenceV1> };
  /**
   * #342 (§4.1.2) — does the ENGINE own the replay submit+drain?
   *
   * `false` (default, in-process path): the engine ignores `replayBatch`/`personaText`,
   * returns `{ offset: 0 }`, and the MANAGER submits + drains the replay itself below.
   *
   * `true` (RPC path): the cli-runner server wrote the persona file, submitted `replayBatch`,
   * and drained the transcript server-side; `launch` returns the real post-drain offset and the
   * manager does NO further submit/drain.
   *
   * This is an EXPLICIT discriminator and MUST be used instead of the `offset === 0` sentinel:
   * `offset === 0` is ALSO a legitimate RPC result (a replay was submitted but the transcript
   * never materialized within the server's drain budget), so keying the in-process re-drain on
   * `offset === 0` would cause the manager to DOUBLE-submit the replay over the socket.
   *
   * CROSS-LANE (Lane A wiring): set `serverOwnsDrain = true` exactly when the RPC engine factory
   * is selected (socket configured); leave it `false`/absent for the in-process factory.
   */
  readonly serverOwnsDrain?: boolean;
}

/** A subscriber receives every emitted transcript record for its user. */
type Subscriber = (record: TranscriptRecord) => void;

interface UserSession {
  engine: CliChatEngine;
  provider: ProviderKind;
  model: string;
  lastActivity: number;
  transcriptOffset: number;
  incognito: boolean;
}

interface PrivateThreadState {
  readonly actorUserId: string;
  readonly threadId: string;
}

const MAX_SUBSCRIBERS_PER_ACTOR = 5;
const PRIVATE_DETACH_GRACE_MS = 30_000;

/**
 * Thrown by submitTurn when a turn is already in flight for the same user. The
 * live route maps this to HTTP 409 (turn-at-a-time, spec §6.5): concurrent input
 * while a turn is in-flight is rejected rather than interleaved, which would
 * corrupt the shared transcript offset.
 */
export class ChatTurnInFlightError extends Error {
  constructor() {
    super("A chat turn is already in progress. Wait for it to finish before sending another.");
    this.name = "ChatTurnInFlightError";
  }
}

export class ChatStreamLimitError extends Error {
  constructor() {
    super("Too many open chat streams for this user.");
    this.name = "ChatStreamLimitError";
  }
}

export class ChatThreadNotFoundError extends Error {
  constructor() {
    super("Chat thread not found or does not belong to this user.");
    this.name = "ChatThreadNotFoundError";
  }
}

export class ChatSessionManager {
  private readonly sessions = new Map<string, UserSession>();
  private readonly subscribers = new Map<string, Set<Subscriber>>();
  private readonly privateDetachTimers = new Map<string, ReturnType<typeof setTimeout>>();
  /** In-flight ensureSession promises, keyed by user, to serialize launches. */
  private readonly launching = new Map<string, Promise<UserSession>>();
  /** Actors whose next relaunch must replay bounded prior context after an explicit resume. */
  private readonly pendingForcedReplay = new Set<string>();
  /**
   * Users with a turn currently in flight. submitTurn rejects a concurrent turn
   * for the same user (turn-at-a-time, spec §6.5) so two turns can't interleave
   * readNew against the shared transcript offset and corrupt it.
   */
  private readonly turnsInFlight = new Set<string>();
  /**
   * #456 — per-turn AbortControllers, keyed by actor. `runTurn` creates one at turn start and
   * stores it here; the poll loop checks `signal.aborted` after every readNew and breaks cleanly
   * (no error) when set. `stopTurn` calls `.abort()` to end the in-flight turn from the outside.
   * Cleared in runTurn's finally so it never leaks.
   */
  private readonly turnControllers = new Map<string, AbortController>();
  private readonly pollMs: number;
  /** #456 — idle/heartbeat watchdog window; 0 disables (tests only). */
  private readonly idleWatchdogMs: number;
  /** #342: RPC engines own replay submit/drain; in-process engines do it here. */
  private readonly serverOwnsDrain: boolean;
  /** #342: serializes reconciliation and idle reaping, which both mutate sessions/tokens. */
  private maintenanceMutex: Promise<void> = Promise.resolve();

  constructor(private readonly deps: ChatSessionManagerDeps) {
    this.pollMs = deps.pollMs ?? 25;
    this.idleWatchdogMs = deps.idleWatchdogMs ?? 180_000;
    this.serverOwnsDrain = deps.serverOwnsDrain ?? false;
  }

  /**
   * Ensure a live engine exists for the user. If absent, resolve the active
   * provider, render the persona, launch a fresh engine, and replay the current
   * conversation's prior turns as seed context. One engine per user; concurrent
   * calls share a single launch.
   */
  async ensureSession(
    actorUserId: string,
    userName: string,
    opts?: { readonly forceReplay?: boolean }
  ): Promise<UserSession> {
    const existing = this.sessions.get(actorUserId);
    if (existing) return existing;

    const inFlight = this.launching.get(actorUserId);
    if (inFlight) return inFlight;

    const forceReplay = opts?.forceReplay ?? this.pendingForcedReplay.delete(actorUserId);
    const launch = this.launchSession(actorUserId, userName, { forceReplay });
    this.launching.set(actorUserId, launch);
    try {
      return await launch;
    } finally {
      this.launching.delete(actorUserId);
    }
  }

  private async launchSession(
    actorUserId: string,
    userName: string,
    opts?: { readonly forceReplay?: boolean }
  ): Promise<UserSession> {
    const { provider, model, executionMode } =
      await this.deps.persistence.resolveActiveProvider(actorUserId);
    const persona =
      typeof this.deps.persona === "string"
        ? this.deps.persona
        : await this.deps.persona(actorUserId, userName);

    const { neutralDir, personaPath } = await renderPersona(this.deps.personaFs, {
      userId: actorUserId,
      userName,
      provider,
      baseDir: this.deps.neutralBase,
      persona
    });

    const sessionKey = actorUserId;
    const engine = this.deps.engineFactory(provider, sessionKey, { executionMode });

    // Build the replay batch BEFORE launch so it can be shipped to the cli-runner in the
    // launch RPC (§4.1). It is REBUILT from live state on every launch — never cached —
    // since persona, recall seed, rolling summary and recent-turn window can all change
    // between launches (§4.1.3).
    //
    // Phase 3: recall injection — prepend <memory> seed before conversation replay.
    const recallResult = this.deps.recall ? await this.deps.recall.recall(actorUserId) : null;
    const seedBudget = process.env.JARVIS_CHAT_SEED_BUDGET_TOKENS
      ? parseInt(process.env.JARVIS_CHAT_SEED_BUDGET_TOKENS, 10)
      : 1500;
    const memorySeed = recallResult
      ? renderMemorySeedBlock(recallResult.episodicChunks, recallResult.facts, seedBudget)
      : "";

    // The bounded window of prior turns (+ older rolling summary) so a respawned or
    // provider-switched engine continues seamlessly.
    const [threadState, { recent: recentTurns, oldSummary }] = await Promise.all([
      this.deps.persistence.getCurrentThreadState?.(actorUserId),
      this.deps.persistence.listPriorTurns(actorUserId, { forceReplay: opts?.forceReplay })
    ]);
    if (threadState?.incognito && !engine.purgeTranscripts) {
      throw new CliChatUnavailableError("private session unavailable");
    }
    const mcpConfig = await this.deps.mintMcpToken?.(actorUserId, actorUserId);
    const replayParts: string[] = [];
    if (memorySeed) replayParts.push(memorySeed);
    if (oldSummary) replayParts.push(renderSummaryBlock(oldSummary));
    if (recentTurns.length > 0) replayParts.push(renderReplayBlock(recentTurns));
    const replayBatch = replayParts.length > 0 ? replayParts.join("\n\n") : undefined;

    // launch now returns the post-drain transcript offset (§4.0/§4.1.2). The manager
    // populates personaText + replayBatch on BOTH paths: the RPC engine consumes them
    // (server writes the persona file, submits + drains replayBatch, returns the real
    // post-drain offset); the in-process engine IGNORES them, returns { offset: 0 }, and
    // the manager keeps doing its own submit + drain below — keyed on the EXPLICIT
    // `serverOwnsDrain` discriminator, NOT on `offset === 0` (see below).
    const { offset } = await engine.launch({
      neutralDir,
      personaPath,
      personaText: persona,
      replayBatch,
      // #367: pass the resolved model id. The launch builders emit `--model` only for a concrete
      // settings override; for the `"default"` sentinel they omit it so the CLI rides its own
      // interactive/account model (the primary path — chat never requires model selection).
      model,
      mcpToken: mcpConfig?.token,
      mcpServerUrl: mcpConfig?.mcpServerUrl
    });

    const session: UserSession = {
      engine,
      provider,
      model,
      lastActivity: this.deps.clock.now(),
      // Seed from the launch return so the FIRST real readNew does not re-read the
      // server-drained replay block as the assistant reply (§4.1.2).
      transcriptOffset: offset,
      incognito: threadState?.incognito ?? false
    };
    this.sessions.set(actorUserId, session);

    // In-process path: the engine did NOT own the replay drain (it ignores replayBatch and
    // returns offset 0), so the manager submits + drains the replay itself, exactly as before.
    //
    // The decision is keyed on the EXPLICIT `serverOwnsDrain` discriminator, NOT on
    // `offset === 0`. `offset === 0` is ALSO a legitimate RPC result — a replay was submitted
    // server-side but the transcript never materialized within the server's drain budget — so an
    // `offset === 0` sentinel would make the manager DOUBLE-submit the replay over the socket on
    // the RPC path. With the discriminator the RPC path is skipped regardless of the offset value
    // (the server already owns the submit+drain), and the in-process path always re-drains.
    //
    // When there is no replay to send at all, both paths skip this.
    if (replayBatch !== undefined && !this.serverOwnsDrain) {
      await engine.submit(replayBatch);
      // Drain (and discard) so real turn records start from a clean offset.
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
  ): Promise<{
    reply: string;
    userMessageId?: string;
    assistantMessageId?: string;
    sourceFreshness?: SourceFreshnessV1 | null;
  }> {
    // Turn-at-a-time (spec §6.5): reject a concurrent turn for the same user.
    // The flag is set synchronously (before any await) so two turns started in
    // the same tick can't both pass the check, and cleared in finally below.
    if (this.turnsInFlight.has(actorUserId)) {
      throw new ChatTurnInFlightError();
    }
    this.turnsInFlight.add(actorUserId);
    try {
      return await this.runTurn(actorUserId, userName, text);
    } finally {
      this.turnsInFlight.delete(actorUserId);
    }
  }

  async seedContext(actorUserId: string, userName: string, seed: string): Promise<void> {
    const session = await this.ensureSession(actorUserId, userName);
    await session.engine.submit(seed);
    session.transcriptOffset = await this.drain(session.engine, session.transcriptOffset);
    session.lastActivity = this.deps.clock.now();
    this.deps.touchMcpToken?.(actorUserId);
  }

  private async runTurn(
    actorUserId: string,
    userName: string,
    text: string
  ): Promise<{
    reply: string;
    userMessageId?: string;
    assistantMessageId?: string;
    sourceFreshness?: SourceFreshnessV1 | null;
  }> {
    const session = await this.ensureSession(actorUserId, userName);

    // #456 — per-turn stop signal. stopTurn(actorUserId) aborts this; the poll loop checks
    // signal.aborted after every readNew and breaks cleanly (no error) when set.
    const controller = new AbortController();
    this.turnControllers.set(actorUserId, controller);

    try {
      const { text: engineText, pendingItems } = await buildEngineText(
        {
          persistence: this.deps.persistence,
          passiveRetrieval: this.deps.passiveRetrieval,
          crossToolRead: this.deps.crossToolRead,
          priorityModel: this.deps.priorityModel
        },
        actorUserId,
        text
      );
      this.emit(actorUserId, { kind: "user", text });
      try {
        await session.engine.submit(engineText);
      } catch (err) {
        if (err instanceof CliChatDeliveryUnknownError) {
          if (this.sessions.get(actorUserId) === session) this.sessions.delete(actorUserId);
          this.deps.revokeMcpToken?.(actorUserId);
        }
        throw err;
      }

      let reply = "";
      const invokedToolNames = new Set<string>();
      let lastEmissionAt = this.deps.clock.now();
      let watchdogTripped = false;
      let stopped = false;
      for (;;) {
        let records: TranscriptRecord[];
        let offset: number;
        let complete: boolean;
        try {
          const result = await session.engine.readNew(session.transcriptOffset);
          records = result.records;
          offset = result.offset;
          complete = result.complete;
        } catch {
          // #456 — a killed engine rejects its in-flight readNew. If the user stopped the turn,
          // break cleanly; otherwise rethrow (a genuine engine failure surfaces to the caller).
          if (controller.signal.aborted) {
            stopped = true;
            break;
          }
          throw new Error("readNew failed");
        }
        if (controller.signal.aborted) {
          stopped = true;
          break;
        }
        session.transcriptOffset = offset;
        if (records.length > 0) {
          lastEmissionAt = this.deps.clock.now();
          // #456 — signal activity so the in-flight RPC turn-verb deadline resets (an
          // actively-producing turn never trips the 45s deadline; a wedged cli-runner still does).
          session.engine.resetActivityDeadline?.();
        }
        for (const record of records) {
          this.emit(actorUserId, record);
          if (record.kind === "reply") reply = record.text;
          if (record.kind === "tool" && record.toolName) {
            invokedToolNames.add(record.toolName);
          }
        }
        if (complete) break;
        // #456 — user-driven Stop: the signal aborts mid-turn; break cleanly (no error) so the
        // turn-in-flight lock releases and the UI returns to input-ready. Persist nothing.
        if (controller.signal.aborted) {
          stopped = true;
          break;
        }
        // #456 — idle/heartbeat watchdog: break only when the engine has emitted NOTHING for the
        // full window. An actively-producing turn (records on every poll) keeps resetting the
        // deadline, so a multi-tool 3+ min turn never trips it. Emits an accurate status record
        // (NOT the old broken TIMEOUT_MESSAGE). No reply was produced → recordTurn is skipped.
        if (
          this.idleWatchdogMs > 0 &&
          this.deps.clock.now() - lastEmissionAt > this.idleWatchdogMs
        ) {
          watchdogTripped = true;
          break;
        }
        if (this.pollMs > 0) await delay(this.pollMs);
      }

      if (stopped) {
        // Coordinator ruling (a): emit a status record over SSE, persist NOTHING. The user message
        // and any partial reply are discarded — the turn never completed.
        this.emit(actorUserId, { kind: "status", text: "Stopped by user." });
        session.lastActivity = this.deps.clock.now();
        this.deps.touchMcpToken?.(actorUserId);
        return { reply };
      }

      if (watchdogTripped) {
        const seconds = Math.round(this.idleWatchdogMs / 1000);
        this.emit(actorUserId, {
          kind: "status",
          text: `No response from the model for ${seconds} seconds — ending turn.`
        });
        session.lastActivity = this.deps.clock.now();
        this.deps.touchMcpToken?.(actorUserId);
        return { reply };
      }

      let answerProvenance: AnswerProvenanceMetadataV1 | undefined;
      if (pendingItems.length > 0 && reply) {
        try {
          const citedIds = parseAnswerMarkers(reply);
          answerProvenance = finalizeProvenance(pendingItems, citedIds);
        } catch {
          answerProvenance = undefined;
        }
      }

      const stored = await this.deps.persistence.recordTurn(
        actorUserId,
        text,
        reply,
        {
          provider: session.provider,
          model: session.model
        },
        { invokedToolNames, answerProvenance }
      );
      session.lastActivity = this.deps.clock.now();
      this.deps.touchMcpToken?.(actorUserId);

      // Post-store: re-emit reply with messageId + sourceFreshness so live UI picks it up
      if (stored?.assistantMessageId && stored.sourceFreshness !== undefined) {
        this.emit(actorUserId, {
          kind: "reply",
          text: reply,
          messageId: stored.assistantMessageId,
          sourceFreshness: stored.sourceFreshness
        });
      }

      return {
        reply,
        userMessageId: stored?.userMessageId,
        assistantMessageId: stored?.assistantMessageId,
        sourceFreshness: stored?.sourceFreshness
      };
    } finally {
      this.turnControllers.delete(actorUserId);
    }
  }

  /**
   * #456 — user-driven Stop. Ends an in-flight turn cleanly: aborts the turn's stop signal,
   * interrupts the engine (so any in-progress CLI work halts), emits a 'Stopped by user.' status
   * record over SSE, and releases the turn-in-flight lock. Persists NOTHING (the turn never
   * completed — no partial reply, no user message). Idempotent: a no-op when no turn is in
   * flight for the user.
   */
  async stopTurn(actorUserId: string): Promise<void> {
    const controller = this.turnControllers.get(actorUserId);
    if (!controller) return; // no turn in flight — idempotent no-op
    controller.abort();
    const session = this.sessions.get(actorUserId);
    if (session) {
      try {
        await session.engine.interrupt();
      } catch {
        // best-effort: the stop signal already broke the loop; interrupt failure must not wedge.
      }
    }
  }

  /**
   * /clear: start a fresh conversation. Rather than sending the CLI's `/clear`
   * (which rotates the transcript to a NEW session-id file the engine can't read —
   * its path is pinned at launch — so post-clear turns either replay the previous
   * reply or time out), we drop the live engine entirely. The next submitTurn
   * lazily relaunches a fresh engine with a new KNOWN transcript path; because
   * openNewConversation() clears the stored turns, nothing is replayed — a clean,
   * contextless reset that matches the "known path, no globbing" launch design.
   */
  async clear(actorUserId: string, options?: { incognito?: boolean }): Promise<void> {
    const currentThread = await this.deps.persistence.getCurrentThreadState?.(actorUserId);
    if (currentThread?.incognito) {
      await this.endPrivateSession(actorUserId);
      await this.deps.persistence.openNewConversation(actorUserId, options);
      return;
    }

    const session = this.sessions.get(actorUserId);
    if (session) {
      await session.engine.kill();
      this.sessions.delete(actorUserId);
      this.deps.revokeMcpToken?.(actorUserId);
    }
    await this.deps.persistence.openNewConversation(actorUserId, options);
  }

  async endPrivateSession(actorUserId: string): Promise<void> {
    const currentThread = await this.deps.persistence.getCurrentThreadState?.(actorUserId);
    if (!currentThread?.incognito) return;

    await this.cleanupPrivateSession(actorUserId, currentThread.id, this.sessions.get(actorUserId));
  }

  async getPrivacyState(actorUserId: string): Promise<{ readonly incognito: boolean }> {
    const currentThread = await this.deps.persistence.getCurrentThreadState?.(actorUserId);
    return { incognito: currentThread?.incognito ?? false };
  }

  /**
   * Resume a past thread: stop any in-flight turn, kill the current engine (so the
   * next submitTurn replays the resumed thread's messages), then touch the target
   * thread so `getCurrentThread` (which sorts by `last_active_at DESC`) returns it.
   * Throws `ChatThreadNotFoundError` when the thread is absent or belongs to another user.
   */
  async resumeThread(actorUserId: string, threadId: string): Promise<void> {
    // Validate ownership FIRST — a stale or foreign id must NOT disrupt the active session.
    // Only after confirming the thread exists and belongs to this user do we stop/drop.
    const found = await this.deps.persistence.touchExistingThread(actorUserId, threadId);
    if (!found) {
      throw new ChatThreadNotFoundError();
    }

    // Thread confirmed valid. Stop any in-flight turn (idempotent no-op when none is in flight).
    await this.stopTurn(actorUserId);

    // Drop the live engine so the next submitTurn launches fresh from the resumed thread.
    const session = this.sessions.get(actorUserId);
    if (session) {
      try {
        await session.engine.kill();
      } catch {
        // best-effort: session is dropped below regardless
      }
      this.sessions.delete(actorUserId);
      this.deps.revokeMcpToken?.(actorUserId);
    }
    this.pendingForcedReplay.add(actorUserId);
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
      this.deps.revokeMcpToken?.(actorUserId);
    }
    await this.ensureSession(actorUserId, userName, { forceReplay: true });
  }

  /**
   * #1081 H2: drop every LIVE session bound to `provider` after an admin-triggered
   * reinstall REPLACED that provider's binary (`RpcInstallProviderResult.binaryChanged`) —
   * a running engine process still holds the STALE binary in its exec image. Unlike
   * `clear()`, this does NOT reset the conversation: the transcript persists, and the next
   * `submitTurn`'s lazy relaunch (`ensureSession`) replays prior turns into a FRESH engine
   * process that execs the just-installed binary — same reasoning as `switchProvider`
   * above (provider changed under the session, keep the conversation). The boot-time
   * reconcile path (`InstallService.reconcileInstalledProviders`, #1081 H1) never needs
   * this: `startupSweep` runs before any session exists.
   *
   * Runs under the shared §5.4 maintenance mutex (same as reapIdle/reconcileLiveSessions)
   * since it mutates `sessions` + revokes tokens.
   */
  async dropSessionsForProvider(provider: ProviderKind): Promise<void> {
    await this.withMaintenanceLock(async () => {
      for (const [actorUserId, session] of this.sessions) {
        if (session.provider !== provider) continue;
        try {
          await session.engine.kill();
        } catch {
          // best-effort: a hung/failed kill must not strand the session — drop it below regardless.
        }
        this.sessions.delete(actorUserId);
        this.deps.revokeMcpToken?.(actorUserId);
      }
    });
  }

  /**
   * Register a subscriber for the user's transcript records. Returns an
   * unsubscribe handle. Multiple subscribers (multi-tab) all receive records.
   */
  subscribe(actorUserId: string, fn: Subscriber): () => void {
    this.clearPrivateDetachTimer(actorUserId);
    let set = this.subscribers.get(actorUserId);
    if (!set) {
      set = new Set();
      this.subscribers.set(actorUserId, set);
    }
    if (set.size >= MAX_SUBSCRIBERS_PER_ACTOR) {
      throw new ChatStreamLimitError();
    }
    set.add(fn);
    return () => {
      const current = this.subscribers.get(actorUserId);
      current?.delete(fn);
      if (current && current.size === 0) {
        this.subscribers.delete(actorUserId);
        if (this.sessions.get(actorUserId)?.incognito) this.schedulePrivateEnd(actorUserId);
      }
    };
  }

  /**
   * Inject a synthetic record into the fan-out for the given user. Used by the
   * MCP gateway notifier (Phase 2) to push action_request and action_result
   * records into the live transcript stream without going through the engine.
   */
  injectRecord(actorUserId: string, record: TranscriptRecord): void {
    this.emit(actorUserId, record);
  }

  /**
   * Kill and drop any engine idle longer than idleMs. The conversation persists,
   * so the next submitTurn respawns the engine and replays prior turns.
   *
   * Runs under the shared §5.4 maintenance mutex so it can never race the ONE
   * reconciliation routine (both mutate `sessions` + revoke tokens).
   */
  async reapIdle(): Promise<void> {
    await this.withMaintenanceLock(async () => {
      const now = this.deps.clock.now();
      for (const [userId, session] of this.sessions) {
        if (session.incognito && (this.subscribers.get(userId)?.size ?? 0) > 0) {
          continue;
        }
        if (now - session.lastActivity > this.deps.idleMs) {
          if (session.incognito) {
            await this.endPrivateSession(userId);
            continue;
          }
          await session.engine.kill();
          this.sessions.delete(userId);
          this.deps.revokeMcpToken?.(userId);
        }
      }
    });
  }

  /**
   * The ONE authoritative reconciliation (#342, RPC contract §5.3). Driven by the RPC
   * client on every socket (re)connect AND on a detected cli-runner `bootId` change (§5.6).
   * `liveKeys` is the authoritative set of sessionKeys the cli-runner reports alive (via
   * `listLiveSessions`, enumerated by mux — §4.6). After it returns, the api's token
   * registry and `sessions` map are consistent with the cli-runner's live set.
   *
   * In-flight launch keys are unioned into `liveKeys` so reconcile never kills
   * a session the api is itself bringing up.
   */
  async reconcileLiveSessions(liveKeys: Set<string>): Promise<void> {
    await this.withMaintenanceLock(async () => {
      // Treat in-flight launches as live for the entire launch window (§5.4).
      const effectiveLive = new Set(liveKeys);
      for (const key of this.launching.keys()) effectiveLive.add(key);

      this.deps.reconcileMcpTokens?.(effectiveLive);

      for (const [sessionKey, session] of this.sessions) {
        if (!effectiveLive.has(sessionKey)) {
          if (session.incognito) {
            const thread = await this.deps.persistence.getCurrentThreadState?.(sessionKey);
            await this.cleanupPrivateSession(
              sessionKey,
              thread?.incognito ? thread.id : undefined,
              session
            );
          } else {
            try {
              if (this.deps.killSession) {
                await this.deps.killSession(sessionKey);
              } else {
                await session.engine.kill();
              }
            } catch {
              /* best-effort stale kill */
            }
            this.sessions.delete(sessionKey);
            this.deps.revokeMcpToken?.(sessionKey);
          }
        }
      }

      const known = new Set<string>(this.sessions.keys());
      for (const key of this.launching.keys()) known.add(key);
      for (const id of this.deps.listMcpTokenSessionIds?.() ?? []) known.add(id);
      for (const liveKey of effectiveLive) {
        if (!known.has(liveKey)) {
          await this.deps.killSession?.(liveKey);
        }
      }
      await this.sweepOrphanedPrivateThreads(effectiveLive);
    });
  }

  /** Wire the production idle reaper. Returns a stop handle that clears the interval. */
  startIdleReaper(intervalMs: number = this.deps.idleMs): () => void {
    const handle = setInterval(() => {
      // Swallow errors so a transient reap failure (e.g. a kill RPC blip) does not crash the
      // timer; the next tick retries and the TTL backstop is the final safety net.
      void this.reapIdle().catch(() => {});
    }, intervalMs);
    // Do not keep the event loop alive solely for the reaper (lets the process exit cleanly).
    handle.unref?.();
    return () => clearInterval(handle);
  }

  // ─── helpers ───────────────────────────────────────────────────────────────

  /**
   * Run `fn` under the shared §5.4 maintenance mutex (a serialized promise chain), so the two
   * session-map-mutating maintenance paths — reconciliation and idle reaping — are mutually
   * exclusive. The chain advances regardless of whether `fn` resolves or rejects.
   */
  private withMaintenanceLock<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.maintenanceMutex.then(fn, fn);
    // Keep the chain alive even if this critical section rejects (swallow only on the chain,
    // not for the caller — the caller still sees the original rejection via `run`).
    this.maintenanceMutex = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  private emit(actorUserId: string, record: TranscriptRecord): void {
    const set = this.subscribers.get(actorUserId);
    if (!set) return;
    for (const fn of set) fn(record);
  }

  private schedulePrivateEnd(actorUserId: string): void {
    const timer = setTimeout(() => {
      this.privateDetachTimers.delete(actorUserId);
      void this.endPrivateSession(actorUserId).catch(() => {});
    }, PRIVATE_DETACH_GRACE_MS);
    timer.unref?.();
    this.privateDetachTimers.set(actorUserId, timer);
  }

  private clearPrivateDetachTimer(actorUserId: string): void {
    const timer = this.privateDetachTimers.get(actorUserId);
    if (!timer) return;
    clearTimeout(timer);
    this.privateDetachTimers.delete(actorUserId);
  }

  private async cleanupPrivateSession(
    actorUserId: string,
    threadId: string | undefined,
    session: UserSession | undefined
  ): Promise<void> {
    // #744/#1086 — the incognito row is the boot sweep's ONLY reclaim handle. A live CLI can
    // recreate its transcript after rm, so only the engine-less post-exit sweep may clear it.
    let purged = false;
    if (session) {
      try {
        if (session.engine.purgeTranscripts) {
          await session.engine.purgeTranscripts();
        }
      } catch {
        /* best-effort live purge; the row is retained regardless for the post-exit sweep */
      }
      try {
        const killArgs: [EngineKillOpts?] = [{ preserveNeutralDir: true }];
        await (this.deps.killSession
          ? this.deps.killSession(actorUserId, ...killArgs)
          : session.engine.kill(...killArgs));
      } catch {
        /* best-effort private kill */
      }
      // Process teardown is unconditional. The marker and row survive until a later sweep can
      // prove the process is gone and purge without a recreate race (#1086).
      this.sessions.delete(actorUserId);
      this.clearPrivateDetachTimer(actorUserId);
      this.deps.revokeMcpToken?.(actorUserId);
    } else {
      try {
        if (this.deps.purgePrivateTranscripts) {
          await this.deps.purgePrivateTranscripts(actorUserId);
          purged = true;
        }
      } catch {
        /* best-effort restart purge; keep the row for the next reconcile/boot sweep */
      }
    }
    if (purged && threadId) {
      await this.deps.persistence.deleteThread?.(actorUserId, threadId);
    }
  }

  private async sweepOrphanedPrivateThreads(effectiveLive: ReadonlySet<string>): Promise<void> {
    const rows = (await this.deps.persistence.listIncognitoThreadStates?.()) ?? [];
    for (const row of rows) {
      if (effectiveLive.has(row.actorUserId) || this.sessions.has(row.actorUserId)) continue;
      await this.cleanupPrivateSession(row.actorUserId, row.threadId, undefined);
    }
  }

  /** Poll readNew until complete, discarding records; returns the new offset. */
  private async drain(engine: CliChatEngine, fromOffset: number): Promise<number> {
    let offset = fromOffset;
    for (;;) {
      const { offset: next, complete } = await engine.readNew(offset);
      offset = next;
      if (complete) break;
      if (this.pollMs > 0) await delay(this.pollMs);
    }
    return offset;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
