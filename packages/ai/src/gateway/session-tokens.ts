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

/**
 * In-memory registry of per-session tokens. Identity NEVER comes from the agent's
 * input — only from a token the API minted at engine launch and revokes at reap.
 */
export class SessionTokenRegistry {
  private readonly tokens = new Map<string, SessionIdentity>();

  mint(identity: SessionIdentity): string {
    const token = `jst_${randomUUID()}`;
    this.tokens.set(token, identity);
    return token;
  }

  verify(token: string): SessionIdentity {
    const identity = this.tokens.get(token);
    if (!identity) {
      throw new InvalidSessionTokenError();
    }
    return identity;
  }

  revoke(token: string): void {
    this.tokens.delete(token);
  }

  revokeBySessionId(chatSessionId: string): void {
    for (const [token, identity] of this.tokens) {
      if (identity.chatSessionId === chatSessionId) {
        this.tokens.delete(token);
      }
    }
  }
}
