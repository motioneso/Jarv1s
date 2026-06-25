import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Kysely } from "kysely";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DataContextRunner, createDatabase, type JarvisDatabase } from "@jarv1s/db";
import { PreferencesRepository } from "@jarv1s/structured-state";
import { NOTES_SOURCE_PREFERENCE_KEY } from "@jarv1s/settings";
import {
  notesCreateExecute,
  notesDeleteExecute,
  notesEditExecute,
  type NotesSyncToolService
} from "@jarv1s/notes";

import { connectionStrings, ids, resetFoundationDatabase } from "./test-database.js";

describe("notes write assistant tools", () => {
  const prefs = new PreferencesRepository();
  let runner: DataContextRunner;
  let root: string;
  let db: Kysely<JarvisDatabase>;
  let syncs: string[];
  let service: NotesSyncToolService;

  beforeEach(async () => {
    await resetFoundationDatabase();
    db = createDatabase({ connectionString: connectionStrings.app, maxConnections: 1 });
    runner = new DataContextRunner(db);
    root = await mkdtemp(join(tmpdir(), `jarv1s-notes-write-${randomUUID()}-`));
    process.env["JARVIS_NOTES_ROOTS"] = root;
    syncs = [];
    service = {
      enqueue: async (actorUserId, sourcePath) => {
        syncs.push(`${actorUserId}:${sourcePath}`);
        return "job-1";
      }
    };
    await runner.withDataContext({ actorUserId: ids.userA, requestId: "seed" }, (scopedDb) =>
      prefs.upsert(scopedDb, NOTES_SOURCE_PREFERENCE_KEY, root)
    );
  });

  afterEach(async () => {
    delete process.env["JARVIS_NOTES_ROOTS"];
    vi.restoreAllMocks();
    await db.destroy();
    await rm(root, { recursive: true, force: true });
  });

  it("creates a new markdown note and enqueues sync", async () => {
    await runner.withDataContext({ actorUserId: ids.userA, requestId: "create" }, async (db) => {
      const result = await notesCreateExecute(
        db,
        { path: "ideas/new.md", content: "# New\n" },
        { actorUserId: ids.userA, requestId: "create", chatSessionId: "chat" },
        { notesSync: service }
      );
      expect(result.data).toEqual({ path: "ideas/new.md", synced: true });
    });

    await expect(readFile(join(root, "ideas/new.md"), "utf-8")).resolves.toBe("# New\n");
    expect(syncs).toEqual([`${ids.userA}:${root}`]);
  });

  it("does not overwrite an existing note unless requested", async () => {
    await mkdir(join(root, "ideas"), { recursive: true });
    await writeFile(join(root, "ideas/new.md"), "first");
    await runner.withDataContext({ actorUserId: ids.userA, requestId: "create" }, async (db) => {
      await expect(
        notesCreateExecute(
          db,
          { path: "ideas/new.md", content: "second" },
          { actorUserId: ids.userA, requestId: "create", chatSessionId: "chat" },
          { notesSync: service }
        )
      ).rejects.toThrow("already exists");
    });
  });

  it("edits only when oldText appears exactly once", async () => {
    await writeFile(join(root, "note.md"), "alpha beta alpha");
    await runner.withDataContext({ actorUserId: ids.userA, requestId: "edit" }, async (db) => {
      await expect(
        notesEditExecute(
          db,
          { path: "note.md", oldText: "alpha", newText: "omega" },
          { actorUserId: ids.userA, requestId: "edit", chatSessionId: "chat" },
          { notesSync: service }
        )
      ).rejects.toThrow("appears 2 times");
    });
  });

  it("deletes a markdown note and enqueues sync", async () => {
    await writeFile(join(root, "note.md"), "delete me");
    await runner.withDataContext({ actorUserId: ids.userA, requestId: "delete" }, async (db) => {
      const result = await notesDeleteExecute(
        db,
        { path: "note.md" },
        { actorUserId: ids.userA, requestId: "delete", chatSessionId: "chat" },
        { notesSync: service }
      );
      expect(result.data).toEqual({ path: "note.md", synced: true });
    });
    await expect(readFile(join(root, "note.md"), "utf-8")).rejects.toThrow();
  });

  it("rejects traversal and symlink escape", async () => {
    const outside = await mkdtemp(join(tmpdir(), `jarv1s-outside-${randomUUID()}-`));
    await symlink(outside, join(root, "escape"));
    await runner.withDataContext({ actorUserId: ids.userA, requestId: "guard" }, async (db) => {
      await expect(
        notesCreateExecute(
          db,
          { path: "../bad.md", content: "bad" },
          { actorUserId: ids.userA, requestId: "guard", chatSessionId: "chat" },
          { notesSync: service }
        )
      ).rejects.toThrow("relative Markdown path");
      await expect(
        notesDeleteExecute(
          db,
          { path: "escape/bad.md" },
          { actorUserId: ids.userA, requestId: "guard", chatSessionId: "chat" },
          { notesSync: service }
        )
      ).rejects.toThrow();
    });
    await rm(outside, { recursive: true, force: true });
  });
});
