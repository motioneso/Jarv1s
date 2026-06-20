/**
 * Live-chat runtime wiring: construct a ChatSessionManager backed by the REAL
 * adapters (tmux CLI engine, DataContext persistence, on-disk persona renderer,
 * wall clock) from the foundation deps the API server already threads.
 *
 * The engineFactory is injectable so integration tests can swap in an in-memory
 * fake engine (no real tmux / `claude` binary). Everything else is real.
 */
import { AiRepository, createRealTmuxIo, type Multiplexer, type ProviderKind } from "@jarv1s/ai";
import type { DataContextDb, DataContextRunner } from "@jarv1s/db";
import { normalizePersonaSettings, renderPersonaText } from "@jarv1s/shared";
import type { PgBoss } from "pg-boss";

import type { RecallPort } from "../recall-port.js";

import { resolveChatHome } from "./chat-home.js";
import {
  ChatEngineRpcClient,
  RpcConnection,
  type RpcClientLogger,
  type RpcReconcileDriver
} from "./chat-engine-rpc-client.js";
import { CliChatEngineImpl } from "./cli-chat-engine.js";
import { CliChatUnavailableError } from "./errors.js";
export { CliChatUnavailableError } from "./errors.js";
export { ChatEngineRpcClient, RpcConnection } from "./chat-engine-rpc-client.js";
export type {
  RpcClientLogger,
  RpcConnectionOpts,
  RpcReconcileDriver
} from "./chat-engine-rpc-client.js";
import { ChatSessionManager } from "./chat-session-manager.js";
import { createRealPersonaFs } from "./persona.js";
import { DataContextChatPersistence } from "./persistence.js";
import type { CliChatEngine } from "./types.js";
import { ChatRepository } from "../repository.js";

// Re-exported so the live route and integration tests can reference the
// turn-at-a-time error without reaching into the manager module directly.
export { ChatTurnInFlightError } from "./chat-session-manager.js";

/** Default idle reap window: 30 minutes of no activity kills the live engine. */
const DEFAULT_IDLE_MS = 30 * 60 * 1000;

/** The default Jarvis persona injected into every live session's context file. */
export const DEFAULT_JARVIS_PERSONA = [
  "You are Jarvis, {{userName}}'s personal assistant.",
  "Be concise, direct, and helpful. Speak in the first person.",
  "You do not have access to {{userName}}'s files or tools in this conversation —",
  "answer from the conversation itself and your own knowledge.",
  "If the user wants to connect Google (Gmail/Calendar), call connectors.startGoogleGuidance and walk them through it; the secret-entry steps happen in Settings, not in chat."
].join("\n");

export type ChatEngineFactory = (provider: ProviderKind, sessionKey: string) => CliChatEngine;

export interface PersonaPreferencesPort {
  get(scopedDb: DataContextDb, key: string): Promise<unknown>;
}

/**
 * Builds the production engine factory. The multiplexer is resolved ONCE at the
 * composition root (module-registry) and injected here, so every session shares
 * one stateless backend. With no mux it defaults to tmux (preserves legacy
 * single-host behavior for tests and standalone embedders).
 */
export function createRealEngineFactory(opts: { mux?: Multiplexer } = {}): ChatEngineFactory {
  // Containerized deploys (deployable-stack §6) point this at the bind-mounted host
  // CLI-dir base (/host-home) so transcripts written by the host CLI are read back
  // correctly. Unset on a host install → the engine uses the OS home (unchanged).
  const homeBase = process.env.JARVIS_CLI_HOME_BASE;
  return (provider, sessionKey) =>
    new CliChatEngineImpl(provider, sessionKey, createRealTmuxIo(), { mux: opts.mux, homeBase });
}

/**
 * The shared connection + the per-session engine factory backed by it. Returned together so the
 * composition root can wire the reconciliation hook on the connection (Lane D's manager owns the
 * reconcile body; the connection only fires it) and tear it down on shutdown.
 */
export interface RpcEngineFactory {
  readonly factory: ChatEngineFactory;
  readonly connection: RpcConnection;
}

/**
 * Builds the RPC engine factory used when the api runs containerized alongside the cli-runner sidecar
 * (#342). Every per-session engine is a thin `ChatEngineRpcClient` over ONE shared `RpcConnection`
 * (one socket per api process, §3.4). The connection is constructed lazily-connected (it connects on
 * first engine use, §3.5); the composition root may also `ensureConnected()` it on boot so
 * reconciliation runs before the first user turn.
 *
 * `onReconcile` is the manager's `reconcileLiveSessions`-driven hook (Lane D); it fires on every
 * (re)connect AND on a `bootId` change (§5.6). `logger` is the {method,id,sessionKey,bytes}-only
 * debug logger (§6.4) — it MUST NOT log frame bodies.
 */
export function createRpcEngineFactory(opts: {
  readonly socketPath: string;
  readonly rpcSecret: string;
  readonly onReconcile?: (driver: RpcReconcileDriver) => Promise<void>;
  readonly logger?: RpcClientLogger;
}): RpcEngineFactory {
  const connection = new RpcConnection({
    socketPath: opts.socketPath,
    rpcSecret: opts.rpcSecret,
    onReconcile: opts.onReconcile,
    logger: opts.logger
  });
  const factory: ChatEngineFactory = (provider, sessionKey) =>
    new ChatEngineRpcClient(provider, sessionKey, connection);
  return { factory, connection };
}

/**
 * Boot-time fork (§3.5): when `JARVIS_CLI_RUNNER_SOCKET` is set the api drives the cli-runner sidecar
 * over the socket (RPC client); otherwise it constructs the in-process `CliChatEngineImpl` exactly as
 * today (host-dev / native-install path, reading `JARVIS_CLI_HOME_BASE`). Lane C sets the socket env
 * only in the compose path. Returns the factory, plus the `RpcConnection` when the RPC path is taken
 * (so the composition root can wire reconciliation + tear it down on shutdown).
 */
export function selectEngineFactory(
  opts: {
    readonly mux?: Multiplexer;
    readonly onReconcile?: (driver: RpcReconcileDriver) => Promise<void>;
    readonly logger?: RpcClientLogger;
    readonly env?: NodeJS.ProcessEnv;
  } = {}
): { factory: ChatEngineFactory; connection?: RpcConnection } {
  const env = opts.env ?? process.env;
  const socketPath = env.JARVIS_CLI_RUNNER_SOCKET;
  if (socketPath) {
    const { factory, connection } = createRpcEngineFactory({
      socketPath,
      rpcSecret: env.JARVIS_CLI_RUNNER_RPC_SECRET ?? "",
      onReconcile: opts.onReconcile,
      logger: opts.logger
    });
    return { factory, connection };
  }
  return { factory: createRealEngineFactory({ mux: opts.mux }) };
}

/** A factory that refuses to launch: used when the host has no multiplexer installed. */
export function unavailableEngineFactory(reason: string): ChatEngineFactory {
  return () => {
    throw new CliChatUnavailableError(reason);
  };
}

/** Back-compat default: tmux over a fresh io (unchanged behavior). */
export const realEngineFactory: ChatEngineFactory = createRealEngineFactory();

export interface CreateChatSessionRuntimeDeps {
  readonly dataContext: DataContextRunner;
  /** Override the engine factory (tests inject a fake); defaults to the real tmux engine. */
  readonly engineFactory?: ChatEngineFactory;
  /** Override the idle reap window (ms); defaults to 30 minutes. */
  readonly idleMs?: number;
  /** pg-boss instance for enqueueing embed/extract-facts jobs after each turn. */
  readonly boss?: PgBoss;
  /** Phase 3: optional recall service — injects <memory> seed at session launch. */
  readonly recall?: RecallPort;
  readonly personaPreferences?: PersonaPreferencesPort;
  /** Phase 2: MCP token lifecycle hooks — mint on engine launch, revoke on reap. */
  readonly mcpTokenLifecycle?: {
    readonly mint: (
      actorUserId: string,
      chatSessionId: string
    ) => Promise<{ token: string; mcpServerUrl: string }>;
    readonly revoke: (chatSessionId: string) => void;
    /** Refresh a session token's TTL on activity (defaults to no-op if omitted). */
    readonly touch?: (chatSessionId: string) => void;
  };
}

export interface ChatSessionRuntime {
  readonly manager: ChatSessionManager;
  /** Resolve the acting user's display name for persona rendering. */
  resolveUserName(actorUserId: string): Promise<string>;
}

/**
 * Build the live-chat runtime (manager + a userName resolver) from foundation deps.
 */
export function createChatSessionRuntime(deps: CreateChatSessionRuntimeDeps): ChatSessionRuntime {
  const persistence = new DataContextChatPersistence({
    dataContext: deps.dataContext,
    chatRepository: new ChatRepository(),
    aiRepository: new AiRepository(),
    boss: deps.boss
  });

  const manager = new ChatSessionManager({
    engineFactory: deps.engineFactory ?? realEngineFactory,
    persistence,
    personaFs: createRealPersonaFs(),
    clock: { now: () => Date.now() },
    idleMs: deps.idleMs ?? DEFAULT_IDLE_MS,
    neutralBase: resolveChatHome(),
    persona: (actorUserId, userName) => resolveChatPersona(deps, actorUserId, userName),
    mintMcpToken: deps.mcpTokenLifecycle?.mint,
    revokeMcpToken: deps.mcpTokenLifecycle?.revoke,
    touchMcpToken: deps.mcpTokenLifecycle?.touch,
    recall: deps.recall
  });

  return {
    manager,
    resolveUserName: (actorUserId) => persistence.resolveUserName(actorUserId)
  };
}

async function resolveChatPersona(
  deps: CreateChatSessionRuntimeDeps,
  actorUserId: string,
  userName: string
): Promise<string> {
  const stored = deps.personaPreferences
    ? await deps.dataContext.withDataContext(
        { actorUserId, requestId: "chat-live:resolve-persona" },
        (scopedDb) => deps.personaPreferences!.get(scopedDb, "persona.bundle")
      )
    : null;
  const persona = normalizePersonaSettings(stored);
  const personaBlock = renderPersonaText({
    assistantName: persona.assistantName,
    personaText: persona.personaText,
    userName
  });
  return [DEFAULT_JARVIS_PERSONA, personaBlock].filter(Boolean).join("\n\n");
}
