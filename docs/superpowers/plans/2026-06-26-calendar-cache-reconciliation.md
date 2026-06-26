# Calendar Cache Reconciliation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Google sync delete stale/cancelled cached calendar events and expose the existing sync action on user Google account rows.

**Architecture:** Keep one reconciliation pass inside `runGoogleSync` after the calendar upsert loop. Add one repository delete method, one owner-scoped worker DELETE policy/grant migration, and a minimal user-facing button that reuses the existing no-arg `POST /api/connectors/google/sync` endpoint.

**Tech Stack:** TypeScript, Kysely, Postgres RLS migrations, Vitest integration tests, React Query.

---

## Verified Branch State

- Branch: `build/calendar-cache-reconciliation`.
- `packages/connectors/src/sync-jobs.ts:312-382` lists and upserts calendar events only; no stale/cancelled DELETE.
- `packages/calendar/src/repository.ts` has `listVisible`, `getById`, `upsertCachedEvent`; no delete method.
- `packages/calendar/sql/0066_calendar_worker_grants_and_google_insert.sql` grants worker `SELECT, INSERT, UPDATE`; no `DELETE`.
- Current RLS has `calendar_events_select`, `calendar_events_insert`, `calendar_events_update`; no DELETE policy, so migration must add both worker `GRANT DELETE` and an owner-scoped DELETE policy.
- Highest existing migration is `0112`; claim `packages/calendar/sql/0113_worker_calendar_events_delete.sql`.
- `syncGoogleConnector()` currently takes no account id and the route enqueues per actor. Plan keeps that existing contract; per-row button calls the no-arg sync and shares pending state across Google rows.

## Files

- Modify: `packages/calendar/sql/0113_worker_calendar_events_delete.sql`
- Modify: `packages/calendar/src/manifest.ts`
- Modify: `packages/calendar/src/repository.ts`
- Modify: `packages/connectors/src/sync-jobs.ts`
- Modify: `packages/shared/src/connectors-api.ts`
- Modify: `apps/web/src/settings/settings-personal-data-panes.tsx`
- Test: `tests/integration/google-sync.test.ts`
- Test: `tests/integration/google-sync-rls.test.ts`

### Task 1: Worker DELETE Grant + RLS Policy

**Files:**

- Create: `packages/calendar/sql/0113_worker_calendar_events_delete.sql`
- Modify: `packages/calendar/src/manifest.ts`
- Test: `tests/integration/google-sync.test.ts`

- [ ] **Step 1: Write failing catalog tests**

Add to `tests/integration/google-sync.test.ts` near calendar RLS tests:

```ts
describe("calendar RLS - worker DELETE reconciliation (0113)", () => {
  it("grants the worker role DELETE on app.calendar_events", async () => {
    const grants = await sql<{ privilege_type: string }>`
      SELECT a.privilege_type
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      CROSS JOIN LATERAL aclexplode(c.relacl) AS a
      JOIN pg_roles g ON g.oid = a.grantee
      WHERE n.nspname = 'app' AND c.relname = 'calendar_events'
        AND g.rolname = 'jarvis_worker_runtime'
    `.execute(appDb);
    expect(grants.rows.map((r) => r.privilege_type)).toContain("DELETE");
  });

  it("adds a worker-only owner-scoped DELETE policy", async () => {
    const roles = await sql<{ rolname: string }>`
      SELECT g.rolname
      FROM pg_policy p
      CROSS JOIN LATERAL unnest(p.polroles) AS r(oid)
      JOIN pg_roles g ON g.oid = r.oid
      WHERE p.polrelid = 'app.calendar_events'::regclass
        AND p.polname = 'calendar_events_delete'
    `.execute(appDb);
    expect(new Set(roles.rows.map((r) => r.rolname))).toEqual(new Set(["jarvis_worker_runtime"]));

    const policy = await sql<{ qual: string }>`
      SELECT pg_get_expr(p.polqual, p.polrelid) AS qual
      FROM pg_policy p
      WHERE p.polrelid = 'app.calendar_events'::regclass
        AND p.polname = 'calendar_events_delete'
    `.execute(appDb);
    const qual = policy.rows[0]?.qual ?? "";
    expect(qual).toMatch(/owner_user_id = app\.current_actor_user_id\(\)/);
    expect(qual).toMatch(/connector_accounts/);
    expect(qual).toMatch(/provider_type = 'google'/);
    expect(qual).toMatch(/https:\/\/www\.googleapis\.com\/auth\/calendar/);
    expect(qual).not.toMatch(/has_share/);
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `pnpm vitest run tests/integration/google-sync.test.ts -t "worker DELETE reconciliation"`

Expected: FAIL because `DELETE` grant/policy does not exist.

- [ ] **Step 3: Add migration and register it**

Create `packages/calendar/sql/0113_worker_calendar_events_delete.sql`:

```sql
-- #473: google-sync reconciliation deletes stale/cancelled cached calendar events.
-- Worker remains owner-scoped by RLS; no admin/private-data bypass.

GRANT DELETE ON app.calendar_events TO jarvis_worker_runtime;

DROP POLICY IF EXISTS calendar_events_delete ON app.calendar_events;

CREATE POLICY calendar_events_delete
ON app.calendar_events
FOR DELETE
TO jarvis_worker_runtime
USING (
  app.current_actor_user_id() IS NOT NULL
  AND owner_user_id = app.current_actor_user_id()
  AND EXISTS (
    SELECT 1
    FROM app.connector_accounts accounts
    JOIN app.connector_definitions definitions
      ON definitions.provider_id = accounts.provider_id
    WHERE accounts.id = connector_account_id
      AND accounts.owner_user_id = app.current_actor_user_id()
      AND (
        definitions.provider_type = 'calendar'
        OR (
          definitions.provider_type = 'google'
          AND 'https://www.googleapis.com/auth/calendar' = ANY (accounts.scopes)
        )
      )
  )
);
```

Add `"sql/0113_worker_calendar_events_delete.sql"` to `packages/calendar/src/manifest.ts` after `0087`.

- [ ] **Step 4: Run test to verify pass**

Run: `pnpm vitest run tests/integration/google-sync.test.ts -t "worker DELETE reconciliation"`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/calendar/sql/0113_worker_calendar_events_delete.sql packages/calendar/src/manifest.ts tests/integration/google-sync.test.ts
git commit -m "fix(calendar): grant worker stale event delete"
```

### Task 2: Calendar Repository Delete Method

**Files:**

- Modify: `packages/calendar/src/repository.ts`
- Test: `tests/integration/google-sync-rls.test.ts`

- [ ] **Step 1: Write failing repository/RLS tests**

Add to `tests/integration/google-sync-rls.test.ts`:

```ts
describe("CalendarRepository.deleteStaleCachedEvents", () => {
  it("worker deletes only stale owner rows for one connector account", async () => {
    const accountId = await seedGoogleAccount([CALENDAR_SCOPE], ids.userA);
    const calendar = new CalendarRepository();
    await workerDataContext.withDataContext(
      { actorUserId: ids.userA, requestId: "test" },
      async (db) => {
        await calendar.upsertCachedEvent(db, {
          connectorAccountId: accountId,
          externalId: "keep-1",
          title: "Keep",
          startsAt: "2026-06-13T09:00:00.000Z",
          endsAt: "2026-06-13T09:30:00.000Z"
        });
        await calendar.upsertCachedEvent(db, {
          connectorAccountId: accountId,
          externalId: "drop-1",
          title: "Drop",
          startsAt: "2026-06-13T10:00:00.000Z",
          endsAt: "2026-06-13T10:30:00.000Z"
        });
        const deleted = await calendar.deleteStaleCachedEvents(db, {
          connectorAccountId: accountId,
          keepExternalIds: ["keep-1"]
        });
        expect(deleted).toBe(1);
        const rows = await db.db
          .selectFrom("app.calendar_events")
          .select("external_id")
          .where("connector_account_id", "=", accountId)
          .orderBy("external_id")
          .execute();
        expect(rows.map((row) => row.external_id)).toEqual(["keep-1"]);
      }
    );
  });

  it("empty keep set deletes all rows for the account", async () => {
    const accountId = await seedGoogleAccount([CALENDAR_SCOPE], ids.userA);
    const calendar = new CalendarRepository();
    const deleted = await workerDataContext.withDataContext(
      { actorUserId: ids.userA, requestId: "test" },
      async (db) => {
        await calendar.upsertCachedEvent(db, {
          connectorAccountId: accountId,
          externalId: "drop-empty-1",
          title: "Drop empty",
          startsAt: "2026-06-13T09:00:00.000Z",
          endsAt: "2026-06-13T09:30:00.000Z"
        });
        return calendar.deleteStaleCachedEvents(db, {
          connectorAccountId: accountId,
          keepExternalIds: []
        });
      }
    );
    expect(deleted).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `pnpm vitest run tests/integration/google-sync-rls.test.ts -t "deleteStaleCachedEvents"`

Expected: FAIL because method does not exist.

- [ ] **Step 3: Add minimal repository method**

Add to `CalendarRepository`:

```ts
  async deleteStaleCachedEvents(
    scopedDb: DataContextDb,
    input: { readonly connectorAccountId: string; readonly keepExternalIds: readonly string[] }
  ): Promise<number> {
    assertDataContextDb(scopedDb);

    let query = scopedDb.db
      .deleteFrom("app.calendar_events")
      .where("connector_account_id", "=", input.connectorAccountId);

    if (input.keepExternalIds.length > 0) {
      query = query.where("external_id", "not in", input.keepExternalIds);
    }

    const result = await query.executeTakeFirst();
    return Number(result.numDeletedRows ?? 0);
  }
```

- [ ] **Step 4: Run test to verify pass**

Run: `pnpm vitest run tests/integration/google-sync-rls.test.ts -t "deleteStaleCachedEvents"`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/calendar/src/repository.ts tests/integration/google-sync-rls.test.ts
git commit -m "fix(calendar): delete stale cached events"
```

### Task 3: Reconcile During Google Sync

**Files:**

- Modify: `packages/connectors/src/sync-jobs.ts`
- Modify: `packages/shared/src/connectors-api.ts`
- Test: `tests/integration/google-sync.test.ts`

- [ ] **Step 1: Write failing sync tests**

Add to `describe("runGoogleSync handler")` in `tests/integration/google-sync.test.ts`:

```ts
it("deletes stale and cancelled cached calendar events after a calendar sync", async () => {
  const accountId = await seedGoogleAccount(handles.dataContext, [
    "https://www.googleapis.com/auth/calendar"
  ]);
  const calendar = new CalendarRepository();
  const ctx = { actorUserId: ids.userA, requestId: "pgboss:test" };
  await handles.workerDataContext.withDataContext(ctx, async (db) => {
    await calendar.upsertCachedEvent(db, {
      connectorAccountId: accountId,
      externalId: "fresh-event",
      title: "Old fresh",
      startsAt: "2026-06-13T09:00:00.000Z",
      endsAt: "2026-06-13T09:30:00.000Z"
    });
    await calendar.upsertCachedEvent(db, {
      connectorAccountId: accountId,
      externalId: "cancelled-event",
      title: "Cancelled old",
      startsAt: "2026-06-13T10:00:00.000Z",
      endsAt: "2026-06-13T10:30:00.000Z"
    });
    await calendar.upsertCachedEvent(db, {
      connectorAccountId: accountId,
      externalId: "deleted-event",
      title: "Deleted old",
      startsAt: "2026-06-13T11:00:00.000Z",
      endsAt: "2026-06-13T11:30:00.000Z"
    });
  });

  const result = await handles.workerDataContext.withDataContext(ctx, (scopedDb) =>
    runGoogleSync(scopedDb, {
      getFreshAccessToken: async () => "tok",
      getActiveAccount: async () => ({ id: accountId, scopes: ["calendar"] }),
      googleClient: {
        listCalendarEvents: async () => [
          {
            id: "fresh-event",
            summary: "Fresh",
            start: { dateTime: "2026-06-14T09:00:00Z" },
            end: { dateTime: "2026-06-14T09:30:00Z" }
          },
          {
            id: "cancelled-event",
            status: "cancelled",
            start: { dateTime: "2026-06-14T10:00:00Z" },
            end: { dateTime: "2026-06-14T10:30:00Z" }
          }
        ],
        listMessageIds: async () => [],
        getMessage: async () => ({ id: "x" })
      },
      emailExtractDeps: {
        selectModel: async () => undefined,
        runChat: async () => ({ text: "" })
      },
      now: () => new Date("2026-06-13T12:00:00.000Z")
    })
  );

  expect(result.calendarUpserted).toBe(1);
  expect(result.calendarReconciled).toBe(2);

  const rows = await handles.workerDataContext.withDataContext(ctx, (db) =>
    db.db
      .selectFrom("app.calendar_events")
      .select("external_id")
      .where("connector_account_id", "=", accountId)
      .orderBy("external_id")
      .execute()
  );
  expect(rows.map((row) => row.external_id)).toEqual(["fresh-event"]);
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `pnpm vitest run tests/integration/google-sync.test.ts -t "deletes stale and cancelled"`

Expected: FAIL because stale/cancelled rows remain and `calendarReconciled` is absent.

- [ ] **Step 3: Add result count type/schema**

In `packages/connectors/src/sync-jobs.ts`, add:

```ts
  readonly calendarReconciled?: number;
```

to `GoogleSyncResult`, initialize `let calendarReconciled = 0;`, include it in logger, persisted counts, and return.

In `packages/shared/src/connectors-api.ts`, add:

```ts
  readonly calendarReconciled?: number;
```

and schema property:

```ts
    calendarReconciled: { type: "number" },
```

- [ ] **Step 4: Add reconciliation logic after upsert loop**

Inside the calendar `try`, before its catch:

```ts
const keepExternalIds = new Set<string>();
for (const event of events) {
  if (!event.id) continue;
  if (event.status === "cancelled") continue;
  const instants = mapEventInstants(event);
  if (!instants) {
    keepExternalIds.add(event.id);
    logger.warn(
      { stage: "calendar", reason: "unusable-event-times" },
      "google-sync skipped a calendar event with no usable start/end"
    );
    continue;
  }
  keepExternalIds.add(event.id);
  // existing savepoint upsert block stays here
}
calendarReconciled = await calendarRepo.deleteStaleCachedEvents(scopedDb, {
  connectorAccountId: account.id,
  keepExternalIds: [...keepExternalIds]
});
```

Keep one DELETE pass after the loop. Do not add a background job or purge endpoint.

- [ ] **Step 5: Run focused test**

Run: `pnpm vitest run tests/integration/google-sync.test.ts -t "deletes stale and cancelled"`

Expected: PASS.

- [ ] **Step 6: Run sync suite**

Run: `pnpm vitest run tests/integration/google-sync.test.ts tests/integration/google-sync-rls.test.ts tests/integration/google-sync-orchestration.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/connectors/src/sync-jobs.ts packages/shared/src/connectors-api.ts tests/integration/google-sync.test.ts
git commit -m "fix(connectors): reconcile calendar cache on sync"
```

### Task 4: User Settings Sync Button

**Files:**

- Modify: `apps/web/src/settings/settings-personal-data-panes.tsx`

- [ ] **Step 1: Add import**

Add `syncGoogleConnector` to the existing client import:

```ts
(revokeConnectorAccount, setMyModuleDisabled, syncGoogleConnector);
```

- [ ] **Step 2: Add sync mutation and poll state**

In `ConnectedPane`, after `revokeMutation`:

```ts
  const [recentlySynced, setRecentlySynced] = useState(false);
  const [syncTick, setSyncTick] = useState(0);
  const syncMutation = useMutation({
    mutationFn: syncGoogleConnector,
    onSuccess: () => {
      toast("Sync started", { icon: <RefreshCw size={17} /> });
      setRecentlySynced(true);
      setSyncTick((tick) => tick + 1);
      void queryClient.invalidateQueries({ queryKey: queryKeys.connectors.accounts });
    },
    onError: (error) => toast(readError(error), { tone: "drift" })
  });
  useEffect(() => {
    if (!recentlySynced) return;
    const stop = setTimeout(() => setRecentlySynced(false), 30_000);
    return () => clearTimeout(stop);
  }, [recentlySynced, syncTick]);
```

Update `accountsQuery`:

```ts
    refetchInterval: () => (syncMutation.isPending || recentlySynced ? 2000 : false),
    refetchIntervalInBackground: false
```

- [ ] **Step 3: Pass sync props into AccountRow**

Update props:

```ts
  readonly onSync?: () => void;
  readonly syncPending?: boolean;
```

Render button before Revoke when `account.providerType === "google" && account.status !== "revoked"`:

```tsx
<button
  type="button"
  className="jds-btn jds-btn--secondary jds-btn--sm"
  onClick={props.onSync}
  disabled={props.syncPending}
>
  <span className="jds-btn__icon">
    <RefreshCw size={15} className={props.syncPending ? "spin" : ""} />
  </span>
  {props.syncPending ? "Syncing..." : "Sync now"}
</button>
```

Pass from map:

```tsx
              onSync={() => syncMutation.mutate()}
              syncPending={syncMutation.isPending}
```

- [ ] **Step 4: Run frontend checks**

Run: `pnpm --filter @jarv1s/web typecheck`

Expected: PASS.

Run: `pnpm lint`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/settings/settings-personal-data-panes.tsx
git commit -m "feat(settings): add user google sync button"
```

### Task 5: Final Verification + Wrap

**Files:** no new files expected.

- [ ] **Step 1: Run focused suites**

Run: `pnpm vitest run tests/integration/google-sync.test.ts tests/integration/google-sync-rls.test.ts tests/integration/google-sync-orchestration.test.ts`

Expected: PASS.

- [ ] **Step 2: Run required trio**

Run: `pnpm format:check && pnpm lint && pnpm typecheck`

Expected: exit 0.

- [ ] **Step 3: Rebase before push**

Run: `git fetch origin main && git rebase origin/main`

Expected: clean rebase.

- [ ] **Step 4: If full gate needed, use lane DB**

Because coordinated builds can race integration resets, create/use a lane DB before full `verify:foundation`:

```bash
docker exec jarv1s-postgres psql -U postgres -c 'CREATE DATABASE jarvis_build_calendar_cache_reconciliation;'
JARVIS_PGDATABASE=jarvis_build_calendar_cache_reconciliation pnpm verify:foundation
```

Expected: exit 0. If DB already exists, continue with same lane DB.

- [ ] **Step 5: Invoke coordinated wrap-up**

Read `~/Jarv1s/.claude/skills/coordinated-wrap-up/SKILL.md`, then follow it: scoped push, PR, `gh pr checks`, report to `Coordinator`. Do not merge or move board/milestones.

## Self-Review

- Spec coverage: stale deleted events, cancelled-status events, automatic sync reconciliation, worker DELETE grant/policy, user-visible Sync now, no new endpoint, no payload secrets.
- Drift handled: `syncGoogleConnector` is no-arg on branch; UI will call existing no-arg endpoint.
- Skipped: standalone purge/admin purge/email stale reconciliation/calendar-only sync; add only if new issue requires it.
