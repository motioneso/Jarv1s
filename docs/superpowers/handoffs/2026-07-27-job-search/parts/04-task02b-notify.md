### Task 2b: `ctx.notify` port for in-app notifications

Ben asked for an in-app notification when new matches land. `ModuleWorkerContext` has no `notify`
port (D1), so a module worker currently has no way to tell the user anything. Generic seam — finance
would use it for a sync failure, news for a breaking story.

**Depends on:** Task 1 (it widened `ExternalModuleRpcError` with `detail`; this task adds one member
to its code union).

**Files**

- Read first: `rg -n "notification" packages/notifications/src --files-with-matches` — the existing
  store and the shape the shell already renders
- Modify: `packages/module-sdk/src/worker.ts` — the port
- Modify: `packages/module-registry/src/external/worker-rpc-host.ts` — service `notify.post`
- Create: `packages/notifications/sql/<next>_notification_event_keys.sql`
- Modify: `packages/notifications/src/repository.ts`, `routes.ts`;
  `packages/shared/src/notifications-api.ts` (**DTO and response schema**);
  `tests/integration/foundation-schema-catalog.test.ts`; the web notification list component
- Modify: `apps/api/src/external-module-tools.ts:44` and
  `apps/worker/src/external-module-job-handler.ts:67` — both RPC construction sites
- Test: `tests/unit/external-module-notify-port.test.ts`, plus integration cases

**Contracts**

```ts
export interface ModuleNotifyPort {
  /** Post an in-app notification for the invoking actor. Rendered from these
   * fields — never from model prose. Rate-limited host-side per module. */
  post(input: {
    /** Stable per-event key. Re-posting the same key updates rather than duplicates. */
    readonly key: string;
    readonly title: string;
    readonly body: string;
    /** In-app route to open. Same-origin path only. */
    readonly href?: string;
  }): Promise<void>;
}
```

reachable as `ctx.notify`. Host-side, on the RPC handler input type:

```ts
readonly postNotification?: (
  access: AccessContext,
  input: CreateNotificationInput
) => Promise<void>;
```

`CreateNotificationInput` gains `eventKey?: string` and `href?: string`.
`ExternalModuleRpcError`'s code union gains `"rate_limited"`.

The keyed upsert, verbatim — one modifying CTE, the shape `markRead` already uses
(`repository.ts:249-257`):

```sql
WITH upserted AS (
  INSERT INTO app.notifications
    (id, module_id, actor_user_id, recipient_user_id, title, body, metadata, href,
     event_key, urgency, deferred_until, created_at, updated_at)
  VALUES ($1, $2, app.current_actor_user_id(), app.current_actor_user_id(), $3, $4, $5, $6,
          $7, $8, $9, now(), now())
  ON CONFLICT (recipient_user_id, module_id, event_key) WHERE event_key IS NOT NULL
  DO UPDATE SET title = excluded.title,
                body = excluded.body,
                metadata = excluded.metadata,
                href = excluded.href,
                urgency = excluded.urgency,
                deferred_until = excluded.deferred_until,
                updated_at = now()
  RETURNING *
),
cleared AS (
  DELETE FROM app.notification_reads
  WHERE notification_id IN (SELECT id FROM upserted)
    AND user_id = app.current_actor_user_id()
)
SELECT * FROM upserted;
```

`markRead` gains a row lock so a concurrent refresh cannot interleave:

```sql
INSERT INTO app.notification_reads (notification_id, user_id, read_at)
SELECT n.id, app.current_actor_user_id(), now()
FROM (
  SELECT id FROM app.notifications
   WHERE id = $1::uuid
   FOR UPDATE
) n
ON CONFLICT (notification_id, user_id) DO UPDATE SET read_at = excluded.read_at
RETURNING notification_id, read_at
```

**Constraints**

- **Serve `notify.post` before `withDataContext`**, beside `attachments.readText` (~:117) and ahead
  of the call at `:152` — the injected `postNotification` takes an `AccessContext` and opens its own
  data context, exactly as `readAttachmentText` does, which is also what keeps `workerDataContext`
  legal as `null` in the unit harness (K4).
- **Caps, rejected not coerced:** `key` ≤ 200, `title` ≤ 200, `body` ≤ 2000, all non-empty;
  five notifications per invocation, then `rate_limited`. Silently shortening a module's copy would
  make the tray disagree with what the module thinks it said. A crawl summarises; it does not
  narrate.
- **The per-invocation counter lives in the factory closure**, beside `let aiCalls = 0;`
  (`worker-rpc-host.ts:110-113`) — not inside the returned `async (method, …) =>`, where it resets
  every call and never trips, and not at module scope, where it leaks across invocations and silences
  the second crawl of the day (C4).
- **`href` is a same-origin path**: starts with `/`, never `//`, no scheme (L17). Rejected at the RPC
  boundary **and** validated again in the repository — a module-supplied absolute URL in the
  notification tray is an open-redirect surface, and the rpc guard is the second belt, not the only
  one.
- **The rename `key` → `eventKey` happens at the host boundary and nowhere else.** `key` is what the
  published SDK port declares; `eventKey` is the repository's field. Type `postNotification` against
  the repository's real `CreateNotificationInput` imported from `@jarv1s/notifications`, never an
  inline `{…}` — an inline shape lets the two names drift while both sides typecheck and the field
  silently vanishes.
- **`postNotification` is optional on the handler input** (unlike Task 1's `embeddingProvider`), with
  an explicit `if (!input.postNotification) throw invalidRpc(...)` guard in the branch, so a host that
  chooses not to offer a tray fails loudly. It must still be threaded at **both** construction sites —
  the crawl that posts these runs on the worker one (K5).
- **Ruling: a keyed re-fire returns the notification to unread.** Three new matches this afternoon is
  not "already seen" because you read this morning's two. Task 2d's badge count and Task 22's badge
  test both derive from this sentence.
- **Unread is the *absence* of a row in `app.notification_reads`** — left join,
  `where reads.notification_id is null` (`repository.ts:355-369`). Updating the notification row
  alone leaves the read row intact and the badge stays cleared, which is exactly the bug the ruling
  exists to prevent. Two separate statements are not good enough either: a failure between them
  leaves a refreshed notification that still reads as seen, and there is no reconciliation pass.
  Hence the single CTE.
- **Three details in that CTE that are easy to get wrong.** `created_at` is deliberately absent from
  the `DO UPDATE` list, which is why `updated_at` must exist — the tray orders by `created_at DESC`
  (`0008_notifications_module.sql:18`), so a refreshed notification would stay buried. Ordering
  becomes `coalesce(updated_at, created_at) desc` with a matching index; `updated_at` need not reach
  the DTO. `deferred_until` is **recomputed** on the re-fire exactly as `create` computes it today
  (`repository.ts:193-201`), so a keyed event re-firing inside quiet hours does not ping. The
  `user_id` predicate on the delete is load-bearing: without it the statement would clear other
  actors' read rows if the policy ever widened.
- **The migration must ship four grant-and-policy pairs that do not exist today.** Multiple
  statements in one file is correct here — the one-statement rule
  (`validateModuleMigrationSql`, A3) governs *external* module migrations, and the live
  `0071_notifications_worker_insert_grant.sql` is itself a grant plus two policies. The file does six
  things: add `event_key text`, `href text`, `updated_at timestamptz NOT NULL DEFAULT now()`; the
  partial unique index on `(recipient_user_id, module_id, event_key) where event_key is not null`
  (partial, so keyless behaviour is untouched); then
  - `GRANT UPDATE ON app.notifications TO jarvis_app_runtime` **plus** a `notifications_update`
    policy — the grant today is `SELECT, INSERT`
    (`packages/notifications/sql/0008_notifications_module.sql:24`) and the only policies are
    `notifications_select` and `notifications_insert` (`:39`, `:48`), so `ON CONFLICT … DO UPDATE`
    fails with a permission error without both. Mirror the insert predicate,
    `recipient_user_id = app.current_actor_user_id()`, in `USING` and `WITH CHECK`.
  - `GRANT DELETE ON app.notification_reads TO jarvis_app_runtime` **plus** a
    `notification_reads_delete` policy — grant today is `SELECT, INSERT, UPDATE` (`:25`), three
    policies (`:61`, `:75`, `:89`). Copy `notification_reads_update`'s `USING` clause verbatim,
    including its `EXISTS` guard against a visible parent.
  - **The same two grants and two policies again for `jarvis_worker_runtime`, or none of this runs in
    production.** The crawl posts from the worker, whose grants are `SELECT, INSERT` on
    `app.notifications` (`0071…:16`) and `SELECT` only on `app.notification_reads` (`0166…:5`), so the
    upsert dies on the first keyed notification while the api-side path passes every test. `0071` is
    the template, including its reason for granting `SELECT` alongside: `RETURNING *` requires
    `SELECT` on the returned columns or the statement errors and poisons the transaction. Mirror the
    app-role predicates **exactly** — widening them for the worker would be a privilege escalation
    dressed as a grant.
- **Migration placement:** a new file in `packages/notifications/sql/`, discovered by directory scan
  (`packages/notifications/src/manifest.ts:38-40`). The manifest's `database.migrations` array is
  **not** the gate (`0166` and `0170` are live and absent from it); the gate is
  `tests/integration/foundation-schema-catalog.test.ts:289`, which asserts the full catalog with
  `toEqual` (A2) — add the new `{version, name}` row or the gate fails.
- **`href` must be declared in the response schema** (`packages/shared/src/notifications-api.ts`), not
  only the DTO type: the Fastify serializer silently drops undeclared fields, so it would vanish
  between the database and the browser with nothing failing (I8).
- **This write path must populate `notifications.module_id`** — Task 2d's per-module counts depend on
  it. The column already exists (`NotificationDto.moduleId`, `notifications-api.ts:20`).

**Tests**

`tests/unit/external-module-notify-port.test.ts` — same synthetic discovery and seven-input harness
as Task 1 (K2), with `postNotification` injected as a `vi.fn()`:

1. **Writes a notification scoped to the invoking actor** — assert `postNotification` was called with
   **two** arguments, `(access, input)`, the first containing the actor id and the second containing
   `moduleId: "job-search"` and **`eventKey`**, and assert the input does **not** have a `key`
   property. Asserting `key` here would pass against a host that forwards a field the repository
   ignores — the exact drift this case exists to catch.
2. **A cross-origin `href` is rejected rather than posted** — `https://evil.example/steal` throws
   `invalid_rpc` and the store was never called.
3. **An over-long body is rejected rather than truncated** — 2001 characters throws `invalid_rpc`,
   store never called.
4. **The per-invocation cap trips** — five succeed, the sixth throws `rate_limited`, and the store was
   called exactly five times.
5. **Each invocation gets its own budget** — exhaust one handler's five, then build a **second**
   handler from the same factory and assert its first post resolves. Only a second handler catches
   both misplacements of the counter; a single-handler test passes against either bug.

Integration (real database, both roles):

6. **The same `eventKey` twice yields one row**; **different `eventKey` yields two**; **an absent
   `eventKey` always creates a new row** (unchanged behaviour).
7. **An absolute or protocol-relative `href` is rejected** by the repository, independent of the RPC
   guard.
8. **`href` survives the REST response schema** — asserted through `app.inject`, never against the
   repository's return value, which cannot observe the serializer.
9. **Return-to-unread, run under the worker role.** Post, mark read, repost the identical
   `event_key`, assert the unread count is back to one **at both tiers** — repository count and REST
   response — because the failure mode is a projection disagreeing with the row. Run the repost
   through a real `jarvis_worker_runtime` data context: an app-role-only test is green against a
   migration that forgot the worker grants entirely. Assert the app-role path too, since the tray's
   own mark-read runs there.
10. **Read rows belong to their reader** — with actor A's read row present, run the upsert as actor B
    and assert A's row survives.
11. **A concurrent `markRead` and refresh leave the notification unread** — open **two** data contexts
    for the same actor, run `markRead` on one inside an explicit transaction held open, fire the
    refresh on the other, then commit; assert unread and that neither statement errored. Both
    statements on one connection serialize for free, so a single-connection version of this test
    passes against the unlocked SQL and proves nothing (K10).

**Verify**

```bash
pnpm vitest run tests/unit/external-module-notify-port.test.ts   # exit 0
pnpm typecheck                                                   # exit 0
pnpm test:integration tests/integration/notifications.test.ts    # exit 0 (runs the whole suite)
```

---
