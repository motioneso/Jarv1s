# Account self-service deletion — hard confirmation + deletion matrix

**Status:** approved (Ben standing keep-moving directive + coordinator review, 2026-06-19). LOCKED: hard-block bootstrap-owner self-delete; HARD DELETE no grace period (flagged to Ben for override); don't block on #238; audit action user.delete.self.
**Issue:** #239
**Tier:** `security` (destructive account/data removal, auth re-verification, session revocation,
RLS-adjacent, last-admin/bootstrap-owner guard). Final merge requires explicit Ben sign-off.
**Part of:** #234
**Predecessors:** #260 (owner bootstrap recovery — spec approved), #237 (active sessions — LANDED),
#238 (data export — NOT landed; see §Open Questions).

## Problem

Today the only way to delete a Jarv1s account is the **admin** path:
`DELETE /api/admin/users/:id` and `POST /api/admin/users/:id/reject` in
`packages/settings/src/routes.ts:418` (and `tearDownAccount` at `packages/settings/src/routes.ts:360`),
which both delegate to the canonical `deleteUserData()` in `scripts/delete-user-data.ts:70`.

That path explicitly refuses self-deletion (`if (id === accessContext.actorUserId) throw 422` at
`packages/settings/src/routes.ts:375`) and is admin-only. There is **no self-service** route.

The user-facing Settings > Profile & account pane has a `Danger zone` group with a single
`Delete account` row marked `coming` (i.e. the `ComingSoon` placeholder) at
`apps/web/src/settings/settings-personal-panes.tsx:165`. Users cannot delete their own data.

The issue (and the 2026-06-18 coordinator unblock note) requires this to become a real
self-service flow with: hard confirmation, reuse of the canonical deletion service (no route-local
table cleanup), a verified deletion matrix, session/token revocation, and last-admin /
bootstrap-owner protection.

## Current machinery to reuse (do not duplicate)

- **`deleteUserData()`** — `scripts/delete-user-data.ts:70`. The canonical, operator-and-route
  shared service. It: opens one transaction on the bootstrap connection; takes a
  `pg_advisory_xact_lock('jarv1s:last-active-admin')`; re-asserts the last-active-admin guard under
  the lock; writes a `user.delete` row to `app.admin_audit_events` with `{ countsBeforeDelete, script }`
  metadata; `DELETE FROM app.users WHERE id = $1` (FK `ON DELETE CASCADE` / `ON DELETE SET NULL`
  does the rest); commits; then `deleteUserVaultDir()` removes the on-disk vault subtree after the
  commit. Throws `LastActiveAdminError` (`scripts/delete-user-data.ts:42`) on the TOCTOU re-check.
  The admin route already maps that to a 409 (`packages/settings/src/routes.ts:396`).
- **`userScopedCountQueries` matrix** — `scripts/delete-user-data.ts:49`. The COUNT probe that
  feeds `countsBeforeDelete` in the audit payload. It is STALE relative to the real schema (see
  §Deletion matrix).
- **`revokeUserSessions(userId)`** — wired from `authRuntime.revokeUserSessions`
  (`packages/auth/src/index.ts:121`) into settings deps (`apps/api/src/server.ts:316`). Deletes every
  `app.better_auth_sessions` row for the user. NOTE: it covers only the cookie-session table — the
  legacy bearer table (`app.auth_sessions`) is NOT cleared by this hook. `deleteUserData`'s
  `DELETE FROM app.users` cascades both session tables via FK, but only AFTER the route returns.
- **`meSessions` service** — `packages/auth/src/session-service.ts` (spec #237, LANDED). Owns all
  current-user session-table reads/writes for the account surface. Exposes `revokeOthers` /
  `revokeOne`. The self-delete path is a destructive current-user operation; it should NOT call
  `meSessions.revokeOthers` (it is about to delete the user entirely) — `deleteUserData`'s cascade
  is the revocation. The dependency is noted only to forbid a second-hand reimplementation.
- **`LastActiveAdminError` + `assertNotLastActiveAdmin`** — the existing last-admin guard. The
  admin route pre-checks with `repository.assertNotLastActiveAdmin` (fast-path 409, commits and
  releases its advisory lock), then `deleteUserData` re-asserts authoritatively under the xact lock.
  Self-delete must reuse the SAME two-phase pattern.
- **`Group` / `Row` / `ComingSoon`** — `apps/web/src/settings/settings-ui.tsx:172`. The Danger zone
  row currently sets `coming`; the build replaces it with a real control.
- **`useFeedback().confirm`** — destructive confirmation primitive already used by Sessions
  revoke-one / revoke-others (`apps/web/src/settings/settings-profile-subviews.tsx:267`). The delete
  confirmation MUST layer a typed-phrase gate on top (see §Contract).

## Locked decisions

1. **One new route, additive.** `DELETE /api/me/account` (self-service). No change to the admin
   `DELETE /api/admin/users/:id` semantics other than extracting the shared tearDown body if it
   reduces duplication (optional; the admin path's pending/self/last-admin ordering must be
   preserved verbatim).

2. **Self-only.** The route takes NO `:id` param. The target is ALWAYS
   `accessContext.actorUserId`. There is no way for the request to name another user.

3. **Hard confirmation, two independent factors.** The request body MUST carry:
   - `confirmEmail` — the caller must type their own account email; the route rejects unless it
     case-insensitively equals the authenticated user's `email` (read inside the data context, not
     trusted from a JWT/client claim).
   - `confirmPhrase` — a fixed literal shown in the UI (e.g. `"DELETE MY ACCOUNT"`); the route
     rejects unless it is an exact, case-sensitive match.
   - `password` — REQUIRED when the account owns an email/password credential
     (`app.auth_accounts` row with `provider_id = 'credential'` and a non-null `password`).
     Verified via the existing better-auth runtime (`auth.api.signInEmail`-equivalent on
     `packages/auth/src/index.ts:104`) — the route must receive a boolean `passwordOk` from an
     auth-owned port, never read the `password` column itself. When the account is OAuth/OIDC-only
     (no password credential), this factor is skipped and `confirmEmail` + `confirmPhrase` is the
     floor, matching the issue's "do not fake it if unavailable."
   - Any missing/wrong factor → 400. No partial information about WHICH factor failed is returned
     (single generic `"Confirmation does not match"` error) to avoid aiding a CSRF-style attacker
     who already holds a session.

4. **Bootstrap owner is never deletable.** `deleteUserData` already hard-blocks the last active
   admin. For self-delete we ALSO block the bootstrap owner outright
   (`is_bootstrap_owner = true`) regardless of admin count, because removing the instance owner has
   recovery implications that only #260's transfer/recovery path should unlock. Map to **409** with
   a message pointing at owner transfer. (See §Open Questions Q1 if Ben wants soft handling.)

5. **Last active admin self-delete → 409.** If the caller `is_instance_admin = true` and is the
   only active admin, the route returns 409 (sourced from `LastActiveAdminError`, exactly like the
   admin route). The two-phase guard is reused unchanged: route-level pre-check inside
   `withDataContext`, then `deleteUserData`'s advisory-lock re-assert is authoritative.

6. **No soft delete, no grace period.** Deletion is immediate and irreversible, identical to the
   admin path. No `status = 'deleting'`, no scheduled tombstone, no new migration. (See §Open
   Questions Q2 if Ben wants a grace window — it would require schema work and is explicitly out of
   scope for this slice.)

7. **Session revocation = the user row delete cascade.** The route does NOT call
   `revokeUserSessions` / `meSessions.revokeOthers` separately — `DELETE FROM app.users` cascades
   `app.better_auth_sessions` and `app.auth_sessions` via FK
   (`packages/auth/src/index.ts` session table mappings). The caller's current session is destroyed
   by the same cascade, so a successful response is returned BEFORE the row is physically removed
   is NOT acceptable — see §Contract for the response-after-commit rule.

8. **Response-after-commit.** The route MUST commit `deleteUserData` and only return 200 once the
   user row is gone. Because the caller's own session is cascade-deleted, the client must treat a
   200 as "you are now signed out everywhere" and redirect to the signed-out root (the same
   transition the auth sign-out flow uses). No follow-up request from the deleted session will
   authenticate (401).

9. **Deletion matrix is reconciled and asserted in tests** (see §Deletion matrix). The
   `userScopedCountQueries` list in `scripts/delete-user-data.ts:49` is the single source of truth
   for the `countsBeforeDelete` audit payload and MUST cover every owner-scoped module table.

10. **Rate-limited.** `DELETE /api/me/account` gets a strict per-route `config.rateLimit`
    (per-principal key, low `max`, e.g. 5/min) overriding the global throttle
    (`apps/api/src/server.ts:165`). Precedent: the auth credential POSTs and the route-local rate
    limit spec (`2026-06-18-route-local-junk-credential-rate-limit-gates.md`). Defense against a
    hijacked session brute-forcing the typed phrase.

11. **Settings UI.** Replace the `coming` row (`apps/web/src/settings/settings-personal-panes.tsx:165`)
    with a real `Delete account` control that opens a destructive dialog:
    - explains what is deleted (personal data, sessions, vault files) and what is retained
      (anonymized audit metadata);
    - collects `confirmEmail` + `confirmPhrase` (+ `password` when the account has a password
      credential — the client learns this from a new `hasPassword` boolean on `GET /api/me`, see
      §Contract);
    - uses `useFeedback().confirm` for the final destructive confirmation, calling `mutate()`
      directly in `onConfirm` (never inside a `setState` updater — same StrictMode rule as Sessions);
    - on 200, clears the React Query cache (`queryKeys.auth.me`) and routes to the signed-out root;
    - on 409 (bootstrap owner / last admin), shows the specific guidance message from the server.

## Contract / API shape

### `DELETE /api/me/account`

Request body (`DeleteMyAccountRequest`):

```ts
export interface DeleteMyAccountRequest {
  readonly confirmEmail: string;
  readonly confirmPhrase: string;
  /** Required iff the account owns a password credential; ignored otherwise. */
  readonly password?: string;
}
```

Response 200 (`DeleteMyAccountResponse`):

```ts
export interface DeleteMyAccountResponse {
  readonly deletedUserId: string;
}
```

Error codes (all routed through the existing `handleSettingsRouteError` / `HttpError` mappers):
- `400` — confirmation factors do not match / `password` missing on a password-bearing account.
  Generic message; no per-factor detail.
- `401` — session missing or expired (existing `requireKnownUser` path).
- `403` — `account_pending_approval` / `account_deactivated` (existing mappers in
  `packages/settings/src/routes.ts:878`).
- `404` — the user row vanished mid-request (treated as already-deleted; idempotent-friendly).
- `409` — bootstrap owner (`is_bootstrap_owner = true`) or last active admin
  (`LastActiveAdminError`). Body carries a `code: "bootstrap_owner"` or `code: "last_admin"` and a
  human message.
- `429` — rate limit (per-route override).

Route schema (`deleteMyAccountRouteSchema`) lives in `packages/shared/src/platform-api.ts`,
mirroring `revokeMySessionRouteSchema` (params/body/response + `errorResponseSchema` for each
documented code). The route is registered in `packages/settings/src/routes.ts` (or a new
`me-account-routes.ts` neighbor to `me-sessions-routes.ts` if the file would otherwise drift —
prefer a new file to keep `routes.ts` under the 1000-line gate).

### `GET /api/me` extension

Add an optional `hasPasswordCredential: boolean` to `MeResponse` so the client knows whether to
render the password field. Computed inside the existing `withDataContext` by reading
`app.auth_accounts` for `provider_id = 'credential' AND password IS NOT NULL` — existence only,
never the hash. (The `users` query and `auth_accounts` are already user-scoped; no new RLS surface.)

### Wiring

`SettingsRoutesDependencies` (`packages/settings/src/routes.ts:57`) gains one optional injection
(the auth-owned password-verification port), mirroring the `meSessions` / `revokeUserSessions`
pattern:

```ts
readonly verifySelfPassword?: (input: {
  readonly actorUserId: string;
  readonly password: string;
}) => Promise<boolean>;
```

Implemented in `packages/auth/src/index.ts` and surfaced on `JarvisAuthRuntime`
(`packages/auth/src/index.ts:49`), wired at `apps/api/src/server.ts:316` next to the existing auth
dependencies. The implementation MUST scope the check to the actor's own credential and return a
boolean — never the hash, never a structured error (the route decides the HTTP code).

### Web client

Add to `apps/web/src/api/client.ts` next to `revokeMySession`:

```ts
export async function deleteMyAccount(
  body: DeleteMyAccountRequest
): Promise<DeleteMyAccountResponse>;
```

## Deletion matrix (the hardening this issue requires)

The implementer MUST reconcile `userScopedCountQueries` (`scripts/delete-user-data.ts:49`) with the
real schema and record the disposition of every owner-scoped table. Current-state audit (verified
against this worktree):

**Covered by the count matrix today** (counts captured in the audit payload, all cascade-deleted):
`app.users`, `app.auth_sessions`, `app.auth_accounts`, `app.better_auth_sessions`, `app.tasks`,
`app.task_activity` (actor), `app.notifications` (recipient OR actor), `app.notification_reads`,
`app.connector_accounts`, `app.calendar_events`, `app.email_messages`, `app.ai_provider_configs`,
`app.ai_configured_models`, `app.ai_assistant_action_requests`, `app.chat_threads`,
`app.chat_messages`, `app.briefing_definitions`, `app.briefing_runs`.

**Missing from the count matrix but cascade-deleted via `owner_user_id ... ON DELETE CASCADE`**
(must be ADDED to the matrix so the audit payload is complete — these rows ARE deleted, they are
just not currently counted):
- `app.task_lists`, `app.task_tags`, `app.task_tag_assignments`, `app.task_preferences`
  (`packages/tasks/sql/0039_tasks_foundation.sql:8,19,27,34`)
- `app.shares` — owner AND grantee both `ON DELETE CASCADE`
  (`infra/postgres/migrations/0017_shares.sql:5,6`). Note: deleting a user removes shares they
  granted AND shares granted to them.
- `app.wellness_checkins`, `app.medications`, `app.medication_logs`, `app.wellness_therapy_notes`
  (`packages/wellness/sql/0082,0083,0084,0089`)
- `app.memory_chunks`, `app.chat_memory_facts` (exported in `scripts/export-user-data.ts:459,476`,
  so they exist; confirm FK cascade during implementation)
- `app.commitments`, `app.entities`, `app.preferences` (exported; confirm FK cascade)

**Retained (NOT deleted) — anonymized via `ON DELETE SET NULL`** (this is the audit-retention
model the issue requires; no action beyond documenting it):
- `app.admin_audit_events.actor_user_id` (`infra/postgres/migrations/0005_admin_audit_events.sql:3`).
  The audit row stays, actor becomes NULL, the `metadata` jsonb keeps only the intentional
  `{ countsBeforeDelete, script }` payload — no secret/private content.
- `app.notifications.actor_user_id` (`packages/notifications/sql/0008_notifications_module.sql:3`).
  Notifications on OTHER users' feeds that reference the deleted user as actor stay visible to the
  recipient with the actor field nullified.

**Vault files** — `deleteUserVaultDir()` (`scripts/delete-user-data.ts:174`) removes the on-disk
vault subtree AFTER the DB commit. Idempotent (no error if absent). This is the file-system half of
the matrix and is already correct.

**Action items for the implementer:**
1. Add every missing owner-scoped table to `userScopedCountQueries` with the correct predicate.
2. Add a focused integration test (in `tests/integration/auth-settings.test.ts` next to the existing
   `deleteUserData` test at line 649) that: seeds a user with rows in EVERY matrix table; calls the
   self-delete route; asserts every owned row is gone (count 0) and every retained row has
   `actor_user_id IS NULL`.
3. Assert the audit event written by the self-delete path has `action = 'user.delete.self'`
   (distinct from the admin `'user.delete'` so audits can tell the surfaces apart) and that its
   `metadata` contains no private payload beyond `countsBeforeDelete` + `script`.
4. If ANY table is found to lack `ON DELETE CASCADE` during implementation, do NOT silently add a
   route-local DELETE — raise it as a schema gap and add a forward migration in the owning module's
   `sql/` directory (never edit an applied migration).

## Hard invariants honored

- **Secrets never escape.** The route never selects `app.auth_accounts.password`,
  `access_token`/`refresh_token`/`id_token`, session `token`, or connector/AI encrypted credentials.
  `verifySelfPassword` returns a boolean only. The 400 error gives no per-factor detail.
- **DataContextDb only.** All pre-checks (email match, bootstrap-owner / last-admin guard,
  `hasPasswordCredential`) run inside `withDataContext` against the scoped `DataContextDb`. No root
  Kysely handle is added. `deleteUserData` continues to use the bootstrap connection (existing,
  documented exemption — it is the canonical cross-module teardown service).
- **AccessContext shape unchanged.** Only `actorUserId` + `requestId` are used; the target user is
  always `actorUserId`. No new field.
- **Private by default / no admin RLS bypass.** Deletion goes through the same FK cascade and the
  same `app.users` row delete; no `BYPASSRLS`, no blanket policy change.
- **Module isolation.** The route lives in `@jarv1s/settings`; it does not import module internals
  or query module tables directly. All cross-module cleanup is the DB's cascade responsibility,
  triggered by the single `DELETE FROM app.users`.
- **Never edit applied migrations.** Schema gaps (if any) get a NEW migration file in the owning
  module's `sql/` dir.
- **No secrets in audit payload.** `countsBeforeDelete` is row counts only; `script` is a static
  string. Confirmed by test.
- **Spec before build.** This spec.

## Verification

Integration tests (Vitest, against the `db:up` Postgres), added to
`tests/integration/auth-settings.test.ts` alongside the existing `deleteUserData` coverage:

1. **Happy path:** a non-admin member with rows in every matrix table calls
   `DELETE /api/me/account` with correct `confirmEmail` + `confirmPhrase` (+ `password` when
   applicable); response is 200; subsequent `GET /api/me` with the same session is 401; every owned
   row is gone; the audit event with `action = 'user.delete.self'` exists with the expected counts
   metadata and a null-free-by-test private payload.
2. **Wrong email / wrong phrase / missing password:** each returns 400 with the generic message;
   no row is deleted; no audit event written.
3. **Password-bearing account without `password` in body:** 400; nothing deleted.
4. **OAuth-only account** (no password credential): succeeds with email + phrase only.
5. **Cross-user isolation:** User A's deletion does not affect User B's rows; the only User-B
   side-effects are the documented `SET NULL` anonymizations (notification/audit actor fields).
6. **Bootstrap owner self-delete:** 409 `code: "bootstrap_owner"`; row intact.
7. **Last active admin self-delete:** 409 `code: "last_admin"`; row intact. Concurrent admin
   demotion racing the self-delete still leaves at least the `deleteUserData` advisory-lock
   re-assert (TOCTOU guard, #94) as authoritative.
8. **Rate limit:** a burst over the per-route cap returns 429.
9. **Vault:** after a successful self-delete, the user's vault directory is gone
   (`deleteUserVaultDir` idempotency also covered: a second call does not throw).
10. **Retention:** `app.admin_audit_events` and cross-user `app.notifications` rows referencing the
    deleted user have `actor_user_id IS NULL` and otherwise intact content.

Unit / web:
- Admin policy / route table coverage (`assertRouteCoverage`) includes the new route under the
  settings manifest's `routes[]` (or the platform allowlist) — the `onReady` coverage hook must
  stay green.
- Settings UI test: the `coming` row is gone; the dialog renders the email + phrase (+ password
  when `hasPasswordCredential`) inputs; submit on 200 clears `queryKeys.auth.me` and routes to the
  signed-out root; 409 shows the specific guidance.

Local gate: `pnpm verify:foundation` and `pnpm audit:release-hardening` green. Coordinator gets
explicit Ben sign-off before merge (security/destructive tier).

## Acceptance criteria

- A signed-in member can delete their own account via `DELETE /api/me/account`; no admin role
  required.
- User A cannot delete User B (no `:id` param; target is always the caller).
- Confirmation requires the account email + a fixed typed phrase + (when the account has a
  password) the current password. OAuth-only accounts use the email + phrase floor.
- The bootstrap owner can never self-delete (409). The last active admin can never self-delete
  (409, TOCTOU-safe).
- Delegation to `deleteUserData()` — no route-local table cleanup.
- The `userScopedCountQueries` matrix covers every owner-scoped module table; an integration test
  asserts every owned row is removed and every retained audit/notification row is anonymized.
- The caller's sessions (cookie + legacy bearer) are invalidated by the user-row cascade.
- No secret/private payload reaches the response, the audit metadata, or the client.
- Settings > Danger zone no longer shows `Delete account` as coming-soon.
- Full gate + release-hardening audit green; Ben signs off the merge.

## Out of scope

- Soft delete / grace period / reversibility (would need schema + a scheduled job — see Q2).
- In-app owner transfer UI (that is #260's recovery path; this spec only blocks on it).
- Operator CLI / admin recovery script (the existing `pnpm delete:user` script is unchanged).
- Data export before deletion (#238 is not landed — see §Open Questions Q3).
- Admin delete/deactivate semantics changes.
- Password change, 2FA, or passkey management.
- Email/SMS notification of deletion (no transactional email infra assumed).
- A deleted-user username/email reservation scheme (the email is freed by the row delete; no
  tombstone).

## Open Questions for Ben

**Q1 — Bootstrap owner messaging.** The spec hard-blocks bootstrap-owner self-delete with a 409
pointing at owner transfer. Recommended: keep the hard block (deleting the only owner without a
transfer path can orphan the instance). Alternative: allow it iff there is at least one other
active admin (matches the last-admin rule). **Recommend: hard block until #260 lands a transfer
path.**

**Q2 — Grace period.** Recommended: no grace period for this slice (stays parity with the existing
irreversible admin path; avoids new schema). Alternative: a 7-day `status = 'pending_deletion'`
window with cancellation. **Recommend: ship hard-delete now; revisit grace period as a separate
sensitive-tier spec if product wants it.**

**Q3 — Pre-delete data export.** #238 (server-side export) is NOT landed; the current
`DataExport` component is simulated (`apps/web/src/settings/settings-profile-subviews.tsx:54`,
`NotWired`, fixed-content JSON). Recommended: the delete dialog links to the existing export UI with
an honest "export is not available yet" note, and deletion does NOT depend on the fake client
export. Alternative: block this issue on #238 landing first. **Recommend: do not block; deletion
proceeds without a real export, and the UI is honest about the export gap.**

**Q4 — Audit action discriminator.** Recommended: `user.delete.self` for this route vs `user.delete`
for admin, so audits distinguish the surfaces. Alternative: reuse `user.delete` and put the surface
in `metadata`. **Recommend: distinct action string.**
