import { randomUUID } from "node:crypto";

import { sql, type Kysely } from "kysely";

import type { AccessContext } from "./data-context.js";
import type { JarvisDatabase } from "./types.js";

export class AuthSessionResolver {
  constructor(private readonly db: Kysely<JarvisDatabase>) {}

  async resolveAccessContext(
    sessionId: string,
    requestId: string = randomUUID()
  ): Promise<AccessContext> {
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
