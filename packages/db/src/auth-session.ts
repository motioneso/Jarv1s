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
    const session = await this.db
      .selectFrom("app.auth_sessions as sessions")
      .select(["sessions.user_id as actorUserId"])
      .where("sessions.id", "=", sessionId)
      .where("sessions.expires_at", ">", sql<Date>`now()`)
      .executeTakeFirst();

    if (!session) {
      throw new Error("Session is missing or expired");
    }

    return {
      actorUserId: session.actorUserId,
      requestId
    };
  }
}
