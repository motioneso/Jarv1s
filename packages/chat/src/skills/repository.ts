import { sql } from "kysely";

import {
  assertDataContextDb,
  type ChatSkill,
  type ChatSkillSource,
  type DataContextDb
} from "@jarv1s/db";

export interface CreateSkillInput {
  readonly name: string;
  readonly description?: string | null;
  readonly frontmatter?: Record<string, unknown>;
  readonly body: string;
  readonly source: ChatSkillSource;
}

function jsonb(value: unknown) {
  return sql<Record<string, unknown>>`${JSON.stringify(value)}::jsonb`;
}

export interface UpdateSkillInput {
  readonly name?: string;
  readonly description?: string | null;
  readonly frontmatter?: Record<string, unknown>;
  readonly body?: string;
}

export class ChatSkillsRepository {
  async create(scopedDb: DataContextDb, input: CreateSkillInput): Promise<ChatSkill> {
    assertDataContextDb(scopedDb);
    const row = await scopedDb.db
      .insertInto("app.chat_skills")
      .values({
        owner_user_id: sql<string>`app.current_actor_user_id()`,
        name: input.name,
        description: input.description ?? null,
        frontmatter: jsonb(input.frontmatter ?? {}),
        body: input.body,
        source: input.source
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    return row as ChatSkill;
  }

  // Deterministic ordering (enabled first, then most-recently-updated) backs the
  // typed bare-name-fallback resolution the spec requires when multiple skills share a name.
  async list(scopedDb: DataContextDb): Promise<ChatSkill[]> {
    assertDataContextDb(scopedDb);
    const rows = await scopedDb.db
      .selectFrom("app.chat_skills")
      .selectAll()
      .orderBy("enabled", "desc")
      .orderBy("updated_at", "desc")
      .execute();
    return rows as ChatSkill[];
  }

  async get(scopedDb: DataContextDb, id: string): Promise<ChatSkill | undefined> {
    assertDataContextDb(scopedDb);
    const row = await scopedDb.db
      .selectFrom("app.chat_skills")
      .selectAll()
      .where("id", "=", id)
      .executeTakeFirst();
    return row as ChatSkill | undefined;
  }

  async update(
    scopedDb: DataContextDb,
    id: string,
    input: UpdateSkillInput
  ): Promise<ChatSkill | undefined> {
    assertDataContextDb(scopedDb);
    const updates: Record<string, unknown> = { updated_at: new Date() };
    if (input.name !== undefined) updates["name"] = input.name;
    if (input.description !== undefined) updates["description"] = input.description;
    if (input.frontmatter !== undefined) updates["frontmatter"] = jsonb(input.frontmatter);
    if (input.body !== undefined) updates["body"] = input.body;
    const row = await scopedDb.db
      .updateTable("app.chat_skills")
      .set(updates)
      .where("id", "=", id)
      .returningAll()
      .executeTakeFirst();
    return row as ChatSkill | undefined;
  }

  async setEnabled(
    scopedDb: DataContextDb,
    id: string,
    enabled: boolean
  ): Promise<ChatSkill | undefined> {
    assertDataContextDb(scopedDb);
    const row = await scopedDb.db
      .updateTable("app.chat_skills")
      .set({ enabled, updated_at: new Date() })
      .where("id", "=", id)
      .returningAll()
      .executeTakeFirst();
    return row as ChatSkill | undefined;
  }

  async delete(scopedDb: DataContextDb, id: string): Promise<boolean> {
    assertDataContextDb(scopedDb);
    const result = await scopedDb.db
      .deleteFrom("app.chat_skills")
      .where("id", "=", id)
      .executeTakeFirst();
    return (result.numDeletedRows ?? 0n) > 0n;
  }
}
