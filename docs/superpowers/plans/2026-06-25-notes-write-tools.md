# Notes Write Tools Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add assistant tools that create and edit Markdown notes automatically, while note deletion
uses the existing approval flow.

**Architecture:** Keep files as the source of truth. Add a focused notes write-tool module that
resolves the actor's linked notes source, validates relative Markdown paths under `JARVIS_NOTES_ROOTS`,
performs the filesystem mutation, then enqueues the existing notes sync job. Reuse the assistant
gateway's risk policy: `notes.create` and `notes.edit` are auto write tools, `notes.delete` is
destructive.

**Tech Stack:** TypeScript, Node `fs/promises`, pg-boss, existing `@jarv1s/notes`,
`@jarv1s/settings`, `@jarv1s/structured-state`, `@jarv1s/ai` gateway, Vitest.

---

## File Map

- Modify `packages/ai/src/gateway/gateway.ts` so auto write tools can receive declared services;
  read tools still receive none.
- Modify `tests/integration/mcp-gateway.test.ts` to prove auto write tools can use services and read
  tools cannot.
- Modify `packages/shared/src/notes-api.ts` with input/output schemas for `notes.create`,
  `notes.edit`, and `notes.delete`.
- Create `packages/notes/src/write-tools.ts` for path validation, filesystem writes, exact-match
  edit, delete, and sync enqueue service use.
- Modify `packages/notes/src/manifest.ts` to add permissions and assistant tool manifests.
- Modify `packages/notes/src/index.ts` to export new helpers/types.
- Modify `packages/chat/src/routes.ts` to register a `notesSync` tool service when `boss` exists.
- Modify `packages/module-registry/src/index.ts` to pass `boss` into chat routes; the dependency is
  already available at composition.
- Modify `apps/web/src/settings/settings-personal-data-panes.tsx` to replace read-only notes copy.
- Add `tests/integration/notes-write-tools.test.ts` for create/edit/delete behavior and sync enqueue.

## Task 1: Gateway Services For Auto Write Tools

**Files:**

- Modify: `packages/ai/src/gateway/gateway.ts`
- Test: `tests/integration/mcp-gateway.test.ts`

- [ ] **Step 1: Write the failing gateway test**

Add this test near the existing service fail-closed tests in
`tests/integration/mcp-gateway.test.ts`:

```ts
it("auto write tools can receive declared services while read tools cannot", async () => {
  const calls: unknown[] = [];
  const module = {
    id: "svc",
    name: "Services",
    version: "0",
    publisher: "test",
    lifecycle: "optional",
    compatibility: { jarv1s: "*" },
    assistantTools: [
      {
        name: "svc.read",
        description: "bad read",
        permissionId: "svc.view",
        risk: "read" as const,
        requiresServices: ["demo"],
        inputSchema: { type: "object", properties: {} },
        execute: async () => {
          calls.push("read");
          return { data: { ok: true } };
        }
      },
      {
        name: "svc.autoWrite",
        description: "good write",
        permissionId: "svc.write",
        risk: "write" as const,
        executionPolicy: "auto" as const,
        requiresServices: ["demo"],
        inputSchema: { type: "object", properties: {} },
        execute: async (_db, _input, _ctx, services) => {
          calls.push((services.demo as { value: string }).value);
          return { data: { ok: true } };
        }
      }
    ]
  };
  const serviceGateway = new AssistantToolGateway({
    resolveActiveModules: async () => [module],
    repository,
    runner,
    tokens,
    confirmations,
    notifier: { emit: (chatSessionId, record) => emitted.push({ chatSessionId, record }) },
    confirmTimeoutMs: 1000,
    toolServices: { demo: { value: "service reached" } }
  });

  const listed = await serviceGateway.listToolsForActor(ids.userA);
  expect(listed.map((tool) => tool.name)).toEqual(["svc.autoWrite"]);

  const token = tokens.mint({
    actorUserId: ids.userA,
    chatSessionId: "svc-session",
    allowedToolNames: null
  });
  const result = await serviceGateway.callTool(token, "svc.autoWrite", {});

  expect(result.ok).toBe(true);
  expect(calls).toEqual(["service reached"]);
});
```

- [ ] **Step 2: Run the gateway test to verify it fails**

Run:

```bash
pnpm vitest run tests/integration/mcp-gateway.test.ts
```

Expected: the new test fails because `svc.autoWrite` is hidden when it declares services and
`resolvePolicy(tool) === "run"`.

- [ ] **Step 3: Update gateway service policy**

In `packages/ai/src/gateway/gateway.ts`, change `servicesFor` and the executable-tools filter:

```ts
private servicesFor(tool: ModuleAssistantToolManifest): ToolServices {
  if (tool.risk === "read") {
    return {};
  }
  const registry = this.deps.toolServices ?? {};
  const keys = tool.requiresServices ?? [];
  const subset: Record<string, unknown> = {};
  for (const key of keys) {
    if (key in registry) subset[key] = registry[key];
  }
  return subset;
}
```

```ts
if (declaredServices.length > 0 && tool.risk === "read") {
  continue;
}
```

Keep the missing-service fail-closed block unchanged.

- [ ] **Step 4: Run the gateway test to verify it passes**

Run:

```bash
pnpm vitest run tests/integration/mcp-gateway.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ai/src/gateway/gateway.ts tests/integration/mcp-gateway.test.ts
git commit -m "fix: allow services for auto write tools"
```

## Task 2: Shared Notes Tool Schemas

**Files:**

- Modify: `packages/shared/src/notes-api.ts`

- [ ] **Step 1: Add shared tool types and schemas**

Append near the existing notes search schemas:

```ts
export interface NotesCreateInput {
  readonly path: string;
  readonly content: string;
  readonly overwrite?: boolean;
}

export interface NotesEditInput {
  readonly path: string;
  readonly oldText: string;
  readonly newText: string;
}

export interface NotesDeleteInput {
  readonly path: string;
}

export interface NotesWriteResult {
  readonly path: string;
  readonly synced: boolean;
}

const relativeMarkdownPathProperty = {
  type: "string",
  minLength: 1,
  pattern: "^[^\\0]+\\.md$"
} as const;

export const notesCreateInputSchema = {
  type: "object",
  additionalProperties: false,
  required: ["path", "content"],
  properties: {
    path: relativeMarkdownPathProperty,
    content: { type: "string" },
    overwrite: { type: "boolean" }
  }
} as const;

export const notesEditInputSchema = {
  type: "object",
  additionalProperties: false,
  required: ["path", "oldText", "newText"],
  properties: {
    path: relativeMarkdownPathProperty,
    oldText: { type: "string", minLength: 1 },
    newText: { type: "string" }
  }
} as const;

export const notesDeleteInputSchema = {
  type: "object",
  additionalProperties: false,
  required: ["path"],
  properties: {
    path: relativeMarkdownPathProperty
  }
} as const;

export const notesWriteResultSchema = {
  type: "object",
  additionalProperties: false,
  required: ["path", "synced"],
  properties: {
    path: { type: "string" },
    synced: { type: "boolean" }
  }
} as const;
```

- [ ] **Step 2: Run typecheck**

Run:

```bash
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/notes-api.ts
git commit -m "feat: add notes write tool schemas"
```

## Task 3: Notes Write Tool Implementation

**Files:**

- Create: `packages/notes/src/write-tools.ts`
- Modify: `packages/notes/src/index.ts`
- Test: `tests/integration/notes-write-tools.test.ts`

- [ ] **Step 1: Write failing create/edit/delete tests**

Create `tests/integration/notes-write-tools.test.ts` with these first tests:

```ts
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
  let db: ReturnType<typeof createDatabase<JarvisDatabase>>;
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
```

- [ ] **Step 2: Run the failing tests**

Run:

```bash
pnpm vitest run tests/integration/notes-write-tools.test.ts
```

Expected: FAIL because `write-tools.ts` exports do not exist.

- [ ] **Step 3: Implement `write-tools.ts`**

Create `packages/notes/src/write-tools.ts`:

```ts
import { lstat, mkdir, open, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, normalize, sep } from "node:path";

import { assertDataContextDb } from "@jarv1s/db";
import type { DataContextDb } from "@jarv1s/db";
import { HttpError, type ToolContext, type ToolExecute, type ToolResult } from "@jarv1s/module-sdk";
import { NOTES_SOURCE_PREFERENCE_KEY, resolveNotesRoots } from "@jarv1s/settings";
import { PreferencesRepository } from "@jarv1s/structured-state";

import { assertWithinRoot } from "./path-guard.js";

export interface NotesSyncToolService {
  enqueue(actorUserId: string, sourcePath: string): Promise<string | null>;
}

const prefs = new PreferencesRepository();

function notesSyncService(services: Record<string, unknown> | undefined): NotesSyncToolService {
  const service = services?.notesSync as NotesSyncToolService | undefined;
  if (!service || typeof service.enqueue !== "function") {
    throw new HttpError(503, "Notes sync service is not available");
  }
  return service;
}

function parseRelativeMarkdownPath(value: unknown): string {
  if (typeof value !== "string") throw new HttpError(400, "path must be a relative Markdown path");
  const trimmed = value.trim();
  if (!trimmed.endsWith(".md") || isAbsolute(trimmed) || trimmed.includes("\0")) {
    throw new HttpError(400, "path must be a relative Markdown path");
  }
  const normalized = normalize(trimmed);
  if (normalized === "." || normalized.startsWith(".." + sep) || normalized === "..") {
    throw new HttpError(400, "path must be a relative Markdown path");
  }
  return normalized;
}

async function resolveSource(scopedDb: DataContextDb): Promise<{ raw: string; resolved: string }> {
  const raw = await prefs.get(scopedDb, NOTES_SOURCE_PREFERENCE_KEY);
  if (typeof raw !== "string" || raw.length === 0) {
    throw new HttpError(409, "No notes source configured");
  }
  const resolved = await realpath(raw);
  const allowedRoots = resolveNotesRoots();
  if (allowedRoots.length === 0) throw new HttpError(503, "Notes roots not configured");
  if (!allowedRoots.some((root) => resolved === root || resolved.startsWith(root + sep))) {
    throw new HttpError(400, "Notes source is outside allowed roots");
  }
  return { raw, resolved };
}

async function resolveExistingFile(source: { raw: string; resolved: string }, rel: string) {
  const target = join(source.raw, rel);
  const info = await lstat(target);
  if (info.isSymbolicLink()) throw new HttpError(400, "Notes path must not be a symlink");
  if (!info.isFile()) throw new HttpError(400, "Notes path is not a file");
  const resolved = await realpath(target);
  assertWithinRoot(source.resolved, resolved);
  return target;
}

function isMissingPath(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { readonly code?: unknown }).code === "ENOENT"
  );
}

async function enqueueSync(
  services: Record<string, unknown> | undefined,
  ctx: ToolContext,
  sourcePath: string
): Promise<void> {
  await notesSyncService(services).enqueue(ctx.actorUserId, sourcePath);
}

export const notesCreateExecute: ToolExecute = async (
  scopedDb,
  input,
  ctx,
  services
): Promise<ToolResult> => {
  assertDataContextDb(scopedDb);
  const source = await resolveSource(scopedDb as DataContextDb);
  const rel = parseRelativeMarkdownPath((input as { path?: unknown }).path);
  const content = String((input as { content?: unknown }).content ?? "");
  const overwrite = (input as { overwrite?: unknown }).overwrite === true;
  const target = join(source.raw, rel);
  await mkdir(dirname(target), { recursive: true });
  const parent = await realpath(dirname(target));
  assertWithinRoot(source.resolved, parent);

  if (overwrite) {
    try {
      await resolveExistingFile(source, rel);
    } catch (error) {
      if (!isMissingPath(error)) throw error;
    }
    await writeFile(target, content, "utf-8");
  } else {
    const handle = await open(target, "wx");
    await handle.writeFile(content, "utf-8");
    await handle.close();
  }
  await enqueueSync(services, ctx, source.raw);
  return { data: { path: rel, synced: true } };
};

export const notesEditExecute: ToolExecute = async (
  scopedDb,
  input,
  ctx,
  services
): Promise<ToolResult> => {
  assertDataContextDb(scopedDb);
  const source = await resolveSource(scopedDb as DataContextDb);
  const rel = parseRelativeMarkdownPath((input as { path?: unknown }).path);
  const oldText = String((input as { oldText?: unknown }).oldText ?? "");
  const newText = String((input as { newText?: unknown }).newText ?? "");
  const target = await resolveExistingFile(source, rel);
  const current = await readFile(target, "utf-8");
  const matches = current.split(oldText).length - 1;
  if (matches !== 1) throw new HttpError(409, `oldText appears ${matches} times`);
  await writeFile(target, current.replace(oldText, newText), "utf-8");
  await enqueueSync(services, ctx, source.raw);
  return { data: { path: rel, synced: true } };
};

export const notesDeleteExecute: ToolExecute = async (
  scopedDb,
  input,
  ctx,
  services
): Promise<ToolResult> => {
  assertDataContextDb(scopedDb);
  const source = await resolveSource(scopedDb as DataContextDb);
  const rel = parseRelativeMarkdownPath((input as { path?: unknown }).path);
  const target = await resolveExistingFile(source, rel);
  await rm(target);
  await enqueueSync(services, ctx, source.raw);
  return { data: { path: rel, synced: true } };
};
```

During implementation, tighten error handling around `open()`/`stat()` with `HttpError` messages if
TypeScript or tests require it. Do not add full-file rewrite or rename behavior.

- [ ] **Step 4: Export new tools**

In `packages/notes/src/index.ts`, add:

```ts
export {
  notesCreateExecute,
  notesEditExecute,
  notesDeleteExecute,
  type NotesSyncToolService
} from "./write-tools.js";
```

- [ ] **Step 5: Run focused tests**

Run:

```bash
pnpm vitest run tests/integration/notes-write-tools.test.ts
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/notes/src/write-tools.ts packages/notes/src/index.ts tests/integration/notes-write-tools.test.ts
git commit -m "feat: add notes filesystem write tools"
```

## Task 4: Manifest Permissions And Tool Registration

**Files:**

- Modify: `packages/notes/src/manifest.ts`
- Test: `tests/integration/notes-write-tools.test.ts`

- [ ] **Step 1: Add manifest assertions**

Append tests in `tests/integration/notes-write-tools.test.ts`:

```ts
import { notesModuleManifest } from "@jarv1s/notes";

it("declares create/edit as auto write tools and delete as destructive", () => {
  const tools = new Map(
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
pnpm vitest run tests/integration/notes-write-tools.test.ts
```

Expected: FAIL because manifest tools are missing.

- [ ] **Step 3: Update notes manifest**

In `packages/notes/src/manifest.ts`, import schemas and executors:

```ts
import {
  notesCreateInputSchema,
  notesEditInputSchema,
  notesDeleteInputSchema,
  notesWriteResultSchema,
  postNotesSyncRouteSchema,
  notesSearchInputSchema,
  notesSearchResponseSchema
} from "@jarv1s/shared";

import {
  notesCreateExecute,
  notesDeleteExecute,
  notesEditExecute,
  notesSearchExecute
} from "./tools.js";
```

Move write executors to the correct import if they live in `write-tools.js`.

Add permissions:

```ts
{
  id: "notes.create",
  label: "Create notes",
  description: "Create Markdown notes in the linked notes source.",
  scope: "user",
  actions: ["create"]
},
{
  id: "notes.edit",
  label: "Edit notes",
  description: "Edit Markdown notes in the linked notes source.",
  scope: "user",
  actions: ["update"]
},
{
  id: "notes.delete",
  label: "Delete notes",
  description: "Delete Markdown notes in the linked notes source after approval.",
  scope: "user",
  actions: ["delete"]
}
```

Add assistant tools after `notes.search`:

```ts
{
  name: "notes.create",
  description: "Create a Markdown note in the user's linked notes source.",
  permissionId: "notes.create",
  risk: "write",
  executionPolicy: "auto",
  requiresServices: ["notesSync"],
  inputSchema: notesCreateInputSchema,
  outputSchema: notesWriteResultSchema,
  execute: notesCreateExecute,
  summarize: (input) => `Create note ${String(input.path ?? "")}`
},
{
  name: "notes.edit",
  description:
    "Edit a Markdown note in the user's linked notes source by exact-match replacement.",
  permissionId: "notes.edit",
  risk: "write",
  executionPolicy: "auto",
  requiresServices: ["notesSync"],
  inputSchema: notesEditInputSchema,
  outputSchema: notesWriteResultSchema,
  execute: notesEditExecute,
  summarize: (input) => `Edit note ${String(input.path ?? "")}`
},
{
  name: "notes.delete",
  description: "Delete a Markdown note in the user's linked notes source after approval.",
  permissionId: "notes.delete",
  risk: "destructive",
  requiresServices: ["notesSync"],
  inputSchema: notesDeleteInputSchema,
  outputSchema: notesWriteResultSchema,
  execute: notesDeleteExecute,
  summarize: (input) => `Delete note ${String(input.path ?? "")}`
}
```

- [ ] **Step 4: Run focused tests**

Run:

```bash
pnpm vitest run tests/integration/notes-write-tools.test.ts
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/notes/src/manifest.ts tests/integration/notes-write-tools.test.ts packages/shared/src/notes-api.ts
git commit -m "feat: register notes write assistant tools"
```

## Task 5: Chat Tool Service Wiring

**Files:**

- Modify: `packages/chat/src/routes.ts`
- Modify: `packages/module-registry/src/index.ts`
- Test: `tests/integration/notes-write-tools.test.ts`

- [ ] **Step 1: Write failing service wiring test**

Add:

```ts
import { buildChatToolServices } from "@jarv1s/chat";

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
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
pnpm vitest run tests/integration/notes-write-tools.test.ts
```

Expected: FAIL because `buildChatToolServices` does not accept or return `notesSync`.

- [ ] **Step 3: Wire notesSync service in chat routes**

In `packages/chat/src/routes.ts`, import the notes queue constants/types:

```ts
import {
  NOTES_SYNC_QUEUE,
  type NotesSyncJobPayload,
  type NotesSyncToolService
} from "@jarv1s/notes";
import { sendJob } from "@jarv1s/jobs";
```

Extend `buildChatToolServices` args:

```ts
export function buildChatToolServices(deps: {
  googleConnectionService?: GoogleConnectionService;
  googleApiClient?: GoogleApiClient;
  connectorsRepository?: ConnectorsRepository;
  boss?: PgBoss;
}): Record<string, unknown> {
  const services: Record<string, unknown> = {};
  if (deps.googleConnectionService && deps.googleApiClient && deps.connectorsRepository) {
    services.calendarWrite = buildCalendarWriteService({
      googleService: deps.googleConnectionService,
      googleApiClient: deps.googleApiClient,
      connectorsRepository: deps.connectorsRepository,
      calendarRepository: new CalendarRepository()
    });
  }
  if (deps.boss) {
    services.notesSync = {
      enqueue: (actorUserId: string, sourcePath: string) =>
        sendJob(
          deps.boss!,
          NOTES_SYNC_QUEUE,
          { actorUserId, sourcePath } satisfies NotesSyncJobPayload,
          { singletonKey: `notes-sync:${actorUserId}` }
        )
    } satisfies NotesSyncToolService;
  }
  return services;
}
```

Pass `boss` through `buildChatGatewayDependencies` collaborators and its call site.

- [ ] **Step 4: Pass boss from module registry to chat routes**

In `packages/module-registry/src/index.ts`, where `registerChatRoutes` is called, ensure it passes:

```ts
boss: deps.boss,
```

- [ ] **Step 5: Run focused tests and typecheck**

Run:

```bash
pnpm vitest run tests/integration/notes-write-tools.test.ts tests/integration/mcp-gateway.test.ts
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/chat/src/routes.ts packages/module-registry/src/index.ts tests/integration/notes-write-tools.test.ts
git commit -m "feat: wire notes sync tool service"
```

## Task 6: Approval Flow Coverage For Delete

**Files:**

- Test: `tests/integration/notes-write-tools.test.ts`

- [ ] **Step 1: Add gateway behavior tests**

Add a test that uses `AssistantToolGateway` with `notesModuleManifest`, a real data context, and
`toolServices: { notesSync: service }`:

```ts
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
```

- [ ] **Step 2: Run the gateway notes test**

Run:

```bash
pnpm vitest run tests/integration/notes-write-tools.test.ts
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/integration/notes-write-tools.test.ts
git commit -m "test: cover notes delete approval flow"
```

## Task 7: Settings Copy

**Files:**

- Modify: `apps/web/src/settings/settings-personal-data-panes.tsx`

- [ ] **Step 1: Update notes source copy**

Replace the linked-state `read-only` badge text with:

```tsx
<span className="vault__ro">
  <Lock size={11} aria-hidden="true" />
  delete approval
</span>
```

Replace the bottom note text with:

```tsx
<Note icon={<ShieldCheck size={13} />}>
  Jarvis can create and edit Markdown notes in this folder. Deleting notes requires approval.
</Note>
```

Use the existing classes; do not add new UI components.

- [ ] **Step 2: Run frontend checks**

Run:

```bash
pnpm prettier --check apps/web/src/settings/settings-personal-data-panes.tsx
pnpm eslint apps/web/src/settings/settings-personal-data-panes.tsx --max-warnings=0
pnpm --filter @jarv1s/web typecheck
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/settings/settings-personal-data-panes.tsx
git commit -m "chore: update notes write settings copy"
```

## Task 8: Final Verification

**Files:**

- No source edits unless verification finds a defect.

- [ ] **Step 1: Run focused verification**

Run:

```bash
pnpm vitest run tests/integration/notes-write-tools.test.ts tests/integration/mcp-gateway.test.ts
pnpm typecheck
pnpm test:unit
```

Expected: all commands exit 0.

- [ ] **Step 2: Run format and file-size checks**

Run:

```bash
pnpm format:check
pnpm check:file-size
```

Expected: both commands exit 0.

- [ ] **Step 3: Manual dev check**

With a writable notes source linked under `JARVIS_NOTES_ROOTS`, ask Jarv1s:

```text
Create a note called demo-write-tools.md with the text "hello from Jarvis"
```

Then ask:

```text
In demo-write-tools.md replace "hello" with "goodbye"
```

Then ask:

```text
Delete demo-write-tools.md
```

Expected: create and edit execute without approval; delete emits an approval card before removing the
file.

## Self-Review

- Spec coverage: create, exact-match edit, delete approval, path confinement, Markdown-only scope,
  sync enqueue, permissions, settings copy, and tests are each covered.
- Red-flag scan: every implementation step has concrete files, commands, and expected outcomes.
- Type consistency: `NotesSyncToolService`, `notesSync`, `notesCreateExecute`,
  `notesEditExecute`, and `notesDeleteExecute` are introduced before use.
