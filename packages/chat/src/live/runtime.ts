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

import {
  AiRepository,
  createRealTmuxIo,
  type ProviderKind
} from "@jarv1s/ai";
import type { DataContextRunner } from "@jarv1s/db";

import { TmuxCliChatEngine } from "./cli-chat-engine.js";
import { ChatSessionManager } from "./chat-session-manager.js";
import { createRealPersonaFs } from "./persona.js";
import { DataContextChatPersistence } from "./persistence.js";
import type { CliChatEngine } from "./types.js";
import { ChatRepository } from "../repository.js";

/** Default idle reap window: 30 minutes of no activity kills the live engine. */
const DEFAULT_IDLE_MS = 30 * 60 * 1000;

/** The default Jarvis persona injected into every live session's context file. */
export const DEFAULT_JARVIS_PERSONA = [
  "You are Jarvis, {{userName}}'s personal assistant.",
  "Be concise, direct, and helpful. Speak in the first person.",
  "You do not have access to {{userName}}'s files or tools in this conversation —",
  "answer from the conversation itself and your own knowledge."
].join("\n");

export type ChatEngineFactory = (provider: ProviderKind, sessionKey: string) => CliChatEngine;

/** The real engine factory: a persistent tmux-driven CLI session per live session. */
export const realEngineFactory: ChatEngineFactory = (provider, sessionKey) =>
  new TmuxCliChatEngine(provider, sessionKey, createRealTmuxIo());

export interface CreateChatSessionRuntimeDeps {
  readonly dataContext: DataContextRunner;
  /** Override the engine factory (tests inject a fake); defaults to the real tmux engine. */
  readonly engineFactory?: ChatEngineFactory;
  /** Override the idle reap window (ms); defaults to 30 minutes. */
  readonly idleMs?: number;
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
    aiRepository: new AiRepository()
  });

  const manager = new ChatSessionManager({
    engineFactory: deps.engineFactory ?? realEngineFactory,
    persistence,
    personaFs: createRealPersonaFs(),
    clock: { now: () => Date.now() },
    idleMs: deps.idleMs ?? DEFAULT_IDLE_MS,
    neutralBase: resolveNeutralBase(),
    persona: DEFAULT_JARVIS_PERSONA
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
