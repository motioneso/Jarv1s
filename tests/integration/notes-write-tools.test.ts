import { randomUUID } from "node:crypto";
import { lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Kysely } from "kysely";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildChatToolServices } from "@jarv1s/chat";
import { DataContextRunner, createDatabase, type JarvisDatabase } from "@jarv1s/db";
import type { JarvisModuleManifest } from "@jarv1s/module-sdk";
import { PreferencesRepository } from "@jarv1s/structured-state";
import { NOTES_SOURCE_PREFERENCE_KEY } from "@jarv1s/settings";
import {
  notesModuleManifest,
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

  it("declares create/edit as auto write tools and delete as destructive", () => {
    const tools = new Map<string, NonNullable<JarvisModuleManifest["assistantTools"]>[number]>(
      (notesModuleManifest.assistantTools ?? []).map((tool) => [tool.name, tool])
    );
    expect(tools.get("notes.create")?.risk).toBe("write");
    expect(tools.get("notes.create")?.executionPolicy).toBe("auto");
    expect(tools.get("notes.edit")?.risk).toBe("write");
    expect(tools.get("notes.edit")?.executionPolicy).toBe("auto");
    expect(tools.get("notes.delete")?.risk).toBe("destructive");
    expect(tools.get("notes.delete")?.executionPolicy).toBeUndefined();
    expect(
      tools.get("notes.delete")?.summarize?.(
        { path: "x.md" },
        {
          actorUserId: ids.userA,
          requestId: "r",
          chatSessionId: "c"
        }
      )
    ).toContain("x.md");
  });

  it("chat tool services include notesSync when boss is provided", async () => {
    const sent: unknown[] = [];
    const boss = {
      send: async (...args: unknown[]) => {
        sent.push(args);
        return "job-123";
      }
    };
    const services = buildChatToolServices({ boss: boss as never });
    const notesSync = services.notesSync as NotesSyncToolService;
    await notesSync.enqueue(ids.userA, "/notes");
    expect(sent[0]).toBeTruthy();
  });

  it("gateway auto-runs create/edit but requires approval for delete", async () => {
    const emitted: unknown[] = [];
    const { AiRepository, AssistantToolGateway, ConfirmationRegistry, SessionTokenRegistry } =
      await import("@jarv1s/ai");
    const repository = new AiRepository();
    const tokens = new SessionTokenRegistry();
    const confirmations = new ConfirmationRegistry();
    const gateway = new AssistantToolGateway({
      resolveActiveModules: async () => [notesModuleManifest],
      repository,
      runner,
      tokens,
      confirmations,
      notifier: { emit: (_chatSessionId, record) => emitted.push(record) },
      confirmTimeoutMs: 30_000,

      actionPolicy: () => ({
        getFamilyTier: async (moduleId, familyId) => "trusted_auto",
        getFamilyManifest: async () => ({
          id: "note_changes",
          label: "Note Changes",
          description: "Modify notes.",
          defaultTier: "ask_each_time",
          allowedTiers: ["ask_each_time", "trusted_auto"]
        })
      }),
      toolServices: { notesSync: service }
    });
    const token = tokens.mint({
      actorUserId: ids.userA,
      chatSessionId: "notes-chat",
      allowedToolNames: null
    });

    const created = await gateway.callTool(token, "notes.create", {
      path: "auto.md",
      content: "hello old"
    });
    expect(created.ok).toBe(true);

    const edited = await gateway.callTool(token, "notes.edit", {
      path: "auto.md",
      oldText: "old",
      newText: "new"
    });
    expect(edited.ok).toBe(true);

    const deletePromise = gateway.callTool(token, "notes.delete", { path: "auto.md" });
    await vi.waitFor(() => {
      expect(emitted.some((r) => (r as { kind?: string }).kind === "action_request")).toBe(true);
    });
    const request = emitted.find((r) => (r as { kind?: string }).kind === "action_request") as {
      actionRequestId: string;
      summary: string;
    };
    expect(request.summary).toContain("auto.md");
    await gateway.resolveActionRequest(ids.userA, request.actionRequestId, "confirmed");
    const deleted = await deletePromise;
    expect(deleted.ok).toBe(true);
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

  it("overwrites an existing note when requested", async () => {
    await mkdir(join(root, "ideas"), { recursive: true });
    await writeFile(join(root, "ideas/new.md"), "first");
    await runner.withDataContext({ actorUserId: ids.userA, requestId: "create" }, async (db) => {
      const result = await notesCreateExecute(
        db,
        { path: "ideas/new.md", content: "second", overwrite: true },
        { actorUserId: ids.userA, requestId: "create", chatSessionId: "chat" },
        { notesSync: service }
      );
      expect(result.data).toEqual({ path: "ideas/new.md", synced: true });
    });

    await expect(readFile(join(root, "ideas/new.md"), "utf-8")).resolves.toBe("second");
    expect(syncs).toEqual([`${ids.userA}:${root}`]);
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

  it("accepts absolute sourcePath from search results (within root) and writes correctly", async () => {
    const absPath = join(root, "journal/2026-06-29.md");
    await runner.withDataContext(
      { actorUserId: ids.userA, requestId: "abs-create" },
      async (db) => {
        const result = await notesCreateExecute(
          db,
          { path: absPath, content: "# Today\n" },
          { actorUserId: ids.userA, requestId: "abs-create", chatSessionId: "chat" },
          { notesSync: service }
        );
        expect(result.data).toEqual({ path: "journal/2026-06-29.md", synced: true });
      }
    );
    await expect(readFile(absPath, "utf-8")).resolves.toBe("# Today\n");

    await runner.withDataContext({ actorUserId: ids.userA, requestId: "abs-edit" }, async (db) => {
      const result = await notesEditExecute(
        db,
        { path: absPath, oldText: "# Today\n", newText: "# Today (edited)\n" },
        { actorUserId: ids.userA, requestId: "abs-edit", chatSessionId: "chat" },
        { notesSync: service }
      );
      expect(result.data).toEqual({ path: "journal/2026-06-29.md", synced: true });
    });
    await expect(readFile(absPath, "utf-8")).resolves.toBe("# Today (edited)\n");

    await runner.withDataContext(
      { actorUserId: ids.userA, requestId: "abs-delete" },
      async (db) => {
        const result = await notesDeleteExecute(
          db,
          { path: absPath },
          { actorUserId: ids.userA, requestId: "abs-delete", chatSessionId: "chat" },
          { notesSync: service }
        );
        expect(result.data).toEqual({ path: "journal/2026-06-29.md", synced: true });
      }
    );
    await expect(readFile(absPath, "utf-8")).rejects.toThrow();
  });

  it("rejects absolute path with traversal after root prefix (sibling-prefix attack)", async () => {
    // e.g. AI passes /root/../../../etc/passwd.md — coerceToRelativePath strips /root/ prefix
    // leaving ../../../etc/passwd.md which must be caught by the `..` check in requireMarkdownPath
    // Must use string concat — join() normalises `..` away before coerceToRelativePath sees it.
    const traversalPath = `${root}/../../../etc/passwd.md`;
    await runner.withDataContext(
      { actorUserId: ids.userA, requestId: "abs-traversal" },
      async (db) => {
        await expect(
          notesCreateExecute(
            db,
            { path: traversalPath, content: "bad" },
            { actorUserId: ids.userA, requestId: "abs-traversal", chatSessionId: "chat" },
            { notesSync: service }
          )
        ).rejects.toThrow("relative Markdown path");
      }
    );
  });

  it("rejects absolute path outside the configured notes root", async () => {
    const outside = await mkdtemp(join(tmpdir(), `jarv1s-outside-abs-${randomUUID()}-`));
    try {
      const absOutsidePath = join(outside, "escape.md");
      await runner.withDataContext(
        { actorUserId: ids.userA, requestId: "abs-outside" },
        async (db) => {
          await expect(
            notesCreateExecute(
              db,
              { path: absOutsidePath, content: "bad" },
              { actorUserId: ids.userA, requestId: "abs-outside", chatSessionId: "chat" },
              { notesSync: service }
            )
          ).rejects.toThrow("relative Markdown path");
        }
      );
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
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
        notesCreateExecute(
          db,
          { path: "escape/sub/bad.md", content: "bad" },
          { actorUserId: ids.userA, requestId: "guard", chatSessionId: "chat" },
          { notesSync: service }
        )
      ).rejects.toThrow("path is not within the linked notes source");
      await expect(lstat(join(outside, "sub"))).rejects.toThrow();
      await writeFile(join(outside, "bad.md"), "outside");
      await symlink(join(outside, "bad.md"), join(root, "linked.md"));
      await expect(
        notesCreateExecute(
          db,
          { path: "linked.md", content: "bad", overwrite: true },
          { actorUserId: ids.userA, requestId: "guard", chatSessionId: "chat" },
          { notesSync: service }
        )
      ).rejects.toThrow("path must reference a Markdown file");
      await expect(readFile(join(outside, "bad.md"), "utf-8")).resolves.toBe("outside");
      await expect(
        notesEditExecute(
          db,
          { path: "escape/bad.md", oldText: "outside", newText: "changed" },
          { actorUserId: ids.userA, requestId: "guard", chatSessionId: "chat" },
          { notesSync: service }
        )
      ).rejects.toThrow("path is not within the linked notes source");
      await expect(readFile(join(outside, "bad.md"), "utf-8")).resolves.toBe("outside");
      await expect(
        notesDeleteExecute(
          db,
          { path: "escape/bad.md" },
          { actorUserId: ids.userA, requestId: "guard", chatSessionId: "chat" },
          { notesSync: service }
        )
      ).rejects.toThrow("path is not within the linked notes source");
      await expect(readFile(join(outside, "bad.md"), "utf-8")).resolves.toBe("outside");
    });
    await rm(outside, { recursive: true, force: true });
  });
});
