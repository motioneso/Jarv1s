import { randomUUID } from "node:crypto";

import { sql, type Updateable } from "kysely";

import {
  assertDataContextDb,
  type DataContextDb,
  type Note,
  type NotesTable,
  type NoteVisibility
} from "@jarv1s/db";

export interface CreateNoteInput {
  readonly title: string;
  readonly body?: string | null;
  readonly visibility?: NoteVisibility;
  readonly workspaceId?: string | null;
}

export interface UpdateNoteInput {
  readonly title?: string;
  readonly body?: string | null;
  readonly visibility?: NoteVisibility;
  readonly workspaceId?: string | null;
  readonly archived?: boolean;
}

export class NotesRepository {
  async listVisible(scopedDb: DataContextDb): Promise<Note[]> {
    assertDataContextDb(scopedDb);

    return scopedDb.db
      .selectFrom("app.notes")
      .selectAll()
      .orderBy("updated_at", "desc")
      .orderBy("id")
      .execute();
  }

  async getById(scopedDb: DataContextDb, noteId: string): Promise<Note | undefined> {
    assertDataContextDb(scopedDb);

    return scopedDb.db
      .selectFrom("app.notes")
      .selectAll()
      .where("id", "=", noteId)
      .executeTakeFirst();
  }

  async create(scopedDb: DataContextDb, input: CreateNoteInput): Promise<Note> {
    assertDataContextDb(scopedDb);

    const now = new Date();

    return scopedDb.db
      .insertInto("app.notes")
      .values({
        id: randomUUID(),
        owner_user_id: sql<string>`app.current_actor_user_id()`,
        workspace_id: input.workspaceId ?? null,
        visibility: input.visibility ?? "private",
        title: input.title,
        body: input.body ?? null,
        archived_at: null,
        created_at: now,
        updated_at: now
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async update(
    scopedDb: DataContextDb,
    noteId: string,
    input: UpdateNoteInput
  ): Promise<Note | undefined> {
    assertDataContextDb(scopedDb);

    const updates: Updateable<NotesTable> = {
      updated_at: new Date()
    };

    if (input.title !== undefined) {
      updates.title = input.title;
    }
    if (input.body !== undefined) {
      updates.body = input.body;
    }
    if (input.visibility !== undefined) {
      updates.visibility = input.visibility;
    }
    if (input.workspaceId !== undefined) {
      updates.workspace_id = input.workspaceId;
    }
    if (input.archived !== undefined) {
      updates.archived_at = input.archived ? new Date() : null;
    }

    return scopedDb.db
      .updateTable("app.notes")
      .set(updates)
      .where("id", "=", noteId)
      .returningAll()
      .executeTakeFirst();
  }
}
