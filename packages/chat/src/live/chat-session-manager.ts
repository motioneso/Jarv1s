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

import type { RecallPort } from "../recall-port.js";
import { renderPersona, type PersonaFs } from "./persona.js";
import { neutralizeSeedFraming } from "./prompt-safety.js";
import { renderMemorySeedBlock } from "./recall-seed.js";
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
  /** Prior stored turns split into recent verbatim turns + older rolling summary. */
  listPriorTurns(actorUserId: string): Promise<{
    recent: readonly { role: "user" | "assistant"; content: string }[];
    oldSummary: string | null;
  }>;
  /** Persist a completed turn (user text + assistant reply + executing provider/model). */
  recordTurn(
    actorUserId: string,
    userText: string,
    assistantReply: string,
    executed: { provider: ProviderKind; model: string }
  ): Promise<void>;
  /** Close the current conversation and open a fresh one (for /clear). */
  openNewConversation(actorUserId: string, options?: { incognito?: boolean }): Promise<void>;
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
  readonly persona: string | ((actorUserId: string, userName: string) => Promise<string>);
  /** Delay between readNew polls (default 25ms; tests pass 0). */
  readonly pollMs?: number;
  /** Cap on readNew polls per turn before a turn is treated as timed out (default 2000). */
  readonly maxPolls?: number;
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
  readonly killSession?: (sessionKey: string) => Promise<void>;
  /** Phase 3: optional recall service — injects <memory> seed before replay. */
  readonly recall?: RecallPort;
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
}

/** Default cap on readNew polls per turn so a never-completing engine can't hang us. */
const DEFAULT_MAX_POLLS = 2_000;

/** Body persisted/returned when a turn never reports complete within the poll cap. */
const TIMEOUT_MESSAGE = "Chat timed out before the model finished responding.";

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

export class ChatSessionManager {
  private readonly sessions = new Map<string, UserSession>();
  private readonly subscribers = new Map<string, Set<Subscriber>>();
  /** In-flight ensureSession promises, keyed by user, to serialize launches. */
  private readonly launching = new Map<string, Promise<UserSession>>();
  /**
   * Users with a turn currently in flight. submitTurn rejects a concurrent turn
   * for the same user (turn-at-a-time, spec §6.5) so two turns can't interleave
   * readNew against the shared transcript offset and corrupt it.
   */
  private readonly turnsInFlight = new Set<string>();
  private readonly pollMs: number;
  private readonly maxPolls: number;
  /**
   * #342 (§4.1.2) — true when the ENGINE (RPC server) owns the replay submit+drain, so the
   * manager must NOT submit/drain the replay itself. Resolved once from deps (default false =
   * in-process path). See {@link ChatSessionManagerDeps.serverOwnsDrain} for why this replaces
   * the old `offset === 0` sentinel (which double-submitted the replay on a 0-offset RPC result).
   */
  private readonly serverOwnsDrain: boolean;
  /**
   * #342 (§5.4) — the single async mutex SHARED by reconciliation and reapIdle. Both mutate
   * `sessions` + revoke tokens, so they MUST be mutually exclusive. Implemented as a promise
   * chain: each critical section awaits the previous one's settlement before running. (A
   * `submitTurn` does not take this mutex — it is serialized per-user by `turnsInFlight`; the
   * mutex only orders the two session-map-mutating maintenance paths against each other.)
   */
  private maintenanceMutex: Promise<void> = Promise.resolve();

  constructor(private readonly deps: ChatSessionManagerDeps) {
    this.pollMs = deps.pollMs ?? 25;
    this.maxPolls = deps.maxPolls ?? DEFAULT_MAX_POLLS;
    this.serverOwnsDrain = deps.serverOwnsDrain ?? false;
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
    const engine = this.deps.engineFactory(provider, sessionKey);
    const mcpConfig = await this.deps.mintMcpToken?.(actorUserId, actorUserId);

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
    const { recent: recentTurns, oldSummary } =
      await this.deps.persistence.listPriorTurns(actorUserId);
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
      // #367: pass the resolved model id (the "sonnet" alias) so the launch uses the registered
      // model via `--model`, instead of riding the CLI account default.
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
      transcriptOffset: offset
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
  ): Promise<{ reply: string }> {
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

  private async runTurn(
    actorUserId: string,
    userName: string,
    text: string
  ): Promise<{ reply: string }> {
    const session = await this.ensureSession(actorUserId, userName);

    this.emit(actorUserId, { kind: "user", text });
    await session.engine.submit(text);

    let reply = "";
    let polls = 0;
    let timedOut = false;
    for (;;) {
      const { records, offset, complete } = await session.engine.readNew(session.transcriptOffset);
      session.transcriptOffset = offset;
      for (const record of records) {
        this.emit(actorUserId, record);
        if (record.kind === "reply") reply = record.text;
      }
      if (complete) break;
      if (++polls >= this.maxPolls) {
        timedOut = true;
        break;
      }
      if (this.pollMs > 0) await delay(this.pollMs);
    }

    // The poll loop exited without the engine reporting complete: surface a clear
    // error rather than silently persisting a partial (often empty) reply as a
    // successful turn. The user message is still recorded so the stored
    // conversation stays consistent.
    if (timedOut) {
      this.emit(actorUserId, { kind: "error", text: TIMEOUT_MESSAGE });
      reply = TIMEOUT_MESSAGE;
    }

    await this.deps.persistence.recordTurn(actorUserId, text, reply, {
      provider: session.provider,
      model: session.model
    });
    session.lastActivity = this.deps.clock.now();
    this.deps.touchMcpToken?.(actorUserId);

    return { reply };
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
    const session = this.sessions.get(actorUserId);
    if (session) {
      await session.engine.kill();
      this.sessions.delete(actorUserId);
      this.deps.revokeMcpToken?.(actorUserId);
    }
    await this.deps.persistence.openNewConversation(actorUserId, options);
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
        if (now - session.lastActivity > this.deps.idleMs) {
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
   * Steps (under the shared §5.4 mutex, mutually exclusive with reapIdle):
   *   2. Orphan-token revoke — sourced from the TOKEN REGISTRY (works with an empty
   *      `sessions` Map, e.g. after an api restart): revoke every token whose session ∉
   *      liveKeys.
   *   3. Drop stale api sessions — a `sessions` entry whose key ∉ liveKeys (cli-runner
   *      restarted, losing it): drop it + revoke its token. The next submitTurn relaunches.
   *   4. Kill orphaned mux sessions — a liveKey the `sessions` Map does NOT know about (api
   *      restarted, cli-runner kept it): issue `kill` BY MUX NAME (§4.5).
   *
   * A `sessionKey` currently mid-launch (in `launching`) is treated as LIVE for the whole
   * launch window (§5.4): it is unioned into the effective-live set so it is never killed,
   * dropped, or its token revoked. Idempotent — running it twice once consistent is a no-op.
   */
  async reconcileLiveSessions(liveKeys: Set<string>): Promise<void> {
    await this.withMaintenanceLock(async () => {
      // Treat in-flight launches as live for the entire launch window (§5.4).
      const effectiveLive = new Set(liveKeys);
      for (const key of this.launching.keys()) effectiveLive.add(key);

      // Step 2: orphan-token revoke, sourced from the token registry (not `sessions`).
      this.deps.reconcileMcpTokens?.(effectiveLive);

      // Step 3: drop stale api sessions (Map key ∉ effectiveLive).
      //
      // The kill MUST be guard-safe on the RPC path. This runs INSIDE the connection's
      // `runReconciliation` (which sets `reconciling = true` for the whole pass), so a
      // `session.engine.kill()` here would route through the PUBLIC `RpcConnection.kill`, which
      // `call()` rejects with `CliChatUnavailableError("cli-runner reconciling after restart")`
      // while `reconciling` is true — throwing BEFORE the `sessions.delete` + `revokeMcpToken` and
      // aborting the rest of step 3 AND step 4 (the throw was not caught). So we route the kill
      // through the SAME guard-bypassing path step 4 uses: `this.deps.killSession` (the reconcile
      // driver's `kill`, idempotent/by-mux-name). The cli-runner already reports these keys dead,
      // so a kill is belt-and-suspenders; the authoritative effect of step 3 is drop + revoke.
      // On the in-process/host path `killSession` is absent, so we fall back to `engine.kill()` —
      // which is safe there (no `reconciling` guard, no separate cli-runner). Either way the kill
      // is wrapped in try/catch so the drop + revoke (and the rest of the loop + step 4) always
      // execute even if the kill rejects.
      for (const [sessionKey, session] of this.sessions) {
        if (!effectiveLive.has(sessionKey)) {
          try {
            if (this.deps.killSession) {
              await this.deps.killSession(sessionKey);
            } else {
              await session.engine.kill();
            }
          } catch {
            // best-effort: a stale-session kill failure must not abort the reconcile pass — the
            // drop + revoke below still run, and the cli-runner already considers the key dead.
          }
          this.sessions.delete(sessionKey);
          this.deps.revokeMcpToken?.(sessionKey);
        }
      }

      // Step 4: kill orphaned mux sessions — a live key the Map does NOT know about. The
      // token registry's session ids are the broader source for "sessions the api once had
      // but whose Map entry is gone" (api restart); union them with current Map keys so an
      // api-unknown live key is reaped by mux name even with an empty `sessions` Map.
      // In-flight launch keys are explicitly EXCLUDED from reaping (§5.4): the api is itself
      // bringing that session up, so it is not an orphan — never kill a launching key.
      const known = new Set<string>(this.sessions.keys());
      for (const key of this.launching.keys()) known.add(key);
      for (const id of this.deps.listMcpTokenSessionIds?.() ?? []) known.add(id);
      for (const liveKey of effectiveLive) {
        if (!known.has(liveKey)) {
          await this.deps.killSession?.(liveKey);
        }
      }
    });
  }

  /**
   * Wire a production idle-reaper (#342, §5.5 option (a) — the PREFERRED outcome). Returns a
   * stop handle that clears the interval. The reaper calls {@link reapIdle}, which takes the
   * shared §5.4 maintenance mutex, so it can never race {@link reconcileLiveSessions}.
   *
   * This is the seam the api boot wiring (the composition root — NOT this package) calls once
   * after constructing the manager; e.g. `const stop = manager.startIdleReaper()` and `stop()`
   * on shutdown. It is OPT-IN so unit/integration tests that drive reapIdle manually are not
   * disturbed by a background timer. Reconciliation does not DEPEND on this running — the
   * bootId/reconnect-driven reconciliation plus the 60-min token TTL backstop are sufficient
   * on their own (§5.5) — but wiring it is the preferred Phase-1 outcome and is provided here.
   *
   * INTEGRATE NOTE: the composition root must call this once at boot (see §5.5); it is not
   * self-starting because the manager has no lifecycle/shutdown hook of its own.
   */
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

  /** Poll readNew until complete, discarding records; returns the new offset. */
  private async drain(engine: CliChatEngine, fromOffset: number): Promise<number> {
    let offset = fromOffset;
    let polls = 0;
    for (;;) {
      const { offset: next, complete } = await engine.readNew(offset);
      offset = next;
      if (complete) break;
      if (++polls >= this.maxPolls) break;
      if (this.pollMs > 0) await delay(this.pollMs);
    }
    return offset;
  }
}

/**
 * Render prior turns as a compact <conversation> seed block so a freshly-spawned
 * or switched engine continues the conversation with full context.
 *
 * Exported for unit testing of the prompt-injection neutralization (#123).
 */
export function renderReplayBlock(
  priorTurns: readonly { role: "user" | "assistant"; content: string }[]
): string {
  // Prior turn content is user-authored — neutralize any seed-framing delimiter
  // so a turn can't break out of the <conversation> block and inject instructions
  // into a freshly-spawned engine (#123).
  const lines = priorTurns.map(
    (t) => `${t.role === "user" ? "User" : "Assistant"}: ${neutralizeSeedFraming(t.content)}`
  );
  return [
    "<conversation>",
    "The following is the prior conversation so far. Continue it; do not respond to this message.",
    ...lines,
    "</conversation>"
  ].join("\n");
}

// Exported for unit testing of the prompt-injection neutralization (#123).
export function renderSummaryBlock(summary: string): string {
  // The rolling summary is a verbatim concatenation of stored assistant message
  // bodies (see persistence.ts buildRollingSummary), which are attacker-steerable
  // — a user can ask the model to echo a `</prior-context>` delimiter that then
  // gets persisted and replayed here. Route it through the same chokepoint as
  // every other untrusted seed surface so it cannot break out of the block (#123).
  return `<prior-context>\n${neutralizeSeedFraming(summary)}\n</prior-context>`;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
