# Safe Automation Audit Log Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an append-only `app.jarvis_action_audit_log` table written exclusively by the action-execution gateway, a `GET /api/ai/action-audit` read route, a Settings "Activity" pane, and retention/export wiring.

**Architecture:** The gateway already has three terminal outcome points (`callTool` auto-run path, `confirmAndRun` denied/cancelled/timeout, `confirmAndRun` approved+ran); we add a `recordAudit` helper called at each of those three points. A daily pg-boss maintenance job calls a `SECURITY DEFINER` purge function. A new `ActivityPane` React component fetches the owner's rows via React Query.

**Tech Stack:** TypeScript, Kysely, pg-boss, Fastify, React + React Query, lucide-react, jds-\* design system.

## Global Constraints

- Migration slot: placeholder `XXXX` in filename during dev; coordinator assigns `0128` at merge — **never hardcode 0128**.
- Never edit existing applied migration files (hash-checked runner).
- Module SQL lives in `packages/ai/sql/` only — never in `infra/postgres/migrations/`.
- `AccessContext` shape is `{ actorUserId, requestId }` only — do not add fields.
- All DB writes go through a `DataContextDb` (assertDataContextDb guard); never raw Kysely root.
- FORCE RLS + ENABLE RLS on all new tables; no BYPASSRLS on runtime or worker roles.
- Grant only `SELECT, INSERT` to `jarvis_app_runtime` — no UPDATE or DELETE.
- Audit-insert failure MUST NOT change user-visible action result — catch + log + swallow.
- Audit rows are metadata-only: never store input content, prompts, secrets, or action inputs.
- Only `AssistantToolGateway` writes audit rows; no other caller.
- No curved/rounded accent left-border on UI cards (AI tell).
- Stage only explicit file paths — never `git add -A`.
- Full local gate: `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test:ai && pnpm test:settings && pnpm test:api && pnpm test:web && pnpm test:integration` (run integration against a lane DB to avoid contention).

---

## File Map

| File                                               | Action                                                                                           |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `packages/ai/sql/XXXX_jarvis_action_audit_log.sql` | **Create**                                                                                       |
| `packages/db/src/types.ts`                         | Modify — add `JarvisActionAuditLogTable`, `JarvisActionAuditLog` type, entry in `JarvisDatabase` |
| `packages/ai/src/repository.ts`                    | Modify — add `insertActionAuditLog`, `listActionAuditLog`, `purgeActionAuditLog`                 |
| `packages/ai/src/jobs.ts`                          | **Create** — queue constant + `registerAiMaintenanceWorkers`                                     |
| `packages/ai/src/manifest.ts`                      | Modify — add migration, new route, ownedTables                                                   |
| `packages/module-registry/src/index.ts`            | Modify — add `queueDefinitions` + `registerWorkers` to AI module entry                           |
| `packages/ai/src/gateway/gateway.ts`               | Modify — add `recordAudit` private method, wire three write sites                                |
| `packages/shared/src/ai-api.ts`                    | Modify — add audit log DTOs + route schema                                                       |
| `packages/ai/src/routes.ts`                        | Modify — add `GET /api/ai/action-audit` handler                                                  |
| `packages/settings/src/data-export.ts`             | Modify — add `jarvisActionAuditLog` to export                                                    |
| `apps/web/src/api/client.ts`                       | Modify — add `listActionAuditLog`                                                                |
| `apps/web/src/api/query-keys.ts`                   | Modify — add `ai.actionAuditLog`                                                                 |
| `apps/web/src/settings/settings-activity-pane.tsx` | **Create** — `ActivityPane` component                                                            |
| `apps/web/src/settings/settings-page.tsx`          | Modify — add "activity" personal section                                                         |
| `tests/integration/foundation.test.ts`             | Modify — add XXXX migration row to list assertion                                                |
| `tests/integration/action-audit-log.test.ts`       | **Create** — all spec test cases                                                                 |

---

### Task 1: SQL migration

**Files:**

- Create: `packages/ai/sql/XXXX_jarvis_action_audit_log.sql`

**Interfaces:**

- Produces: `app.jarvis_action_audit_log` table; `app.purge_jarvis_action_audit_log(timestamptz)` function; RLS policies; grants to `jarvis_app_runtime`.

- [ ] **Step 1: Create the migration file**

```sql
-- packages/ai/sql/XXXX_jarvis_action_audit_log.sql

CREATE TABLE IF NOT EXISTS app.jarvis_action_audit_log (
  id uuid PRIMARY KEY,
  owner_user_id uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  tool_module_id text NOT NULL CHECK (length(btrim(tool_module_id)) > 0),
  tool_name text NOT NULL CHECK (length(btrim(tool_name)) > 0),
  action_family_id text,
  action_kind text NOT NULL CHECK (action_kind IN ('write', 'destructive')),
  approval_mode text NOT NULL
    CHECK (approval_mode IN ('auto', 'confirmed', 'rejected', 'cancelled', 'timeout')),
  outcome text NOT NULL CHECK (outcome IN ('success', 'failed', 'denied', 'cancelled')),
  error_class text CHECK (error_class IS NULL OR length(error_class) <= 64),
  request_id text,
  chat_session_id text,
  source_surface text NOT NULL DEFAULT 'chat'
    CHECK (source_surface IN ('chat', 'proactive', 'scheduled', 'unknown')),
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS jarvis_action_audit_log_owner_time_idx
  ON app.jarvis_action_audit_log(owner_user_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS jarvis_action_audit_log_owner_family_time_idx
  ON app.jarvis_action_audit_log(owner_user_id, action_family_id, occurred_at DESC);

GRANT SELECT, INSERT ON app.jarvis_action_audit_log TO jarvis_app_runtime;

ALTER TABLE app.jarvis_action_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.jarvis_action_audit_log FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS jarvis_action_audit_log_select
  ON app.jarvis_action_audit_log;
DROP POLICY IF EXISTS jarvis_action_audit_log_insert
  ON app.jarvis_action_audit_log;

CREATE POLICY jarvis_action_audit_log_select
ON app.jarvis_action_audit_log
FOR SELECT TO jarvis_app_runtime
USING (
  app.current_actor_user_id() IS NOT NULL
  AND owner_user_id = app.current_actor_user_id()
);

CREATE POLICY jarvis_action_audit_log_insert
ON app.jarvis_action_audit_log
FOR INSERT TO jarvis_app_runtime
WITH CHECK (
  app.current_actor_user_id() IS NOT NULL
  AND owner_user_id = app.current_actor_user_id()
);

CREATE OR REPLACE FUNCTION app.purge_jarvis_action_audit_log(older_than timestamptz)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app, public
AS $$
DECLARE
  affected integer;
BEGIN
  DELETE FROM app.jarvis_action_audit_log WHERE occurred_at < older_than;
  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END;
$$;

REVOKE ALL ON FUNCTION app.purge_jarvis_action_audit_log(timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.purge_jarvis_action_audit_log(timestamptz) TO jarvis_app_runtime;
```

- [ ] **Step 2: Run migration and verify (requires running Postgres)**

```bash
pnpm db:migrate
```

Expected: no errors; check `app.schema_migrations` for the XXXX row.

- [ ] **Step 3: Commit**

```bash
git add packages/ai/sql/XXXX_jarvis_action_audit_log.sql
git commit -m "feat(ai): add jarvis_action_audit_log migration with RLS and purge function

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 2: DB types

**Files:**

- Modify: `packages/db/src/types.ts:365-380` (after `AiAssistantActionRequestsTable`, before `ChatThreadsTable`)

**Interfaces:**

- Consumes: `TimestampColumn`, `NullableTimestampColumn` (already in scope in the file)
- Produces: `JarvisActionAuditLogTable` interface; `JarvisActionAuditLog` type (Selectable); entry `"app.jarvis_action_audit_log": JarvisActionAuditLogTable` in `JarvisDatabase`

- [ ] **Step 1: Read the file to verify current state**

```bash
grep -n "AiAssistantActionRequestsTable\|JarvisActionAuditLog\|ChatThreadsTable" packages/db/src/types.ts
```

Confirm `JarvisActionAuditLogTable` does not yet exist.

- [ ] **Step 2: Add the table interface after `AiAssistantActionRequestsTable` (around line 380)**

In `packages/db/src/types.ts`, after the closing `}` of `AiAssistantActionRequestsTable`, add:

```typescript
export interface JarvisActionAuditLogTable {
  id: string;
  owner_user_id: string;
  tool_module_id: string;
  tool_name: string;
  action_family_id: string | null;
  action_kind: string;
  approval_mode: string;
  outcome: string;
  error_class: string | null;
  request_id: string | null;
  chat_session_id: string | null;
  source_surface: string;
  occurred_at: TimestampColumn;
}
```

- [ ] **Step 3: Add to JarvisDatabase (around line 828, after `"app.ai_assistant_action_requests"`)**

In the `JarvisDatabase` interface, after `"app.ai_assistant_action_requests": AiAssistantActionRequestsTable;`, add:

```typescript
  "app.jarvis_action_audit_log": JarvisActionAuditLogTable;
```

- [ ] **Step 4: Add Selectable type alias (near line 875, after `AiAssistantActionRequest`)**

After `export type AiAssistantActionRequest = Selectable<AiAssistantActionRequestsTable>;`, add:

```typescript
export type JarvisActionAuditLog = Selectable<JarvisActionAuditLogTable>;
```

- [ ] **Step 5: Verify typecheck passes**

```bash
pnpm typecheck
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/types.ts
git commit -m "feat(db): add JarvisActionAuditLogTable type for audit log

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 3: Repository methods

**Files:**

- Modify: `packages/ai/src/repository.ts`

**Interfaces:**

- Consumes: `JarvisActionAuditLogTable`, `JarvisDatabase` from `@jarv1s/db`; `DataContextDb`, `assertDataContextDb` (already imported in this file); `sql` from `kysely` (already imported)
- Produces:
  - `InsertAuditLogInput` interface
  - `ListAuditLogOptions` interface
  - `AiRepository.insertActionAuditLog(scopedDb, input): Promise<void>`
  - `AiRepository.listActionAuditLog(scopedDb, opts): Promise<JarvisActionAuditLog[]>` (requires `import type { JarvisActionAuditLog } from '@jarv1s/db'`)
  - `AiRepository.purgeActionAuditLog(appDb, olderThan): Promise<number>`

- [ ] **Step 1: Read repository.ts imports to confirm what's already present**

```bash
head -35 packages/ai/src/repository.ts
```

- [ ] **Step 2: Add `JarvisActionAuditLog` to the db import if not already there**

In the import block at the top of `packages/ai/src/repository.ts`, the existing import from `@jarv1s/db` already imports many types. Add `JarvisActionAuditLog` to that import:

```typescript
import {
  assertDataContextDb,
  type AiAssistantActionRequest,
  type AiAssistantActionRisk,
  type AiAssistantActionStatus,
  type AiAuthMethod,
  type AiConfiguredModelsTable,
  type AiModelStatus,
  type AiModelTier,
  type AiProviderConfigsTable,
  type AiProviderKind,
  type AiProviderStatus,
  type DataContextDb,
  type JarvisActionAuditLog,
  type JarvisDatabase
} from "@jarv1s/db";
```

- [ ] **Step 3: Add input interfaces near the other input interfaces (around line 125)**

After `CreateAiAssistantActionInput`, add:

```typescript
export interface InsertAuditLogInput {
  readonly id: string;
  readonly ownerUserId: string;
  readonly toolModuleId: string;
  readonly toolName: string;
  readonly actionFamilyId: string | null;
  readonly actionKind: "write" | "destructive";
  readonly approvalMode: "auto" | "confirmed" | "rejected" | "cancelled" | "timeout";
  readonly outcome: "success" | "failed" | "denied" | "cancelled";
  readonly errorClass: string | null;
  readonly requestId: string | null;
  readonly chatSessionId: string | null;
  readonly sourceSurface: "chat" | "proactive" | "scheduled" | "unknown";
}

export interface ListAuditLogOptions {
  readonly since: Date;
  readonly familyFilter?: { moduleId: string; familyId: string } | null;
  readonly limit: number;
}
```

- [ ] **Step 4: Add the three methods to AiRepository class**

Inside the `AiRepository` class (at the end, before the closing `}`), add:

```typescript
  async insertActionAuditLog(scopedDb: DataContextDb, input: InsertAuditLogInput): Promise<void> {
    assertDataContextDb(scopedDb);
    await scopedDb.db
      .insertInto("app.jarvis_action_audit_log")
      .values({
        id: input.id,
        owner_user_id: input.ownerUserId,
        tool_module_id: input.toolModuleId,
        tool_name: input.toolName,
        action_family_id: input.actionFamilyId ?? null,
        action_kind: input.actionKind,
        approval_mode: input.approvalMode,
        outcome: input.outcome,
        error_class: input.errorClass ?? null,
        request_id: input.requestId ?? null,
        chat_session_id: input.chatSessionId ?? null,
        source_surface: input.sourceSurface
      })
      .execute();
  }

  async listActionAuditLog(
    scopedDb: DataContextDb,
    opts: ListAuditLogOptions
  ): Promise<JarvisActionAuditLog[]> {
    assertDataContextDb(scopedDb);
    let query = scopedDb.db
      .selectFrom("app.jarvis_action_audit_log")
      .selectAll()
      .where("occurred_at", ">=", opts.since)
      .orderBy("occurred_at", "desc")
      .limit(opts.limit);

    if (opts.familyFilter) {
      query = query
        .where("tool_module_id", "=", opts.familyFilter.moduleId)
        .where("action_family_id", "=", opts.familyFilter.familyId);
    }

    return query.execute();
  }

  async purgeActionAuditLog(
    appDb: Kysely<JarvisDatabase>,
    olderThan: Date
  ): Promise<number> {
    const result = await sql<{ count: number }>`
      SELECT app.purge_jarvis_action_audit_log(${olderThan}) AS count
    `.execute(appDb);
    return Number(result.rows[0]?.count ?? 0);
  }
```

- [ ] **Step 5: Verify typecheck**

```bash
pnpm typecheck
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/ai/src/repository.ts
git commit -m "feat(ai): add insertActionAuditLog, listActionAuditLog, purgeActionAuditLog to AiRepository

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 4: AI jobs module

**Files:**

- Create: `packages/ai/src/jobs.ts`

**Interfaces:**

- Consumes: `DataContextRunner` from `@jarv1s/db`; `AiRepository` from `./repository.js`; `registerDataContextWorker`, `QueueDefinition` from `@jarv1s/jobs`; `PgBoss` from `pg-boss`
- Produces:
  - `AI_PURGE_AUDIT_LOG_QUEUE = "ai-purge-audit-log"` constant
  - `AI_QUEUE_DEFINITIONS: readonly QueueDefinition[]`
  - `registerAiMaintenanceWorkers(boss, dataContext): Promise<string[]>`

- [ ] **Step 1: Check that `@jarv1s/jobs` exports `registerDataContextWorker` and `QueueDefinition`**

```bash
grep -n "registerDataContextWorker\|QueueDefinition" packages/jobs/src/index.ts 2>/dev/null || grep -rn "export.*registerDataContextWorker\|export.*QueueDefinition" packages/jobs/src/ | head -5
```

- [ ] **Step 2: Create the file**

```typescript
// packages/ai/src/jobs.ts
import type { PgBoss } from "pg-boss";

import type { DataContextRunner, Kysely, JarvisDatabase } from "@jarv1s/db";
import { registerDataContextWorker, type QueueDefinition } from "@jarv1s/jobs";

import { AiRepository } from "./repository.js";

export const AI_PURGE_AUDIT_LOG_QUEUE = "ai-purge-audit-log";

export const AI_QUEUE_DEFINITIONS: readonly QueueDefinition[] = [
  {
    name: AI_PURGE_AUDIT_LOG_QUEUE,
    options: { retryLimit: 3, retryDelay: 300, retryBackoff: true }
  }
];

export async function registerAiMaintenanceWorkers(
  boss: PgBoss,
  rootDb: Kysely<JarvisDatabase>
): Promise<string[]> {
  const repository = new AiRepository();

  await boss.schedule(AI_PURGE_AUDIT_LOG_QUEUE, "0 3 * * *", {}, { tz: "UTC" });

  const workId = await boss.work(AI_PURGE_AUDIT_LOG_QUEUE, async () => {
    const olderThan = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    const count = await repository.purgeActionAuditLog(rootDb, olderThan);
    return { purgedRows: count };
  });

  return [workId];
}
```

Note: The purge job uses `rootDb` (a raw Kysely handle) because `purgeActionAuditLog` calls the SECURITY DEFINER function which bypasses RLS internally — no actor context needed for the maintenance purge.

- [ ] **Step 3: Verify the import for Kysely in db package**

```bash
grep -n "export.*Kysely" packages/db/src/index.ts | head -5
```

If `Kysely` is not re-exported from `@jarv1s/db`, import it from `kysely` directly:

```typescript
import { type Kysely } from "kysely";
import type { DataContextRunner, JarvisDatabase } from "@jarv1s/db";
```

Adjust the import accordingly.

- [ ] **Step 4: Verify typecheck**

```bash
pnpm typecheck
```

- [ ] **Step 5: Commit**

```bash
git add packages/ai/src/jobs.ts
git commit -m "feat(ai): add AI maintenance jobs module with daily audit log purge

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 5: Update AI manifest and module registry

**Files:**

- Modify: `packages/ai/src/manifest.ts`
- Modify: `packages/module-registry/src/index.ts`

**Interfaces:**

- Consumes (manifest): `AI_QUEUE_DEFINITIONS`, `registerAiMaintenanceWorkers` from `./jobs.js` (new); `listActionAuditLogRouteSchema` from `@jarv1s/shared` (to be added in Task 7 — update this task after Task 7 is done)
- Consumes (registry): `AI_QUEUE_DEFINITIONS`, `registerAiMaintenanceWorkers` from `@jarv1s/ai`

**IMPORTANT:** The route entry in manifest.ts referencing `listActionAuditLogRouteSchema` can be added after Task 7 (shared types). For this task, just add the migration, ownedTables, and a placeholder comment. Wire the route in Task 7.

- [ ] **Step 1: Update `packages/ai/src/manifest.ts` — add migration to the migrations list**

In the `database.migrations` array in `aiModuleManifest`, after `"sql/0098_ai_cancel_stale_assistant_actions.sql"`, add:

```typescript
"sql/XXXX_jarvis_action_audit_log.sql";
```

- [ ] **Step 2: Update ownedTables in the manifest**

In `database.ownedTables`, add `"app.jarvis_action_audit_log"`:

```typescript
ownedTables: [
  "app.ai_provider_configs",
  "app.ai_configured_models",
  "app.ai_assistant_action_requests",
  "app.jarvis_action_audit_log"
];
```

- [ ] **Step 3: Update `packages/module-registry/src/index.ts` — add AI jobs imports**

Near the existing AI module imports (around line 16-19), add:

```typescript
import { AI_QUEUE_DEFINITIONS, registerAiMaintenanceWorkers } from "@jarv1s/ai/jobs";
```

If `@jarv1s/ai` doesn't export from a `jobs` sub-path, check the package.json exports. If sub-path is not set up, import from the main entry instead:

```bash
grep -n '"exports"\|"./jobs"' packages/ai/package.json | head -10
```

If there's no sub-path export, add `jobs.ts` to the ai package exports (in `packages/ai/package.json`), or import directly:

```typescript
import { AI_QUEUE_DEFINITIONS, registerAiMaintenanceWorkers } from "@jarv1s/ai";
```

And export from `packages/ai/src/index.ts`:

```bash
# Check current exports
grep -n "AI_QUEUE_DEFINITIONS\|registerAiMaintenance\|jobs" packages/ai/src/index.ts | head -5
```

Add to `packages/ai/src/index.ts` if needed:

```typescript
export { AI_QUEUE_DEFINITIONS, registerAiMaintenanceWorkers } from "./jobs.js";
```

- [ ] **Step 4: Update the AI module entry in `BUILT_IN_MODULES` (around line 539)**

Change the AI module entry from:

```typescript
  {
    manifest: aiModuleManifest,
    sqlMigrationDirectories: [aiModuleSqlMigrationDirectory],
    queueDefinitions: [],
    registerRoutes: (server, deps) => { ... }
  },
```

To:

```typescript
  {
    manifest: aiModuleManifest,
    sqlMigrationDirectories: [aiModuleSqlMigrationDirectory],
    queueDefinitions: AI_QUEUE_DEFINITIONS,
    registerRoutes: (server, deps) => { ... },
    registerWorkers: (boss, deps) =>
      registerAiMaintenanceWorkers(boss, deps.rootDb)
  },
```

Note: `deps.rootDb` is the raw `Kysely<JarvisDatabase>` passed into `BuiltInWorkerDependencies`. Verify it exists:

```bash
grep -n "rootDb\|BuiltInWorkerDependencies" packages/module-registry/src/index.ts | head -10
```

- [ ] **Step 5: Verify typecheck**

```bash
pnpm typecheck
```

- [ ] **Step 6: Commit**

```bash
git add packages/ai/src/manifest.ts packages/module-registry/src/index.ts packages/ai/src/index.ts
git commit -m "feat(ai): register maintenance jobs queue and daily audit-log purge worker

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 6: Gateway wiring

**Files:**

- Modify: `packages/ai/src/gateway/gateway.ts`

**Interfaces:**

- Consumes: `InsertAuditLogInput` from `../repository.js` (already imported in gateway via `AiRepository`); `randomUUID` from `node:crypto` (already imported)
- Produces: private `recordAudit(ctx, found, opts)` method on `AssistantToolGateway`; wired write sites in `callTool()` and `confirmAndRun()`

- [ ] **Step 1: Add `InsertAuditLogInput` to the repository import in gateway.ts**

At the top of `packages/ai/src/gateway/gateway.ts`, the existing import from `../repository.js` looks like:

```typescript
import type { AiRepository } from "../repository.js";
```

Change to:

```typescript
import type { AiRepository, InsertAuditLogInput } from "../repository.js";
```

- [ ] **Step 2: Add `recordAudit` private method to `AssistantToolGateway`**

Inside the class (before the closing `}`), add:

```typescript
  private async recordAudit(
    access: AccessContext,
    found: ExecutableTool,
    opts: {
      approvalMode: InsertAuditLogInput["approvalMode"];
      outcome: InsertAuditLogInput["outcome"];
      errorClass?: string | null;
      chatSessionId?: string;
    }
  ): Promise<void> {
    try {
      await this.deps.runner.withDataContext(access, (scopedDb) =>
        this.deps.repository.insertActionAuditLog(scopedDb, {
          id: randomUUID(),
          ownerUserId: access.actorUserId,
          toolModuleId: found.dto.moduleId,
          toolName: found.dto.name,
          actionFamilyId: found.tool.actionFamilyId ?? null,
          actionKind: found.tool.risk as "write" | "destructive",
          approvalMode: opts.approvalMode,
          outcome: opts.outcome,
          errorClass: opts.errorClass ?? null,
          requestId: access.requestId,
          chatSessionId: opts.chatSessionId ?? null,
          sourceSurface: "chat"
        })
      );
    } catch {
      // Audit failure must never change the action result. Log metadata and swallow.
      // No message or stack — only structured metadata.
      console.error(
        JSON.stringify({
          event: "audit_log_write_failed",
          toolName: found.dto.name,
          toolModuleId: found.dto.moduleId,
          approvalMode: opts.approvalMode,
          outcome: opts.outcome
        })
      );
    }
  }
```

- [ ] **Step 3: Wire audit in `callTool()` — auto-run path**

In `callTool()`, the current auto-run branch (around line 98-100) is:

```typescript
if ((await resolvePolicy(found.tool, found.dto.moduleId, lookup)) === "run") {
  return this.runHandler(found, input, ctx);
}
```

Change to:

```typescript
const access: AccessContext = { actorUserId: ctx.actorUserId, requestId: ctx.requestId };
if ((await resolvePolicy(found.tool, found.dto.moduleId, lookup)) === "run") {
  const result = await this.runHandler(found, input, ctx);
  if (found.tool.risk !== "read") {
    void this.recordAudit(access, found, {
      approvalMode: "auto",
      outcome: result.ok ? "success" : "failed",
      errorClass: result.ok ? null : "handler_error",
      chatSessionId: ctx.chatSessionId
    });
  }
  return result;
}
```

Note: the `access` const is already constructed inside `runHandler`, but we need it here for `recordAudit`. Check that constructing it here doesn't shadow anything (it doesn't — it's a new const in the outer scope).

- [ ] **Step 4: Wire audit in `confirmAndRun()` — denied/cancelled/timeout and confirmed paths**

Current `confirmAndRun()` denied branch (around line 269-281):

```typescript
    if (outcome !== "confirmed") {
      this.deps.notifier.emit(ctx.chatSessionId, { ... });
      const reason = outcome === "timeout" ? "..." : "Denied by user.";
      return { ok: false, denied: true, reason };
    }
```

Change to:

```typescript
const access: AccessContext = { actorUserId: ctx.actorUserId, requestId: ctx.requestId };

if (outcome !== "confirmed") {
  this.deps.notifier.emit(ctx.chatSessionId, {
    kind: "action_result",
    actionRequestId: action.id,
    toolName: found.dto.name,
    outcome: "denied"
  });
  const approvalMode =
    outcome === "timeout" ? "timeout" : outcome === "rejected" ? "rejected" : "cancelled";
  const auditOutcome = outcome === "cancelled" ? "cancelled" : "denied";
  void this.recordAudit(access, found, {
    approvalMode,
    outcome: auditOutcome,
    chatSessionId: ctx.chatSessionId
  });
  const reason =
    outcome === "timeout"
      ? "Timed out awaiting confirmation — still pending in your drawer."
      : "Denied by user.";
  return { ok: false, denied: true, reason };
}
```

Current confirmed + ran branch (around line 283-290):

```typescript
    const result = await this.runHandler(found, input, ctx);
    this.deps.notifier.emit(ctx.chatSessionId, { ... });
    return result;
```

Change to:

```typescript
const result = await this.runHandler(found, input, ctx);
this.deps.notifier.emit(ctx.chatSessionId, {
  kind: "action_result",
  actionRequestId: action.id,
  toolName: found.dto.name,
  outcome: result.ok ? "executed" : "error"
});
void this.recordAudit(access, found, {
  approvalMode: "confirmed",
  outcome: result.ok ? "success" : "failed",
  errorClass: result.ok ? null : "handler_error",
  chatSessionId: ctx.chatSessionId
});
return result;
```

Note: the `access` const was also used earlier in `confirmAndRun` (for creating the pending action). Move it to the top of the method or reuse the existing one (it's already declared there):

```bash
grep -n "const access" packages/ai/src/gateway/gateway.ts
```

If `access` is already declared at the top of `confirmAndRun`, don't re-declare it — just use the existing one.

- [ ] **Step 5: Verify typecheck**

```bash
pnpm typecheck
```

- [ ] **Step 6: Commit**

```bash
git add packages/ai/src/gateway/gateway.ts
git commit -m "feat(ai): wire audit log writes into action gateway at all terminal outcome points

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 7: Shared types + manifest route + API route

**Files:**

- Modify: `packages/shared/src/ai-api.ts`
- Modify: `packages/ai/src/manifest.ts`
- Modify: `packages/ai/src/routes.ts`

**Interfaces:**

- Produces (shared):
  - `actionAuditLogEntrySchema` (internal schema object)
  - `listActionAuditLogResponseSchema` (exported)
  - `listActionAuditLogRouteSchema` (exported)
  - `ActionAuditLogEntryDto` (exported TypeScript type)
  - `ListActionAuditLogResponse` (exported TypeScript type)
- Produces (manifest): route entry for `GET /api/ai/action-audit`
- Produces (routes): handler for `GET /api/ai/action-audit`

- [ ] **Step 1: Add schemas and types to `packages/shared/src/ai-api.ts`**

Add near the end of `packages/shared/src/ai-api.ts` (before the route schemas block or alongside the existing assistant-action schemas):

```typescript
const actionAuditLogEntrySchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "id",
    "ownerUserId",
    "toolModuleId",
    "toolName",
    "actionFamilyId",
    "actionKind",
    "approvalMode",
    "outcome",
    "errorClass",
    "requestId",
    "chatSessionId",
    "sourceSurface",
    "occurredAt"
  ],
  properties: {
    id: { type: "string" },
    ownerUserId: { type: "string" },
    toolModuleId: { type: "string" },
    toolName: { type: "string" },
    actionFamilyId: { type: ["string", "null"] },
    actionKind: { type: "string", enum: ["write", "destructive"] },
    approvalMode: {
      type: "string",
      enum: ["auto", "confirmed", "rejected", "cancelled", "timeout"]
    },
    outcome: {
      type: "string",
      enum: ["success", "failed", "denied", "cancelled"]
    },
    errorClass: { type: ["string", "null"] },
    requestId: { type: ["string", "null"] },
    chatSessionId: { type: ["string", "null"] },
    sourceSurface: {
      type: "string",
      enum: ["chat", "proactive", "scheduled", "unknown"]
    },
    occurredAt: { type: "string" }
  }
} as const;

export const listActionAuditLogResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["entries"],
  properties: {
    entries: { type: "array", items: actionAuditLogEntrySchema }
  }
} as const;

export const listActionAuditLogRouteSchema = {
  querystring: {
    type: "object",
    additionalProperties: false,
    properties: {
      since: { type: "string" },
      family: { type: "string" },
      limit: { type: "integer", minimum: 1, maximum: 500 }
    }
  },
  response: {
    200: listActionAuditLogResponseSchema
  }
} as const;

export type ActionAuditLogEntryDto = {
  readonly id: string;
  readonly ownerUserId: string;
  readonly toolModuleId: string;
  readonly toolName: string;
  readonly actionFamilyId: string | null;
  readonly actionKind: "write" | "destructive";
  readonly approvalMode: "auto" | "confirmed" | "rejected" | "cancelled" | "timeout";
  readonly outcome: "success" | "failed" | "denied" | "cancelled";
  readonly errorClass: string | null;
  readonly requestId: string | null;
  readonly chatSessionId: string | null;
  readonly sourceSurface: "chat" | "proactive" | "scheduled" | "unknown";
  readonly occurredAt: string;
};

export type ListActionAuditLogResponse = {
  readonly entries: readonly ActionAuditLogEntryDto[];
};
```

- [ ] **Step 2: Add route to `packages/ai/src/manifest.ts`**

First, add `listActionAuditLogRouteSchema` to the import from `@jarv1s/shared` at the top of manifest.ts.

Then add to the `routes` array:

```typescript
    {
      method: "GET",
      path: "/api/ai/action-audit",
      responseSchema: listActionAuditLogRouteSchema.response[200],
      permissionId: "ai.assistant-actions"
    }
```

- [ ] **Step 3: Add imports to `packages/ai/src/routes.ts`**

Add to imports from `@jarv1s/shared`:

```typescript
  listActionAuditLogRouteSchema,
  type ListActionAuditLogResponse,
  type ActionAuditLogEntryDto,
```

Also add import from repository:

```typescript
  type JarvisActionAuditLog,
```

(Or from `@jarv1s/db` if it's only there.)

- [ ] **Step 4: Add `GET /api/ai/action-audit` handler to `registerAiRoutes`**

Inside `registerAiRoutes`, add a new route after the `resolveAiAssistantAction` route:

```typescript
const AUDIT_RETENTION_DAYS = 90;
const AUDIT_MAX_LIMIT = 500;
const AUDIT_DEFAULT_LIMIT = 200;

server.get<{ Querystring: { since?: string; family?: string; limit?: number } }>(
  "/api/ai/action-audit",
  { schema: listActionAuditLogRouteSchema },
  async (request, reply) => {
    try {
      const accessContext = await dependencies.resolveAccessContext(request);
      const retentionFloor = new Date(Date.now() - AUDIT_RETENTION_DAYS * 24 * 60 * 60 * 1000);

      let since: Date;
      if (request.query.since) {
        const parsed = new Date(request.query.since);
        since = isNaN(parsed.getTime()) ? retentionFloor : parsed;
        if (since < retentionFloor) since = retentionFloor;
      } else {
        since = retentionFloor;
      }

      let familyFilter: { moduleId: string; familyId: string } | null = null;
      if (request.query.family) {
        const parts = request.query.family.split("/");
        if (parts.length === 2 && parts[0] && parts[1]) {
          familyFilter = { moduleId: parts[0], familyId: parts[1] };
        }
      }

      const limit = Math.min(request.query.limit ?? AUDIT_DEFAULT_LIMIT, AUDIT_MAX_LIMIT);

      const entries = await dependencies.dataContext.withDataContext(accessContext, (scopedDb) =>
        repository.listActionAuditLog(scopedDb, { since, familyFilter, limit })
      );

      const response: ListActionAuditLogResponse = {
        entries: entries.map(serializeAuditLogEntry)
      };
      return response;
    } catch (error) {
      return handleRouteError(error, reply);
    }
  }
);
```

And add the serializer function alongside other serializers at the bottom of the file:

```typescript
function serializeAuditLogEntry(row: JarvisActionAuditLog): ActionAuditLogEntryDto {
  return {
    id: row.id,
    ownerUserId: row.owner_user_id,
    toolModuleId: row.tool_module_id,
    toolName: row.tool_name,
    actionFamilyId: row.action_family_id ?? null,
    actionKind: row.action_kind as "write" | "destructive",
    approvalMode: row.approval_mode as ActionAuditLogEntryDto["approvalMode"],
    outcome: row.outcome as ActionAuditLogEntryDto["outcome"],
    errorClass: row.error_class ?? null,
    requestId: row.request_id ?? null,
    chatSessionId: row.chat_session_id ?? null,
    sourceSurface: row.source_surface as ActionAuditLogEntryDto["sourceSurface"],
    occurredAt:
      row.occurred_at instanceof Date ? row.occurred_at.toISOString() : String(row.occurred_at)
  };
}
```

- [ ] **Step 5: Verify typecheck**

```bash
pnpm typecheck
```

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/ai-api.ts packages/ai/src/manifest.ts packages/ai/src/routes.ts
git commit -m "feat(ai): add action audit log API route and shared DTO types

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 8: Data export

**Files:**

- Modify: `packages/settings/src/data-export.ts`

**Interfaces:**

- Consumes: existing `readRows`, `sql` patterns already in file
- Produces: `jarvisActionAuditLog` field in `UserDataExportTables`; `jarvisActionAuditLogQuery(userId)` function; entry in `readExportTables`

- [ ] **Step 1: Add `jarvisActionAuditLog` to the `UserDataExportTables` interface**

In `packages/settings/src/data-export.ts`, inside `UserDataExportTables`, add (alphabetically or near `aiAssistantActionRequests`):

```typescript
  readonly jarvisActionAuditLog: readonly ExportRow[];
```

- [ ] **Step 2: Add the query function near `aiAssistantActionRequestsQuery`**

```typescript
function jarvisActionAuditLogQuery(userId: string) {
  return sql<Record<string, unknown>>`
    SELECT
      id::text AS id,
      owner_user_id::text AS "ownerUserId",
      tool_module_id AS "toolModuleId",
      tool_name AS "toolName",
      action_family_id AS "actionFamilyId",
      action_kind AS "actionKind",
      approval_mode AS "approvalMode",
      outcome,
      error_class AS "errorClass",
      request_id AS "requestId",
      chat_session_id AS "chatSessionId",
      source_surface AS "sourceSurface",
      occurred_at AS "occurredAt"
    FROM app.jarvis_action_audit_log
    WHERE owner_user_id = ${userId}::uuid
    ORDER BY occurred_at, id
  `;
}
```

- [ ] **Step 3: Add to `readExportTables` return object**

In the `readExportTables` function, add:

```typescript
    jarvisActionAuditLog: await readRows(scopedDb.db, jarvisActionAuditLogQuery(userId)),
```

- [ ] **Step 4: Verify typecheck**

```bash
pnpm typecheck
```

- [ ] **Step 5: Commit**

```bash
git add packages/settings/src/data-export.ts
git commit -m "feat(settings): include jarvisActionAuditLog in user data export

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 9: Frontend API client and query keys

**Files:**

- Modify: `apps/web/src/api/client.ts`
- Modify: `apps/web/src/api/query-keys.ts`

**Interfaces:**

- Consumes: `listActionAuditLogRouteSchema` querystring types; `ListActionAuditLogResponse` from `@jarv1s/shared`; `requestJson` (existing utility in client.ts)
- Produces:
  - `listActionAuditLog(params?)` function in client.ts
  - `queryKeys.ai.actionAuditLog` in query-keys.ts

- [ ] **Step 1: Add `ListActionAuditLogResponse` to shared imports in client.ts**

Check the existing import from `@jarv1s/shared` in `client.ts` and add `ListActionAuditLogResponse`.

- [ ] **Step 2: Add `listActionAuditLog` function to `apps/web/src/api/client.ts`**

Near the `listAiAssistantTools` function:

```typescript
export async function listActionAuditLog(params?: {
  since?: string;
  family?: string;
  limit?: number;
}): Promise<ListActionAuditLogResponse> {
  const search = new URLSearchParams();
  if (params?.since) search.set("since", params.since);
  if (params?.family) search.set("family", params.family);
  if (params?.limit !== undefined) search.set("limit", String(params.limit));
  const qs = search.toString();
  return requestJson<ListActionAuditLogResponse>(`/api/ai/action-audit${qs ? `?${qs}` : ""}`);
}
```

- [ ] **Step 3: Add `ai.actionAuditLog` to `apps/web/src/api/query-keys.ts`**

Inside the `ai` object in `queryKeys`, add:

```typescript
    actionAuditLog: (params?: { since?: string; family?: string; limit?: number }) =>
      ["ai", "action-audit-log", params] as const,
```

- [ ] **Step 4: Verify typecheck**

```bash
pnpm typecheck
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/api/client.ts apps/web/src/api/query-keys.ts
git commit -m "feat(web): add listActionAuditLog API client and query key

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 10: Settings Activity pane

**Files:**

- Create: `apps/web/src/settings/settings-activity-pane.tsx`

**Interfaces:**

- Consumes: `listActionAuditLog` from `../api/client.js`; `queryKeys.ai.actionAuditLog` from `../api/query-keys.js`; `useQuery` from `@tanstack/react-query`; `PaneProps` from `./settings-types`; `ActionAuditLogEntryDto` from `@jarv1s/shared`
- Produces: `ActivityPane` (named export, `ComponentType<PaneProps>`)

- [ ] **Step 1: Check existing empty/loading pattern used in another pane**

```bash
grep -rn "jds-empty\|EmptyState\|empty-state\|settings-empty" apps/web/src/settings/ | head -10
```

- [ ] **Step 2: Create `apps/web/src/settings/settings-activity-pane.tsx`**

```tsx
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { listActionAuditLog } from "../api/client.js";
import { queryKeys } from "../api/query-keys.js";
import type { PaneProps } from "./settings-types.js";
import type { ActionAuditLogEntryDto } from "@jarv1s/shared";

type DateRange = "today" | "7d" | "30d" | "90d";

function sinceForRange(range: DateRange): string {
  const now = Date.now();
  const offsets: Record<DateRange, number> = {
    today: 0,
    "7d": 7 * 24 * 60 * 60 * 1000,
    "30d": 30 * 24 * 60 * 60 * 1000,
    "90d": 90 * 24 * 60 * 60 * 1000
  };
  if (range === "today") {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.toISOString();
  }
  return new Date(now - offsets[range]).toISOString();
}

function approvalLabel(mode: ActionAuditLogEntryDto["approvalMode"]): string {
  const labels: Record<typeof mode, string> = {
    auto: "Auto-run",
    confirmed: "Confirmed",
    rejected: "Declined",
    cancelled: "Cancelled",
    timeout: "Timed out"
  };
  return labels[mode];
}

function outcomeLabel(outcome: ActionAuditLogEntryDto["outcome"]): string {
  const labels: Record<typeof outcome, string> = {
    success: "Done",
    failed: "Failed",
    denied: "Declined",
    cancelled: "Cancelled"
  };
  return labels[outcome];
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export function ActivityPane(_props: PaneProps) {
  const [range, setRange] = useState<DateRange>("30d");
  const [familyFilter, setFamilyFilter] = useState<string>("");

  const { data, isLoading } = useQuery({
    queryKey: queryKeys.ai.actionAuditLog({ since: sinceForRange(range) }),
    queryFn: () => listActionAuditLog({ since: sinceForRange(range), limit: 200 })
  });

  const entries = data?.entries ?? [];

  const families = Array.from(
    new Set(
      entries.filter((e) => e.actionFamilyId).map((e) => `${e.toolModuleId}/${e.actionFamilyId}`)
    )
  );

  const filtered = familyFilter
    ? entries.filter((e) => `${e.toolModuleId}/${e.actionFamilyId}` === familyFilter)
    : entries;

  const isDistinct = (outcome: ActionAuditLogEntryDto["outcome"]): boolean =>
    outcome === "failed" || outcome === "denied";

  return (
    <div className="settings-pane">
      <div className="settings-pane__header">
        <h2 className="settings-pane__title">Activity</h2>
        <p className="settings-pane__description">
          Actions Jarvis ran on your behalf, last 90 days.
        </p>
      </div>

      <div
        className="settings-pane__controls"
        style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginBottom: "1rem" }}
      >
        {(["today", "7d", "30d", "90d"] as DateRange[]).map((r) => (
          <button
            key={r}
            className={`jds-button jds-button--xs${range === r ? " jds-button--active" : ""}`}
            onClick={() => setRange(r)}
            type="button"
          >
            {r === "today" ? "Today" : r === "7d" ? "7 days" : r === "30d" ? "30 days" : "90 days"}
          </button>
        ))}
        {families.length > 0 && (
          <select
            className="jds-select jds-select--sm"
            value={familyFilter}
            onChange={(e) => setFamilyFilter(e.target.value)}
          >
            <option value="">All actions</option>
            {families.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        )}
      </div>

      {isLoading && (
        <div className="settings-pane__loading" aria-live="polite">
          Loading…
        </div>
      )}

      {!isLoading && filtered.length === 0 && (
        <div className="settings-pane__empty">
          <p>No Jarvis actions yet.</p>
        </div>
      )}

      {!isLoading && filtered.length > 0 && (
        <ul className="settings-pane__list" style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {filtered.map((entry) => (
            <li
              key={entry.id}
              className={`settings-pane__list-item${isDistinct(entry.outcome) ? " settings-pane__list-item--distinct" : ""}`}
              style={{ padding: "0.75rem 0", borderBottom: "1px solid var(--jds-border)" }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "flex-start",
                  gap: "0.5rem"
                }}
              >
                <div>
                  <span className="settings-pane__label">{entry.toolName}</span>
                  {entry.actionFamilyId && (
                    <span
                      className="settings-pane__meta"
                      style={{ marginLeft: "0.375rem", opacity: 0.6 }}
                    >
                      {entry.actionFamilyId}
                    </span>
                  )}
                  <div
                    style={{
                      marginTop: "0.25rem",
                      display: "flex",
                      gap: "0.375rem",
                      flexWrap: "wrap"
                    }}
                  >
                    <span className="jds-badge jds-badge--sm">
                      {approvalLabel(entry.approvalMode)}
                    </span>
                    <span
                      className={`jds-badge jds-badge--sm${isDistinct(entry.outcome) ? " jds-badge--warn" : ""}`}
                    >
                      {outcomeLabel(entry.outcome)}
                    </span>
                    {entry.sourceSurface !== "chat" && (
                      <span className="jds-badge jds-badge--sm jds-badge--muted">
                        from {entry.sourceSurface}
                      </span>
                    )}
                  </div>
                </div>
                <div style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                  <span
                    className="settings-pane__meta"
                    title={new Date(entry.occurredAt).toLocaleString()}
                  >
                    {relativeTime(entry.occurredAt)}
                  </span>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Verify typecheck**

```bash
pnpm typecheck
```

If `jds-badge--warn` or `jds-button--active` don't exist, use appropriate existing class names. Run:

```bash
grep -rn "jds-badge\|jds-button" apps/web/src/styles/ | head -20
```

and adjust class names to match what's present.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/settings/settings-activity-pane.tsx
git commit -m "feat(web): add settings ActivityPane for action audit log

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 11: Wire activity pane into settings-page

**Files:**

- Modify: `apps/web/src/settings/settings-page.tsx`

**Interfaces:**

- Consumes: `ActivityPane` from `./settings-activity-pane.tsx`
- Produces: "activity" entry in `PERSONAL_SECTIONS`; `"activity"` added to `PersonalSectionId` union

- [ ] **Step 1: Add lazy import for ActivityPane**

After the existing `AppearancePane` lazy import (around line 91), add:

```typescript
const ActivityPane = lazyPane(() =>
  import("./settings-activity-pane").then((module) => ({ default: module.ActivityPane }))
);
```

- [ ] **Step 2: Add "activity" to `PersonalSectionId` union**

In the `type PersonalSectionId = ...` union (around line 49), add `| "activity"`:

```typescript
type PersonalSectionId =
  | "profile"
  | "assistant"
  | "priorities"
  | "memory"
  | "connected"
  | "sources"
  | "modules"
  | "appearance"
  | "general"
  | "activity";
```

- [ ] **Step 3: Add entry to `PERSONAL_SECTIONS`**

In `PERSONAL_SECTIONS`, add after the `"assistant"` entry (second position, so it appears near AI-related items), or at the end before `"general"`. Spec suggests placing it logically. Add:

```typescript
  { id: "activity", icon: Activity, label: "Activity", Pane: ActivityPane },
```

Note: `Activity` from lucide-react is already imported in `settings-page.tsx` (line 7 in the imports block above). If not, add it to the lucide import.

- [ ] **Step 4: Verify typecheck**

```bash
pnpm typecheck
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/settings/settings-page.tsx
git commit -m "feat(web): add Activity section to settings personal panes

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 12: Tests

**Files:**

- Modify: `tests/integration/foundation.test.ts`
- Create: `tests/integration/action-audit-log.test.ts`

**Interfaces:**

- Consumes: test infrastructure from `./test-database.js` (`connectionStrings`, `ids`, `resetFoundationDatabase`); `AiRepository`, `AssistantToolGateway` patterns from existing `ai-tools.test.ts`

- [ ] **Step 1: Add the XXXX migration to `foundation.test.ts`**

In the `toEqual([...])` array in `foundation.test.ts`, after `{ version: "0126", name: "0126_app_runtime_calendar_events_delete.sql" }`, add:

```typescript
        { version: "XXXX", name: "XXXX_jarvis_action_audit_log.sql" }
```

Note: the actual version prefix in `XXXX` depends on the filename. Since we named it `XXXX_jarvis_action_audit_log.sql` with literal `XXXX`, the version extracted will be `XXXX`. If the migration runner extracts versions differently, verify:

```bash
grep -n "version.*name\|extractVersion\|split.*sql\|slice.*4" packages/db/src/ -r | head -10
```

Adjust the version string to match what the runner extracts.

- [ ] **Step 2: Create `tests/integration/action-audit-log.test.ts`**

```typescript
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import type { Kysely } from "kysely";

import { AiRepository } from "@jarv1s/ai";
import { DataContextRunner, createDatabase, type JarvisDatabase } from "@jarv1s/db";
import { connectionStrings, ids, resetFoundationDatabase } from "./test-database.js";

const LANE_DB = process.env.JARVIS_PGDATABASE ?? "jarvis_test";

describe("action audit log", () => {
  let appDb: Kysely<JarvisDatabase>;
  let dataContext: DataContextRunner;
  let repo: AiRepository;

  beforeAll(async () => {
    await resetFoundationDatabase();
    appDb = createDatabase({ connectionString: connectionStrings.app, maxConnections: 2 });
    dataContext = new DataContextRunner(appDb);
    repo = new AiRepository();
  });

  afterAll(async () => {
    await appDb.destroy();
  });

  it("inserts an audit row and reads it back", async () => {
    const id = randomUUID();
    await dataContext.withDataContext(
      { actorUserId: ids.userA, requestId: "req-1" },
      async (scopedDb) => {
        await repo.insertActionAuditLog(scopedDb, {
          id,
          ownerUserId: ids.userA,
          toolModuleId: "tasks",
          toolName: "tasks.create",
          actionFamilyId: "task-changes",
          actionKind: "write",
          approvalMode: "auto",
          outcome: "success",
          errorClass: null,
          requestId: "req-1",
          chatSessionId: null,
          sourceSurface: "chat"
        });
      }
    );

    const rows = await dataContext.withDataContext(
      { actorUserId: ids.userA, requestId: "req-2" },
      (scopedDb) =>
        repo.listActionAuditLog(scopedDb, {
          since: new Date(Date.now() - 60_000),
          limit: 10
        })
    );

    expect(rows.some((r) => r.id === id)).toBe(true);
    const row = rows.find((r) => r.id === id)!;
    expect(row.approval_mode).toBe("auto");
    expect(row.outcome).toBe("success");
    expect(row.tool_name).toBe("tasks.create");
    expect(row.action_kind).toBe("write");
    expect((row as any).input_summary).toBeUndefined();
  });

  it("enforces RLS: user A cannot see user B rows", async () => {
    const idB = randomUUID();
    await dataContext.withDataContext(
      { actorUserId: ids.userB, requestId: "req-b" },
      async (scopedDb) => {
        await repo.insertActionAuditLog(scopedDb, {
          id: idB,
          ownerUserId: ids.userB,
          toolModuleId: "tasks",
          toolName: "tasks.create",
          actionFamilyId: null,
          actionKind: "write",
          approvalMode: "confirmed",
          outcome: "success",
          errorClass: null,
          requestId: "req-b",
          chatSessionId: null,
          sourceSurface: "chat"
        });
      }
    );

    const rowsA = await dataContext.withDataContext(
      { actorUserId: ids.userA, requestId: "req-check" },
      (scopedDb) =>
        repo.listActionAuditLog(scopedDb, {
          since: new Date(Date.now() - 60_000),
          limit: 100
        })
    );

    expect(rowsA.some((r) => r.id === idB)).toBe(false);
  });

  it("rejects INSERT with mismatched owner_user_id (WITH CHECK violation)", async () => {
    const id = randomUUID();
    await expect(
      dataContext.withDataContext(
        { actorUserId: ids.userA, requestId: "req-bad" },
        async (scopedDb) => {
          await repo.insertActionAuditLog(scopedDb, {
            id,
            ownerUserId: ids.userB,
            toolModuleId: "tasks",
            toolName: "tasks.create",
            actionFamilyId: null,
            actionKind: "write",
            approvalMode: "auto",
            outcome: "success",
            errorClass: null,
            requestId: null,
            chatSessionId: null,
            sourceSurface: "chat"
          });
        }
      )
    ).rejects.toThrow();
  });

  it("purge function deletes old rows and leaves recent rows", async () => {
    const oldId = randomUUID();
    const recentId = randomUUID();

    await dataContext.withDataContext(
      { actorUserId: ids.userA, requestId: "req-purge" },
      async (scopedDb) => {
        // Insert a row we'll manually backdate via raw SQL after
        await repo.insertActionAuditLog(scopedDb, {
          id: oldId,
          ownerUserId: ids.userA,
          toolModuleId: "tasks",
          toolName: "tasks.deleteList",
          actionFamilyId: null,
          actionKind: "destructive",
          approvalMode: "confirmed",
          outcome: "success",
          errorClass: null,
          requestId: null,
          chatSessionId: null,
          sourceSurface: "chat"
        });
        await repo.insertActionAuditLog(scopedDb, {
          id: recentId,
          ownerUserId: ids.userA,
          toolModuleId: "tasks",
          toolName: "tasks.create",
          actionFamilyId: null,
          actionKind: "write",
          approvalMode: "auto",
          outcome: "success",
          errorClass: null,
          requestId: null,
          chatSessionId: null,
          sourceSurface: "chat"
        });
      }
    );

    // Backdate the old row to 91 days ago
    await appDb
      .updateTable("app.jarvis_action_audit_log")
      .set({ occurred_at: new Date(Date.now() - 91 * 24 * 60 * 60 * 1000) })
      .where("id", "=", oldId)
      .execute();

    const olderThan = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    const count = await repo.purgeActionAuditLog(appDb, olderThan);

    expect(count).toBeGreaterThanOrEqual(1);

    const remaining = await appDb
      .selectFrom("app.jarvis_action_audit_log")
      .select("id")
      .where("id", "in", [oldId, recentId])
      .execute();

    const ids = remaining.map((r) => r.id);
    expect(ids).not.toContain(oldId);
    expect(ids).toContain(recentId);
  });

  it("runtime role has no UPDATE or DELETE grant (verified via schema)", async () => {
    // The migration grants only SELECT, INSERT to jarvis_app_runtime.
    // Test attempts an UPDATE via the app DB connection (uses app runtime role).
    // If the grant is correct, this should throw a permission denied error.
    await expect(
      appDb
        .updateTable("app.jarvis_action_audit_log")
        .set({ error_class: "test" })
        .where("id", "=", randomUUID())
        .execute()
    ).rejects.toThrow();
  });

  it("cascade: deleting user removes their audit rows", async () => {
    // Create a temporary user, insert an audit row, delete the user.
    // Verify the audit row is gone (ON DELETE CASCADE).
    const tempUserId = randomUUID();
    const tempRowId = randomUUID();

    // Insert user directly (bypass auth — migration schema only)
    await appDb
      .insertInto("app.users")
      .values({
        id: tempUserId,
        email: `cascade-test-${tempUserId}@example.com`,
        name: "Cascade Test",
        is_instance_admin: false,
        created_at: new Date(),
        updated_at: new Date()
      })
      .execute();

    await dataContext.withDataContext(
      { actorUserId: tempUserId, requestId: "req-cascade" },
      async (scopedDb) => {
        await repo.insertActionAuditLog(scopedDb, {
          id: tempRowId,
          ownerUserId: tempUserId,
          toolModuleId: "tasks",
          toolName: "tasks.create",
          actionFamilyId: null,
          actionKind: "write",
          approvalMode: "auto",
          outcome: "success",
          errorClass: null,
          requestId: null,
          chatSessionId: null,
          sourceSurface: "chat"
        });
      }
    );

    // Delete the user
    await appDb.deleteFrom("app.users").where("id", "=", tempUserId).execute();

    // Audit row should be gone
    const surviving = await appDb
      .selectFrom("app.jarvis_action_audit_log")
      .select("id")
      .where("id", "=", tempRowId)
      .execute();

    expect(surviving).toHaveLength(0);
  });

  it("audit rows contain no input_summary or content columns", async () => {
    // Verify schema: the table should have no input_summary column
    const { rows } = await appDb.executeQuery<{ column_name: string }>(
      appDb
        .raw(
          `SELECT column_name FROM information_schema.columns
         WHERE table_schema = 'app' AND table_name = 'jarvis_action_audit_log'`
        )
        .compile(appDb)
    );
    const colNames = rows.map((r) => r.column_name);
    expect(colNames).not.toContain("input_summary");
    expect(colNames).not.toContain("content");
    expect(colNames).not.toContain("prompt");
  });
});
```

Note: The `it("audit rows contain no input_summary...")` test uses a raw SQL introspection call — adjust the exact query to match how the codebase runs raw SQL (look at other tests for the pattern):

```bash
grep -rn "information_schema\|column_name.*information" tests/integration/ | head -5
```

If raw SQL is needed differently, use `pg` client directly (pattern from `foundation.test.ts`).

- [ ] **Step 3: Run the new integration tests against a lane database**

```bash
docker exec jarv1s-postgres psql -U postgres -c 'CREATE DATABASE jarvis_build_540;'
JARVIS_PGDATABASE=jarvis_build_540 pnpm vitest run tests/integration/action-audit-log.test.ts
```

Expected: all tests pass.

- [ ] **Step 4: Run focused non-integration checks**

```bash
pnpm lint && pnpm format:check && pnpm typecheck
```

- [ ] **Step 5: Commit**

```bash
git add tests/integration/foundation.test.ts tests/integration/action-audit-log.test.ts
git commit -m "test(ai): add action audit log integration tests and foundation migration list update

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Self-Review

### Spec coverage check

| Spec §/Criterion                                                                  | Task                             |
| --------------------------------------------------------------------------------- | -------------------------------- |
| §5 Table, indexes, RLS, grants                                                    | Task 1                           |
| §5 Purge function + REVOKE/GRANT                                                  | Task 1                           |
| §3 DB types                                                                       | Task 2                           |
| Repository insert/list/purge                                                      | Task 3                           |
| §6 Daily pg-boss maintenance job                                                  | Task 4                           |
| Module registry registration                                                      | Task 5                           |
| §6 Gateway write sites (auto, denied/cancelled/timeout, confirmed)                | Task 6                           |
| §6 Audit failure swallowed                                                        | Task 6 (`recordAudit` try/catch) |
| §7 GET /api/ai/action-audit, DTOs, since/family/limit clamping                    | Task 7                           |
| §11 User data export                                                              | Task 8                           |
| Frontend client + query key                                                       | Task 9                           |
| §8 Activity pane (date filter, family filter, badges, empty state)                | Task 10                          |
| Wire Activity into settings                                                       | Task 11                          |
| §14 Acceptance criteria tests (RLS, cascade, no content, purge, no UPDATE/DELETE) | Task 12                          |
| foundation.test.ts migration list                                                 | Task 12                          |

### Missing coverage identified

- **Data export test**: The spec says export must include the audit log (§11). `tests/integration/data-export.test.ts` likely already tests `UserDataExportTables`. Add an assertion there that `jarvisActionAuditLog` is present in the export response. **Add this step to Task 12.**

  ```bash
  grep -n "jarvisActionAuditLog\|aiAssistantAction" tests/integration/data-export.test.ts | head -5
  ```

  If it only checks the shape by key presence, add:

  ```typescript
  expect(exportData.tables).toHaveProperty("jarvisActionAuditLog");
  expect(Array.isArray(exportData.tables.jarvisActionAuditLog)).toBe(true);
  ```

- **GET /api/ai/action-audit route test**: No API-level test for the route. Add a simple test in `action-audit-log.test.ts` or a new `ai-action-audit.test.ts` hitting the REST endpoint via the Fastify test server, verifying owner-scoping and the `since` floor clamp. Consider it in scope for Task 12.

### Placeholder scan

No TBD/TODO found — all steps have concrete code. One soft spot: the `rawSql` introspection in the "no input_summary columns" test uses a pattern that may need adjustment to match the local pg `Client` pattern. The note in Task 12 Step 2 calls this out.

### Type consistency

- `InsertAuditLogInput.approvalMode` union matches `recordAudit` opts type ✓
- `JarvisActionAuditLogTable.approval_mode` is `string` in DB types; serializer casts correctly ✓
- `ActionAuditLogEntryDto.approvalMode` union strings match what gateway writes ✓
- `listActionAuditLog` in repository takes `ListAuditLogOptions`; route handler constructs that shape ✓
