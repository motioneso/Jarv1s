import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Kysely } from "kysely";
import pg from "pg";

import { createApiServer } from "../../apps/api/src/server.js";
import {
  AuthSessionResolver,
  DataContextRunner,
  createDatabase,
  type AccessContext,
  type JarvisDatabase
} from "@jarv1s/db";
import {
  getBuiltInModuleManifests,
  getBuiltInModuleRegistrations,
  getBuiltInSqlMigrationDirectories
} from "@jarv1s/module-registry";
import { NotesRepository, notesModuleManifest } from "@jarv1s/notes";
import { connectionStrings, ids, resetFoundationDatabase } from "./test-database.js";

const { Client } = pg;

const noteIds = {
  aPrivate: "50000000-0000-4000-8000-000000000001",
  bPrivate: "50000000-0000-4000-8000-000000000002",
  bGrantedToA: "50000000-0000-4000-8000-000000000003",
  bWorkspaceShared: "50000000-0000-4000-8000-000000000004"
} as const;

describe("Notes module M5", () => {
  let appDb: Kysely<JarvisDatabase>;
  let auth: AuthSessionResolver;
  let dataContext: DataContextRunner;
  let repository: NotesRepository;
  let server: ReturnType<typeof createApiServer>;

  beforeAll(async () => {
    await resetFoundationDatabase();
    await seedNoteData();

    appDb = createDatabase({
      connectionString: connectionStrings.app,
      maxConnections: 1
    });
    auth = new AuthSessionResolver(appDb);
    dataContext = new DataContextRunner(appDb);
    repository = new NotesRepository();
    server = createApiServer({
      appDb,
      logger: false
    });
    await server.ready();
  });

  afterAll(async () => {
    await Promise.allSettled([server?.close(), appDb?.destroy()]);
  });

  it("applies Notes migrations with forced RLS and no worker table grant", async () => {
    const client = new Client({ connectionString: connectionStrings.migration });

    await client.connect();
    try {
      const migrations = await client.query<{ version: string; name: string }>(
        `
          SELECT version, name
          FROM app.schema_migrations
          WHERE version IN ('0006', '0007')
          ORDER BY version
        `
      );
      const tables = await client.query<{
        relname: string;
        relrowsecurity: boolean;
        relforcerowsecurity: boolean;
        owner: string;
        worker_can_select: boolean;
      }>(
        `
          SELECT
            c.relname,
            c.relrowsecurity,
            c.relforcerowsecurity,
            pg_get_userbyid(c.relowner) AS owner,
            has_table_privilege('jarvis_worker_runtime', c.oid, 'SELECT') AS worker_can_select
          FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'app'
            AND c.relname = 'notes'
        `
      );

      expect(migrations.rows).toEqual([
        { version: "0006", name: "0006_notes_module.sql" },
        { version: "0007", name: "0007_tighten_workspace_update_rls.sql" }
      ]);
      expect(tables.rows).toEqual([
        {
          relname: "notes",
          relrowsecurity: true,
          relforcerowsecurity: true,
          owner: "jarvis_migration_owner",
          worker_can_select: false
        }
      ]);
    } finally {
      await client.end();
    }
  });

  it("loads the built-in Notes module manifest", () => {
    const manifests = getBuiltInModuleManifests();
    const registrations = getBuiltInModuleRegistrations();
    const manifest = manifests.find((item) => item.id === notesModuleManifest.id);

    expect(manifests.map((item) => item.id)).toEqual([
      "settings",
      "connectors",
      "tasks",
      "notes",
      "notifications",
      "calendar",
      "email",
      "ai",
      "chat",
      "briefings"
    ]);
    expect(registrations.map((registration) => registration.manifest.id)).toEqual([
      "settings",
      "connectors",
      "tasks",
      "notes",
      "notifications",
      "calendar",
      "email",
      "ai",
      "chat",
      "briefings"
    ]);
    expect(manifest?.database?.ownedTables).toEqual(["app.notes"]);
    expect(manifest?.navigation?.[0]).toMatchObject({
      id: "notes",
      path: "/notes",
      permissionId: "notes.view"
    });
    expect(manifest?.shareableResources?.[0]).toEqual({
      resourceType: "note",
      grantLevels: ["view", "contribute", "manage"]
    });
    expect(getBuiltInSqlMigrationDirectories()).toContainEqual(
      expect.stringContaining("packages/notes/sql")
    );
  });

  it("denies note reads when no data context is set", async () => {
    await expect(appDb.selectFrom("app.notes").select("id").execute()).resolves.toEqual([]);
  });

  it("lets a user create and read their own private note", async () => {
    const created = await dataContext.withDataContext(userAContext(), (scopedDb) =>
      repository.create(scopedDb, {
        title: "User A private note",
        body: "private note body"
      })
    );
    const fetched = await dataContext.withDataContext(userAContext(), (scopedDb) =>
      repository.getById(scopedDb, created.id)
    );

    expect(created.owner_user_id).toBe(ids.userA);
    expect(created.visibility).toBe("private");
    expect(fetched?.id).toBe(created.id);
  });

  it("does not let another user or admin role read private notes", async () => {
    const userRead = await dataContext.withDataContext(userAContext(), (scopedDb) =>
      repository.getById(scopedDb, noteIds.bPrivate)
    );
    const adminContext = await auth.resolveAccessContext(ids.sessionAdmin, "request:admin-notes");
    const adminRead = await dataContext.withDataContext(adminContext, (scopedDb) =>
      repository.getById(scopedDb, noteIds.bPrivate)
    );

    expect(userRead).toBeUndefined();
    expect(adminRead).toBeUndefined();
  });

  it("allows note access through explicit grants and active workspace context", async () => {
    const granted = await dataContext.withDataContext(userAContext(), (scopedDb) =>
      repository.getById(scopedDb, noteIds.bGrantedToA)
    );
    const withoutWorkspace = await dataContext.withDataContext(userAContext(), (scopedDb) =>
      repository.getById(scopedDb, noteIds.bWorkspaceShared)
    );
    const withWorkspace = await dataContext.withDataContext(
      userAContext(ids.workspaceAlpha),
      (scopedDb) => repository.getById(scopedDb, noteIds.bWorkspaceShared)
    );

    expect(granted?.id).toBe(noteIds.bGrantedToA);
    expect(withoutWorkspace).toBeUndefined();
    expect(withWorkspace?.id).toBe(noteIds.bWorkspaceShared);
  });

  it("serves Notes API create, list, read, update, and archive from session context", async () => {
    const createResponse = await server.inject({
      method: "POST",
      url: "/api/notes",
      headers: {
        authorization: `Bearer ${ids.sessionA}`
      },
      payload: {
        title: "API-created note",
        body: "Visible only to the creating actor",
        ownerUserId: ids.userB,
        owner_user_id: ids.userB
      }
    });
    const created = createResponse.json<{
      note: { id: string; ownerUserId: string; title: string; archivedAt: string | null };
    }>().note;
    const listResponse = await server.inject({
      method: "GET",
      url: "/api/notes",
      headers: {
        authorization: `Bearer ${ids.sessionA}`
      }
    });
    const getResponse = await server.inject({
      method: "GET",
      url: `/api/notes/${created.id}`,
      headers: {
        authorization: `Bearer ${ids.sessionA}`
      }
    });
    const updateResponse = await server.inject({
      method: "PATCH",
      url: `/api/notes/${created.id}`,
      headers: {
        authorization: `Bearer ${ids.sessionA}`
      },
      payload: {
        title: "API-updated note",
        body: "Updated body"
      }
    });
    const archiveResponse = await server.inject({
      method: "PATCH",
      url: `/api/notes/${created.id}`,
      headers: {
        authorization: `Bearer ${ids.sessionA}`
      },
      payload: {
        archived: true
      }
    });
    const getAsOtherUserResponse = await server.inject({
      method: "GET",
      url: `/api/notes/${created.id}`,
      headers: {
        authorization: `Bearer ${ids.sessionB}`
      }
    });

    expect(createResponse.statusCode).toBe(201);
    expect(created.ownerUserId).toBe(ids.userA);
    expect(
      listResponse
        .json<{ notes: Array<{ id: string }> }>()
        .notes.some((note) => note.id === created.id)
    ).toBe(true);
    expect(getResponse.statusCode).toBe(200);
    expect(
      updateResponse.json<{ note: { title: string; body: string | null } }>().note
    ).toMatchObject({
      title: "API-updated note",
      body: "Updated body"
    });
    expect(
      archiveResponse.json<{ note: { archivedAt: string | null } }>().note.archivedAt
    ).not.toBeNull();
    expect(getAsOtherUserResponse.statusCode).toBe(404);
  });

  it("requires active workspace context when updating a note to workspace visibility", async () => {
    const createResponse = await server.inject({
      method: "POST",
      url: "/api/notes",
      headers: {
        authorization: `Bearer ${ids.sessionA}`
      },
      payload: {
        title: "Workspace update guard note"
      }
    });
    const noteId = createResponse.json<{ note: { id: string } }>().note.id;
    const missingWorkspaceContextResponse = await server.inject({
      method: "PATCH",
      url: `/api/notes/${noteId}`,
      headers: {
        authorization: `Bearer ${ids.sessionA}`
      },
      payload: {
        visibility: "workspace",
        workspaceId: ids.workspaceAlpha
      }
    });
    const activeWorkspaceResponse = await server.inject({
      method: "PATCH",
      url: `/api/notes/${noteId}`,
      headers: {
        authorization: `Bearer ${ids.sessionA}`,
        "x-jarvis-workspace-id": ids.workspaceAlpha
      },
      payload: {
        visibility: "workspace",
        workspaceId: ids.workspaceAlpha
      }
    });

    expect(createResponse.statusCode).toBe(201);
    expect(missingWorkspaceContextResponse.statusCode).toBe(400);
    expect(activeWorkspaceResponse.statusCode).toBe(200);
    expect(
      activeWorkspaceResponse.json<{ note: { visibility: string; workspaceId: string | null } }>()
        .note
    ).toMatchObject({
      visibility: "workspace",
      workspaceId: ids.workspaceAlpha
    });
  });

  it("fails loudly when the Notes repository is called without withDataContext", async () => {
    await expect(repository.listVisible({} as never)).rejects.toThrow(
      "Repository access requires withDataContext"
    );
  });
});

async function seedNoteData(): Promise<void> {
  const client = new Client({ connectionString: connectionStrings.bootstrap });

  await client.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `
        INSERT INTO app.notes (id, owner_user_id, workspace_id, visibility, title, body)
        VALUES
          ($1, $2, null, 'private', 'User A seeded private note', 'A private body'),
          ($3, $4, null, 'private', 'User B seeded private note', 'B private body'),
          ($5, $4, null, 'private', 'User B granted note', 'B granted body'),
          ($6, $4, $7, 'workspace', 'User B workspace note', 'B workspace body')
      `,
      [
        noteIds.aPrivate,
        ids.userA,
        noteIds.bPrivate,
        ids.userB,
        noteIds.bGrantedToA,
        noteIds.bWorkspaceShared,
        ids.workspaceAlpha
      ]
    );
    await client.query(
      `
        INSERT INTO app.resource_grants (resource_type, resource_id, grantee_user_id, grant_level)
        VALUES ('note', $1, $2, 'view')
      `,
      [noteIds.bGrantedToA, ids.userA]
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    await client.end();
  }
}

function userAContext(workspaceId?: string): AccessContext {
  return {
    actorUserId: ids.userA,
    workspaceId,
    requestId: "request:user-a-notes"
  };
}
