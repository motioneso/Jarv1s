import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { Job } from "pg-boss";
import type { Kysely } from "kysely";
import type { PgBoss } from "pg-boss";
import pg from "pg";
import Fastify from "fastify";

import { createApiServer } from "../../apps/api/src/server.js";
import { DataContextRunner, createDatabase, type JarvisDatabase } from "@jarv1s/db";
import type { GetNotesSourceResponse, PostNotesSyncResponse } from "@jarv1s/shared";
import { StubEmbeddingProvider } from "@jarv1s/memory";
import { NOTES_SOURCE_PREFERENCE_KEY, resolveNotesRoots } from "@jarv1s/settings";
import { PreferencesRepository } from "@jarv1s/structured-state";
import {
  assertWithinRoot,
  NotesPathError,
  handleNotesSyncJob,
  registerNotesSyncRoutes,
  NOTES_SYNC_QUEUE,
  type NotesSyncJobPayload
} from "@jarv1s/notes";
import {
  connectionStrings,
  resetEmptyFoundationDatabase,
  setInstanceSetting
} from "./test-database.js";

const { Client } = pg;

// ── path-guard ────────────────────────────────────────────────────────────────

describe("assertWithinRoot", () => {
  it("passes when path equals the root", () => {
    expect(() => assertWithinRoot("/notes", "/notes")).not.toThrow();
  });

  it("passes when path is directly inside the root", () => {
    expect(() => assertWithinRoot("/notes", "/notes/daily.md")).not.toThrow();
  });

  it("passes when path is deeply nested inside the root", () => {
    expect(() => assertWithinRoot("/notes", "/notes/2026/June/01.md")).not.toThrow();
  });

  it("throws NotesPathError for path outside root", () => {
    expect(() => assertWithinRoot("/notes", "/etc/passwd")).toThrowError(NotesPathError);
  });

  it("rejects partial prefix overlap (no slash suffix)", () => {
    expect(() => assertWithinRoot("/notes", "/notes-evil/file.md")).toThrowError(NotesPathError);
  });

  it("rejects path traversal attempt", () => {
    expect(() => assertWithinRoot("/notes", "/notes/../etc/passwd")).toThrowError(NotesPathError);
  });
});

// ── resolveNotesRoots ─────────────────────────────────────────────────────────

describe("resolveNotesRoots", () => {
  it("returns empty array when env var is absent", () => {
    const roots = resolveNotesRoots({});
    expect(roots).toEqual([]);
  });

  it("parses comma-separated roots", () => {
    const roots = resolveNotesRoots({ JARVIS_NOTES_ROOTS: "/a, /b , /c" });
    expect(roots).toEqual(["/a", "/b", "/c"]);
  });

  it("filters empty segments", () => {
    const roots = resolveNotesRoots({ JARVIS_NOTES_ROOTS: ",," });
    expect(roots).toEqual([]);
  });
});

// ── shared API server setup ───────────────────────────────────────────────────

let appDb: Kysely<JarvisDatabase>;
let ownerCookie: string;
let notesDir: string;

async function signUp(
  srv: ReturnType<typeof createApiServer>,
  name: string,
  email: string
): Promise<string> {
  const res = await srv.inject({
    method: "POST",
    url: "/api/auth/sign-up/email",
    headers: { "content-type": "application/json" },
    payload: { name, email, password: "correct horse battery staple" }
  });
  expect(res.statusCode).toBe(200);
  const cookies: string[] = Array.isArray(res.headers["set-cookie"])
    ? res.headers["set-cookie"]
    : [String(res.headers["set-cookie"] ?? "")];
  return cookies.map((c) => c.split(";", 1)[0]).join("; ");
}

beforeAll(async () => {
  await resetEmptyFoundationDatabase();
  notesDir = join(tmpdir(), `jarv1s-notes-test-${randomUUID()}`);
  await mkdir(notesDir, { recursive: true });
  appDb = createDatabase({ connectionString: connectionStrings.app, maxConnections: 1 });
  await setInstanceSetting("registration.requires_approval", { value: false });
});

afterAll(async () => {
  await appDb?.destroy();
  await rm(notesDir, { recursive: true, force: true });
});

// ── GET /api/me/notes-source ──────────────────────────────────────────────────

describe("GET /api/me/notes-source", () => {
  let server: ReturnType<typeof createApiServer>;

  beforeAll(async () => {
    server = createApiServer({ appDb, logger: false });
    await server.ready();
    ownerCookie = await signUp(server, "Owner2", `get-notes-${randomUUID()}@example.test`);
  });

  afterAll(async () => {
    await server?.close();
  });

  it("returns null path by default", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/api/me/notes-source",
      headers: { cookie: ownerCookie }
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<GetNotesSourceResponse>().path).toBeNull();
  });

  it("requires authentication", async () => {
    const res = await server.inject({ method: "GET", url: "/api/me/notes-source" });
    expect(res.statusCode).toBe(401);
  });
});

// ── PUT /api/me/notes-source ──────────────────────────────────────────────────

describe("PUT /api/me/notes-source", () => {
  let server: ReturnType<typeof createApiServer>;
  let cookie: string;

  beforeAll(async () => {
    server = createApiServer({ appDb, logger: false });
    await server.ready();
    cookie = await signUp(server, "PutOwner", `put-notes-${randomUUID()}@example.test`);
  });

  afterAll(async () => {
    await server?.close();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env["JARVIS_NOTES_ROOTS"];
  });

  it("returns 503 when JARVIS_NOTES_ROOTS is not set", async () => {
    delete process.env["JARVIS_NOTES_ROOTS"];
    const res = await server.inject({
      method: "PUT",
      url: "/api/me/notes-source",
      headers: { cookie, "content-type": "application/json" },
      payload: { path: "/some/path" }
    });
    expect(res.statusCode).toBe(503);
  });

  it("returns 400 when path is not within any allowed root", async () => {
    process.env["JARVIS_NOTES_ROOTS"] = notesDir;
    const res = await server.inject({
      method: "PUT",
      url: "/api/me/notes-source",
      headers: { cookie, "content-type": "application/json" },
      payload: { path: "/etc" }
    });
    expect(res.statusCode).toBe(400);
  });

  it("saves path when it is within an allowed root", async () => {
    process.env["JARVIS_NOTES_ROOTS"] = notesDir;
    const put = await server.inject({
      method: "PUT",
      url: "/api/me/notes-source",
      headers: { cookie, "content-type": "application/json" },
      payload: { path: notesDir }
    });
    expect(put.statusCode).toBe(200);
    expect(put.json<GetNotesSourceResponse>().path).toBe(notesDir);

    const get = await server.inject({
      method: "GET",
      url: "/api/me/notes-source",
      headers: { cookie }
    });
    expect(get.statusCode).toBe(200);
    expect(get.json<GetNotesSourceResponse>().path).toBe(notesDir);
  });

  it("clears path when null is provided", async () => {
    process.env["JARVIS_NOTES_ROOTS"] = notesDir;
    // Set first
    await server.inject({
      method: "PUT",
      url: "/api/me/notes-source",
      headers: { cookie, "content-type": "application/json" },
      payload: { path: notesDir }
    });
    // Clear
    const put = await server.inject({
      method: "PUT",
      url: "/api/me/notes-source",
      headers: { cookie, "content-type": "application/json" },
      payload: { path: null }
    });
    expect(put.statusCode).toBe(200);
    expect(put.json<GetNotesSourceResponse>().path).toBeNull();
  });

  it("path preference is per-user (RLS)", async () => {
    const memberCk = await signUp(server, "RLSMember", `rls-member-${randomUUID()}@example.test`);
    process.env["JARVIS_NOTES_ROOTS"] = notesDir;
    await server.inject({
      method: "PUT",
      url: "/api/me/notes-source",
      headers: { cookie, "content-type": "application/json" },
      payload: { path: notesDir }
    });
    const memberRes = await server.inject({
      method: "GET",
      url: "/api/me/notes-source",
      headers: { cookie: memberCk }
    });
    expect(memberRes.json<GetNotesSourceResponse>().path).toBeNull();
  });
});

// ── POST /api/notes/sync ──────────────────────────────────────────────────────

describe("POST /api/notes/sync", () => {
  let server: ReturnType<typeof createApiServer>;
  let syncCookie: string;

  beforeAll(async () => {
    server = createApiServer({ appDb, logger: false });
    await server.ready();
    syncCookie = await signUp(server, "SyncUser", `sync-${randomUUID()}@example.test`);
  });

  afterAll(async () => {
    await server?.close();
  });

  it("returns 409 when no notes source is configured", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/api/notes/sync",
      headers: { cookie: syncCookie }
    });
    expect(res.statusCode).toBe(409);
  });

  it("returns 202 with jobId when notes source is configured (mock boss)", async () => {
    const bossSend = vi.fn(async () => "test-job-id-123");
    const fakeServer = Fastify({ logger: false });

    const userId = randomUUID();
    const dataContextRunner = new DataContextRunner(appDb);

    // Pre-seed the notes source preference in DB
    const client = new Client({ connectionString: connectionStrings.bootstrap });
    await client.connect();
    try {
      await client.query(
        `INSERT INTO app.users (id, email, is_instance_admin) VALUES ($1, $2, false) ON CONFLICT DO NOTHING`,
        [userId, `sync-mock-${userId}@example.test`]
      );
      await client.query(
        `INSERT INTO app.preferences (owner_user_id, key, value_json) VALUES ($1, $2, $3::jsonb) ON CONFLICT (owner_user_id, key) DO UPDATE SET value_json = EXCLUDED.value_json`,
        [userId, NOTES_SOURCE_PREFERENCE_KEY, JSON.stringify(notesDir)]
      );
    } finally {
      await client.end();
    }

    registerNotesSyncRoutes(fakeServer, {
      dataContext: dataContextRunner,
      resolveAccessContext: async () => ({ actorUserId: userId, requestId: "req:sync-test" }),
      preferencesRepository: new PreferencesRepository(),
      boss: { send: bossSend } as unknown as PgBoss
    });

    await fakeServer.ready();
    try {
      const res = await fakeServer.inject({ method: "POST", url: "/api/notes/sync" });
      expect(res.statusCode).toBe(202);
      const body = res.json<PostNotesSyncResponse>();
      expect(typeof body.jobId).toBe("string");
      expect(bossSend).toHaveBeenCalledWith(
        NOTES_SYNC_QUEUE,
        expect.objectContaining({ actorUserId: userId, sourcePath: notesDir }),
        expect.objectContaining({ singletonKey: `notes-sync:${userId}` })
      );
    } finally {
      await fakeServer.close();
    }
  });

  it("requires authentication", async () => {
    const res = await server.inject({ method: "POST", url: "/api/notes/sync" });
    expect(res.statusCode).toBe(401);
  });
});

// ── handleNotesSyncJob (worker integration) ───────────────────────────────────

describe("handleNotesSyncJob", () => {
  let dataContext: DataContextRunner;
  const provider = new StubEmbeddingProvider();
  const jobUserId = "00000000-0000-4000-8100-000000000099";
  let jobNotesDir: string;

  function makeJob(sourcePath: string): Job<NotesSyncJobPayload> {
    return {
      id: randomUUID(),
      data: { actorUserId: jobUserId, sourcePath }
    } as unknown as Job<NotesSyncJobPayload>;
  }

  beforeAll(async () => {
    jobNotesDir = join(tmpdir(), `jarv1s-notes-worker-${randomUUID()}`);
    await mkdir(jobNotesDir, { recursive: true });

    const client = new Client({ connectionString: connectionStrings.bootstrap });
    await client.connect();
    try {
      await client.query(
        `INSERT INTO app.users (id, email, is_instance_admin)
         VALUES ($1, 'notes-worker@example.test', false) ON CONFLICT DO NOTHING`,
        [jobUserId]
      );
    } finally {
      await client.end();
    }

    dataContext = new DataContextRunner(appDb);
    process.env["JARVIS_NOTES_ROOTS"] = jobNotesDir;
  });

  afterAll(async () => {
    await rm(jobNotesDir, { recursive: true, force: true });
    delete process.env["JARVIS_NOTES_ROOTS"];
  });

  it("ingests markdown files and stores chunks with source_kind=notes", async () => {
    await writeFile(join(jobNotesDir, "hello.md"), "# Hello\n\nThis is a test note.\n");
    await writeFile(join(jobNotesDir, "world.md"), "# World\n\n## Section\n\nMore content.\n");

    const result = await dataContext.withDataContext(
      { actorUserId: jobUserId, requestId: "req:worker-test" },
      (scopedDb) => handleNotesSyncJob(makeJob(jobNotesDir), scopedDb, provider)
    );

    expect(result.ingested).toBe(2);
    expect(result.skipped).toBe(0);
    expect(result.errors).toBe(0);
  });

  it("skips unchanged files on re-run", async () => {
    const result = await dataContext.withDataContext(
      { actorUserId: jobUserId, requestId: "req:worker-skip" },
      (scopedDb) => handleNotesSyncJob(makeJob(jobNotesDir), scopedDb, provider)
    );

    expect(result.ingested).toBe(0);
    expect(result.skipped).toBe(2);
    expect(result.errors).toBe(0);
  });

  it("re-ingests when file content changes", async () => {
    await writeFile(join(jobNotesDir, "hello.md"), "# Hello\n\nContent was updated.\n");

    const result = await dataContext.withDataContext(
      { actorUserId: jobUserId, requestId: "req:worker-update" },
      (scopedDb) => handleNotesSyncJob(makeJob(jobNotesDir), scopedDb, provider)
    );

    expect(result.ingested).toBe(1);
    expect(result.skipped).toBe(1);
  });

  it("walks subdirectories recursively", async () => {
    const subDir = join(jobNotesDir, "subdir");
    await mkdir(subDir, { recursive: true });
    await writeFile(join(subDir, "nested.md"), "# Nested note\n\nDeep content.\n");

    const result = await dataContext.withDataContext(
      { actorUserId: jobUserId, requestId: "req:worker-nested" },
      (scopedDb) => handleNotesSyncJob(makeJob(jobNotesDir), scopedDb, provider)
    );

    expect(result.ingested).toBeGreaterThanOrEqual(1);
  });

  it("throws when JARVIS_NOTES_ROOTS is not configured", async () => {
    delete process.env["JARVIS_NOTES_ROOTS"];
    await expect(
      dataContext.withDataContext(
        { actorUserId: jobUserId, requestId: "req:worker-no-roots" },
        (scopedDb) => handleNotesSyncJob(makeJob(jobNotesDir), scopedDb, provider)
      )
    ).rejects.toThrow("JARVIS_NOTES_ROOTS not configured");
    process.env["JARVIS_NOTES_ROOTS"] = jobNotesDir;
  });

  it("throws when sourcePath is not within any allowed root", async () => {
    process.env["JARVIS_NOTES_ROOTS"] = jobNotesDir;
    await expect(
      dataContext.withDataContext(
        { actorUserId: jobUserId, requestId: "req:worker-escape" },
        (scopedDb) => handleNotesSyncJob(makeJob("/etc"), scopedDb, provider)
      )
    ).rejects.toThrow("not within any allowed root");
  });
});
