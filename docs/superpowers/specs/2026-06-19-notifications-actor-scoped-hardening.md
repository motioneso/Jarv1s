# Spec — Notifications V1 actor-scoped delivery hardening

**Status:** approved (Ben standing keep-moving directive + coordinator review, 2026-06-19). LOCKED: metadata primitives-only; DB bound size-only CHECK (app enforces structure).
**Issue:** #151
**Tier:** sensitive (DB migrations on owned tables + cross-module output contract; RLS-adjacent
but introduces **no** new policy and **no** admin/owner bypass)
**Date:** 2026-06-19

## Problem

Notifications V1 is **in-app, actor-scoped delivery**: a notification is a personal message whose
`recipient_user_id` is always the active actor (`app.current_actor_user_id()`), created inside that
actor's `DataContextRunner` scope. It is **not** a cross-user / system-broadcast mechanism and V1 ships
no external push / email / SMS delivery. The RLS contract already enforces this — both the app role
(`0008` / `0024` / `0029`) and the worker role (`0071`) policies require
`recipient_user_id = app.current_actor_user_id()` on INSERT and SELECT.

The application layer, however, still carries residuals from the older workspace-era / cross-recipient
mental model that the RLS contract no longer permits:

- `NotificationsRepository.create` (`packages/notifications/src/repository.ts:50`) accepts an optional
  `recipientUserId` override and an `actorUserId` override on `CreateNotificationInput`
  (`repository.ts:16-22`). RLS silently rejects any recipient ≠ current actor, so the override is
  **phantom flexibility** — it can only ever succeed with the current actor's id, and a caller reading
  the signature is misled into thinking cross-recipient delivery is supported.
- `notificationDtoSchema.metadata` (`packages/shared/src/notifications-api.ts:27-30, 58`) is declared
  `{ type: "object", additionalProperties: true }`. Because Fastify has **no global `removeAdditional`
  AJV config** (verified), the response schema does **not** strip anything: arbitrary jsonb written to
  `app.notifications.metadata` flows through unchanged to REST clients (`routes.ts:91`) and assistant
  tools (`tools.ts:18`). The column itself has no CHECK bound, so a producer (or a backfill) can write
  unbounded content that then exits raw through both surfaces.
- `markRead` (`repository.ts:82-114`) does an `INSERT ... SELECT ... ON CONFLICT ... RETURNING` and
  then a **second** `getById` SELECT to fetch the row fields. Two round-trips for one logical
  operation; the follow-up read is only there to load columns the first query chose not to return.
- The absent-vs-denied conflation (`markRead` returns `undefined` both when the row does not exist and
  when it exists but is RLS-invisible to the actor; the route answers `404 Notification not found`
  either way, `routes.ts:79-81`) is **intentional** — it prevents existence probing — but it is nowhere
  documented, so a future change could quietly "fix" it into an information leak.
- Test fixtures and comments still speak in workspace-era terms long after the workspace concept was
  retired (`tests/integration/notifications.test.ts`: `aWorkspaceSeed`, `"Workspace seed notification"`,
  `{ workspaceScoped: true }`, the `x-jarvis-workspace-id` request pair; `tests/integration/ai-tools.test.ts`:
  `notificationIds.workspace`, `bWorkspace`). The `notification_reads` policies' `EXISTS` clause against
  `app.notifications` is silent defense-in-depth with no SQL comment explaining why it is there.

These are hardening items, not new functionality. They make the application layer honest about the
delivery model the RLS contract already enforces, close an unbounded-egress path on a personal-data
table, remove a redundant round-trip, and capture the deliberate 404 behavior in docs, tests, and SQL.

## Locked Decisions

### 1. Document the V1 delivery model

Add a module-level docblock at the top of `packages/notifications/src/manifest.ts` (and mirror a
one-paragraph summary in `packages/notifications/src/index.ts`) that states, in this order:

- V1 is **in-app, actor-scoped delivery**: `recipient_user_id` is always `app.current_actor_user_id()`.
- App and worker code may create notifications **only inside the active actor's `DataContextRunner`
  scope**; `assertDataContextDb` is the gate.
- It is **not** a generic cross-user or system-broadcast mechanism.
- V1 covers **no** external push / email / SMS delivery.
- The briefings worker is the reference producer path (see `packages/briefings/src/jobs.ts:162`).

The manifest's `// No sidebar nav entry` comment (`manifest.ts:38-39`) already exists and stays.

### 2. Remove the phantom recipient/actor create overrides

Narrow `CreateNotificationInput` (`packages/notifications/src/repository.ts:16-22`) so it no longer
accepts `recipientUserId` or `actorUserId`. The repository always writes
`recipient_user_id = app.current_actor_user_id()` and `actor_user_id = app.current_actor_user_id()`
via the existing `sql` template literals (`repository.ts:60-67`). Concretely:

```ts
export interface CreateNotificationInput {
  readonly title: string;
  readonly body?: string | null;
  readonly metadata?: Record<string, unknown>;
}
```

Rationale: the overrides could never produce a value RLS would accept other than the current actor.
Keeping them pretends to support cross-recipient / system-emitter paths that the V1 RLS contract
forbids. A future spec can re-introduce a system-emitter (NULL `actor_user_id`) path with its own
`SECURITY DEFINER` plumbing when there is a concrete need; this slice does not.

**Callsite conformance:** the only production producer is
`packages/briefings/src/jobs.ts:162`, which already calls `create(scopedDb, { title, metadata })` with
no overrides — no production change required there. Update the integration test in
`tests/integration/notifications.test.ts` ("creates private notifications for the active actor by
default") so it asserts both `actor_user_id` and `recipient_user_id` equal `ids.userA` (it already
does at lines 231-232; that assertion stays as the regression guard for this decision).

The existing test `forbids inserting a notification for another recipient with the current actor`
(`notifications.test.ts:196-212`) stays — it pins the RLS-level invariant independent of the repo API.

### 3. Bound and schema-project notification metadata (input + output + DB)

Three layers, in defense order:

**3a. Input bounding (repository).** Add a pure helper, e.g.
`projectNotificationMetadata(raw: unknown): NotificationMetadata` in
`packages/notifications/src/repository.ts` (or a small adjacent `metadata.ts`). It MUST:

- Treat non-object / array / null input as `{}`.
- Keep at most **16** keys (drop the rest, deterministically — e.g. by insertion order).
- Keep only keys matching `^[a-zA-Z_][a-zA-Z0-9_]{0,63}$`; drop everything else.
- Keep only JSON-primitive values (`string | number | boolean | null`). Drop nested objects and
  arrays entirely (key discarded, not just value replaced). This is the open question — see below.
- Truncate retained string values to **256** characters (UTF-16 code units is fine).
- Reject the result if `JSON.stringify(...)` exceeds **4096** bytes; in that case keep reducing keys
  (in insertion order) until it fits, or return `{}` if even one value overflows.

Apply `projectNotificationMetadata` inside `create(...)` before writing to the column. The briefing
producer's metadata `{ definitionId, briefingRunId }` (`packages/briefings/src/jobs.ts:164`) passes
unchanged.

**3b. Output projection (serializer).** Apply the **same** `projectNotificationMetadata` in
`serializeNotification` (`packages/notifications/src/routes.ts:91-102`) to `notification.metadata`
before constructing the DTO. This is the single chokepoint that covers **both** the REST route
(`routes.ts:91`) and the assistant tool (`tools.ts:18` imports `serializeNotification`). Do **not**
rely on Fastify's response schema to strip fields — there is no global `removeAdditional` AJV config
and adding one is out of scope for this slice.

**3c. Honest output contract (shared schema).** Update `notificationDtoSchema.metadata`
(`packages/shared/src/notifications-api.ts:27-30, 58`) to declare the bounded shape:

```ts
const metadataSchema = {
  type: "object",
  maxProperties: 16,
  additionalProperties: {
    anyOf: [
      { type: "string", maxLength: 256 },
      { type: "number" },
      { type: "boolean" },
      { type: "null" }
    ]
  },
  propertyNames: { pattern: "^[a-zA-Z_][a-zA-Z0-9_]{0,63}$" }
} as const;
```

The `NotificationDto.metadata` TypeScript type (`notifications-api.ts:9`) narrows from
`Record<string, unknown>` to a bounded `Record<string, string | number | boolean | null>` (or a named
`NotificationMetadata` type exported from the shared module so the repository and serializer share it).

**3d. DB-level bound (defense-in-depth migration).** Add a **new** migration file in
`packages/notifications/sql/` (next free number; the highest in the repo today is `0093`, so this will
be `0094` or higher — never edit `0008` / `0024` / `0029` / `0071`). Add a single size CHECK only —
keeping it language-agnostic avoids a custom PL/pgSQL helper:

```sql
ALTER TABLE app.notifications
  ADD CONSTRAINT notifications_metadata_size_check
  CHECK (octet_length(metadata::text) <= 4096);
```

Register the new migration filename in `notificationsModuleManifest.database.migrations`
(`packages/notifications/src/manifest.ts:30-34`). The 16-keys / key-name / primitive-value bounds are
enforced at the application layer only (3a/3b); they are not duplicated as DB constraints because
encoding them generically requires a helper function and is not worth the surface for V1.

### 4. Collapse `markRead` into one logical query

Rewrite `markRead` (`packages/notifications/src/repository.ts:82-114`) so the
`INSERT ... SELECT ... ON CONFLICT ... RETURNING` and the row fetch are **one** database round-trip
that returns the full `NotificationWithReadState` or `undefined`. Use a modifying CTE (Postgres
supports data-modifying CTEs); the engineer may express it with a Kysely CTE builder or a raw `sql`
template. Reference shape:

```sql
WITH inserted AS (
  INSERT INTO app.notification_reads (notification_id, user_id, read_at)
  SELECT n.id, app.current_actor_user_id(), now()
  FROM app.notifications n
  WHERE n.id = $1::uuid
  ON CONFLICT (notification_id, user_id) DO UPDATE SET read_at = excluded.read_at
  RETURNING notification_id, read_at
)
SELECT n.id, n.actor_user_id, n.recipient_user_id, n.title, n.body, n.metadata,
       n.created_at, inserted.read_at AS read_at
FROM app.notifications n
JOIN inserted ON inserted.notification_id = n.id;
```

Hard requirements:

- Exactly **one** DB round-trip in the success path. No follow-up `getById`.
- The `SELECT FROM app.notifications` inside the modifying CTE is still subject to RLS, so a row that
  does not exist **or** is invisible to the actor yields zero inserted rows and the final JOIN returns
  no rows → `undefined`. The absent-vs-denied conflation (Decision 5) is preserved exactly.
- `markAllRead` (`repository.ts:116-139`) is **not** required to change shape — it returns a count, not
  a row, so there is no redundant follow-up read there. Leave it.

### 5. Document the deliberate absent-vs-denied `undefined` / 404 behavior

Add explicit docblocks (not runtime behavior change):

- Above `markRead` in `packages/notifications/src/repository.ts` — state that `undefined` is returned
  both when the notification does not exist **and** when it exists but is not visible to the current
  actor, that this is deliberate (no existence side-channel), and that callers must not differentiate.
- Above the `PATCH /api/notifications/:id/read` handler in `packages/notifications/src/routes.ts:68-88`
  — state that `404 Notification not found` covers both absent and denied, intentionally.
- A short "Information-egress non-goals" line in the V1 model docblock from Decision 1.

### 6. Rename stale workspace-era fixtures and comments

Rename in `tests/integration/notifications.test.ts`:

- `notificationIds.aWorkspaceSeed` → `notificationIds.aSeed` (the seeded, recipient=userA row used to
  prove recipient-only visibility). Keep the id literal; only the property name changes.
- Seed row title `"Workspace seed notification"` → `"Seeded notification for User A"`.
- Seed metadata `{ source: "seed", workspaceScoped: true }` → `{ source: "seed" }` (or another neutral
  flat value that still exercises the bounded metadata projection).
- The `listWithoutWorkspaceResponse` / `listWithWorkspaceResponse` request pair
  (`notifications.test.ts:292-306, 336-349`) becomes a single actor-context request — the workspace
  header probe is no longer meaningful because the personal-actor context is the only context. If the
  engineer wants to keep a second request, replace it with a request that varies some other
  irrelevant header and asserts identical results.

Rename in `tests/integration/ai-tools.test.ts`:

- `notificationIds.workspace` (`ai-tools.test.ts:35`) → an actor-scoped name (e.g.
  `notificationIds.forUserB` since the row's recipient is `userB` per the comment at line 184).
- `bWorkspace` / `taskIds.bWorkspace` references that exist **only** to support notification seeding
  are renamed in lockstep. (Other `*Workspace` names in `ai-tools.test.ts` that legitimately refer to
  the retired workspace concept in unrelated task/email/calendar assertions are out of scope for this
  slice — only the notification-bearing identifiers and their seed/comment text are touched.)

Update any comments that still reference "workspace" in the context of notifications to say
"actor-scoped" or "recipient-only".

### 7. Add SQL comments for the `notification_reads` parent-visibility defense-in-depth

Add a **new** migration file in `packages/notifications/sql/` (the next free number after 3d; if 3d
takes `0094`, this is `0095` — engineer picks). It must NOT edit `0008`. Add table- and policy-level
comments only:

```sql
COMMENT ON TABLE app.notifications IS
  'Notifications V1: in-app, actor-scoped delivery. recipient_user_id is always '
  'app.current_actor_user_id(); the app role (0008/0024/0029) and the worker role (0071) '
  'both enforce this on INSERT and SELECT. Not a cross-user/system broadcast mechanism.';

COMMENT ON TABLE app.notification_reads IS
  'Per-actor read state. Every policy re-checks parent-notification visibility via an EXISTS '
  'subquery against app.notifications — defense-in-depth so this table cannot leak notification '
  'ids even if its own RLS is later weakened. Do not drop the EXISTS clause.';

COMMENT ON POLICY notification_reads_select ON app.notification_reads IS
  'Exists-with-visible-parent guard: user_id owns the row AND the parent notification is '
  'currently visible to the actor. The parent check is defense-in-depth, not redundant.';

COMMENT ON POLICY notification_reads_insert ON app.notification_reads IS
  'User may only record a read for themselves on a notification currently visible to them.';

COMMENT ON POLICY notification_reads_update ON app.notification_reads IS
  'Same visibility guard as select/insert; only read_at may change.';

COMMENT ON POLICY notifications_select ON app.notifications IS
  'Recipient-only: a notification is visible iff its recipient is the current actor.';

COMMENT ON POLICY notifications_insert ON app.notifications IS
  'Recipient-only: a notification may be created iff its recipient (and actor, when non-null) '
  'is the current actor. Worker role mirrors this in 0071.';
```

Register this migration filename in `notificationsModuleManifest.database.migrations` alongside 3d.

## Contract / API shape

**Unchanged routes** (additive only — no path, method, or status-code change):

- `GET /api/notifications` → `200 ListNotificationsResponse`
- `PATCH /api/notifications/:id/read` → `200 MarkNotificationReadResponse` | `404 { error: "Notification not found" }`
- `PATCH /api/notifications/read-all` → `200 MarkAllNotificationsReadResponse`
- Assistant tool `notifications.listVisible` → `listNotificationsResponseSchema`

**Changed types (narrowing — callers that compiled before still compile):**

- `CreateNotificationInput` loses `actorUserId` and `recipientUserId`.
- `NotificationDto.metadata` type narrows from `Record<string, unknown>` to a bounded
  `Record<string, string | number | boolean | null>` (named `NotificationMetadata` in shared).
- `notificationDtoSchema.metadata` declares `maxProperties: 16`, `propertyNames.pattern`, and a
  primitive-only `additionalProperties` union.

**No new routes, no new tools, no new permissions.** The manifest's permission ids
(`notifications.view` / `.update` / `.manage`) are unchanged.

## Hard invariants honored

- **Secrets never escape.** No notification field is a secret; metadata is bounded and projected
  before REST/tool exposure (Decision 3b). The `metadata` projection is the information-egress control.
- **`DataContextDb` / module isolation.** Every repository method continues to call
  `assertDataContextDb(scopedDb)` first (`repository.ts:26, 43, 54, 86, 117`). The briefings producer
  continues to call `create` inside `withDataContext` (`packages/briefings/src/jobs.ts:162`).
- **Private by default / recipient-only.** Decision 2 makes the application layer match the
  recipient-only RLS contract. No new "share" or "broadcast" path is introduced.
- **No admin / owner RLS bypass.** None of the existing `app.current_actor_user_id()` policies are
  weakened. The `notification_reads` EXISTS guard is documented (Decision 7) but not removed. The
  existing test "does not let another user or admin role read private notifications"
  (`notifications.test.ts:238-252`) must continue to pass unmodified.
- **Never edit applied migrations.** Decisions 3d and 7 each ship as **new** migration files. `0008`,
  `0024`, `0029`, and `0071` are untouched. Migration files in `packages/notifications/sql/` are
  append-only.
- **RLS never disabled, even momentarily.** No migration touches `ALTER TABLE ... DISABLE ROW LEVEL
  SECURITY`. The CHECK constraint (3d) and COMMENT statements (7) do not require disabling RLS.

## Verification

The implementer MUST add / extend these integration tests in `tests/integration/notifications.test.ts`
and the AI-tools suite where flagged:

1. **`create` no longer accepts recipient/actor overrides.** A TypeScript compile-level test is
   sufficient (a call passing `recipientUserId` must fail typecheck). Plus a runtime assertion that
   `create(scopedDb, { title, metadata })` yields a row whose `actor_user_id === recipient_user_id ===
   ids.userA`. (Extends the existing "creates private notifications for the active actor by default".)
2. **Metadata bounding at input.** A direct unit-style test against `projectNotificationMetadata`
   covering: non-object input → `{}`; >16 keys → first 16 kept; bad key names dropped; nested
   object/array values dropped (key removed); over-long string truncated to 256 chars; oversized total
   → reduced until ≤ 4096 bytes.
3. **Metadata projection at output.** Seed (via bootstrap) a notification whose raw `metadata` jsonb
   contains a nested object, a too-long key, and a 16+ key set. Through both `GET /api/notifications`
   and the `notifications.listVisible` tool, assert the DTO `metadata` matches the projected shape
   (no nested objects, only allowed keys, strings ≤ 256).
4. **Schema-declaration honesty.** Assert `notificationDtoSchema.metadata` has `maxProperties: 16`,
   the `propertyNames.pattern`, and a primitive-only `additionalProperties` (a static AST/equality
   check on the exported schema object).
5. **`markRead` is a single round-trip.** Spy / mock the `DataContextDb.db` executor and assert that
   `markRead` issues exactly one query in the success path and exactly one in the not-found path
   (today it issues two in the success path). Alternatively, if a query-count assertion is impractical
   in Kysely, a comment-anchored code review check is acceptable but the behavioral assertion below is
   mandatory.
6. **`markRead` absent-vs-denied is indistinguishable.** For two distinct ids — one that does not
   exist (`randomUUID()`) and one that exists but is RLS-invisible to the actor (`notificationIds.bPrivate`
   for `userA`) — assert `repository.markRead` returns `undefined` for both and `PATCH :id/read` returns
   `404` with the identical body for both. This formalizes the existing
   `deniedMarkReadResponse.statusCode === 404` assertion (`notifications.test.ts:350`).
7. **Briefing worker delivery still works.** The existing briefings scheduled-run integration test
   (the one that exercises `packages/briefings/src/jobs.ts:162`) must still assert that the "Your
   morning briefing is ready" notification is inserted and visible only to the briefing owner.
   No regression in that suite.
8. **DB CHECK blocks oversized metadata.** A bootstrap-connection test that attempts
   `INSERT INTO app.notifications (... metadata with > 4096 bytes ...)` fails with a constraint
   violation named `notifications_metadata_size_check`.
9. **SQL comments are present.** A migration-client query against `pg_description` /
   `pg_{get_viewdef,etc}` asserting the table-level comments on `app.notifications` and
   `app.notification_reads` contain the expected substrings ("actor-scoped", "defense-in-depth",
   "EXISTS").
10. **Stale workspace names are gone.** `notifications.test.ts` no longer references
    `aWorkspaceSeed`, `workspaceScoped`, `x-jarvis-workspace-id`, or the literal string "Workspace";
    `ai-tools.test.ts` no longer references `notificationIds.workspace` (renamed per Decision 6).

`pnpm verify:foundation` MUST pass. The full `notifications.test.ts` suite and the AI-tools
notification-relevance assertions MUST pass.

## Acceptance Criteria

- V1 delivery model is documented at the module top in `manifest.ts` (+ mirrored summary in `index.ts`).
- `CreateNotificationInput` no longer exposes `recipientUserId` or `actorUserId`; the briefings
  producer compiles unchanged and the recipient-only invariant is asserted at runtime.
- Notification `metadata` is bounded at the input (16 keys, primitive values, ≤256-char strings,
  ≤4096 bytes), projected at the output via a single `serializeNotification` chokepoint, declared
  honestly in `notificationDtoSchema`, and capped at the DB by a new CHECK constraint migration.
- `markRead` performs one DB round-trip and returns `undefined` indistinguishably for absent vs.
  RLS-invisible ids; the route returns identical 404 bodies in both cases.
- The absent-vs-denied behavior is documented in repository and route docblocks.
- Stale workspace-era fixture names and comments in `tests/integration/notifications.test.ts` and the
  notification-bearing parts of `tests/integration/ai-tools.test.ts` are renamed to actor-scoped
  language.
- A new migration adds table- and policy-level `COMMENT`s explaining the `notification_reads` EXISTS
  defense-in-depth, without editing `0008` / `0024` / `0029` / `0071`.
- `pnpm verify:foundation` passes; no notification or AI-tools integration test regresses.

## Out of Scope

- External delivery (push / email / SMS). V1 is in-app only.
- A system-emitter / NULL-`actor_user_id` producer path. Decision 2 removes the unused override; a
  future spec can add a `SECURITY DEFINER`-backed system path with its own RLS analysis.
- Cross-user or broadcast delivery. The recipient-only RLS contract is final for V1.
- Replacing the jsonb `metadata` column with a typed/normalized schema. This slice bounds and projects
  it; structuring is a later call.
- Per-value type-tagging or signed metadata envelopes.
- Migrating `markAllRead` to a single-round-trip shape (it has no follow-up read today; nothing to
  collapse).
- Renaming `*Workspace` task / email / calendar identifiers in `ai-tools.test.ts` that are unrelated
  to notification seeding.
- A global Fastify `removeAdditional` AJV config. Output projection is done explicitly in
  `serializeNotification` so both REST and tool paths are covered without a global behavior change.
- Editing any applied migration (`0008`, `0024`, `0029`, `0071`).

## Open Questions for Ben

1. **Metadata value shape (Decision 3a) — strict-primitive vs. allow shallow nested.** I recommend
   **primitives only** (`string | number | boolean | null`, drop nested objects/arrays entirely). Every
   live callsite today (`briefings/jobs.ts:164`) uses flat primitives, a strict bound now is cheaper to
   relax later than the reverse, and primitives are easy to schema-project at the output. If you want
   to reserve room for shallow nested objects (e.g. `{ link: { href, label } }` for future UI affordances),
   say so and the bound becomes "string | number | boolean | null | one-level nested object of
   primitives" with a per-key size cap. **Recommendation: primitives only.**
2. **DB-level bound (Decision 3d) — size CHECK vs. structure CHECK.** I recommend the **size-only**
   CHECK (`octet_length(metadata::text) <= 4096`) because encoding key-count / key-name / nested-value
   rules in SQL needs a PL/pgSQL helper function and adds maintenance surface for V1. If you want the
   DB to also enforce key count and key names, the migration grows a `CREATE FUNCTION` + CHECK that
   calls it. **Recommendation: size-only CHECK; enforce structure at the app layer.**
