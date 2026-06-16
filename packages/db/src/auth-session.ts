import { randomUUID } from "node:crypto";

import { sql, type Kysely } from "kysely";

import { isUuid, type AccessContext } from "./data-context.js";
import type { JarvisDatabase } from "./types.js";

export class AuthSessionResolver {
  constructor(private readonly db: Kysely<JarvisDatabase>) {}

  async resolveAccessContext(
    sessionId: string,
    requestId: string = randomUUID()
  ): Promise<AccessContext> {
    // A bearer token that is not a well-formed UUID can never match a session row. Guard here
    // so a malformed token returns the same clean "missing/expired" rejection (→ 401) instead of
    // a raw Postgres 22P02 invalid_text_representation error surfacing from the `::uuid` cast below.
    if (!isUuid(sessionId)) {
      throw new Error("Session is missing or expired");
    }

    // Uses a SECURITY DEFINER function owned by jarvis_auth_runtime (migration 0046)
    // so jarvis_app_runtime never holds direct SELECT on auth_sessions.
    const result = await sql<{ user_id: string }>`
      SELECT user_id FROM app.resolve_auth_session(${sessionId}::uuid)
    `.execute(this.db);

    const session = result.rows[0];

    if (!session) {
      throw new Error("Session is missing or expired");
    }

    return {
      actorUserId: session.user_id,
      requestId
    };
  }
}
