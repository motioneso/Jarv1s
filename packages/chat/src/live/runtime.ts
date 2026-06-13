/**
 * Live-chat runtime wiring: construct a ChatSessionManager backed by the REAL
 * adapters (tmux CLI engine, DataContext persistence, on-disk persona renderer,
 * wall clock) from the foundation deps the API server already threads.
 *
 * The engineFactory is injectable so integration tests can swap in an in-memory
 * fake engine (no real tmux / `claude` binary). Everything else is real.
 */
import { homedir } from "node:os";
import { join } from "node:path";

import { AiRepository, createRealTmuxIo, type Multiplexer, type ProviderKind } from "@jarv1s/ai";
import type { DataContextRunner } from "@jarv1s/db";
import type { PgBoss } from "pg-boss";

import type { RecallPort } from "../recall-port.js";

import { CliChatEngineImpl } from "./cli-chat-engine.js";
import { CliChatUnavailableError } from "./errors.js";
export { CliChatUnavailableError } from "./errors.js";
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

/**
 * Builds the production engine factory. The multiplexer is resolved ONCE at the
 * composition root (module-registry) and injected here, so every session shares
 * one stateless backend. With no mux it defaults to tmux (preserves legacy
 * single-host behavior for tests and standalone embedders).
 */
export function createRealEngineFactory(opts: { mux?: Multiplexer } = {}): ChatEngineFactory {
  return (provider, sessionKey) =>
    new CliChatEngineImpl(provider, sessionKey, createRealTmuxIo(), { mux: opts.mux });
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
  /** Phase 2: MCP token lifecycle hooks — mint on engine launch, revoke on reap. */
  readonly mcpTokenLifecycle?: {
    readonly mint: (
      actorUserId: string,
      chatSessionId: string
    ) => { token: string; mcpServerUrl: string };
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
    neutralBase: resolveNeutralBase(),
    persona: DEFAULT_JARVIS_PERSONA,
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

/** Base dir for per-user neutral chat dirs (mirrors renderPersona's own default). */
function resolveNeutralBase(): string {
  return process.env.JARVIS_CHAT_HOME ?? join(homedir(), ".jarvis", "chat");
}
