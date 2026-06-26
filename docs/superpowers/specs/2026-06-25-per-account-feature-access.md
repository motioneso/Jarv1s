# Per-account, per-feature access controls for email/calendar (#482)

**Status:** approved
**Date:** 2026-06-25
**Owner:** Ben + Codex
**Grounded on:** `~/Jarv1s/packages/connectors/src/sync-jobs.ts:313,385` (access check today is
`account.scopes.includes(CALENDAR_SCOPE)` — the OAuth scope IS the access grant; no separate feature
state), `packages/connectors/src/repository.ts:349`, `packages/connectors/sql/0009_connectors_module.sql:42`
(`connector_accounts.scopes text[]`), `packages/structured-state/src/preferences-repository.ts`
(`app.preferences` owner-scoped RLS), `packages/email/src/manifest.ts:62` & `packages/calendar/src/manifest.ts:74`
(`sourceBehaviors` — module-wide behavior toggles, NOT per-account; this is the gap #482 fills).

## 1. Decision

Decouple **technical capability** (OAuth scope — what Google granted) from **user choice** (whether
Jarvis may actually use it). Add a **per-connected-account, per-feature** access toggle for email and
calendar. A feature is usable only when BOTH are true: the account's OAuth scope includes it AND the
user has enabled it for that account.

This is distinct from the existing module-level `sourceBehaviors` (module-wide, gates downstream
behaviors like "appear in briefings") and from module permissions (`email.view`/`calendar.view`).
#482 is per-**account**: a user with two Google accounts can grant email on one and calendar on the
other; on a single account with both scopes, email and calendar are independent feature states.

## 2. Storage — one JSON preference per account

Per-account grants stored in `app.preferences` under key
`connector.<accountId>.feature_grants` = `{ email: boolean, calendar: boolean }`. Owner-scoped RLS
(via `app.preferences`). **No new table, no migration** — reuses the existing preferences store.

**Why not a table:** the realistic access pattern is single-row keyed lookup (one account + feature
at a time, never an aggregation) and single-row writes (one toggle). A dedicated table's advantages
(cross-row queries, FK cascades) are speculative for phase-1. A pref key matches the actual pattern;
migrating to a table later is a clean backfill if cross-row queries (admin dashboards, module-disable
cascade) become real.

**Why not per-feature keys** (`connector.<id>.email.enabled`): key sprawl; one read per feature
instead of one read per account. The JSON doc keeps it one-key-per-account.

## 3. Default state + grant lifecycle

- **At connect time:** when a user connects an account, feature grants default **on** for each scope
  the account actually has. An account connected with both email + calendar scopes →
  `{ email: true, calendar: true }`. This preserves today's behavior (no surprise loss of briefing
  context on upgrade); the OAuth grant was already an explicit user action. The toggle revokes after.
- Accounts connected before this ships: lazily treated as default-on for their scopes (the resolver
  treats "no pref row" as "enabled for every scope the account has" — same effective behavior).
- **Toggle:** user flips email or calendar off for an account → writes the pref.
- **Re-enable:** instant — the cached data is still present, just resumes being used.

## 4. Resolver change — the feature gate

Every place that today checks `account.scopes.includes(X)` to decide it may use a feature gains a
second check: the feature grant for that account. Concretely a shared helper:

```ts
// packages/connectors/src/feature-grants.ts (new)
export async function isFeatureGranted(
  scopedDb, preferences, accountId, feature
): Promise<boolean> {
  const grants = await preferences.get(scopedDb, `connector.${accountId}.feature_grants`);
  // No row = default-on for every scope the account has (legacy + fresh-connect parity).
  if (!isRecord(grants)) return true;
  return grants[feature] === true;
}
```

Effective gate: `account.scopes.includes(X) && await isFeatureGranted(scopedDb, prefs, account.id, "email"|"calendar")`.

**Call sites to update** (the spots that currently gate on scope alone):
- `packages/connectors/src/sync-jobs.ts:313` (calendar sync) + `:385` (email sync) — skip syncing a
  feature whose grant is off. (Cached data is retained, just not refreshed; see §5.)
- `packages/connectors/src/repository.ts:349` (`hasCalendarScope`-style check) — add the grant check.
- The email/calendar **assistant tools** (read tools) — gate on the grant too, so a revoked feature
  returns "access disabled for this account" rather than reading cached data. Find the exact tool
  entry points in `packages/email/src/tools.ts` / `packages/calendar/src/tools.ts` (or wherever the
  read tools live) and add the check at the top of execute.

`PreferencesRepository` is injected where these run (sync job already has a `scopedDb`; tools get
services via the `ToolServices` seam — same pattern as #474's consent check).

## 5. Cached-data behavior on revoke

Revoking a feature only blocks **future** use (sync + tool reads). Already-cached emails/events are
**retained** — re-enabling instantly resumes surfacing them. This matches "reversible" and avoids
destructive data loss on a misclick. A separate "purge cached data for this feature" action is
deferred (could be added later, ideally alongside #473's calendar reconciliation machinery).

Rationale: deletion on revoke is a privacy win but a UX trap (one misclick wipes a year of synced
email); retaining + blocking-use gives the same access-control outcome safely.

## 6. UI — per-account feature controls

In the **Connected accounts pane** (`ConnectedPane` / `AccountRow` in
`settings-personal-data-panes.tsx`), each account row that has email and/or calendar scopes gains
**independent enable/disable toggles** for each feature it supports:

- An account with both scopes shows two controls: "Email access" and "Calendar access".
- An account with only calendar scope shows only "Calendar access".
- Toggle → writes the pref via a new route (§7) → invalidates the accounts query.
- Copy makes the boundary explicit: *"Jarvis may read your email from this account"* (independent of
  the calendar toggle on the same account). Note that this governs Jarvis's access, not the Google
  OAuth grant itself (which is managed at Google).

This is the natural home — it's where the user already manages per-account state (reconnect/revoke).
The existing module-level `sourceBehaviors` (Data sources pane) stays as-is — it's a different axis
(behaviors, module-wide), and the two compose: module behavior off = never used regardless; account
grant off = not from this account.

## 7. Routes

New routes owned by the connectors module (admin not required — these are the user's own accounts;
owner-scoped RLS):

- `GET /api/connectors/accounts/:id/feature-grants` → `{ email: boolean, calendar: boolean }`
  (resolved effective state — default-on for scopes the account has when no pref row).
- `PUT /api/connectors/accounts/:id/feature-grants` body `{ email?: boolean, calendar?: boolean }`
  → partial update (only the provided features change), returns the new effective state.
- Audit on PUT: `action: "connector.feature_grant.set"`, `targetType: "connector_account"`,
  `targetId: id`, metadata `{ feature, enabled }` (not the cached data itself).

Gated by the existing connector-account access (owner-scoped — only the account's owner can toggle).

## 8. Security & invariants

- **Two-gate access control.** Feature usable only when `scope AND grant` — neither alone suffices.
  Revoking the grant immediately blocks tool reads + sync even though the OAuth token still works.
- **Per-account isolation.** Grants are keyed by `accountId` under owner-scoped RLS. User A cannot
  affect user B's account grants. Admin = config power only (can't read emails via this).
- **No secrets surface.** Grant routes return booleans only; no tokens, no message/event content.
- **Cached data retained, not leaked.** Revoking blocks *use*; the cache stays owner-scoped under
  RLS as today. No new data flows anywhere.
- **Independent features.** Email and calendar grants are separate keys in the JSON doc; granting one
  never implies the other (the issue's explicit "one feature grant cannot imply another").
- **No new context fields.** Preference read is per-actor via RLS / the injected repo.

## 9. Acceptance criteria (from #482)

- [ ] A connected account shows separate email and calendar access controls where the account has
      those scopes.
- [ ] A user can grant or revoke each feature independently, even on the same account.
- [ ] Jarvis only uses email/calendar access when BOTH the account scope AND the per-account feature
      grant allow it — verified in sync (`sync-jobs.ts`) and in the read tools.
- [ ] Full-access grants are explicit (default-on at connect is the OAuth grant already being
      explicit) and reversible (toggle off anytime).
- [ ] Revoking blocks future use immediately; cached data is retained (reversible).
- [ ] One feature grant cannot imply another (email and calendar are independent keys).
- [ ] No secrets in any response or audit row; no new DB table/migration.

## 10. Rollout / blast radius

- `packages/connectors/src/feature-grants.ts` — new (shared `isFeatureGranted` helper + pref shape).
- `packages/connectors/src/sync-jobs.ts` — gate calendar + email sync sections on the grant.
- `packages/connectors/src/repository.ts` — scope checks gain the grant check.
- `packages/email/src/tools.ts` + `packages/calendar/src/tools.ts` (read tools) — gate execute on grant.
- `packages/connectors/src/routes.ts` — new GET/PUT feature-grants routes.
- `packages/connectors/src/manifest.ts` — register routes.
- `packages/shared/src/connectors-api.ts` (or similar) — DTOs + schemas.
- `apps/web/src/api/client.ts` + `query-keys.ts` — client fns + keys.
- `apps/web/src/settings/settings-personal-data-panes.tsx` (`AccountRow`) — per-feature toggles.
- Composition host — inject `PreferencesRepository` into sync + tool services where not already.

**No DB migration** (uses `app.preferences`). No new permissions.

## 11. Out of scope

- **Purge cached data on revoke** — deferred; pairs with #473 reconciliation later.
- **Per-feature read granularity** within email (e.g. "read subjects but not bodies") — coarse
  email on/off for now.
- **Admin-managed per-account grants** — user-managed only in phase-1.
- **Grant expiry / time-windowed access** — static toggle for now.
- Migration to a dedicated table (only if cross-row queries become real).
