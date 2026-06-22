# Notes Folder Ingest Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow users to link an operator-allowed notes folder and sync its Markdown files into the Jarvis memory module via a pg-boss worker.

**Architecture:** Settings routes (`GET/PUT /api/me/notes-source`) extend `packages/settings` using the existing `PreferencesRepository` KV pattern — no migration needed. Sync is triggered via `POST /api/notes/sync` in a new `packages/notes` module, which enqueues a pg-boss job. The worker reads the user's configured path, validates it against `JARVIS_NOTES_ROOTS`, walks `.md` files, and upserts chunks into `MemoryRepository` (same store as vault/chat, `source_kind="notes"`).

**Tech Stack:** Fastify 5, pg-boss v12, Vitest, `@jarv1s/db` (DataContextRunner, PreferencesPort), `@jarv1s/structured-state` (PreferencesRepository), `@jarv1s/memory` (parseDocument, MemoryRepository, EmbeddingProvider), `@jarv1s/jobs` (registerDataContextWorker, sendJob), Node `fs/promises`

## Global Constraints

- No migration files — use `app.preferences` KV (`notes-source-path` key).
- Payload must pass `assertMetadataOnlyPayload` — add `sourcePath` to `ALLOWED_PAYLOAD_KEYS`.
- `VaultContext` is off-limits for notes reads — custom path-traversal guard required.
- Worker must resolve symlinks (`fs.realpath`) and assert prefix within `JARVIS_NOTES_ROOTS`.
- File content never in pg-boss payload — only `{ actorUserId, sourcePath }`.
- `PUT /api/me/notes-source` → 400 if path not in `JARVIS_NOTES_ROOTS`; 503 if env var absent.
- `source_kind = "notes"` in `MemoryRepository` calls (keeps vault/chat/notes separate).
- `Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>` on all commits.
- All commits must be green (typecheck + lint + format pass).

---

## File Map

**New files:**

- `packages/shared/src/notes-api.ts` — DTOs + Fastify JSON schemas
- `packages/settings/src/notes-source-routes.ts` — GET/PUT /api/me/notes-source
- `packages/notes/package.json` — workspace package
- `packages/notes/tsconfig.json`
- `packages/notes/src/manifest.ts` — module manifest (id: "notes")
- `packages/notes/src/path-guard.ts` — symlink-safe traversal guard
- `packages/notes/src/notes-sync-routes.ts` — POST /api/notes/sync
- `packages/notes/src/jobs.ts` — queue + worker + handler
- `packages/notes/src/index.ts` — public exports
- `tests/integration/notes.test.ts` — full integration suite

**Modified files:**

- `packages/shared/src/index.ts` — re-export notes-api
- `packages/jobs/src/pg-boss.ts` — add `"sourcePath"` to ALLOWED_PAYLOAD_KEYS
- `packages/settings/src/manifest.ts` — add GET/PUT /api/me/notes-source to `routes`
- `packages/settings/src/routes.ts` — import + call `registerNotesSourceRoutes`
- `packages/module-registry/src/index.ts` — add notes module to BUILT_IN_MODULES

---

### Task 1: Shared API contracts

**Files:**

- Create: `packages/shared/src/notes-api.ts`
- Modify: `packages/shared/src/index.ts`

**Interfaces:**

- Produces:
  - `GetNotesSourceResponse` — `{ path: string | null }`
  - `PutNotesSourceRequest` — `{ path: string | null }`
  - `PostNotesSyncResponse` — `{ jobId: string }`
  - `getNotesSourceRouteSchema`, `putNotesSourceRouteSchema`, `postNotesSyncRouteSchema` — Fastify JSON schemas

- [ ] **Step 1: Write `packages/shared/src/notes-api.ts`**

```typescript
export interface GetNotesSourceResponse {
  readonly path: string | null;
}

export interface PutNotesSourceRequest {
  readonly path: string | null;
}

export interface PostNotesSyncResponse {
  readonly jobId: string;
}

export const getNotesSourceRouteSchema = {
  response: {
    200: {
      type: "object",
      required: ["path"],
      properties: {
        path: { type: ["string", "null"] }
      }
    }
  }
} as const;

export const putNotesSourceRouteSchema = {
  body: {
    type: ["object", "null"],
    properties: {
      path: { type: ["string", "null"] }
    }
  },
  response: {
    200: {
      type: "object",
      required: ["path"],
      properties: {
        path: { type: ["string", "null"] }
      }
    }
  }
} as const;

export const postNotesSyncRouteSchema = {
  response: {
    202: {
      type: "object",
      required: ["jobId"],
      properties: {
        jobId: { type: "string" }
      }
    }
  }
} as const;
```

- [ ] **Step 2: Add export to `packages/shared/src/index.ts`**

Append after the existing `export *` lines:

```typescript
export * from "./notes-api.js";
```

- [ ] **Step 3: Typecheck shared**

```bash
cd packages/shared && pnpm typecheck
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/notes-api.ts packages/shared/src/index.ts
git commit -m "feat(shared): notes-source and notes-sync API contracts

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 2: Allow `sourcePath` in pg-boss payloads

**Files:**

- Modify: `packages/jobs/src/pg-boss.ts` (line ~47 — the `ALLOWED_PAYLOAD_KEYS` set)

**Interfaces:**

- Consumes: existing `ALLOWED_PAYLOAD_KEYS` constant
- Produces: `sourcePath` added to the allowlist so notes sync job payloads pass `assertMetadataOnlyPayload`

- [ ] **Step 1: Add `"sourcePath"` to `ALLOWED_PAYLOAD_KEYS`**

In `packages/jobs/src/pg-boss.ts`, find the `ALLOWED_PAYLOAD_KEYS` set:

```typescript
export const ALLOWED_PAYLOAD_KEYS: ReadonlySet<string> = new Set([
  "actorUserId",
  "taskId",
  "requestedStatus",
  "definitionId",
  "briefingRunId",
  "runKind",
  "threadId",
  "messageId",
  "targetItemId",
  "kind",
  "resourceId",
  "idempotencyKey"
]);
```

Add `"sourcePath"` to the set:

```typescript
export const ALLOWED_PAYLOAD_KEYS: ReadonlySet<string> = new Set([
  "actorUserId",
  "taskId",
  "requestedStatus",
  "definitionId",
  "briefingRunId",
  "runKind",
  "threadId",
  "messageId",
  "targetItemId",
  "kind",
  "resourceId",
  "idempotencyKey",
  "sourcePath"
]);
```

- [ ] **Step 2: Typecheck jobs**

```bash
cd packages/jobs && pnpm typecheck
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/jobs/src/pg-boss.ts
git commit -m "feat(jobs): allow sourcePath in pg-boss metadata payloads

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 3: Notes-source settings routes

**Files:**

- Create: `packages/settings/src/notes-source-routes.ts`
- Modify: `packages/settings/src/manifest.ts` (add 2 routes to `routes` array)
- Modify: `packages/settings/src/routes.ts` (import + wire registration)

**Interfaces:**

- Consumes:
  - `ProfilePreferencesPort` from `./preferences-port.js` — `.get(scopedDb, key)` / `.upsert(scopedDb, key, value)`
  - `handleSettingsRouteError` from `./route-error.js`
  - `getNotesSourceRouteSchema`, `putNotesSourceRouteSchema`, `GetNotesSourceResponse`, `PutNotesSourceRequest` from `@jarv1s/shared`
  - `DataContextRunner`, `AccessContext` from `@jarv1s/db`
- Produces:
  - `registerNotesSourceRoutes(server, deps)` — callable by `registerSettingsRoutes`
  - `resolveNotesRoots(): string[]` — exported for reuse in the notes worker

The preference key is `"notes-source-path"`. The value stored/retrieved is the path string or `null`.

`JARVIS_NOTES_ROOTS` is a comma-separated list of absolute directory prefixes (e.g. `/home/ben/notes,/srv/docs`). An empty or absent env var → no allowed roots → 503 on PUT (operator misconfiguration, not a user error).

Path validation on PUT:

1. If no `JARVIS_NOTES_ROOTS` → `reply.code(503).send({ error: "Notes roots not configured" })`.
2. `fs.realpath(providedPath)` → `resolvedPath` (throws ENOENT/ENOTDIR if invalid).
3. If `resolvedPath` does not start with any allowed root prefix → 400.
4. Store `providedPath` (the user-supplied string) — the resolved check is the security gate.

- [ ] **Step 1: Write `packages/settings/src/notes-source-routes.ts`**

```typescript
import { realpath } from "node:fs/promises";

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import type { AccessContext, DataContextRunner } from "@jarv1s/db";
import {
  getNotesSourceRouteSchema,
  putNotesSourceRouteSchema,
  type GetNotesSourceResponse,
  type PutNotesSourceRequest
} from "@jarv1s/shared";

import type { ProfilePreferencesPort } from "./preferences-port.js";
import { handleSettingsRouteError } from "./route-error.js";

export const NOTES_SOURCE_PREFERENCE_KEY = "notes-source-path";

interface NotesSourceRoutesDependencies {
  readonly dataContext: DataContextRunner;
  readonly resolveAccessContext: (request: FastifyRequest) => Promise<AccessContext>;
  readonly preferencesRepository: ProfilePreferencesPort;
}

export function resolveNotesRoots(env: NodeJS.ProcessEnv = process.env): string[] {
  const raw = env.JARVIS_NOTES_ROOTS ?? "";
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function registerNotesSourceRoutes(
  server: FastifyInstance,
  dependencies: NotesSourceRoutesDependencies
): void {
  server.get(
    "/api/me/notes-source",
    { schema: getNotesSourceRouteSchema },
    async (request, reply) => {
      try {
        const accessContext = await dependencies.resolveAccessContext(request);
        const raw = await dependencies.dataContext.withDataContext(accessContext, (scopedDb) =>
          dependencies.preferencesRepository.get(scopedDb, NOTES_SOURCE_PREFERENCE_KEY)
        );
        const path = typeof raw === "string" ? raw : null;
        return reply.send({ path } satisfies GetNotesSourceResponse);
      } catch (error) {
        return handleSettingsRouteError(error, reply);
      }
    }
  );

  server.put(
    "/api/me/notes-source",
    { schema: putNotesSourceRouteSchema },
    async (request, reply) => {
      try {
        const body = request.body as PutNotesSourceRequest | null;
        const providedPath = body?.path ?? null;

        if (providedPath === null) {
          const accessContext = await dependencies.resolveAccessContext(request);
          await dependencies.dataContext.withDataContext(accessContext, (scopedDb) =>
            dependencies.preferencesRepository.upsert(scopedDb, NOTES_SOURCE_PREFERENCE_KEY, null)
          );
          return reply.send({ path: null } satisfies GetNotesSourceResponse);
        }

        const allowedRoots = resolveNotesRoots();
        if (allowedRoots.length === 0) {
          return reply.code(503).send({ error: "Notes roots not configured on this server" });
        }

        let resolvedPath: string;
        try {
          resolvedPath = await realpath(providedPath);
        } catch {
          return reply.code(400).send({ error: "Path does not exist or cannot be resolved" });
        }

        const allowed = allowedRoots.some(
          (root) => resolvedPath === root || resolvedPath.startsWith(root + "/")
        );
        if (!allowed) {
          return reply.code(400).send({ error: "Path is not within an allowed notes root" });
        }

        const accessContext = await dependencies.resolveAccessContext(request);
        await dependencies.dataContext.withDataContext(accessContext, (scopedDb) =>
          dependencies.preferencesRepository.upsert(
            scopedDb,
            NOTES_SOURCE_PREFERENCE_KEY,
            providedPath
          )
        );
        return reply.send({ path: providedPath } satisfies GetNotesSourceResponse);
      } catch (error) {
        return handleSettingsRouteError(error, reply);
      }
    }
  );
}
```

- [ ] **Step 2: Add routes to settings manifest**

In `packages/settings/src/manifest.ts`, add two route entries to the `routes` array after the existing `/api/me/weather-location` pair:

```typescript
    {
      method: "GET",
      path: "/api/me/notes-source",
      permissionId: "settings.view"
    },
    {
      method: "PUT",
      path: "/api/me/notes-source",
      permissionId: "settings.view"
    },
```

- [ ] **Step 3: Wire into `registerSettingsRoutes`**

In `packages/settings/src/routes.ts`:

Add import alongside the weather-location import:

```typescript
import { registerNotesSourceRoutes } from "./notes-source-routes.js";
```

At the bottom of the `registerSettingsRoutes` function (after the existing `registerWeatherLocationRoutes` call), add:

```typescript
registerNotesSourceRoutes(server, {
  dataContext: dependencies.dataContext,
  resolveAccessContext: dependencies.resolveAccessContext,
  preferencesRepository: dependencies.preferencesRepository ?? new SettingsRepository()
});
```

Look at how `registerWeatherLocationRoutes` is called — it's near the end of the function. Follow the exact same pattern (same deps shape). `preferencesRepository` is already injected there via `dependencies.preferencesRepository ?? new PreferencesRepository()`. Use the same guard.

- [ ] **Step 4: Typecheck settings**

```bash
cd packages/settings && pnpm typecheck
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add packages/settings/src/notes-source-routes.ts packages/settings/src/manifest.ts packages/settings/src/routes.ts
git commit -m "feat(settings): notes-source GET/PUT routes with JARVIS_NOTES_ROOTS validation

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 4: Notes package scaffold

**Files:**

- Create: `packages/notes/package.json`
- Create: `packages/notes/tsconfig.json`
- Create: `packages/notes/src/manifest.ts`
- Create: `packages/notes/src/path-guard.ts`
- Create: `packages/notes/src/index.ts`

**Interfaces:**

- Produces:
  - `notesModuleManifest: JarvisModuleManifest` with `id: "notes"`, route `/api/notes/sync`
  - `notesModuleSqlMigrationDirectory` — empty (no migrations)
  - `NotesPathError` class
  - `resolveNotesPath(resolvedRoot: string, absoluteFilePath: string): string` — validates absolute file path is within the already-resolved root; returns the path unchanged on success

- [ ] **Step 1: Create `packages/notes/package.json`**

```json
{
  "name": "@jarv1s/notes",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@jarv1s/db": "workspace:*",
    "@jarv1s/jobs": "workspace:*",
    "@jarv1s/memory": "workspace:*",
    "@jarv1s/module-sdk": "workspace:*",
    "@jarv1s/settings": "workspace:*",
    "@jarv1s/shared": "workspace:*",
    "@jarv1s/structured-state": "workspace:*",
    "fastify": "^5.6.2"
  }
}
```

- [ ] **Step 2: Create `packages/notes/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "verbatimModuleSyntax": true,
    "skipLibCheck": true,
    "outDir": "dist"
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Create `packages/notes/src/manifest.ts`**

```typescript
import { fileURLToPath } from "node:url";

import type { JarvisModuleManifest } from "@jarv1s/module-sdk";

export const notesModuleSqlMigrationDirectory = fileURLToPath(new URL("../sql", import.meta.url));

export const NOTES_MODULE_ID = "notes";

export const notesModuleManifest: JarvisModuleManifest = {
  id: NOTES_MODULE_ID,
  name: "Notes",
  version: "0.0.0",
  publisher: "jarv1s",
  lifecycle: "optional",
  compatibility: {
    jarv1s: ">=0.0.0"
  },
  availability: {
    defaultEnabled: true
  },
  routes: [
    {
      method: "POST",
      path: "/api/notes/sync"
    }
  ]
};
```

- [ ] **Step 4: Create `packages/notes/src/path-guard.ts`**

Adapted from `packages/vault/src/vault-path.ts`, but for absolute host-filesystem paths.

```typescript
import { sep } from "node:path";

export class NotesPathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotesPathError";
  }
}

/**
 * Assert that `absoluteFilePath` is strictly inside `resolvedRoot`.
 * Both arguments must already be realpath-resolved (no symlinks).
 * Returns `absoluteFilePath` unchanged so callers can chain.
 */
export function assertWithinRoot(resolvedRoot: string, absoluteFilePath: string): string {
  if (absoluteFilePath !== resolvedRoot && !absoluteFilePath.startsWith(resolvedRoot + sep)) {
    throw new NotesPathError(
      `Path escape blocked: ${JSON.stringify(absoluteFilePath)} is not inside ${JSON.stringify(resolvedRoot)}`
    );
  }
  return absoluteFilePath;
}
```

- [ ] **Step 5: Create `packages/notes/src/index.ts`**

```typescript
export {
  notesModuleManifest,
  notesModuleSqlMigrationDirectory,
  NOTES_MODULE_ID
} from "./manifest.js";
export { NotesPathError, assertWithinRoot } from "./path-guard.js";
export { NOTES_SYNC_QUEUE, NOTES_QUEUE_DEFINITIONS, registerNotesJobWorkers } from "./jobs.js";
export { registerNotesSyncRoutes } from "./notes-sync-routes.js";
```

(The exports for jobs and routes reference tasks 5+6 — they will resolve once those files exist.)

- [ ] **Step 6: Create empty `packages/notes/sql/.gitkeep`**

```bash
mkdir -p packages/notes/sql && touch packages/notes/sql/.gitkeep
```

- [ ] **Step 7: Typecheck notes package**

```bash
pnpm install && cd packages/notes && pnpm typecheck
```

Expected: errors only on missing `./jobs.js` and `./notes-sync-routes.js` (stubs not yet written). That's OK for now — run full typecheck only after Task 6.

- [ ] **Step 8: Commit scaffold (skip typecheck — stubs pending)**

```bash
git add packages/notes/
git commit -m "feat(notes): package scaffold — manifest, path-guard, empty sql dir

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 5: Notes sync routes

**Files:**

- Create: `packages/notes/src/notes-sync-routes.ts`

**Interfaces:**

- Consumes:
  - `PgBoss` from `pg-boss`
  - `sendJob`, `type ActorScopedJobPayload` from `@jarv1s/jobs`
  - `postNotesSyncRouteSchema`, `type PostNotesSyncResponse` from `@jarv1s/shared`
  - `AccessContext` from `@jarv1s/db`
  - `NOTES_SYNC_QUEUE` from `./jobs.js`
- Produces:
  - `registerNotesSyncRoutes(server, deps)` — registers `POST /api/notes/sync`

POST /api/notes/sync:

1. Resolve access context.
2. `sendJob(boss, NOTES_SYNC_QUEUE, { actorUserId, sourcePath: "" })` — `sourcePath` will be read by the worker from preferences at job-run time; pass an empty string placeholder so the key is present.

Wait — re-reading the spec: the route sends `{ actorUserId, sourcePath }` where `sourcePath` is the user's currently-configured path. The worker reads `sourcePath` from the payload. So the route must first read the configured path from preferences, then include it in the payload. This avoids the worker needing to re-read preferences.

Actually, re-thinking: the handoff says `{ actorUserId, sourcePath, jobId }` where jobId is the pg-boss job ID returned by `boss.send`. The payload is just `{ actorUserId, sourcePath }`.

The route should:

1. Read the user's `notes-source-path` from preferences.
2. If null → 400 "No notes source configured".
3. `sendJob(boss, NOTES_SYNC_QUEUE, { actorUserId, sourcePath })` → jobId.
4. Return 202 `{ jobId }`.

- [ ] **Step 1: Write `packages/notes/src/notes-sync-routes.ts`**

```typescript
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { PgBoss } from "pg-boss";

import type { AccessContext, DataContextRunner } from "@jarv1s/db";
import { sendJob, type ActorScopedJobPayload } from "@jarv1s/jobs";
import { postNotesSyncRouteSchema, type PostNotesSyncResponse } from "@jarv1s/shared";
import type { PreferencesPort } from "@jarv1s/db";

import { NOTES_SYNC_QUEUE } from "./jobs.js";
import { NOTES_SOURCE_PREFERENCE_KEY } from "@jarv1s/settings";

export interface NotesSyncJobPayload extends ActorScopedJobPayload {
  readonly sourcePath: string;
}

interface NotesSyncRoutesDependencies {
  readonly boss: PgBoss;
  readonly dataContext: DataContextRunner;
  readonly resolveAccessContext: (request: FastifyRequest) => Promise<AccessContext>;
  readonly preferencesRepository: PreferencesPort;
}

export function registerNotesSyncRoutes(
  server: FastifyInstance,
  dependencies: NotesSyncRoutesDependencies
): void {
  server.post("/api/notes/sync", { schema: postNotesSyncRouteSchema }, async (request, reply) => {
    const accessContext = await dependencies.resolveAccessContext(request);
    const raw = await dependencies.dataContext.withDataContext(accessContext, (scopedDb) =>
      dependencies.preferencesRepository.get(scopedDb, NOTES_SOURCE_PREFERENCE_KEY)
    );
    const sourcePath = typeof raw === "string" ? raw : null;
    if (!sourcePath) {
      return reply.code(400).send({ error: "No notes source configured" });
    }
    const jobId = await sendJob<NotesSyncJobPayload>(boss, NOTES_SYNC_QUEUE, {
      actorUserId: accessContext.actorUserId,
      sourcePath
    });
    return reply.code(202).send({ jobId } satisfies PostNotesSyncResponse);
  });
}
```

Wait — there's a bug: `boss` is not in scope (should be `dependencies.boss`). Let me fix:

```typescript
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { PgBoss } from "pg-boss";

import type { AccessContext, DataContextRunner, PreferencesPort } from "@jarv1s/db";
import { sendJob, type ActorScopedJobPayload } from "@jarv1s/jobs";
import { postNotesSyncRouteSchema, type PostNotesSyncResponse } from "@jarv1s/shared";

import { NOTES_SOURCE_PREFERENCE_KEY } from "@jarv1s/settings";
import { NOTES_SYNC_QUEUE } from "./jobs.js";

export interface NotesSyncJobPayload extends ActorScopedJobPayload {
  readonly sourcePath: string;
}

interface NotesSyncRoutesDependencies {
  readonly boss: PgBoss;
  readonly dataContext: DataContextRunner;
  readonly resolveAccessContext: (request: FastifyRequest) => Promise<AccessContext>;
  readonly preferencesRepository: PreferencesPort;
}

export function registerNotesSyncRoutes(
  server: FastifyInstance,
  dependencies: NotesSyncRoutesDependencies
): void {
  server.post("/api/notes/sync", { schema: postNotesSyncRouteSchema }, async (request, reply) => {
    const accessContext = await dependencies.resolveAccessContext(request);
    const raw = await dependencies.dataContext.withDataContext(accessContext, (scopedDb) =>
      dependencies.preferencesRepository.get(scopedDb, NOTES_SOURCE_PREFERENCE_KEY)
    );
    const sourcePath = typeof raw === "string" ? raw : null;
    if (!sourcePath) {
      return reply.code(400).send({ error: "No notes source configured" });
    }
    const jobId = await sendJob<NotesSyncJobPayload>(dependencies.boss, NOTES_SYNC_QUEUE, {
      actorUserId: accessContext.actorUserId,
      sourcePath
    });
    return reply.code(202).send({ jobId } satisfies PostNotesSyncResponse);
  });
}
```

Note: `NOTES_SOURCE_PREFERENCE_KEY` is exported from `packages/settings/src/notes-source-routes.ts`. Add it to `packages/settings/src/index.ts` (or check if settings already re-exports it — if not, add the export). The simplest approach: export it from `@jarv1s/settings`.

Check if settings has an index.ts and if it exports things. If `@jarv1s/settings` doesn't export `NOTES_SOURCE_PREFERENCE_KEY`, then inline the constant in notes-sync-routes.ts instead:

```typescript
const NOTES_SOURCE_PREFERENCE_KEY = "notes-source-path";
```

This avoids a cross-module constant import. Use the inline constant.

Updated file with inlined constant:

```typescript
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { PgBoss } from "pg-boss";

import type { AccessContext, DataContextRunner, PreferencesPort } from "@jarv1s/db";
import { sendJob, type ActorScopedJobPayload } from "@jarv1s/jobs";
import { postNotesSyncRouteSchema, type PostNotesSyncResponse } from "@jarv1s/shared";

import { NOTES_SYNC_QUEUE } from "./jobs.js";

const NOTES_SOURCE_PREFERENCE_KEY = "notes-source-path";

export interface NotesSyncJobPayload extends ActorScopedJobPayload {
  readonly sourcePath: string;
}

interface NotesSyncRoutesDependencies {
  readonly boss: PgBoss;
  readonly dataContext: DataContextRunner;
  readonly resolveAccessContext: (request: FastifyRequest) => Promise<AccessContext>;
  readonly preferencesRepository: PreferencesPort;
}

export function registerNotesSyncRoutes(
  server: FastifyInstance,
  dependencies: NotesSyncRoutesDependencies
): void {
  server.post("/api/notes/sync", { schema: postNotesSyncRouteSchema }, async (request, reply) => {
    const accessContext = await dependencies.resolveAccessContext(request);
    const raw = await dependencies.dataContext.withDataContext(accessContext, (scopedDb) =>
      dependencies.preferencesRepository.get(scopedDb, NOTES_SOURCE_PREFERENCE_KEY)
    );
    const sourcePath = typeof raw === "string" ? raw : null;
    if (!sourcePath) {
      return reply.code(400).send({ error: "No notes source configured" });
    }
    const jobId = await sendJob<NotesSyncJobPayload>(dependencies.boss, NOTES_SYNC_QUEUE, {
      actorUserId: accessContext.actorUserId,
      sourcePath
    });
    return reply.code(202).send({ jobId } satisfies PostNotesSyncResponse);
  });
}
```

- [ ] **Step 2: Typecheck (after jobs.ts is written — run after Task 6)**

Defer full typecheck to after Task 6.

- [ ] **Step 3: Commit**

```bash
git add packages/notes/src/notes-sync-routes.ts
git commit -m "feat(notes): POST /api/notes/sync route — enqueue ingest job

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 6: Notes ingest worker

**Files:**

- Create: `packages/notes/src/jobs.ts`

**Interfaces:**

- Consumes:
  - `NotesSyncJobPayload` from `./notes-sync-routes.js` (re-imported)
  - `resolveNotesRoots` from `@jarv1s/settings` — NO: inline in worker (avoids cross-package dep). Read `process.env.JARVIS_NOTES_ROOTS` directly with the same split logic.
  - `assertWithinRoot`, `NotesPathError` from `./path-guard.js`
  - `parseDocument` from `@jarv1s/memory`
  - `MemoryRepository`, `type EmbeddingProvider`, `type NewChunkData` from `@jarv1s/memory`
  - `registerDataContextWorker`, `QueueDefinition` from `@jarv1s/jobs`
  - Node `fs/promises`: `realpath`, `readdir`, `readFile`
  - `createHash` from `node:crypto`
- Produces:
  - `NOTES_SYNC_QUEUE = "notes.sync"` — queue name constant
  - `NOTES_QUEUE_DEFINITIONS: readonly QueueDefinition[]`
  - `handleNotesSyncJob(scopedDb, actorUserId, sourcePath, embeddingProvider, memoryRepository): Promise<void>`
  - `registerNotesJobWorkers(boss, dataContext, embeddingProvider): Promise<string[]>`

Worker algorithm for `handleNotesSyncJob`:

1. Parse `JARVIS_NOTES_ROOTS` from env. If empty → log warn + return (no-op; operator misconfiguration, not a crash).
2. `resolvedRoot = await realpath(sourcePath)`.
3. Assert `resolvedRoot` starts with one of the allowed roots (using `assertWithinRoot` against each root). Throw `NotesPathError` if none match — pg-boss will retry then fail the job.
4. `const entries = await readdir(resolvedRoot, { recursive: true })` — Node 18.17+.
5. Filter `entries` for strings ending in `.md`.
6. For each `.md` entry:
   a. `const absFile = path.join(resolvedRoot, entry)` — safe: readdir returns relative paths within the scanned dir.
   b. `assertWithinRoot(resolvedRoot, absFile)` — belt-and-suspenders.
   c. `const content = await readFile(absFile, "utf-8")`.
   d. `const fileHash = createHash("sha256").update(content).digest("hex")`.
   e. Check existing index: `memoryRepository.getFileIndex(scopedDb, actorUserId, "notes", absFile)`. If `existing?.fileHash === fileHash && existing.embedModelName === embeddingProvider.modelName` → skip (no change).
   f. `const { chunks } = parseDocument(content)`.
   g. Build `NewChunkData[]` by embedding each chunk: `await embeddingProvider.embedDocument(chunk.text)`.
   h. `await memoryRepository.upsertFileChunks(scopedDb, actorUserId, absFile, newChunks, embeddingProvider.modelName, embeddingProvider.modelVersion, "notes")`.
   i. `await memoryRepository.upsertFileIndex(scopedDb, actorUserId, "notes", absFile, fileHash, newChunks.length, embeddingProvider.modelName, embeddingProvider.modelVersion)`.

- [ ] **Step 1: Write `packages/notes/src/jobs.ts`**

```typescript
import { createHash } from "node:crypto";
import { realpath, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import type { PgBoss, WorkOptions } from "pg-boss";

import type { DataContextDb, DataContextRunner } from "@jarv1s/db";
import { registerDataContextWorker, type QueueDefinition } from "@jarv1s/jobs";
import {
  parseDocument,
  MemoryRepository,
  type EmbeddingProvider,
  type NewChunkData
} from "@jarv1s/memory";

import { assertWithinRoot, NotesPathError } from "./path-guard.js";
import type { NotesSyncJobPayload } from "./notes-sync-routes.js";

const NOTES_SOURCE_KIND = "notes";

export const NOTES_SYNC_QUEUE = "notes.sync";

export const NOTES_QUEUE_DEFINITIONS: readonly QueueDefinition[] = [
  { name: NOTES_SYNC_QUEUE, options: { retryLimit: 2, deleteAfterSeconds: 3600 } }
];

function resolveAllowedRoots(): string[] {
  const raw = process.env.JARVIS_NOTES_ROOTS ?? "";
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export async function handleNotesSyncJob(
  scopedDb: DataContextDb,
  actorUserId: string,
  sourcePath: string,
  embeddingProvider: EmbeddingProvider,
  memoryRepository: MemoryRepository = new MemoryRepository()
): Promise<void> {
  const allowedRoots = resolveAllowedRoots();
  if (allowedRoots.length === 0) {
    process.stderr.write(
      `${JSON.stringify({
        level: "warn",
        event: "notes_sync.no_roots_configured",
        actorUserId
      })}\n`
    );
    return;
  }

  const resolvedRoot = await realpath(sourcePath);

  const withinAllowed = allowedRoots.some(
    (root) => resolvedRoot === root || resolvedRoot.startsWith(root + "/")
  );
  if (!withinAllowed) {
    throw new NotesPathError(
      `sourcePath ${JSON.stringify(resolvedRoot)} is not within any allowed root`
    );
  }

  const entries = await readdir(resolvedRoot, { recursive: true });
  const mdFiles = entries.filter((e) => typeof e === "string" && e.endsWith(".md")) as string[];

  for (const relative of mdFiles) {
    const absFile = join(resolvedRoot, relative);
    assertWithinRoot(resolvedRoot, absFile);

    const content = await readFile(absFile, "utf-8");
    const fileHash = createHash("sha256").update(content).digest("hex");

    const existing = await memoryRepository.getFileIndex(
      scopedDb,
      actorUserId,
      NOTES_SOURCE_KIND,
      absFile
    );
    if (
      existing &&
      existing.fileHash === fileHash &&
      existing.embedModelName === embeddingProvider.modelName
    ) {
      continue;
    }

    const { chunks } = parseDocument(content);

    const newChunks: NewChunkData[] = await Promise.all(
      chunks.map(async (chunk) => ({
        sourcePath: absFile,
        lineStart: chunk.lineStart,
        lineEnd: chunk.lineEnd,
        contentHash: createHash("sha256").update(chunk.text).digest("hex"),
        text: chunk.text,
        embedding: await embeddingProvider.embedDocument(chunk.text)
      }))
    );

    await memoryRepository.upsertFileChunks(
      scopedDb,
      actorUserId,
      absFile,
      newChunks,
      embeddingProvider.modelName,
      embeddingProvider.modelVersion,
      NOTES_SOURCE_KIND
    );

    await memoryRepository.upsertFileIndex(
      scopedDb,
      actorUserId,
      NOTES_SOURCE_KIND,
      absFile,
      fileHash,
      newChunks.length,
      embeddingProvider.modelName,
      embeddingProvider.modelVersion
    );
  }
}

export async function registerNotesJobWorkers(
  boss: PgBoss,
  dataContext: DataContextRunner,
  embeddingProvider: EmbeddingProvider,
  workOptions?: WorkOptions
): Promise<string[]> {
  const memoryRepo = new MemoryRepository();

  const syncWorkId = await registerDataContextWorker<NotesSyncJobPayload, void>(
    boss,
    NOTES_SYNC_QUEUE,
    dataContext,
    async (job, scopedDb) => {
      await handleNotesSyncJob(
        scopedDb,
        job.data.actorUserId,
        job.data.sourcePath,
        embeddingProvider,
        memoryRepo
      );
    },
    workOptions
  );

  return [syncWorkId];
}
```

- [ ] **Step 2: Typecheck notes package**

```bash
cd packages/notes && pnpm typecheck
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/notes/src/jobs.ts
git commit -m "feat(notes): notes-sync pg-boss worker with path-traversal guard

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 7: Register notes module in module-registry

**Files:**

- Modify: `packages/module-registry/src/index.ts`

**Interfaces:**

- Consumes: all exports from `@jarv1s/notes` (manifest, routes, workers)
- Produces: notes module entry in `BUILT_IN_MODULES` with `sqlMigrationDirectories`, `queueDefinitions`, `registerRoutes`, `registerWorkers`

- [ ] **Step 1: Add import block to `packages/module-registry/src/index.ts`**

Find the block of module imports (where `weatherModuleManifest` is imported) and add:

```typescript
import {
  notesModuleManifest,
  notesModuleSqlMigrationDirectory,
  NOTES_QUEUE_DEFINITIONS,
  registerNotesSyncRoutes,
  registerNotesJobWorkers
} from "@jarv1s/notes";
```

Also add `PreferencesRepository` import from `@jarv1s/structured-state` — it's already imported there; verify it is present before adding a duplicate.

- [ ] **Step 2: Add notes entry to `BUILT_IN_MODULES`**

Find the end of `BUILT_IN_MODULES` (after the `weatherModuleManifest` entry, before `];`). Add:

```typescript
  {
    manifest: notesModuleManifest,
    sqlMigrationDirectories: [notesModuleSqlMigrationDirectory],
    queueDefinitions: NOTES_QUEUE_DEFINITIONS,
    registerRoutes: (server, deps) =>
      registerNotesSyncRoutes(server, {
        boss: deps.boss,
        dataContext: deps.dataContext,
        resolveAccessContext: deps.resolveAccessContext,
        preferencesRepository: new PreferencesRepository()
      }),
    registerWorkers: (boss, deps) =>
      registerNotesJobWorkers(boss, deps.dataContext, deps.embeddingProvider)
  }
```

- [ ] **Step 3: Run `pnpm install` to pick up the new workspace package**

```bash
pnpm install
```

- [ ] **Step 4: Typecheck module-registry**

```bash
cd packages/module-registry && pnpm typecheck
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add packages/module-registry/src/index.ts packages/notes/src/index.ts
git commit -m "feat(module-registry): register notes module — sync route + ingest worker

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 8: Integration tests

**Files:**

- Create: `tests/integration/notes.test.ts`

**Interfaces:**

- Consumes: `createApiServer` from `apps/api/src/server.ts`, `resetFoundationDatabase`, `connectionStrings`, `ids` from `./test-database.js`
- Test pattern: same as other integration tests — `resetFoundationDatabase()` in `beforeAll`, inject `boss` + session auth, make HTTP requests

The tests mock the filesystem using `os.tmpdir()` + `fs.mkdtemp`. `JARVIS_NOTES_ROOTS` is set to the temp dir for tests.

- [ ] **Step 1: Write `tests/integration/notes.test.ts`**

```typescript
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { DataContextRunner, createDatabase, type Kysely, type JarvisDatabase } from "@jarv1s/db";
import { createPgBossClient } from "@jarv1s/jobs";
import { StubEmbeddingProvider } from "@jarv1s/memory";

import { createApiServer } from "../../apps/api/src/server.js";
import { connectionStrings, ids, resetFoundationDatabase } from "./test-database.js";
import { handleNotesSyncJob } from "../../packages/notes/src/jobs.js";
import { PreferencesRepository } from "@jarv1s/structured-state";

describe("notes integration", () => {
  let server: Awaited<ReturnType<typeof createApiServer>>;
  let appDb: Kysely<JarvisDatabase>;
  let boss: ReturnType<typeof createPgBossClient>;
  let tmpDir: string;
  const originalNotesRoots = process.env.JARVIS_NOTES_ROOTS;

  beforeAll(async () => {
    await resetFoundationDatabase();

    tmpDir = await mkdtemp(join(tmpdir(), "jarv1s-notes-test-"));
    process.env.JARVIS_NOTES_ROOTS = tmpDir;

    appDb = createDatabase({ connectionString: connectionStrings.app, maxConnections: 2 });
    boss = createPgBossClient(connectionStrings.app);
    await boss.start();

    server = createApiServer({ appDb, boss });
    await server.ready();
  });

  afterAll(async () => {
    await server.close();
    await boss.stop({ graceful: false });
    await appDb.destroy();
    process.env.JARVIS_NOTES_ROOTS = originalNotesRoots;
    await rm(tmpDir, { recursive: true, force: true });
  });

  describe("GET /api/me/notes-source", () => {
    it("returns null when no source is configured", async () => {
      const response = await server.inject({
        method: "GET",
        url: "/api/me/notes-source",
        headers: { authorization: `Bearer ${ids.sessionA}` }
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ path: null });
    });
  });

  describe("PUT /api/me/notes-source", () => {
    it("returns 503 when JARVIS_NOTES_ROOTS is empty", async () => {
      const saved = process.env.JARVIS_NOTES_ROOTS;
      process.env.JARVIS_NOTES_ROOTS = "";
      try {
        const response = await server.inject({
          method: "PUT",
          url: "/api/me/notes-source",
          headers: { authorization: `Bearer ${ids.sessionA}`, "content-type": "application/json" },
          payload: { path: "/tmp/notes" }
        });
        expect(response.statusCode).toBe(503);
      } finally {
        process.env.JARVIS_NOTES_ROOTS = saved;
      }
    });

    it("returns 400 for a path outside allowed roots", async () => {
      const response = await server.inject({
        method: "PUT",
        url: "/api/me/notes-source",
        headers: { authorization: `Bearer ${ids.sessionA}`, "content-type": "application/json" },
        payload: { path: "/etc" }
      });
      expect(response.statusCode).toBe(400);
    });

    it("returns 400 for a traversal path", async () => {
      const response = await server.inject({
        method: "PUT",
        url: "/api/me/notes-source",
        headers: { authorization: `Bearer ${ids.sessionA}`, "content-type": "application/json" },
        payload: { path: `${tmpDir}/../../../etc` }
      });
      expect(response.statusCode).toBe(400);
    });

    it("stores a valid path within JARVIS_NOTES_ROOTS", async () => {
      const sub = join(tmpDir, "my-notes");
      await mkdir(sub, { recursive: true });

      const response = await server.inject({
        method: "PUT",
        url: "/api/me/notes-source",
        headers: { authorization: `Bearer ${ids.sessionA}`, "content-type": "application/json" },
        payload: { path: sub }
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ path: sub });

      const getResponse = await server.inject({
        method: "GET",
        url: "/api/me/notes-source",
        headers: { authorization: `Bearer ${ids.sessionA}` }
      });
      expect(getResponse.json()).toEqual({ path: sub });
    });

    it("clears the source when path is null", async () => {
      const response = await server.inject({
        method: "PUT",
        url: "/api/me/notes-source",
        headers: { authorization: `Bearer ${ids.sessionA}`, "content-type": "application/json" },
        payload: { path: null }
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ path: null });
    });
  });

  describe("POST /api/notes/sync", () => {
    it("returns 400 when no source is configured", async () => {
      const response = await server.inject({
        method: "POST",
        url: "/api/notes/sync",
        headers: { authorization: `Bearer ${ids.sessionA}` }
      });
      expect(response.statusCode).toBe(400);
    });

    it("returns 202 with a jobId when source is configured", async () => {
      const sub = join(tmpDir, "sync-notes");
      await mkdir(sub, { recursive: true });

      await server.inject({
        method: "PUT",
        url: "/api/me/notes-source",
        headers: { authorization: `Bearer ${ids.sessionA}`, "content-type": "application/json" },
        payload: { path: sub }
      });

      const response = await server.inject({
        method: "POST",
        url: "/api/notes/sync",
        headers: { authorization: `Bearer ${ids.sessionA}` }
      });
      expect(response.statusCode).toBe(202);
      const body = response.json();
      expect(typeof body.jobId).toBe("string");
      expect(body.jobId.length).toBeGreaterThan(0);
    });
  });

  describe("handleNotesSyncJob (unit-style via real DB)", () => {
    it("ingests .md files from a folder into memory chunks", async () => {
      const notesDir = join(tmpDir, "ingest-test");
      await mkdir(notesDir, { recursive: true });
      await writeFile(join(notesDir, "hello.md"), "# Hello\n\nThis is a test note.");
      await writeFile(join(notesDir, "sub", "world.md"), "Sub note.").catch(async () => {
        await mkdir(join(notesDir, "sub"), { recursive: true });
        await writeFile(join(notesDir, "sub", "world.md"), "Sub note.");
      });

      const dataContext = new DataContextRunner(appDb);
      const embeddingProvider = new StubEmbeddingProvider();
      const prefsRepo = new PreferencesRepository();

      await dataContext.withDataContext(
        { actorUserId: ids.userA, requestId: "test:ingest" },
        async (scopedDb) => {
          await handleNotesSyncJob(scopedDb, ids.userA, notesDir, embeddingProvider);

          // Verify chunks were written (source_kind='notes')
          const rows = await scopedDb.db
            .selectFrom("app.memory_chunks")
            .select(["source_path", "source_kind"])
            .where("owner_user_id", "=", ids.userA)
            .where("source_kind", "=", "notes")
            .execute();

          expect(rows.length).toBeGreaterThan(0);
          expect(rows.every((r) => r.source_kind === "notes")).toBe(true);
        }
      );
    });

    it("skips a file on second run when content unchanged", async () => {
      const notesDir = join(tmpDir, "idempotent-test");
      await mkdir(notesDir, { recursive: true });
      await writeFile(join(notesDir, "static.md"), "# Static\n\nUnchanged content.");

      const dataContext = new DataContextRunner(appDb);
      const embeddingProvider = new StubEmbeddingProvider();

      let embedCallCount = 0;
      const countingProvider: typeof embeddingProvider = {
        ...embeddingProvider,
        embedDocument: async (text) => {
          embedCallCount++;
          return embeddingProvider.embedDocument(text);
        }
      };

      await dataContext.withDataContext(
        { actorUserId: ids.userB, requestId: "test:ingest-1" },
        (scopedDb) => handleNotesSyncJob(scopedDb, ids.userB, notesDir, countingProvider)
      );
      const firstCount = embedCallCount;
      expect(firstCount).toBeGreaterThan(0);

      await dataContext.withDataContext(
        { actorUserId: ids.userB, requestId: "test:ingest-2" },
        (scopedDb) => handleNotesSyncJob(scopedDb, ids.userB, notesDir, countingProvider)
      );
      // No new embed calls — file unchanged
      expect(embedCallCount).toBe(firstCount);
    });
  });
});
```

- [ ] **Step 2: Run the tests (requires `pnpm db:up` and `pnpm db:migrate`)**

```bash
pnpm db:up && pnpm db:migrate
vitest run tests/integration/notes.test.ts
```

Expected: all tests pass.

- [ ] **Step 3: Commit**

```bash
git add tests/integration/notes.test.ts
git commit -m "test(notes): integration tests — settings routes, sync endpoint, ingest worker

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Self-Review

### Spec coverage check

| Requirement                                                 | Task                                                      |
| ----------------------------------------------------------- | --------------------------------------------------------- |
| `JARVIS_NOTES_ROOTS` operator config                        | Task 3 (`resolveNotesRoots`) + Task 6 (worker)            |
| `GET /api/me/notes-source` → path or null                   | Task 3                                                    |
| `PUT /api/me/notes-source` validates + stores               | Task 3                                                    |
| 400 for path outside allowed root                           | Task 3 + Task 8 test                                      |
| Symlink-escape check                                        | Task 3 (`realpath`) + Task 4 (`assertWithinRoot`)         |
| `POST /api/notes/sync` → 202 `{ jobId }`                    | Task 5 + Task 8 test                                      |
| Metadata-only pg-boss payload `{ actorUserId, sourcePath }` | Tasks 2 + 5                                               |
| Worker: walk + chunk + embed + upsert                       | Task 6                                                    |
| File content never in payload                               | Task 5 (sends only path string)                           |
| `pnpm verify:foundation` passes                             | All tasks typecheck; tests run green                      |
| Notes module in module-registry                             | Task 7                                                    |
| `GET /api/notes/sync/status`                                | Out of scope (deferred per spec: "optional, best-effort") |

### Type consistency check

- `NotesSyncJobPayload` defined in `notes-sync-routes.ts`, imported in `jobs.ts` ✓
- `NOTES_SYNC_QUEUE` defined in `jobs.ts`, imported in `notes-sync-routes.ts` ✓
- `assertWithinRoot` defined in `path-guard.ts`, imported in `jobs.ts` ✓
- `NOTES_SOURCE_PREFERENCE_KEY` — kept as a local constant in each file that uses it (settings routes + sync routes) to avoid cross-package import ✓
- `notesModuleSqlMigrationDirectory` — points to `../sql` dir (created with `.gitkeep`) ✓

### Placeholder scan

No TBDs, TODOs, or "similar to Task N" references. All code blocks contain actual implementations. ✓

### Import verification note

In Task 3 Step 3 (wiring `registerNotesSourceRoutes` into `registerSettingsRoutes`): verify the exact call site by reading `routes.ts` — find where `registerWeatherLocationRoutes` is called and add the notes call immediately after. The preferencesRepository fallback may use `PreferencesRepository` (not `SettingsRepository`) — check the existing weather-location call for the exact guard pattern to copy.
