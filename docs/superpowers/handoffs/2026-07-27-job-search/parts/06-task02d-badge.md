### Task 2d: Manifest-declared nav badge, counted from the module's own notifications

Ben asked for a count badge on the Job Search nav entry. `navigation[]` entries validate to
`{id, label, path, icon?, order?}` only — there is no badge field, and the validator drops one (F1).

**Where the count comes from — settle this before designing anything.** A badge cannot be polled from
a module assistant tool. At HEAD the gateway emits `action_result` with `{actionRequestId, toolName,
outcome}` and never populates `result`; the field exists on the wire and nothing fills it, so a module
surface reading `record.result` gets `undefined` forever, silently (I6, M5). Building that opt-in is a
core project in its own right and is not needed here.

The count the badge wants is already a first-class core concept. Task 2b gives the module
`ctx.notify.post`, and `NotificationDto` already carries `moduleId` (G6). So the badge is **this
module's unread notification count** — no polling, no new channel, and the badge and the notification
bell can never disagree, which is what a user expects anyway. The only core addition is a per-module
breakdown of a number the API already computes.

**Depends on:** Task 2b — the core count change stands alone, but the badge is only ever non-zero once
the module can post notifications. Task 22 asserts the badge end to end (L8).

**Files**

- Modify: `packages/notifications/src/repository.ts` — `countUnreadByModule` beside `countUnread`
  (:355), returned from `listVisible` (:153)
- Modify: `packages/notifications/src/routes.ts` — pass it through the list handler
- Modify: `packages/shared/src/notifications-api.ts` — `unreadByModule` on `ListNotificationsResult`
  / `ListNotificationsResponse` **and on the response schema** (near the `required` list at :93)
- Modify: `packages/module-sdk/src/index.ts` — `ExternalModuleNavigationEntry.badge?`
- Modify: `packages/module-registry/src/external/validate.ts` — validate it and re-emit it in the
  navigation entry literal (~:640)
- Modify: the shell nav renderer (`rg -n "navigation" apps/web/src/shell --files-with-matches`)
- Modify: `packages/shared/src/platform-api.ts` — `badge?` on `ModuleNavigationEntryDto` (:34-40)
  **and** on `moduleNavigationEntrySchema` (:143-154, `additionalProperties: false`), declared in
  `properties` but NOT in `required`. Follow the `#918` `web` precedent at :193-198.
- Modify: `apps/api/src/server.ts` — `serializeExternalModule` (:896-902) hand-enumerates the
  navigation fields, so it must re-emit `badge` conditionally. NOT the mapper at :863; badge is
  external-only. **Ruling G8** — without these two the badge validates, renders, and never
  arrives, and a type-level assertion still passes.
- Test: `tests/unit/external-module-nav-badge.test.ts`,
  `tests/integration/notifications-unread-by-module.test.ts`

**Contracts**

```ts
// packages/module-sdk/src/index.ts — on ExternalModuleNavigationEntry
readonly badge?: {
  /**
   * Closed enum with one member today. A badge is always derived from a core-owned count —
   * never from module-supplied text or a module tool result — so the module can only choose
   * *which* core count, never the number itself.
   */
  readonly source: "notifications";
};
```

```ts
// packages/shared/src/notifications-api.ts — on ListNotificationsResult / ListNotificationsResponse
readonly unreadByModule: Readonly<Record<string, number>>;
```

`unreadByModule` is keyed by `module_id` across **all** of the actor's visible notifications, not just
the returned page. Core notifications (`module_id IS NULL`) are excluded from the map; they are already
covered by the existing top-level `unreadCount`.

Response-schema fragment, verbatim — this field is dropped on the wire without it (G7):

```json
{ "type": "object", "additionalProperties": { "type": "integer", "minimum": 0 } }
```

**Constraints**

- **The count is a SQL aggregate under RLS, mirroring `countUnread` (:355) exactly** — same left join
  to `app.notification_reads`, same `deferred_until` guard — but grouped by `module_id`, with
  `module_id IS NOT NULL`. Read state lives in a separate table (G1); a count that forgets the join
  counts read notifications.
- **Add `unreadByModule` to the response schema, not just the TypeScript interface** (G7). Leave it
  out of `required` only if the client also defaults it to `{}`.
- **Validate `badge` positively** — an object, exactly the key `source`, value strictly
  `"notifications"` — and re-emit it in the `validated.push({…})` literal. The validator defensively
  reconstructs and drops anything it does not know about (F1), so validating without re-emitting
  passes its own test and still ships nothing.
- **The shell renders `unreadByModule[moduleId] ?? 0`** from the notifications query it already runs
  (`apps/web/src/shell/app-shell.tsx:227`), reusing `formatUnreadCount` (:386) so 100+ renders as
  `99+` exactly like the bell. Nothing at 0 or while loading. **Never** render a badge from any
  module-supplied value (L9).
- **A badge test that omits `runtime` or a complete `assistantTools` entry fails the manifest before
  the badge logic is reached** and reads as a badge bug. `assistantTools` entries require `name`,
  `permissionId`, `description`, `risk`, `handler` (F3), and declaring any assistant tool makes
  `runtime` required (`validate.ts:425`). Build the fixture from
  `external-modules/finance/jarvis.module.json`.

**Tests**

`tests/unit/external-module-nav-badge.test.ts` — against the real `validateExternalModuleManifest`:

1. **A declared badge survives manifest reconstruction** — `manifest.navigation[0].badge` equals
   `{source: "notifications"}`. Fails against a validator that checks the field but forgets to re-emit
   it, which is the failure mode F1 makes likely.
2. **An unknown badge source is rejected** — `{source: "tool"}` fails. Fails against a validator that
   accepts any string, which would let a future source ship by accident.
3. **A badge that is not an object is rejected** — `badge: "notifications"`.
4. **A navigation entry with no badge still validates** — the field is optional and no existing
   module manifest may break.

`tests/integration/notifications-unread-by-module.test.ts` — integration, not unit: the count is a
SQL aggregate under RLS and the thing most likely to be wrong is the join to `notification_reads`,
which a mocked repository never exercises.

5. **Counts unread notifications per module, for the actor only.** Seed an owner with two
   `job-search` notifications, one `news`, one core (`module_id IS NULL`), one already marked read,
   plus one `job-search` notification belonging to a different user. Assert
   `unreadByModule` equals `{"job-search": 2, news: 1}` and `unreadCount` is 4. Every number here
   catches a distinct broken implementation: `news: 1` proves the result is keyed rather than one
   filtered count; the absence of `"job-search": 4` proves both the read notification and the other
   user's are excluded; `unreadCount === 4` proves the core notification stays out of the map but
   still reaches the bell.

**Verify**

```bash
pnpm vitest run tests/unit/external-module-nav-badge.test.ts                                            # exit 0
pnpm vitest run --config vitest.integration.config.ts tests/integration/notifications-unread-by-module.test.ts  # exit 0
pnpm typecheck                                                                                          # exit 0
```

---
