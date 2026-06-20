import { randomUUID } from "node:crypto";

export interface SessionIdentity {
  readonly actorUserId: string;
  readonly chatSessionId: string;
  /**
   * When non-null, only tools whose names appear in this set may be called
   * via this session token.  null = unrestricted (REST and non-MCP paths).
   */
  readonly allowedToolNames: Set<string> | null;
}

export class InvalidSessionTokenError extends Error {
  constructor() {
    super("Invalid or revoked session token");
    this.name = "InvalidSessionTokenError";
  }
}

/** Wall clock, injected so token expiry is deterministically testable. */
export interface SessionTokenClock {
  now(): number;
}

/**
 * TTL backstop for minted tokens. The primary lifecycle is explicit:
 * {@link SessionTokenRegistry.revoke}/{@link SessionTokenRegistry.revokeBySessionId}
 * fire when the chat engine stops or is idle-reaped. This TTL only catches tokens
 * whose owning engine was orphaned (crash, missed revoke) — without it such a token
 * (and its memory) would live forever. Set generously beyond the idle-reap window
 * (30 min) so it never preempts a live session; the manager refreshes it on every
 * activity (see touchBySessionId), so a live token never expires out from under a
 * session regardless of how this is tuned.
 */
const DEFAULT_TOKEN_TTL_MS = 60 * 60 * 1000;

interface TokenEntry {
  readonly identity: SessionIdentity;
  expiresAt: number;
}

export interface SessionTokenRegistryOptions {
  readonly clock?: SessionTokenClock;
  /** Override the TTL backstop (ms); defaults to 60 minutes. */
  readonly ttlMs?: number;
}

/**
 * In-memory registry of per-session tokens. Identity NEVER comes from the agent's
 * input — only from a token the API minted at engine launch and revokes at reap.
 * Entries also carry a TTL backstop so an orphaned engine cannot leave a token
 * (or its memory) alive forever.
 */
export class SessionTokenRegistry {
  private readonly tokens = new Map<string, TokenEntry>();
  private readonly clock: SessionTokenClock;
  private readonly ttlMs: number;

  constructor(options: SessionTokenRegistryOptions = {}) {
    this.clock = options.clock ?? { now: () => Date.now() };
    this.ttlMs = options.ttlMs ?? DEFAULT_TOKEN_TTL_MS;
  }

  mint(identity: SessionIdentity): string {
    // Opportunistically purge anything already expired (one token per user → cheap).
    this.sweepExpired();
    const token = `jst_${randomUUID()}`;
    this.tokens.set(token, { identity, expiresAt: this.clock.now() + this.ttlMs });
    return token;
  }

  verify(token: string): SessionIdentity {
    const entry = this.tokens.get(token);
    if (!entry) {
      throw new InvalidSessionTokenError();
    }
    if (this.clock.now() >= entry.expiresAt) {
      this.tokens.delete(token);
      throw new InvalidSessionTokenError();
    }
    // Sliding refresh: an in-use token (e.g. a long turn making many tool calls)
    // never expires mid-flight.
    entry.expiresAt = this.clock.now() + this.ttlMs;
    return entry.identity;
  }

  /**
   * Refresh the TTL for every token of a session. Wired to the chat manager's
   * activity signal (the same one that gates idle reaping) so token liveness
   * tracks session liveness — a session active in chat but not yet calling tools
   * keeps a valid token.
   */
  touchBySessionId(chatSessionId: string): void {
    const expiresAt = this.clock.now() + this.ttlMs;
    for (const entry of this.tokens.values()) {
      if (entry.identity.chatSessionId === chatSessionId) {
        entry.expiresAt = expiresAt;
      }
    }
  }

  revoke(token: string): void {
    this.tokens.delete(token);
  }

  revokeBySessionId(chatSessionId: string): void {
    for (const [token, entry] of this.tokens) {
      if (entry.identity.chatSessionId === chatSessionId) {
        this.tokens.delete(token);
      }
    }
  }

  /**
   * Every distinct chatSessionId the registry currently holds a (live) token for.
   *
   * This is the SOURCE for orphan-token reconciliation (#342, RPC contract §5.3 step 2):
   * after an api restart the {@link ChatSessionManager} `sessions` Map is empty, so the
   * token registry — not the Map — is what tells us which sessions still have tokens to
   * sweep. Expired entries are purged first so the result reflects only live tokens. One
   * token per session today, but de-duplicated defensively in case that ever changes.
   */
  listSessionIds(): string[] {
    this.sweepExpired();
    const ids = new Set<string>();
    for (const entry of this.tokens.values()) {
      ids.add(entry.identity.chatSessionId);
    }
    return [...ids];
  }

  /**
   * Revoke every token whose chatSessionId is NOT in `liveSessionIds` (#342, §5.3 step 2).
   *
   * Driven by the api's ONE reconciliation routine on every socket (re)connect and on a
   * detected cli-runner `bootId` change: `liveSessionIds` is the authoritative set of
   * sessionKeys the cli-runner reports alive (via `listLiveSessions`, enumerated by mux —
   * §4.6), unioned by the caller with any in-flight launches. A token for a session the
   * cli-runner no longer has (e.g. after a cli-runner crash) is an orphan and is revoked
   * here, even when the manager's `sessions` Map is empty (an api restart). Idempotent.
   */
  reconcile(liveSessionIds: Set<string>): void {
    for (const [token, entry] of this.tokens) {
      if (!liveSessionIds.has(entry.identity.chatSessionId)) {
        this.tokens.delete(token);
      }
    }
  }

  private sweepExpired(): void {
    const now = this.clock.now();
    for (const [token, entry] of this.tokens) {
      if (now >= entry.expiresAt) {
        this.tokens.delete(token);
      }
    }
  }
}
