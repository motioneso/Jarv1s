# Per-account feature grants for calendar/email CRUD actions (#514)

**Status:** draft
**Date:** 2026-06-29
**Owner:** Pam
**Issue:** #514
**Grounded on:** `~/Jarv1s/docs/superpowers/specs/2026-06-25-per-account-feature-access.md`,
`~/Jarv1s/packages/connectors/src/feature-grants.ts:1-60`,
`~/Jarv1s/packages/connectors/src/live-tools.ts:88-159`,
`~/Jarv1s/packages/connectors/src/sync-jobs.ts:318-415`,
`~/Jarv1s/packages/chat/src/calendar-write-impl.ts:65-96, 217-260`,
`~/Jarv1s/packages/calendar/src/calendar-write-service.ts:31-53`,
`~/Jarv1s/packages/calendar/src/tools.ts:132-181`,
`~/Jarv1s/packages/calendar/src/manifest.ts:226-253`,
`~/Jarv1s/tests/integration/calendar-delete.test.ts:238-560`.
Grounded on commit `b69ca7574c5e49e9d65e99b40d51ec0d8542f870`.

---

## 1. Problem

The phase-1 per-account feature grant model (#482) correctly separates OAuth capability from
Jarvis's user-controlled feature access:

- OAuth scope says what Google technically permits.
- The per-account feature grant says whether Jarvis may use that account for `email` or
  `calendar`.
- Effective access is `OAuth scope AND feature grant`.

That model already gates Google sync, live Gmail/calendar read tools, and the calendar focus-block
create path. It does **not** yet cover every calendar/email mutation. The concrete gap in current
source is `calendar.deleteEvent`: it checks the cached event row and Google calendar-write scope,
then refreshes a token and calls Google DELETE, but it never checks the account's `calendar` feature
grant. If the user disables Calendar access for the connected account, deletes should fail closed
before any token refresh, Google call, or cache-eviction enqueue.

Email mutation tools are not currently present. #514 should establish the same rule for them before
they are added, without turning this slice into a full email client.

This is separate from #501. #501 is about whether cached email/calendar **reads** should be
account-grant-gated. #514 is about live external actions and mutations: create, update, delete,
send, label/archive, and similar operations that act through the connected provider.

---

## 2. Decision

Use the existing per-account feature grants as the single user-choice gate for **all** calendar and
email external actions. Do not introduce per-action grants such as `calendarDelete` or `emailSend`.
The feature grant is intentionally coarse: when `calendar` is off, Jarvis must not read, create,
update, or delete calendar data through that account; when `email` is off, Jarvis must not read,
draft, send, label, archive, delete, or otherwise modify email through that account.

Every calendar/email action must pass three checks before the first provider mutation:

1. **Owner/RLS target check** when the action targets a cached row. Cross-user rows remain invisible
   through `DataContextDb`.
2. **OAuth capability check** for the operation's required provider scope. If the connected account
   lacks the required scope, the action returns the existing reconnect/grant-permission message.
3. **Per-account feature grant check** for the same connector account. If the grant is off, the
   action returns a sanitized disabled-access message and performs no token refresh, provider call,
   cache write/delete, or job enqueue.

The human confirmation gateway remains mandatory for write-risk tools. The grant check is an
execution-time authorization guard after approval, not a replacement for the approval card. This
means a user can see an approval card and then receive "Calendar access is disabled for this
account in Settings" if the grant is revoked before execution. That fail-closed race is acceptable
and safer than caching authorization state on the card.

---

## 3. Current matrix

| Feature                     | Operation class                 | Current state                                                                         | #514 action                               |
| --------------------------- | ------------------------------- | ------------------------------------------------------------------------------------- | ----------------------------------------- |
| Calendar                    | Sync/read from Google           | `sync-jobs.ts` and live read tools already gate on `calendar` grant                   | Keep as-is                                |
| Calendar                    | Create Google event             | `calendar.proposeFocusBlock` already checks calendar-write scope and `calendar` grant | Keep as-is; avoid regression              |
| Calendar                    | Delete Google event             | `calendar.deleteEvent` checks scope but not `calendar` grant                          | Fix now                                   |
| Calendar                    | Update Google event             | No update tool currently exists                                                       | Document mandatory guard for future tool  |
| Email                       | Sync/read from Google           | `sync-jobs.ts` and live Gmail tools already gate on `email` grant                     | Keep as-is                                |
| Email                       | Draft/send/label/archive/delete | No mutation tools currently exist                                                     | Document mandatory guard for future tools |
| Cached email/calendar reads | Read cached DB rows             | Covered by #501, not this spec                                                        | Out of scope                              |

---

## 4. Implementation slices

### Slice A — Fix `calendar.deleteEvent` grant enforcement

**Files:** `packages/chat/src/calendar-write-impl.ts`, `tests/integration/calendar-delete.test.ts`

In `buildCalendarWriteService().deleteEvent`, add the same grant check that `proposeAndInsert`
already uses, immediately after `getCalendarWriteScopeState()` succeeds and before
`getFreshAccessToken()` runs:

```ts
const preferencesRepository = deps.preferencesRepository ?? new PreferencesRepository();
const featureGrants = await preferencesRepository.get(
  scopedDb,
  featureGrantsPrefKey(calendarScope.accountId)
);
if (!isFeatureGranted(featureGrants, "calendar")) {
  return {
    deleted: false,
    googleDeleted: "skipped-no-scope",
    cacheMirror: "not-cached",
    message: "Calendar access is disabled for this account in Settings."
  };
}
```

The exact `googleDeleted` enum value can stay `skipped-no-scope` because it already means "no
provider delete attempted"; do not add a new enum unless implementation needs different UI copy.

Add a regression test in `tests/integration/calendar-delete.test.ts` Section D:

- Seed a Google account with calendar scope.
- Insert a cached calendar event for that account.
- Upsert `connector.<accountId>.feature_grants` to `{ email: true, calendar: false }`.
- Call `impl.deleteEvent(...)`.
- Assert:
  - `deleted === false`
  - message mentions Calendar access disabled
  - no Google DELETE call happened
  - no cache-evict enqueue happened
  - the cached event remains visible to the owner

This proves revocation blocks provider mutation and local side effects even when the OAuth scope is
still present and the target row is owner-visible.

### Slice B — Keep create/delete grant checks symmetric

**Files:** `packages/chat/src/calendar-write-impl.ts`

If the implementation starts duplicating more than the existing two-line preference read, extract a
small local helper in the composition host, not in `packages/calendar`:

```ts
async function isCalendarFeatureGranted(
  deps: CalendarWriteImplDeps,
  scopedDb: DataContextDb,
  accountId: string
): Promise<boolean> {
  const preferencesRepository = deps.preferencesRepository ?? new PreferencesRepository();
  const featureGrants = await preferencesRepository.get(scopedDb, featureGrantsPrefKey(accountId));
  return isFeatureGranted(featureGrants, "calendar");
}
```

Keep `packages/calendar` free of connectors imports. `packages/chat` is the current composition host
for calendar write services and already imports connectors, Google clients, and preferences.

### Slice C — Future calendar update tools

**Files when added:** `packages/calendar/src/calendar-write-service.ts`,
`packages/calendar/src/tools.ts`, `packages/calendar/src/manifest.ts`,
`packages/chat/src/calendar-write-impl.ts`, relevant integration tests.

Any future `calendar.updateEvent` or related mutation must:

- Use a write-risk action family that stays `allowedTiers: ["always_confirm"]`.
- Resolve the target cached event under owner RLS before provider mutation.
- Require the provider scope needed for that mutation.
- Check the same account's `calendar` feature grant before token refresh and before Google PATCH.
- Return sanitized failure messages that do not include provider response bodies.
- Treat cache mirroring as best-effort after provider success, never as authorization.

This slice does not add update tools. It defines the access-control contract those tools must meet.

### Slice D — Future email mutation tools

**Files when added:** email tool package, connectors Google client methods, composition host
services, shared schemas, and integration tests for the specific action.

Any future Gmail draft/send/label/archive/delete tool must:

- Use the OAuth scope required by that exact Gmail operation; if the current connected account lacks
  it, return a reconnect/grant-permission message.
- Check the connected account's `email` feature grant before token refresh and before any Gmail
  create/update/delete/send call.
- Keep action confirmation mandatory for write-risk or destructive operations.
- Persist only metadata required for audit/action tracking. Do not log or persist message bodies,
  provider error bodies, access tokens, refresh tokens, or raw email payloads.
- Add a disabled-grant test proving no Gmail provider call happens when `{ email: false }` is set.

This slice does not add email mutation tools or a full email client.

---

## 5. Acceptance criteria

- [ ] Disabling Calendar access for a connected Google account blocks `calendar.deleteEvent` before
      token refresh, Google DELETE, cache eviction, or local deletion side effects.
- [ ] `calendar.proposeFocusBlock` remains grant-gated and continues to pass its existing tests.
- [ ] `calendar.deleteEvent` still returns the existing reconnect/no-scope message when OAuth
      calendar-write scope is absent.
- [ ] Cross-user delete attempts remain row-invisible under owner RLS; the feature-grant check does
      not create a new cross-user oracle.
- [ ] Future calendar/email mutation tools have an explicit implementation checklist requiring
      `OAuth scope AND feature grant` before provider mutation.
- [ ] No new database table, migration, frontend toggle, or action-family tier is introduced for
      #514.
- [ ] `pnpm verify:foundation` is green for the implementation PR.

---

## 6. Security and invariants

- **No admin private-data bypass.** These checks run inside the actor's `DataContextDb`; admins do
  not gain private email/calendar access through configuration authority.
- **Grant revocation is immediate for external actions.** Once the preference is off, Jarvis must
  stop using that account for provider actions even if Google tokens and scopes remain valid.
- **Provider response bodies remain private.** Google error bodies must not appear in API responses,
  logs, action audit rows, or tool results.
- **Cached data retention is unchanged.** #514 blocks action/use. It does not purge cached events or
  messages on revoke.
- **Module isolation stays intact.** `packages/calendar` owns calendar tool contracts; the
  composition host wires connectors, Google, and preferences. Do not import connectors internals
  into the calendar module.

---

## 7. Out of scope

- #501 cached email/calendar read gating.
- Purging cached email/calendar data on feature-grant revoke.
- New per-action grant toggles.
- Building a full calendar editor or email client.
- Adding Gmail draft/send/delete/label tools.
- Reconciling OAuth scopes on token refresh; provider 403 remains the final backstop when Google
  permissions are narrowed out-of-band.
