# Error Explainability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. In this coordinated build, do not use subagent-driven-development or executing-plans; drive tasks inline after coordinator approval.

**Goal:** Persist safe, owner-scoped API/client error events and expose a bounded read-only assistant tool so Jarvis can explain recent user-visible errors without leaking secrets.

**Architecture:** Follow the approved D1-D5 decisions, not the stale Architecture/Exit text that still names `packages/observability`. The table, repository, and assistant tool live in `packages/ai`; `apps/api/src/error-handling.ts` gets a narrow optional recorder dependency and never receives or persists stack traces. Authenticated errors are inserted under `DataContextDb`; unauthenticated events use a narrow `SECURITY DEFINER` function that forces `owner_user_id = NULL`, matching the existing purge-function pattern without raw Kysely CRUD writes.

**Tech Stack:** TypeScript, Fastify, Kysely, Postgres RLS, Vitest, existing `@jarv1s/ai`, `@jarv1s/db`, and `@jarv1s/module-sdk` contracts.

---

## Pre-Plan Verification

- Spec present on branch: `docs/superpowers/specs/2026-07-07-error-explainability.md` at commit `c964132d`.
- Migration `0145` still free in this worktree; highest current SQL migration is `0144`.
- Existing call sites verified:
  - `apps/api/src/error-handling.ts` has `registerClientErrorsRoute` and `setJarvisErrorHandler`.
  - `packages/ai/sql/0127_jarvis_action_audit_log.sql` is the RLS/retention model.
  - `packages/ai/src/manifest.ts` owns AI migrations/tables.
  - `packages/ai/src/repository.ts` owns existing action-audit repository methods.
  - `packages/chat/src/tools.ts` shows the `ToolExecute`/`assertDataContextDb` pattern.
- Spec contradiction: D2/D3 say `packages/ai`; later Architecture/Exit Criteria still say `packages/observability`. This plan treats D2/D3 as authoritative because the handoff says to build D1-D5.

## Files

- Create: `packages/ai/sql/0145_jarvis_error_log.sql` - table, indexes, RLS, purge function.
- Create: `packages/ai/src/error-tools.ts` - read-only assistant tool.
- Modify: `packages/ai/src/index.ts` - export the tool for tests and package consumers.
- Create: `tests/integration/error-log.test.ts` - DB/RLS/repository/tool coverage.
- Modify: `packages/db/src/types.ts` - Kysely table/type entries.
- Modify: `packages/ai/src/repository.ts` - `recordError`, `recordAnonymousError`, `listRecentErrors`, `purgeErrorLog`.
- Modify: `packages/ai/src/manifest.ts` - migration, owned table, assistant tool declaration.
- Modify: `apps/api/src/error-handling.ts` - optional recorder dependency; stack dropped before persistence.
- Modify: `apps/api/src/server.ts` - wire AI repository/data context into error handlers.
- Modify: `tests/unit/api-error-handling.test.ts` - recorder behavior, stack non-persistence.
- Modify: `tests/integration/foundation.test.ts` - migration list entry.

## Task 1: Schema + DB Types

**Files:**

- Create: `packages/ai/sql/0145_jarvis_error_log.sql`
- Modify: `packages/db/src/types.ts`
- Modify: `packages/ai/src/manifest.ts`
- Modify: `tests/integration/foundation.test.ts`

- [ ] **Step 1: Write failing migration/type checks**

Add `0145_jarvis_error_log.sql` to the migration list assertion in `tests/integration/foundation.test.ts` after `0144`.

Add a compile-only table entry in `packages/db/src/types.ts`:

```ts
export interface JarvisErrorLogTable {
  id: string;
  owner_user_id: string | null;
  occurred_at: TimestampColumn;
  feature: string;
  operation: string;
  error_category: string;
  retryable: boolean;
  user_message: string;
  internal_summary: string;
  request_id: string | null;
}

// JarvisDatabase map:
"app.jarvis_error_log": JarvisErrorLogTable;

export type JarvisErrorLog = Selectable<JarvisErrorLogTable>;
```

Run:

```bash
pnpm vitest run tests/integration/foundation.test.ts
```

Expected: FAIL because migration `0145_jarvis_error_log.sql` is missing.

- [ ] **Step 2: Add migration**

Create `packages/ai/sql/0145_jarvis_error_log.sql`:

```sql
CREATE TABLE IF NOT EXISTS app.jarvis_error_log (
  id uuid PRIMARY KEY,
  owner_user_id uuid REFERENCES app.users(id) ON DELETE CASCADE,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  feature text NOT NULL CHECK (length(btrim(feature)) > 0 AND length(feature) <= 80),
  operation text NOT NULL CHECK (length(btrim(operation)) > 0 AND length(operation) <= 120),
  error_category text NOT NULL CHECK (length(btrim(error_category)) > 0 AND length(error_category) <= 80),
  retryable boolean NOT NULL DEFAULT false,
  user_message text NOT NULL CHECK (length(btrim(user_message)) > 0 AND length(user_message) <= 500),
  internal_summary text NOT NULL CHECK (length(btrim(internal_summary)) > 0 AND length(internal_summary) <= 1000),
  request_id text
);

CREATE INDEX IF NOT EXISTS jarvis_error_log_owner_time_idx
  ON app.jarvis_error_log(owner_user_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS jarvis_error_log_owner_feature_time_idx
  ON app.jarvis_error_log(owner_user_id, feature, occurred_at DESC);

GRANT SELECT, INSERT ON app.jarvis_error_log TO jarvis_app_runtime;

ALTER TABLE app.jarvis_error_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.jarvis_error_log FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS jarvis_error_log_select ON app.jarvis_error_log;
DROP POLICY IF EXISTS jarvis_error_log_insert ON app.jarvis_error_log;
DROP POLICY IF EXISTS jarvis_error_log_maintenance_insert ON app.jarvis_error_log;
DROP POLICY IF EXISTS jarvis_error_log_maintenance_select ON app.jarvis_error_log;
DROP POLICY IF EXISTS jarvis_error_log_maintenance_delete ON app.jarvis_error_log;

CREATE POLICY jarvis_error_log_select
ON app.jarvis_error_log
FOR SELECT TO jarvis_app_runtime
USING (
  app.current_actor_user_id() IS NOT NULL
  AND owner_user_id = app.current_actor_user_id()
);

CREATE POLICY jarvis_error_log_insert
ON app.jarvis_error_log
FOR INSERT TO jarvis_app_runtime
WITH CHECK (
  app.current_actor_user_id() IS NOT NULL
  AND owner_user_id = app.current_actor_user_id()
);

CREATE POLICY jarvis_error_log_maintenance_select
ON app.jarvis_error_log
FOR SELECT TO jarvis_migration_owner
USING (true);

CREATE POLICY jarvis_error_log_maintenance_insert
ON app.jarvis_error_log
FOR INSERT TO jarvis_migration_owner
WITH CHECK (owner_user_id IS NULL);

CREATE POLICY jarvis_error_log_maintenance_delete
ON app.jarvis_error_log
FOR DELETE TO jarvis_migration_owner
USING (true);

CREATE OR REPLACE FUNCTION app.record_anonymous_error(
  event_id uuid,
  event_feature text,
  event_operation text,
  event_error_category text,
  event_retryable boolean,
  event_user_message text,
  event_internal_summary text,
  event_request_id text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app, public
AS $$
BEGIN
  INSERT INTO app.jarvis_error_log (
    id,
    owner_user_id,
    feature,
    operation,
    error_category,
    retryable,
    user_message,
    internal_summary,
    request_id
  )
  VALUES (
    event_id,
    NULL,
    event_feature,
    event_operation,
    event_error_category,
    event_retryable,
    event_user_message,
    event_internal_summary,
    event_request_id
  );
END;
$$;

REVOKE ALL ON FUNCTION app.record_anonymous_error(uuid, text, text, text, boolean, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.record_anonymous_error(uuid, text, text, text, boolean, text, text, text) TO jarvis_app_runtime;

CREATE OR REPLACE FUNCTION app.purge_jarvis_error_log(older_than timestamptz)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app, public
AS $$
DECLARE
  affected integer;
BEGIN
  DELETE FROM app.jarvis_error_log WHERE occurred_at < older_than;
  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END;
$$;

REVOKE ALL ON FUNCTION app.purge_jarvis_error_log(timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.purge_jarvis_error_log(timestamptz) TO jarvis_app_runtime;
```

Add to `packages/ai/src/manifest.ts`:

```ts
database: {
  migrations: [
    // ...
    "sql/0127_jarvis_action_audit_log.sql",
    "sql/0145_jarvis_error_log.sql"
  ],
  ownedTables: [
    // ...
    "app.jarvis_action_audit_log",
    "app.jarvis_error_log"
  ]
}
```

- [ ] **Step 3: Run focused schema checks**

Run:

```bash
pnpm vitest run tests/integration/foundation.test.ts
pnpm typecheck
```

Expected: foundation migration assertion passes; typecheck may still fail until repository methods exist if imports were added early.

- [ ] **Step 4: Commit**

```bash
git add packages/ai/sql/0145_jarvis_error_log.sql packages/db/src/types.ts packages/ai/src/manifest.ts tests/integration/foundation.test.ts
git commit -m "feat(ai): add error log schema"
```

## Task 2: Repository + Security Tests

**Files:**

- Modify: `packages/ai/src/repository.ts`
- Create: `tests/integration/error-log.test.ts`

- [ ] **Step 1: Write failing repository tests**

Create `tests/integration/error-log.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type { Kysely } from "kysely";
import pg from "pg";

import { AiRepository } from "@jarv1s/ai";
import { DataContextRunner, createDatabase, type JarvisDatabase } from "@jarv1s/db";
import { connectionStrings, ids, resetFoundationDatabase } from "./test-database.js";

const { Client } = pg;

describe("jarvis error log", () => {
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

  it("records and lists only the actor's own errors", async () => {
    const ownId = randomUUID();
    const otherId = randomUUID();

    await dataContext.withDataContext({ actorUserId: ids.userA, requestId: "req-a" }, (scopedDb) =>
      repo.recordError(scopedDb, {
        id: ownId,
        feature: "sports",
        operation: "GET /api/sports",
        errorCategory: "request_failed",
        retryable: true,
        userMessage: "Scores are temporarily unavailable",
        internalSummary: "Route returned a 503",
        requestId: "req-a"
      })
    );

    await dataContext.withDataContext({ actorUserId: ids.userB, requestId: "req-b" }, (scopedDb) =>
      repo.recordError(scopedDb, {
        id: otherId,
        feature: "sports",
        operation: "GET /api/sports",
        errorCategory: "request_failed",
        retryable: false,
        userMessage: "Other user error",
        internalSummary: "Must not leak",
        requestId: "req-b"
      })
    );

    const rows = await dataContext.withDataContext(
      { actorUserId: ids.userA, requestId: "req-list" },
      (scopedDb) => repo.listRecentErrors(scopedDb, { query: "sports", limit: 20 })
    );

    expect(rows.map((row) => row.id)).toContain(ownId);
    expect(rows.map((row) => row.id)).not.toContain(otherId);
  });

  it("rejects a stack field structurally", async () => {
    await dataContext.withDataContext(
      { actorUserId: ids.userA, requestId: "req-stack" },
      (scopedDb) =>
        repo.recordError(scopedDb, {
          id: randomUUID(),
          feature: "client",
          operation: "POST /api/errors",
          errorCategory: "client_error",
          retryable: false,
          userMessage: "The page hit an error",
          internalSummary: "Client reported react_error",
          requestId: "req-stack",
          // @ts-expect-error stack is intentionally not accepted at the persistence boundary.
          stack: "Error: secret"
        })
    );
  });

  it("schema has no stack, payload, header, cookie, or prompt columns", async () => {
    const client = new Client({ connectionString: connectionStrings.migration });
    await client.connect();
    try {
      const result = await client.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns
         WHERE table_schema = 'app' AND table_name = 'jarvis_error_log'`
      );
      const names = result.rows.map((row) => row.column_name);
      expect(names).not.toContain("stack");
      expect(names).not.toContain("request_body");
      expect(names).not.toContain("headers");
      expect(names).not.toContain("cookies");
      expect(names).not.toContain("prompt");
    } finally {
      await client.end();
    }
  });

  it("anonymous rows are insertable but invisible to user-scoped reads", async () => {
    const id = randomUUID();
    await repo.recordAnonymousError(appDb, {
      id,
      feature: "client",
      operation: "POST /api/errors",
      errorCategory: "client_error",
      retryable: false,
      userMessage: "The page hit an error",
      internalSummary: "Client reported uncaught_error",
      requestId: "anon-1"
    });

    const rows = await dataContext.withDataContext(
      { actorUserId: ids.userA, requestId: "req-list-anon" },
      (scopedDb) => repo.listRecentErrors(scopedDb, { query: "client", limit: 50 })
    );

    expect(rows.map((row) => row.id)).not.toContain(id);
  });

  it("runtime cannot insert anonymous rows directly", async () => {
    await expect(
      appDb
        .insertInto("app.jarvis_error_log")
        .values({
          id: randomUUID(),
          owner_user_id: null,
          feature: "client",
          operation: "POST /api/errors",
          error_category: "client_error",
          retryable: false,
          user_message: "The page hit an error",
          internal_summary: "Direct anonymous insert must fail",
          request_id: "direct-anon"
        })
        .execute()
    ).rejects.toThrow();
  });
});
```

Run:

```bash
pnpm vitest run tests/integration/error-log.test.ts
```

Expected: FAIL because repository methods do not exist.

- [ ] **Step 2: Add repository methods**

Add imports/types to `packages/ai/src/repository.ts`:

```ts
import type { JarvisErrorLog } from "@jarv1s/db";

export interface RecordErrorInput {
  readonly id: string;
  readonly feature: string;
  readonly operation: string;
  readonly errorCategory: string;
  readonly retryable: boolean;
  readonly userMessage: string;
  readonly internalSummary: string;
  readonly requestId: string | null;
}

export interface ListRecentErrorsOptions {
  readonly query?: string;
  readonly since?: Date;
  readonly limit: number;
}
```

Add methods to `AiRepository`:

```ts
async recordError(scopedDb: DataContextDb, input: RecordErrorInput): Promise<void> {
  assertDataContextDb(scopedDb);
  await scopedDb.db
    .insertInto("app.jarvis_error_log")
    .values({
      id: input.id,
      owner_user_id: sql<string>`app.current_actor_user_id()`,
      feature: input.feature,
      operation: input.operation,
      error_category: input.errorCategory,
      retryable: input.retryable,
      user_message: input.userMessage,
      internal_summary: input.internalSummary,
      request_id: input.requestId
    })
    .execute();
}

async recordAnonymousError(appDb: Kysely<JarvisDatabase>, input: RecordErrorInput): Promise<void> {
  await sql`
    SELECT app.record_anonymous_error(
      ${input.id}::uuid,
      ${input.feature},
      ${input.operation},
      ${input.errorCategory},
      ${input.retryable},
      ${input.userMessage},
      ${input.internalSummary},
      ${input.requestId}
    )
  `.execute(appDb);
}

async listRecentErrors(
  scopedDb: DataContextDb,
  opts: ListRecentErrorsOptions
): Promise<JarvisErrorLog[]> {
  assertDataContextDb(scopedDb);
  const since = opts.since ?? new Date(Date.now() - 24 * 60 * 60 * 1000);
  const q = opts.query?.trim().toLowerCase();
  let query = scopedDb.db
    .selectFrom("app.jarvis_error_log")
    .selectAll()
    .where("occurred_at", ">=", since)
    .orderBy("occurred_at", "desc")
    .limit(Math.min(opts.limit, 50));

  if (q) {
    query = query.where((eb) =>
      eb.or([
        eb(sql<string>`lower(feature)`, "like", `%${q}%`),
        eb(sql<string>`lower(operation)`, "like", `%${q}%`),
        eb(sql<string>`lower(error_category)`, "like", `%${q}%`),
        eb(sql<string>`lower(user_message)`, "like", `%${q}%`)
      ])
    );
  }

  return query.execute();
}

async purgeErrorLog(appDb: Kysely<JarvisDatabase>, olderThan: Date): Promise<number> {
  const result = await sql<{ count: number }>`
    SELECT app.purge_jarvis_error_log(${olderThan}) AS count
  `.execute(appDb);
  return Number(result.rows[0]?.count ?? 0);
}
```

- [ ] **Step 3: Run focused checks**

```bash
pnpm vitest run tests/integration/error-log.test.ts
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/ai/src/repository.ts tests/integration/error-log.test.ts
git commit -m "feat(ai): record structured error events"
```

## Task 3: Assistant Tool

**Files:**

- Create: `packages/ai/src/error-tools.ts`
- Modify: `packages/ai/src/manifest.ts`
- Modify: `packages/ai/src/index.ts`
- Modify: `tests/integration/error-log.test.ts`

- [ ] **Step 1: Write failing tool tests**

Append to `tests/integration/error-log.test.ts`:

```ts
import { aiExplainRecentErrorsExecute } from "@jarv1s/ai";

it("assistant tool returns bounded recent matching errors", async () => {
  await dataContext.withDataContext(
    { actorUserId: ids.userA, requestId: "req-tool-seed" },
    (scopedDb) =>
      repo.recordError(scopedDb, {
        id: randomUUID(),
        feature: "sports",
        operation: "GET /api/sports/scores",
        errorCategory: "upstream_provider_unavailable",
        retryable: true,
        userMessage: "Scores are temporarily unavailable for some leagues",
        internalSummary: "Provider returned partial league data",
        requestId: "req-tool-seed"
      })
  );

  const result = await dataContext.withDataContext(
    { actorUserId: ids.userA, requestId: "req-tool" },
    (scopedDb) =>
      aiExplainRecentErrorsExecute(
        scopedDb,
        { query: "sports scores", limit: 5 },
        { actorUserId: ids.userA, requestId: "req-tool", chatSessionId: "" }
      )
  );

  expect(result.data.errors).toEqual([
    expect.objectContaining({
      feature: "sports",
      operation: "GET /api/sports/scores",
      errorCategory: "upstream_provider_unavailable",
      retryable: true
    })
  ]);
  expect(JSON.stringify(result.data)).not.toContain("stack");
});

it("assistant tool says when no diagnostic data exists", async () => {
  const result = await dataContext.withDataContext(
    { actorUserId: ids.userA, requestId: "req-tool-empty" },
    (scopedDb) =>
      aiExplainRecentErrorsExecute(
        scopedDb,
        { query: "not-real-feature", limit: 5 },
        { actorUserId: ids.userA, requestId: "req-tool-empty", chatSessionId: "" }
      )
  );

  expect(result.data).toEqual({
    errors: [],
    message:
      "No matching structured error data was found. The feature may not have emitted instrumentation for this error yet."
  });
});
```

Run:

```bash
pnpm vitest run tests/integration/error-log.test.ts
```

Expected: FAIL because `error-tools.ts` does not exist.

- [ ] **Step 2: Add tool**

Create `packages/ai/src/error-tools.ts`:

```ts
import { assertDataContextDb } from "@jarv1s/db";
import type { ToolExecute, ToolResult } from "@jarv1s/module-sdk";

import { AiRepository } from "./repository.js";

const repository = new AiRepository();
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 20;

function stringInput(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberLimit(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(Math.max(1, Math.floor(value)), MAX_LIMIT)
    : DEFAULT_LIMIT;
}

export const aiExplainRecentErrorsExecute: ToolExecute = async (
  scopedDb,
  input
): Promise<ToolResult> => {
  assertDataContextDb(scopedDb);
  const errors = await repository.listRecentErrors(scopedDb, {
    query: stringInput(input.query),
    limit: numberLimit(input.limit)
  });

  if (errors.length === 0) {
    return {
      data: {
        errors: [],
        message:
          "No matching structured error data was found. The feature may not have emitted instrumentation for this error yet."
      }
    };
  }

  return {
    data: {
      errors: errors.map((row) => ({
        occurredAt:
          row.occurred_at instanceof Date ? row.occurred_at.toISOString() : String(row.occurred_at),
        feature: row.feature,
        operation: row.operation,
        errorCategory: row.error_category,
        retryable: row.retryable,
        userMessage: row.user_message,
        internalSummary: row.internal_summary,
        requestId: row.request_id
      }))
    }
  };
};
```

Add to `packages/ai/src/manifest.ts`:

```ts
import { aiExplainRecentErrorsExecute } from "./error-tools.js";

assistantTools: [
  {
    name: "ai.explainRecentErrors",
    description: "List recent structured error events visible to the active actor.",
    permissionId: "ai.view",
    risk: "read",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        limit: { type: "number" }
      }
    },
    execute: aiExplainRecentErrorsExecute
  }
];
```

Add to `packages/ai/src/index.ts`:

```ts
export * from "./error-tools.js";
```

- [ ] **Step 3: Run focused checks**

```bash
pnpm vitest run tests/integration/error-log.test.ts
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/ai/src/error-tools.ts packages/ai/src/index.ts packages/ai/src/manifest.ts tests/integration/error-log.test.ts
git commit -m "feat(ai): expose recent error explanation tool"
```

## Task 4: API Write Path

**Files:**

- Modify: `apps/api/src/error-handling.ts`
- Modify: `apps/api/src/server.ts`
- Modify: `tests/unit/api-error-handling.test.ts`

- [ ] **Step 1: Write failing unit tests**

In `tests/unit/api-error-handling.test.ts`, update `makeServer` to accept recorder dependencies and add:

```ts
it("records client errors without passing stack to persistence", async () => {
  const recorded: unknown[] = [];
  server = Fastify({ logger: false });
  registerClientErrorsRoute(server, {
    recordClientError: async (event) => {
      recorded.push(event);
    }
  });
  setJarvisErrorHandler(server);

  const res = await server.inject({
    method: "POST",
    url: "/api/errors",
    headers: { "content-type": "application/json" },
    payload: { type: "react_error", message: "boom", stack: "Error: secret stack" }
  });

  expect(res.statusCode).toBe(204);
  expect(recorded).toEqual([
    expect.objectContaining({
      feature: "client",
      operation: "POST /api/errors",
      errorCategory: "client_error",
      retryable: false,
      userMessage: "boom",
      internalSummary: "Client reported react_error"
    })
  ]);
  expect(JSON.stringify(recorded)).not.toContain("stack");
  expect(JSON.stringify(recorded)).not.toContain("secret stack");
});

it("records request errors without passing raw stack or secret fields", async () => {
  const recorded: unknown[] = [];
  server = Fastify({ logger: false });
  server.get("/boom", async () => {
    const err = Object.assign(new Error("db password=hunter2"), {
      statusCode: 503,
      stack: "secret stack",
      headers: "cookie"
    });
    throw err;
  });
  setJarvisErrorHandler(server, {
    recordRequestError: async (event) => {
      recorded.push(event);
    }
  });

  const res = await server.inject({ method: "GET", url: "/boom" });

  expect(res.statusCode).toBe(503);
  expect(res.json()).toEqual({ error: "Internal Server Error" });
  expect(recorded).toEqual([
    expect.objectContaining({
      feature: "api",
      operation: "GET /boom",
      errorCategory: "http_5xx",
      retryable: true,
      userMessage: "Internal Server Error",
      internalSummary: "Request failed with status 503",
      requestId: expect.any(String)
    })
  ]);
  expect(JSON.stringify(recorded)).not.toContain("secret stack");
  expect(JSON.stringify(recorded)).not.toContain("headers");
});
```

Run:

```bash
pnpm vitest run tests/unit/api-error-handling.test.ts
```

Expected: FAIL because recorder options do not exist.

- [ ] **Step 2: Add narrow recorder seam**

In `apps/api/src/error-handling.ts`, add:

```ts
export interface PersistableErrorEvent {
  readonly feature: string;
  readonly operation: string;
  readonly errorCategory: string;
  readonly retryable: boolean;
  readonly userMessage: string;
  readonly internalSummary: string;
  readonly requestId: string | null;
}

export interface ClientErrorsRouteOptions {
  readonly recordClientError?: (
    event: PersistableErrorEvent,
    request: FastifyRequest
  ) => Promise<void>;
}

export interface JarvisErrorHandlerOptions {
  readonly recordRequestError?: (
    event: PersistableErrorEvent,
    request: FastifyRequest
  ) => Promise<void>;
}
```

Update function signatures:

```ts
export function registerClientErrorsRoute(
  server: FastifyInstance,
  options: ClientErrorsRouteOptions = {}
): void;

export function setJarvisErrorHandler(
  server: FastifyInstance,
  options: JarvisErrorHandlerOptions = {}
): void;
```

Inside `registerClientErrorsRoute`, after the existing log line:

```ts
await options
  .recordClientError?.(
    {
      feature: "client",
      operation: "POST /api/errors",
      errorCategory: "client_error",
      retryable: false,
      userMessage: payload.message.slice(0, MAX_CLIENT_MESSAGE_CHARS),
      internalSummary: `Client reported ${payload.type}`,
      requestId: request.id
    },
    request
  )
  .catch((recordError) => {
    request.log.error(
      { err: String(recordError), reqId: request.id },
      "failed to persist client error"
    );
  });
```

Inside `setJarvisErrorHandler`, after the existing log line and before sending the response:

```ts
const operation = `${request.method} ${request.routeOptions.url ?? request.url.split("?")[0] ?? request.url}`;
const errorCategory = statusCode >= 500 ? "http_5xx" : "http_4xx";
void options
  .recordRequestError?.(
    {
      feature: "api",
      operation,
      errorCategory,
      retryable: statusCode >= 500,
      userMessage: statusCode < 500 ? message : "Internal Server Error",
      internalSummary: `Request failed with status ${statusCode}`,
      requestId: request.id
    },
    request
  )
  .catch((recordError) => {
    request.log.error(
      { err: String(recordError), reqId: request.id },
      "failed to persist request error"
    );
  });
```

- [ ] **Step 3: Wire server composition**

In `apps/api/src/server.ts`, import `randomUUID` and `AiRepository`.

Create one repository near the existing composition dependencies:

```ts
const aiRepository = new AiRepository();
```

Add a local helper in `apps/api/src/server.ts`:

```ts
function hasAuthMaterial(request: FastifyRequest): boolean {
  const authorization = request.headers.authorization;
  const cookie = request.headers.cookie;
  return (
    (typeof authorization === "string" && authorization.trim().length > 0) ||
    (typeof cookie === "string" && cookie.trim().length > 0)
  );
}
```

Pass options to `registerClientErrorsRoute`:

```ts
registerClientErrorsRoute(server, {
  recordClientError: async (event, request) => {
    const input = { id: randomUUID(), ...event };
    if (!hasAuthMaterial(request)) {
      await aiRepository.recordAnonymousError(appDb, input);
      return;
    }

    try {
      const accessContext = await authRuntime.resolveAccessContext(request);
      await dataContext.withDataContext(accessContext, (scopedDb) =>
        aiRepository.recordError(scopedDb, {
          id: input.id,
          feature: event.feature,
          operation: event.operation,
          errorCategory: event.errorCategory,
          retryable: event.retryable,
          userMessage: event.userMessage,
          internalSummary: event.internalSummary,
          requestId: event.requestId
        })
      );
    } catch {
      request.log.warn(
        { reqId: request.id },
        "skipped error persistence after auth resolution failed"
      );
    }
  }
});
```

Implementation note: use the actual `request` passed by `registerClientErrorsRoute` for `resolveAccessContext`; only requests with no bearer/cookie auth material become anonymous.

Pass options to `setJarvisErrorHandler`:

```ts
setJarvisErrorHandler(server, {
  recordRequestError: async (event, request) => {
    if (!hasAuthMaterial(request)) {
      await aiRepository.recordAnonymousError(appDb, { id: randomUUID(), ...event });
      return;
    }

    const accessContext = await authRuntime.resolveAccessContext(request);
    await dataContext.withDataContext(accessContext, (scopedDb) =>
      aiRepository.recordError(scopedDb, { id: randomUUID(), ...event })
    );
  }
});
```

- [ ] **Step 4: Run focused checks**

```bash
pnpm vitest run tests/unit/api-error-handling.test.ts tests/integration/error-log.test.ts
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/error-handling.ts apps/api/src/server.ts tests/unit/api-error-handling.test.ts
git commit -m "feat(api): persist safe error diagnostics"
```

## Task 5: Final Verification

**Files:**

- All touched files.

- [ ] **Step 1: Re-index code graph**

```bash
codegraph sync .
```

Expected: exits 0.

- [ ] **Step 2: Run focused tests**

```bash
pnpm vitest run tests/unit/api-error-handling.test.ts tests/integration/error-log.test.ts tests/integration/foundation.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run full foundation gate**

```bash
pnpm verify:foundation
```

Expected: PASS.

- [ ] **Step 4: Pre-push trio + rebase before wrap-up**

```bash
pnpm format:check && pnpm lint && pnpm typecheck
git fetch origin main && git rebase origin/main
```

Expected: all PASS; rebase clean.

## Self-Review

- D1 covered: new `app.jarvis_error_log`, not action audit reuse.
- D2 covered: uses `packages/ai`, no new module.
- D3 covered: RLS-forced table, grants, purge function, manifest migration/table updates.
- D4 covered: both API error call sites write narrowed persistence events; `stack` is dropped before recorder boundary.
- D5 covered: read-only assistant tool, bounded recency-ordered results, explicit no-data message.
- Security covered: owner-scoped RLS, anonymous rows invisible to users, no stack/request body/header/cookie/prompt columns, type-level `stack` rejection test.
- Coordinator adjudication applied: anonymous persistence uses `app.record_anonymous_error(...)` as a `SECURITY DEFINER` function, not bare Kysely CRUD, and direct NULL-owner INSERT is denied by policy.
- Auth downgrade applied: only requests with no auth material write anonymous rows. If auth material exists and resolution fails, persistence is skipped/logged instead of hiding the event in anonymous rows.
