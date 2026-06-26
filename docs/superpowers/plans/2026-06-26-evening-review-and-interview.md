# Evening Review And Interview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add morning/evening briefing types, scheduled evening review, and a chat-seeded prep interview.

**Architecture:** Keep the review in `packages/briefings` and the interview in `packages/chat`. Add a `briefing_type` enum/column instead of overloading `run_kind`; scheduled jobs stay metadata-only. The interview uses existing live chat/action-request machinery, with one small context-seed API so review content enters chat as delimited context, not a visible user-authored turn.

**Tech Stack:** TypeScript, Kysely, Fastify, pg-boss, Vitest, React Query, React.

---

## Branch Verification

- Current branch: `build/evening-review-and-interview` at `fdf381b`.
- `node_modules` present.
- Required skills resolved: `coordinated-build`, `coordinated-wrap-up`, `relay`.
- Current highest SQL migration on this branch: `0113_worker_calendar_events_delete.sql`; coordinator says #484 claims `0114` and `0115`, so this plan claims `packages/briefings/sql/0116_briefing_type.sql`.
- Spec drift: `packages/briefings/src/settings/index.tsx` does not exist. Current briefings settings UI is `apps/web/src/settings/settings-module-subviews.tsx`, local state only. Plan wires that existing surface to real briefings APIs.
- Action-loop from #214/#488 is present (`packages/ai/src/repository.ts`, `packages/chat/src/routes.ts`, `apps/web/src/chat/action-request-card.tsx`). No custom proposal/write path needed.
- Runtime config #496 is present, but briefings do not read `instance_settings`; no runtime-config integration needed for evening review.

## Files

- Create `packages/briefings/sql/0116_briefing_type.sql`: enum + columns.
- Modify `packages/briefings/src/manifest.ts`: include migration.
- Modify `packages/db/src/types.ts`: `BriefingType`, table columns.
- Modify `packages/shared/src/briefings-api.ts`: DTO/schema/type additions and interview endpoint contract.
- Modify `packages/briefings/src/repository.ts`: create/update/list/generate/persist type-aware definitions/runs.
- Modify `packages/briefings/src/routes.ts`: parse/serialize `briefingType`; expose owned evening-run seed data through the resolver used by chat.
- Modify `packages/briefings/src/schedule.ts`: scheduled payload includes `briefingType`; default target time helper.
- Modify `packages/briefings/src/jobs.ts`: payload/schema metadata-only check includes `briefingType`; notification title switches morning/evening.
- Modify `packages/briefings/src/compose.ts`: morning/evening trusted prompt selection.
- Modify `packages/chat/src/live/chat-session-manager.ts`: add `seedContext(actorUserId, userName, seed)` that submits/drains hidden context without persisting it as a user turn.
- Modify `packages/chat/src/live-routes.ts`: add `POST /api/chat/evening-interview`.
- Modify `packages/chat/src/routes.ts` and `packages/module-registry/src/index.ts`: inject a briefings seed resolver into chat routes without chat importing briefings internals.
- Modify `apps/web/src/api/client.ts`, `apps/web/src/api/query-keys.ts`: client helpers.
- Modify `apps/web/src/settings/settings-module-subviews.tsx`: real morning/evening definitions settings.
- Modify `apps/web/src/today/today-page.tsx`: latest evening review card + prep button.
- Tests: `tests/unit/briefings-schedule.test.ts`, `tests/unit/briefings-prompt-isolation.test.ts`, `tests/unit/briefings-compose.test.ts`, `tests/integration/briefings.test.ts`, `tests/integration/briefings-synthesis.test.ts`, `tests/unit/chat-session-manager.test.ts`, `tests/integration/chat-live-api.test.ts`.

---

### Task 1: Schema And Contracts

**Files:**

- Create: `packages/briefings/sql/0116_briefing_type.sql`
- Modify: `packages/briefings/src/manifest.ts`
- Modify: `packages/db/src/types.ts`
- Modify: `packages/shared/src/briefings-api.ts`
- Test: `tests/integration/briefings.test.ts`

- [ ] **Step 1: Write failing contract/schema tests**

Add expectations that serialized definitions/runs include `briefingType`, and job schemas accept only metadata fields including `briefingType`.

```ts
expect(briefingRunPayloadSchema.required).toContain("briefingType");
expect(briefingRunPayloadSchema.properties.briefingType).toEqual({
  type: "string",
  enum: ["morning", "evening"]
});
```

- [ ] **Step 2: Run failing tests**

Run:

```bash
pnpm vitest run tests/integration/briefings.test.ts tests/unit/briefings-schedule.test.ts
```

Expected: FAIL on missing `briefingType`.

- [ ] **Step 3: Add migration**

Create `0116_briefing_type.sql`:

```sql
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type
    WHERE typnamespace = 'app'::regnamespace
      AND typname = 'briefing_type'
  ) THEN
    CREATE TYPE app.briefing_type AS ENUM ('morning', 'evening');
  END IF;
END
$$;

ALTER TABLE app.briefing_definitions
  ADD COLUMN IF NOT EXISTS briefing_type app.briefing_type NOT NULL DEFAULT 'morning';

ALTER TABLE app.briefing_runs
  ADD COLUMN IF NOT EXISTS briefing_type app.briefing_type NOT NULL DEFAULT 'morning';

CREATE INDEX IF NOT EXISTS briefing_definitions_owner_type_updated_at_idx
  ON app.briefing_definitions(owner_user_id, briefing_type, updated_at DESC);
```

Add migration to `briefingsModuleManifest.database.migrations`.

- [ ] **Step 4: Add TS/shared types**

Add:

```ts
export type BriefingType = "morning" | "evening";
```

Add `briefing_type: BriefingType` to DB tables and `briefingType` to DTOs, requests, payload DTOs, and JSON schemas.

- [ ] **Step 5: Run tests**

Run:

```bash
pnpm vitest run tests/integration/briefings.test.ts tests/unit/briefings-schedule.test.ts
```

Expected: PASS for schema/contract pieces.

- [ ] **Step 6: Commit**

```bash
git add packages/briefings/sql/0116_briefing_type.sql packages/briefings/src/manifest.ts packages/db/src/types.ts packages/shared/src/briefings-api.ts tests/integration/briefings.test.ts tests/unit/briefings-schedule.test.ts
git commit -m "feat(briefings): add briefing type contract"
```

---

### Task 2: Briefing Engine Type Selection

**Files:**

- Modify: `packages/briefings/src/compose.ts`
- Modify: `packages/briefings/src/repository.ts`
- Modify: `packages/briefings/src/routes.ts`
- Modify: `packages/briefings/src/schedule.ts`
- Modify: `packages/briefings/src/jobs.ts`
- Test: `tests/unit/briefings-compose.test.ts`
- Test: `tests/unit/briefings-prompt-isolation.test.ts`
- Test: `tests/integration/briefings-synthesis.test.ts`

- [ ] **Step 1: Write failing compose/schedule tests**

Add tests that:

```ts
expect(prompt).toContain("evening-review writer");
expect(prompt).toContain("day in review");
expect(prompt).toContain("<trusted_instructions>");
expect(trustedText).not.toContain("completed <external_source>");
expect(call.data).toEqual({
  actorUserId: "owner-1",
  definitionId: "def-1",
  runKind: "scheduled",
  briefingType: "evening"
});
```

- [ ] **Step 2: Run failing tests**

```bash
pnpm vitest run tests/unit/briefings-compose.test.ts tests/unit/briefings-prompt-isolation.test.ts tests/unit/briefings-schedule.test.ts tests/integration/briefings-synthesis.test.ts
```

Expected: FAIL on missing evening prompt/payload.

- [ ] **Step 3: Implement prompt split**

In `compose.ts`, keep trusted text literal-only:

```ts
const SYNTHESIS_INSTRUCTIONS_MORNING =
  "You are a calm morning-briefing writer. Synthesize a concise, scannable morning briefing " +
  "with light section headers. Ground strictly in the items in the <external_source> blocks; " +
  "do not invent. Where a section is empty, note it briefly. Keep it warm and non-judgmental " +
  "about missed or at-risk items.";
const SYNTHESIS_INSTRUCTIONS_EVENING =
  "You are a calm evening-review writer. Synthesize a concise day in review. " +
  "Ground strictly in the items in the <external_source> blocks; do not invent. " +
  "Focus on what happened today, what slipped or remains at risk, and what rolls forward.";

function trustedInstructionsFor(type: BriefingType): string {
  return type === "evening" ? TRUSTED_INSTRUCTIONS_EVENING : TRUSTED_INSTRUCTIONS_MORNING;
}
```

Pass `definition.briefing_type` into `buildMessages`.

- [ ] **Step 4: Implement repository/routes/schedule/jobs**

Add `briefingType` to create/update inputs and route parsers. Defaults:

```ts
briefingType: optionalBriefingType(value.briefingType) ?? "morning";
scheduleMetadata: input.scheduleMetadata ??
  defaultScheduleMetadata(input.briefingType ?? "morning");
```

Use default target times:

```ts
export function defaultScheduleMetadataFor(type: BriefingType) {
  return { targetTime: type === "evening" ? "19:00" : "07:00", timezone: "UTC" };
}
```

Persist `briefing_type` on definitions and runs. Scheduled payload adds `briefingType: definition.briefing_type`. Notification title:

```ts
title: outcome.run.briefing_type === "evening"
  ? "Your evening review is ready"
  : "Your morning briefing is ready";
```

- [ ] **Step 5: Run tests**

```bash
pnpm vitest run tests/unit/briefings-compose.test.ts tests/unit/briefings-prompt-isolation.test.ts tests/unit/briefings-schedule.test.ts tests/integration/briefings-synthesis.test.ts tests/integration/briefings.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/briefings/src/compose.ts packages/briefings/src/repository.ts packages/briefings/src/routes.ts packages/briefings/src/schedule.ts packages/briefings/src/jobs.ts tests/unit/briefings-compose.test.ts tests/unit/briefings-prompt-isolation.test.ts tests/unit/briefings-schedule.test.ts tests/integration/briefings-synthesis.test.ts tests/integration/briefings.test.ts
git commit -m "feat(briefings): synthesize evening reviews"
```

---

### Task 3: Evening Interview Seeded Chat

**Files:**

- Modify: `packages/chat/src/live/chat-session-manager.ts`
- Modify: `packages/chat/src/live-routes.ts`
- Modify: `packages/chat/src/routes.ts`
- Modify: `packages/module-registry/src/index.ts`
- Modify: `packages/shared/src/chat-api.ts` or `packages/shared/src/briefings-api.ts`
- Test: `tests/unit/chat-session-manager.test.ts`
- Test: `tests/integration/chat-live-api.test.ts`

- [ ] **Step 1: Write failing chat seed tests**

Test manager hidden seed:

```ts
await manager.seedContext(
  "actor-1",
  "Ben",
  "<trusted_instructions>\nEvening interview seed.\n</trusted_instructions>\n\n" +
    '<external_source type="evening_review">\nReview text\n</external_source>'
);
expect(engine.submissions[0]).toContain("<external_source");
expect(persistedMessages).toHaveLength(0);
```

Test route:

```ts
const res = await app.inject({
  method: "POST",
  url: "/api/chat/evening-interview",
  payload: { briefingRunId: "run-evening-1" }
});
expect(res.statusCode).toBe(200);
```

- [ ] **Step 2: Run failing tests**

```bash
pnpm vitest run tests/unit/chat-session-manager.test.ts tests/integration/chat-live-api.test.ts
```

Expected: FAIL on missing route/method.

- [ ] **Step 3: Add seed API**

Add method:

```ts
async seedContext(actorUserId: string, userName: string, seed: string): Promise<void> {
  const session = await this.ensureSession(actorUserId, userName);
  await session.engine.submit(seed);
  session.transcriptOffset = await this.drain(session.engine, session.transcriptOffset);
}
```

Add live route `POST /api/chat/evening-interview`:

```ts
const seed = await runtime.resolveEveningInterviewSeed?.(access.actorUserId, body.briefingRunId);
await runtime.manager.seedContext(access.actorUserId, userName, seed.context);
const result = await runtime.manager.submitTurn(access.actorUserId, userName, seed.openingPrompt);
```

Seed literal must wrap review content as untrusted data:

```xml
<trusted_instructions>
You are running Jarvis's evening interview. Ask concise reflection/planning questions:
what went well, what slipped, and what one thing matters tomorrow. Do not create,
move, or delete records directly; use normal chat action-request proposals.
</trusted_instructions>

<external_source type="evening_review">
Review text escaped through the same external-data sanitizer used by briefings.
</external_source>
```

- [ ] **Step 4: Wire resolver in module registry**

In `registerBuiltInApiRoutes`, construct resolver with `BriefingsRepository` + `dataContext`. It reads only actor-owned evening runs through `DataContextDb`, never root DB.

- [ ] **Step 5: Run tests**

```bash
pnpm vitest run tests/unit/chat-session-manager.test.ts tests/integration/chat-live-api.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/chat/src/live/chat-session-manager.ts packages/chat/src/live-routes.ts packages/chat/src/routes.ts packages/module-registry/src/index.ts packages/shared/src/chat-api.ts tests/unit/chat-session-manager.test.ts tests/integration/chat-live-api.test.ts
git commit -m "feat(chat): seed evening interview context"
```

---

### Task 4: Web Settings And Today Surface

**Files:**

- Modify: `apps/web/src/api/client.ts`
- Modify: `apps/web/src/api/query-keys.ts`
- Modify: `apps/web/src/settings/settings-module-subviews.tsx`
- Modify: `apps/web/src/today/today-page.tsx`
- Test: existing typecheck plus focused unit tests if a helper is extracted.

- [ ] **Step 1: Write failing UI helper tests**

Create `apps/web/src/briefings/briefing-settings-model.ts` for pure selection/default helpers and test:

```ts
expect(findDefinition(defs, "evening")?.scheduleMetadata.targetTime).toBe("19:00");
```

- [ ] **Step 2: Add client helpers**

Add:

```ts
export async function startEveningInterview(input: { briefingRunId?: string }) {
  return requestJson<{ reply: string }>("/api/chat/evening-interview", {
    method: "POST",
    body: input
  });
}
```

- [ ] **Step 3: Wire settings to real APIs**

Replace local-only briefings state with React Query:

```ts
const definitionsQuery = useQuery({
  queryKey: queryKeys.briefings.definitions,
  queryFn: listBriefingDefinitions
});
const toolsQuery = useQuery({
  queryKey: queryKeys.ai.assistantTools,
  queryFn: listAiAssistantTools
});
```

Create missing morning/evening definitions using all read-risk tools, default morning `07:00`, evening `19:00`. Patch toggles/time through `updateBriefingDefinition`.

- [ ] **Step 4: Add Today card**

On `TodayPage`, read definitions/runs. Find latest evening run. Render card only when evening definition exists. Add button:

```tsx
<button
  type="button"
  className="jds-button"
  onClick={() => startEveningInterview({ briefingRunId: latestEveningRun.id })}
>
  <MessageSquareText size={14} aria-hidden="true" />
  Prep for tomorrow
</button>
```

If no run exists, button still starts interview without `briefingRunId`; backend gathers/uses available day context fallback.

- [ ] **Step 5: Run checks**

```bash
pnpm --filter @jarv1s/web typecheck
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/api/client.ts apps/web/src/api/query-keys.ts apps/web/src/settings/settings-module-subviews.tsx apps/web/src/today/today-page.tsx
git commit -m "feat(web): surface evening review controls"
```

---

### Final Verification

- [ ] Run focused tests:

```bash
pnpm vitest run tests/unit/briefings-compose.test.ts tests/unit/briefings-prompt-isolation.test.ts tests/unit/briefings-schedule.test.ts tests/unit/chat-session-manager.test.ts tests/integration/briefings.test.ts tests/integration/briefings-synthesis.test.ts tests/integration/chat-live-api.test.ts
```

- [ ] Pre-push trio + rebase:

```bash
pnpm format:check && pnpm lint && pnpm typecheck
git fetch origin main && git rebase origin/main
```

- [ ] Full gate if lane DB is available:

```bash
JARVIS_PGDATABASE=jarvis_build_evening_review pnpm verify:foundation
```

- [ ] Invoke `coordinated-wrap-up`.

## Coverage Check

- Evening review enable/time/default 19:00: Task 4.
- Distinct evening synthesis prompt/trust boundary: Task 2.
- `briefing_type` enum/column: Task 1.
- Metadata-only scheduled payload with `briefingType`: Task 2.
- Evening notification copy: Task 2.
- Prep button + independent chat route: Tasks 3-4.
- Interview seed external-source boundary: Task 3.
- Proposal/write path through existing action-loop: Task 3 uses existing chat gateway, no new write path.
- No exact evening review content sections beyond content follow-up: Task 2 prompt stays high-level.
