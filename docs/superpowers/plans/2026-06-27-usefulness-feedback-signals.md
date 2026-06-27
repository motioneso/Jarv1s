# Usefulness Feedback Signals Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add owner-scoped usefulness feedback signals for chat and briefing targets, with metadata-only storage, undo, dismissal suppression, and safe manual memory-candidate intake.

**Architecture:** Add a small required `@jarv1s/usefulness-feedback` package that owns the ledger tables, REST routes, repository, verifier registry, and target registry. Chat and briefings expose module-owned verifier factories; module-registry composes them into the feedback routes. Memory owns the manual candidate intake/cancel helper used by `remember_this`.

**Tech Stack:** TypeScript, Fastify, Kysely/DataContextDb, Postgres RLS, Vitest, React Query, existing Jarvis design CSS.

---

## Verified Current State

- `app.usefulness_feedback_signals`, `app.usefulness_feedback_targets`, `UsefulnessFeedback*`, `feedbackItemId`, and the three `/api/me/usefulness-feedback` routes are absent.
- `app.memory_candidates` exists in `packages/memory/sql/0119_memory_candidates.sql`, but no memory-owned manual intake/cancel helper exists.
- Chat messages have stable row ids in history responses, but live `TranscriptRecord` and `POST /api/chat/turn` currently expose only text/reply.
- Briefing runs store `summary_text` and metadata in `app.briefing_runs`; briefing item feedback ids and target registry rows are absent.
- Assigned migration slot `0120_usefulness_feedback_signals.sql` is unused.

## Files

- Create `packages/usefulness-feedback/package.json`: package scaffold.
- Create `packages/usefulness-feedback/src/{index.ts,manifest.ts,repository.ts,routes.ts,target-verifiers.ts,metadata.ts}`: feedback module.
- Create `packages/usefulness-feedback/sql/0120_usefulness_feedback_signals.sql`: tables, constraints, grants, RLS.
- Modify `packages/db/src/types.ts`: table types and row aliases.
- Modify `packages/shared/src/{index.ts,usefulness-feedback-api.ts,chat-api.ts,briefings-api.ts}`: API contracts plus optional `messageId` / `feedbackItemId`.
- Modify `packages/memory/src/{index.ts,manual-candidates.ts}` and possibly `candidates-repository.ts`: memory-owned manual intake/cancel.
- Modify `packages/chat/src/{index.ts,manifest.ts,repository.ts,live/types.ts,live/chat-session-manager.ts,live-routes.ts,routes.ts}`: chat verifier and live message ids.
- Modify `packages/briefings/src/{index.ts,manifest.ts,repository.ts,compose.ts,routes.ts}`: run/item verifier, target registry upsert, dismissal suppression.
- Modify `packages/module-registry/src/index.ts`: register feedback module and verifiers.
- Modify `packages/settings/src/data-export.ts`: include feedback/target metadata in user export.
- Modify `apps/web/src/api/{client.ts,query-keys.ts}` and `apps/web/src/{chat/chat-drawer.tsx,today/today-page.tsx,styles/kit-chat.css,styles/kit-today.css}`: compact feedback menus and undo.
- Test `tests/integration/usefulness-feedback.test.ts`; update focused chat/briefings tests only where contracts change.

## Task 1: Contracts, Migration, And Module Shell

**Files:**

- Create: `packages/shared/src/usefulness-feedback-api.ts`
- Create: `packages/usefulness-feedback/package.json`
- Create: `packages/usefulness-feedback/src/index.ts`
- Create: `packages/usefulness-feedback/src/manifest.ts`
- Create: `packages/usefulness-feedback/sql/0120_usefulness_feedback_signals.sql`
- Modify: `packages/shared/src/index.ts`
- Modify: `packages/db/src/types.ts`
- Modify: `packages/module-registry/src/index.ts`

- [ ] **Step 1: Write failing migration/manifest tests**

Add `tests/integration/usefulness-feedback.test.ts`:

```ts
import Fastify from "fastify";
import { beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { getBuiltInModuleManifests, getBuiltInModuleRegistrations } from "@jarv1s/module-registry";
import { resetFoundationDatabase, connectionStrings } from "./test-database.js";

const { Client } = pg;

describe("usefulness feedback foundation", () => {
  beforeAll(async () => {
    await resetFoundationDatabase();
  });

  it("registers the required feedback module and applies owner-only RLS", async () => {
    expect(getBuiltInModuleManifests().map((m) => m.id)).toContain("usefulness-feedback");
    const registration = getBuiltInModuleRegistrations().find(
      (item) => item.manifest.id === "usefulness-feedback"
    );
    expect(registration?.manifest.routes?.map((r) => `${r.method} ${r.path}`)).toEqual([
      "POST /api/me/usefulness-feedback",
      "GET /api/me/usefulness-feedback",
      "POST /api/me/usefulness-feedback/:id/undo"
    ]);

    const client = new Client({ connectionString: connectionStrings.migration });
    await client.connect();
    try {
      const tables = await client.query(`
        SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity,
               has_table_privilege('jarvis_app_runtime', c.oid, 'DELETE') AS app_delete
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'app'
          AND c.relname IN ('usefulness_feedback_signals', 'usefulness_feedback_targets')
        ORDER BY c.relname
      `);
      expect(tables.rows).toEqual([
        {
          relname: "usefulness_feedback_signals",
          relrowsecurity: true,
          relforcerowsecurity: true,
          app_delete: false
        },
        {
          relname: "usefulness_feedback_targets",
          relrowsecurity: true,
          relforcerowsecurity: true,
          app_delete: false
        }
      ]);
    } finally {
      await client.end();
    }
  });
});
```

Run: `pnpm test:integration -- tests/integration/usefulness-feedback.test.ts`
Expected: FAIL because package/module/tables do not exist.

- [ ] **Step 2: Add shared contracts**

Add locked enum unions, request/response DTOs, and Fastify schemas in `packages/shared/src/usefulness-feedback-api.ts`; export it from `packages/shared/src/index.ts`.

Key contracts:

```ts
export type UsefulnessFeedbackKind =
  | "more_like_this"
  | "too_much"
  | "wrong_priority"
  | "not_useful"
  | "remember_this"
  | "dismiss";
export type FeedbackTargetKind =
  | "chat_message"
  | "briefing_run"
  | "briefing_item"
  | "proactive_card";
export type FeedbackSurface = "chat" | "briefing" | "today" | "proactive";
export type FeedbackStatus = "active" | "undone";
```

- [ ] **Step 3: Add migration**

Create `packages/usefulness-feedback/sql/0120_usefulness_feedback_signals.sql` with:

- `app.usefulness_feedback_signals`
- `app.usefulness_feedback_targets`
- enum checks for target/surface/kind/status
- partial unique index on active `(owner_user_id, target_kind, target_ref, kind)`
- owner-only RLS for `SELECT/INSERT/UPDATE`
- no runtime `DELETE` grant

- [ ] **Step 4: Add DB table types and module manifest**

Add table interfaces in `packages/db/src/types.ts`, then add `@jarv1s/usefulness-feedback` manifest with owned tables and the three route declarations. Wire it into `BUILT_IN_MODULES`.

- [ ] **Step 5: Run test**

Run: `pnpm test:integration -- tests/integration/usefulness-feedback.test.ts`
Expected: PASS for migration/manifest test.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/usefulness-feedback-api.ts packages/shared/src/index.ts packages/usefulness-feedback/package.json packages/usefulness-feedback/src/index.ts packages/usefulness-feedback/src/manifest.ts packages/usefulness-feedback/sql/0120_usefulness_feedback_signals.sql packages/db/src/types.ts packages/module-registry/src/index.ts tests/integration/usefulness-feedback.test.ts
git commit -m "feat: add usefulness feedback ledger schema"
```

## Task 2: Repository, Routes, Validation, And Verifier Registry

**Files:**

- Create: `packages/usefulness-feedback/src/{repository.ts,routes.ts,target-verifiers.ts,metadata.ts}`
- Modify: `packages/usefulness-feedback/src/index.ts`
- Modify: `packages/module-registry/src/index.ts`
- Test: `tests/integration/usefulness-feedback.test.ts`

- [ ] **Step 1: Write failing route tests**

Extend `tests/integration/usefulness-feedback.test.ts` with:

```ts
it("rejects invalid kinds, target/surface mismatches, and unknown top-level keys", async () => {
  const server = await buildFeedbackTestServer();
  expect(
    (
      await server.inject({
        method: "POST",
        url: "/api/me/usefulness-feedback",
        headers: userAHeaders(),
        payload: { targetKind: "chat_message", targetRef: "x", surface: "chat", kind: "dismiss" }
      })
    ).statusCode
  ).toBe(400);
  expect(
    (
      await server.inject({
        method: "POST",
        url: "/api/me/usefulness-feedback",
        headers: userAHeaders(),
        payload: {
          targetKind: "chat_message",
          targetRef: "x",
          surface: "today",
          kind: "not_useful"
        }
      })
    ).statusCode
  ).toBe(400);
  expect(
    (
      await server.inject({
        method: "POST",
        url: "/api/me/usefulness-feedback",
        headers: userAHeaders(),
        payload: {
          targetKind: "chat_message",
          targetRef: "x",
          surface: "chat",
          kind: "not_useful",
          extra: true
        }
      })
    ).statusCode
  ).toBe(400);
});

it("creates idempotent active feedback through a registered verifier and undoes it", async () => {
  const { server, verifierCalls } = await buildFeedbackTestServer({
    verifier: async () => ({
      ownerUserId: ids.userA,
      targetKind: "chat_message",
      targetRef: "msg-a",
      surface: "chat",
      sourceKind: "chat",
      sourceLabel: "Chat",
      priorityBand: "normal",
      metadata: { role: "assistant" },
      canRemember: false
    })
  });
  const create = () =>
    server.inject({
      method: "POST",
      url: "/api/me/usefulness-feedback",
      headers: userAHeaders(),
      payload: {
        targetKind: "chat_message",
        targetRef: "msg-a",
        surface: "chat",
        kind: "not_useful"
      }
    });
  const first = await create();
  const second = await create();
  expect(first.statusCode).toBe(201);
  expect(second.statusCode).toBe(200);
  expect(verifierCalls()).toBe(1);
  const id = first.json().feedback.id;
  expect(
    (
      await server.inject({
        method: "POST",
        url: `/api/me/usefulness-feedback/${id}/undo`,
        headers: userAHeaders()
      })
    ).statusCode
  ).toBe(200);
});
```

Run: `pnpm test:integration -- tests/integration/usefulness-feedback.test.ts`
Expected: FAIL because routes/repository are absent.

- [ ] **Step 2: Implement registry and repository**

Implement:

- `FeedbackTargetVerifierRegistry.register(kind, verifier)`
- `UsefulnessFeedbackRepository.findActive`, `create`, `list`, `undo`, `upsertTarget`, `isDismissed`
- metadata sanitizer: serialized cap 2 KB, string cap 200 chars, plain JSON only

- [ ] **Step 3: Implement routes**

`registerUsefulnessFeedbackRoutes` must:

- resolve `AccessContext`
- validate request shape with `additionalProperties: false`
- reject invalid target/action and target/surface pairs before DB writes
- return existing active row before verifier/memory side effects
- call verifier under `DataContextDb`
- fail closed with 404 when no verifier or missing target
- set logs to metadata-only fields
- implement idempotent undo with `resolved_at`

- [ ] **Step 4: Wire routes in module-registry**

Instantiate one registry/repository in `registerBuiltInApiRoutes`, register verifiers from later tasks only when available, then call feedback route registration.

- [ ] **Step 5: Run tests**

Run: `pnpm test:integration -- tests/integration/usefulness-feedback.test.ts`
Expected: PASS for validation, idempotency, list, undo basics.

- [ ] **Step 6: Commit**

```bash
git add packages/usefulness-feedback/src packages/module-registry/src/index.ts tests/integration/usefulness-feedback.test.ts
git commit -m "feat: add usefulness feedback routes"
```

## Task 3: Memory Manual Intake For `remember_this`

**Files:**

- Create: `packages/memory/src/manual-candidates.ts`
- Modify: `packages/memory/src/index.ts`
- Modify: `packages/usefulness-feedback/src/{routes.ts,repository.ts}`
- Test: `tests/integration/usefulness-feedback.test.ts`

- [ ] **Step 1: Write failing memory tests**

Add tests:

```ts
it("remember_this creates one pending manual memory candidate and stores only candidate id on feedback", async () => {
  const { server, dataContext } = await buildFeedbackTestServer({
    verifier: rememberableVerifier("remember me safely")
  });
  const first = await server.inject({
    method: "POST",
    url: "/api/me/usefulness-feedback",
    headers: userAHeaders(),
    payload: {
      targetKind: "chat_message",
      targetRef: "msg-memory",
      surface: "chat",
      kind: "remember_this"
    }
  });
  const second = await server.inject({
    method: "POST",
    url: "/api/me/usefulness-feedback",
    headers: userAHeaders(),
    payload: {
      targetKind: "chat_message",
      targetRef: "msg-memory",
      surface: "chat",
      kind: "remember_this"
    }
  });
  expect(first.statusCode).toBe(201);
  expect(second.statusCode).toBe(200);
  expect(first.json().feedback.effectKind).toBe("memory_candidate");
  expect(JSON.stringify(first.json().feedback)).not.toContain("remember me safely");
  const rows = await dataContext.withDataContext(userAContext(), (scopedDb) =>
    scopedDb.db
      .selectFrom("app.memory_candidates")
      .selectAll()
      .where("owner_user_id", "=", ids.userA)
      .execute()
  );
  expect(rows).toHaveLength(1);
  expect(rows[0].status).toBe("pending");
  expect(rows[0].payload_json).toMatchObject({
    manualRequest: true,
    excerpt: "remember me safely",
    targetKind: "chat_message",
    targetRef: "msg-memory"
  });
});

it("undo of pending remember_this suppresses the linked candidate", async () => {
  const { server, dataContext } = await buildFeedbackTestServer({
    verifier: rememberableVerifier("cancel me")
  });
  const created = await server.inject({
    method: "POST",
    url: "/api/me/usefulness-feedback",
    headers: userAHeaders(),
    payload: {
      targetKind: "chat_message",
      targetRef: "msg-cancel",
      surface: "chat",
      kind: "remember_this"
    }
  });
  await server.inject({
    method: "POST",
    url: `/api/me/usefulness-feedback/${created.json().feedback.id}/undo`,
    headers: userAHeaders()
  });
  const row = await dataContext.withDataContext(userAContext(), (scopedDb) =>
    scopedDb.db
      .selectFrom("app.memory_candidates")
      .selectAll()
      .where("id", "=", created.json().feedback.effectRef)
      .executeTakeFirstOrThrow()
  );
  expect(row.status).toBe("suppressed");
});
```

Run: `pnpm test:integration -- tests/integration/usefulness-feedback.test.ts`
Expected: FAIL because memory intake helper is absent.

- [ ] **Step 2: Implement memory-owned helper**

Add `ManualMemoryCandidateService.createPendingManualCandidate(scopedDb, ownerUserId, input)`:

- signature `manual:<sha256(targetKind + targetRef + normalized excerpt)>`
- `kind = "fact"`, `action = "create"`, `status = "pending"`
- `episode_id` optional
- `confidence = 0.5`, `importance = 0.5`
- payload includes `manualRequest`, bounded `excerpt`, `targetKind`, `targetRef`
- revive only same manual signature back to pending

Add `cancelPendingManualCandidate(scopedDb, ownerUserId, id)` that changes only pending candidate to `suppressed`.

- [ ] **Step 3: Wire `remember_this` transaction order**

In create route, for `remember_this`:

1. verify target and `canRemember`
2. create pending memory candidate
3. create feedback row with `effect_kind = "memory_candidate"` and `effect_ref`

If intake fails, no feedback row remains.

- [ ] **Step 4: Run tests**

Run: `pnpm test:integration -- tests/integration/usefulness-feedback.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/memory/src/manual-candidates.ts packages/memory/src/index.ts packages/usefulness-feedback/src tests/integration/usefulness-feedback.test.ts
git commit -m "feat: route remember feedback through memory candidates"
```

## Task 4: Chat Verifier And Live Message IDs

**Files:**

- Modify: `packages/chat/src/{repository.ts,routes.ts,index.ts,live/types.ts,live/chat-session-manager.ts,live-routes.ts,manifest.ts}`
- Modify: `packages/shared/src/chat-api.ts`
- Modify: `apps/web/src/chat/use-chat-stream.ts`
- Test: `tests/integration/usefulness-feedback.test.ts`, `tests/integration/chat-live.test.ts`

- [ ] **Step 1: Write failing chat verifier tests**

Create a chat message for user A, then assert:

```ts
it("verifies chat_message through chat-owned verifier and rejects other owners/incognito remember", async () => {
  const userAMessage = await createStoredChatMessage(ids.userA, {
    role: "assistant",
    incognito: false,
    body: "bounded reply"
  });
  const userBMessage = await createStoredChatMessage(ids.userB, {
    role: "assistant",
    incognito: false,
    body: "private reply"
  });
  expect(
    await postFeedback("chat_message", userAMessage.id, "chat", "not_useful", userAHeaders())
  ).toMatchObject({ statusCode: 201 });
  expect(
    (await postFeedback("chat_message", userBMessage.id, "chat", "not_useful", userAHeaders()))
      .statusCode
  ).toBe(404);
  const incognito = await createStoredChatMessage(ids.userA, {
    role: "assistant",
    incognito: true,
    body: "secret"
  });
  expect(
    (await postFeedback("chat_message", incognito.id, "chat", "remember_this", userAHeaders()))
      .statusCode
  ).toBe(400);
});
```

Run: `pnpm test:integration -- tests/integration/usefulness-feedback.test.ts`
Expected: FAIL because chat verifier is absent.

- [ ] **Step 2: Add chat-owned verifier**

Add `createChatFeedbackTargetVerifier(repository = new ChatRepository())` returning metadata-only:

- target kind `chat_message`
- owner-scoped lookup by message id
- `sourceKind = "chat"`, `sourceLabel = "Chat"`
- `metadata = { role, status }`
- `canRemember = !thread.incognito && message.role === "user"` or assistant only if explicit product decision is approved; default user-authored only for safety
- `rememberExcerpt` bounded and transient

- [ ] **Step 3: Expose live message ids**

Adjust persistence/manager so `submitTurn` returns and emits `messageId` for stored user/reply records without putting message bodies in metadata. Update shared/web `TranscriptRecord` parsing to preserve optional `messageId`.

- [ ] **Step 4: Run tests**

Run: `pnpm test:chat`
Run: `pnpm test:integration -- tests/integration/usefulness-feedback.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/chat/src packages/shared/src/chat-api.ts apps/web/src/chat/use-chat-stream.ts tests/integration/usefulness-feedback.test.ts tests/integration/chat-live.test.ts
git commit -m "feat: verify chat feedback targets"
```

## Task 5: Briefing Run/Item Targets And Dismissal

**Files:**

- Modify: `packages/briefings/src/{compose.ts,repository.ts,routes.ts,index.ts,manifest.ts}`
- Modify: `packages/shared/src/briefings-api.ts`
- Test: `tests/integration/usefulness-feedback.test.ts`, `tests/integration/briefings.test.ts`

- [ ] **Step 1: Write failing briefing tests**

Add tests:

```ts
it("creates stable safe briefing item ids and registry rows without raw source ids", async () => {
  const run = await createBriefingRunWithSignals(ids.userA);
  const items = run.source_metadata.feedbackItems;
  expect(items[0].feedbackItemId).toMatch(/^[a-z]+:[a-z_]+:[a-f0-9]{16}$/);
  expect(items[0].feedbackItemId).not.toContain("email");
  const listed = await listRunsAsUserA();
  expect(listed.runs[0].feedbackItems[0]).toMatchObject({
    targetKind: "briefing_item",
    surface: "briefing"
  });
});

it("dismiss hides exact briefing item for owner only", async () => {
  const itemRef = await createRegisteredBriefingItem(ids.userA);
  expect(
    (await postFeedback("briefing_item", itemRef, "briefing", "dismiss", userAHeaders())).statusCode
  ).toBe(201);
  expect(await listBriefingItemRefs(ids.userA)).not.toContain(itemRef);
  expect(await listBriefingItemRefs(ids.userB)).toContain(itemRef);
});
```

Run: `pnpm test:briefings -- tests/integration/briefings.test.ts`
Expected: FAIL because feedback item ids and dismissal suppression are absent.

- [ ] **Step 2: Add stable item id helper**

In briefings, derive `feedbackItemId` as:

```ts
`${source}:${signalType}:${sha256(sourceIds + normalizedSummary).slice(0, 16)}`;
```

Expose only the id, source label, signal type, and priority band. Do not expose raw source ids or summaries inside `targetRef`.

- [ ] **Step 3: Upsert target registry while rendering/listing**

Use feedback repository public API from module-registry seam or a small injected port so briefings does not query feedback tables directly. Upsert metadata-only rows:

- `target_kind = "briefing_run"` for each run
- `target_kind = "briefing_item"` for each item
- `metadata_json.signalType` only, no raw text

- [ ] **Step 4: Add briefings verifier and dismissal filter**

Verifier checks registry rows for item/run ownership. `dismiss` filtering excludes active dismissed run/item refs for the actor before serializing responses.

- [ ] **Step 5: Run tests**

Run: `pnpm test:briefings`
Run: `pnpm test:integration -- tests/integration/usefulness-feedback.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/briefings/src packages/shared/src/briefings-api.ts tests/integration/briefings.test.ts tests/integration/usefulness-feedback.test.ts
git commit -m "feat: add briefing feedback targets"
```

## Task 6: Web UI Actions And Undo

**Files:**

- Modify: `apps/web/src/api/{client.ts,query-keys.ts}`
- Modify: `apps/web/src/chat/chat-drawer.tsx`
- Modify: `apps/web/src/today/today-page.tsx`
- Modify: `apps/web/src/styles/{kit-chat.css,kit-today.css}`

- [ ] **Step 1: Add client calls**

Add `createUsefulnessFeedback`, `undoUsefulnessFeedback`, and `listUsefulnessFeedback` wrappers in `apps/web/src/api/client.ts`.

- [ ] **Step 2: Add compact action menu**

Use existing button styling plus `lucide-react` icons. Chat rows with `messageId` show `More like this`, `Not useful`, and `Remember this` only when allowed by DTO flag. Briefing run/card surfaces show allowed V1 actions.

- [ ] **Step 3: Add quiet undo**

After mutation success, render a small inline status with `Undo` button that calls `/undo` and invalidates affected queries. Keep copy short; no explanatory feature text.

- [ ] **Step 4: Build/typecheck web**

Run: `pnpm --filter @jarv1s/web typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/api/client.ts apps/web/src/api/query-keys.ts apps/web/src/chat/chat-drawer.tsx apps/web/src/today/today-page.tsx apps/web/src/styles/kit-chat.css apps/web/src/styles/kit-today.css
git commit -m "feat: add usefulness feedback controls"
```

## Task 7: Export Coverage, Security Tests, And Final Gate

**Files:**

- Modify: `packages/settings/src/data-export.ts`
- Test: `tests/integration/usefulness-feedback.test.ts`

- [ ] **Step 1: Add export and RLS tests**

Add tests that:

- user A list/create/undo cannot see user B targets
- admin cannot bypass private feedback rows
- export includes feedback rows and target rows for owner only
- feedback rows never store `rememberExcerpt`, prompt text, or source bodies

- [ ] **Step 2: Add data export rows**

Add `usefulnessFeedbackSignals` and `usefulnessFeedbackTargets` to `UserDataExportTables` and SQL queries, selecting metadata columns only.

- [ ] **Step 3: Run focused tests**

Run:

```bash
pnpm test:api
pnpm test:chat
pnpm test:briefings
pnpm test:memory
pnpm test:integration -- tests/integration/usefulness-feedback.test.ts
```

Expected: PASS.

- [ ] **Step 4: Run local gate**

Run:

```bash
pnpm format:check && pnpm lint && pnpm typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/settings/src/data-export.ts tests/integration/usefulness-feedback.test.ts
git commit -m "test: cover usefulness feedback security"
```

## Self-Review

- Spec coverage: ledger, target registry, routes, validation, verifier registry, stable briefing item refs, metadata-only storage, idempotent create, undo, dismiss, memory-safe `remember_this`, export, and RLS are covered.
- Deliberate skip: no learned ranking engine, proactive-card verifier, free-form text, memory dashboard, or priority model mutation.
- Risk note: live chat message ids require touching runtime response/SSE shape; keep additive and optional.
