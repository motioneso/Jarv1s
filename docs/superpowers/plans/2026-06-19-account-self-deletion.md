# Plan — #239 account self-service deletion

**Spec:** `docs/superpowers/specs/2026-06-19-account-self-deletion.md` (approved, LOCKED)
**Tier:** `security` (destructive; Ben signs off merge)
**Worktree / branch / DB:** `account-self-deletion-239` / `account-self-deletion-239` / `jarvis_build_239`
**Audit action:** `user.delete.self` (distinct from admin `user.delete`)

Bite-sized TDD tasks. Each task = one green commit, explicit files only (no `git add -A`).
`Co-Authored-By: Claude` trailer on every commit.

---

## Forks surfaced during grounding (need coordinator nod, none block planning)

The spec names literal target files for several additions that **would breach the 1000-line
`check:file-size` gate**. Plan resolves each by extracting to a sibling file — same package,
same intent, no semantic change:

| File (current lines)                                | Spec says add                                                                         | Gate impact                                        | Resolution                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| --------------------------------------------------- | ------------------------------------------------------------------------------------- | -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/shared/src/platform-api.ts` (**1000**)    | `DeleteMyAccount*` + schema + `hasPasswordCredential` on `MeResponse`/`meRouteSchema` | +~30 → OVER                                        | Extract the entire me/sessions block (MeResponse, ProfilePrefs, PatchMeProfile*, MeSession*, meRouteSchema, patchMeProfileRouteSchema, meSessionSchema, list/revoke MySessions* schemas ≈ 150 lines) into new `packages/shared/src/me-api.ts`, re-export from `packages/shared/src/index.ts`. Add the new fields + `DeleteMyAccount*`+`deleteMyAccountRouteSchema`there. Pure mechanical move; idiomatic (every other domain has its own`\*-api.ts`). |
| `apps/web/src/api/client.ts` (**992**)              | `deleteMyAccount`                                                                     | +~8 → ~1000, over/risky (handoff explicitly warns) | New `apps/web/src/api/account-client.ts` with `deleteMyAccount(body)`; re-export from `client.ts`.                                                                                                                                                                                                                                                                                                                                                    |
| `packages/settings/src/routes.ts` (**895**)         | inline DELETE route                                                                   | +~90 → ~985, tight                                 | New `packages/settings/src/me-account-routes.ts` (mirrors `me-sessions-routes.ts`). Spec EXPLICITLY allows this — not a fork, listed for completeness.                                                                                                                                                                                                                                                                                                |
| `tests/integration/auth-settings.test.ts` (**910**) | add 10-scenario matrix suite                                                          | +~250 → ~1160 OVER                                 | New sibling `tests/integration/account-self-deletion.test.ts`. Reuses exported helpers from `tests/integration/test-database.ts` (`connectionStrings`, `resetEmptyFoundationDatabase`, `setInstanceSetting`) + a tiny local `cookieHeader`/`signUp` (matches the `*.helpers.ts` precedent). **Deviation from spec's literal "add to auth-settings.test.ts" — flagging.**                                                                              |

**Other findings:**

- **Matrix is wider than the spec lists.** Grounding found 4 MORE owner-scoped `ON DELETE CASCADE`
  tables not in the spec's matrix OR its "missing" list. All get added to `userScopedCountQueries`
  for a complete `countsBeforeDelete`:
  - `app.chat_memory_settings` (`packages/chat/sql/0042_chat_memory_settings.sql:5`, `user_id` CASCADE)
  - `app.inferred_patterns_suppression` (`packages/memory/sql/0092...:7`, `owner_user_id` CASCADE)
  - `app.module_enablement_per_user` (`packages/settings/sql/0065_module_enablement.sql:16`,
    `user_id` CASCADE; `disabled_by_user_id` SET NULL — count on `user_id`)
  - `app.member_onboarding` (`infra/postgres/migrations/0079_member_onboarding.sql:22`, `user_id` CASCADE)
- **No schema gap.** Every owner-scoped table cascades. **No forward migration needed.** Retained-with-
  SET-NULL model also confirmed: `app.admin_audit_events.actor_user_id` (0005), `app.notifications.actor_user_id` (0008).
- **`deleteUserData` audit action is hardcoded** `'user.delete'` at `scripts/delete-user-data.ts:144`.
  Cleanest seam: optional `auditAction` param (default `'user.delete'`); self-delete route passes
  `'user.delete.self'`. Admin path unchanged.

---

## Task 1 — Reconcile the deletion matrix + add `auditAction` seam

**Files:**

- `scripts/delete-user-data.ts`
- `tests/integration/auth-settings.test.ts` (extend the existing `deleteUserData` audit test to
  assert the new matrix keys appear in `countsBeforeDelete`; if size is a concern, assert in a
  new tiny test in the new sibling file instead — decide at build time)

**Changes:**

1. Extend `userScopedCountQueries` with all missing owner-scoped tables (predicate each):
   - From spec §Deletion matrix: `task_lists`, `task_tags`, `task_tag_assignments`,
     `task_preferences`, `shares` (predicate `owner_user_id = $1 OR grantee_user_id = $1`),
     `wellness_checkins`, `medications`, `medication_logs`, `wellness_therapy_notes`,
     `memory_chunks`, `chat_memory_facts`, `commitments`, `entities`, `preferences`.
   - From grounding extras: `chat_memory_settings`, `inferred_patterns_suppression`,
     `module_enablement_per_user`, `member_onboarding`.
2. `DeleteUserDataOptions` gains `readonly auditAction?: string` (default `'user.delete'`).
   Thread it into the audit INSERT literal.
3. Test: existing `deleteUserData` coverage still passes (admin path unaffected, default action
   preserved); add an assertion that `countsBeforeDelete` includes a few of the newly counted
   tables (e.g. `task_lists`, `commitments`).

**Exit:** matrix reconciled, audit-action seam in place, existing tests green.

---

## Task 2 — Shared contract: extract `me-api.ts`, add self-delete types + `hasPasswordCredential`

**Files:**

- NEW `packages/shared/src/me-api.ts`
- `packages/shared/src/index.ts` (add `export * from "./me-api.js";`)
- `packages/shared/src/platform-api.ts` (REMOVE the moved block only — no semantic edits here)

**Changes:**

1. Move (cut, not copy) from `platform-api.ts` into `me-api.ts`: `MeResponse`, `ProfilePrefs`,
   `PatchMeProfileRequest`, `MeSessionDeviceKind`, `MeSessionDto`, `ListMySessionsResponse`,
   `RevokeMySessionResponse`, `RevokeMyOtherSessionsResponse`, `AdminRevokeSessionsResponse`,
   `meRouteSchema`, `patchMeProfileRouteSchema`, `meSessionSchema`, `listMySessionsRouteSchema`,
   `revokeMySessionRouteSchema`, `revokeMyOtherSessionsRouteSchema`. Re-export from index keeps
   every existing import working (`@jarv1s/shared`).
2. In `me-api.ts`, add to `MeResponse`: `readonly hasPasswordCredential: boolean;` (optional
   during rollout — decide: required, client treats missing as false; spec calls it a new field).
   Add matching `hasPasswordCredential: { type: "boolean" }` to `meRouteSchema` 200 properties +
   required list.
3. In `me-api.ts`, add:
   ```ts
   export interface DeleteMyAccountRequest {
     readonly confirmEmail: string;
     readonly confirmPhrase: string;
     readonly password?: string;
   }
   export interface DeleteMyAccountResponse {
     readonly deletedUserId: string;
   }
   export const DELETE_MY_ACCOUNT_PHRASE = "DELETE MY ACCOUNT";
   export const deleteMyAccountRouteSchema = { body: {...}, response: { 200, 400, 401, 403, 404, 409 {code}, 429 } } as const;
   ```
   409 response carries `code: "bootstrap_owner" | "last_admin"`. Per-factor 400 = single generic
   `"Confirmation does not match"`.

**Exit:** `pnpm typecheck` green; platform-api.ts now ~850 lines, me-api.ts ~180.

---

## Task 3 — Auth `verifySelfPassword` port

**Files:**

- `packages/auth/src/index.ts` (interface + impl)

**Changes:**

1. Add to `JarvisAuthRuntime` interface (next to `revokeUserSessions`/`meSessions`):
   ```ts
   readonly verifySelfPassword: (input: { readonly actorUserId: string; readonly password: string; }) => Promise<boolean>;
   ```
2. Implement in `createJarvisAuthRuntime`: look up the user's email from `app.users` via the pool,
   call `auth.api.signInEmail({ body: { email, password } })` inside try/catch; on success return
   `true`; on `APIError` (bad password) return `false`. **MUST scope to the actor's own
   credential** — fetch the email by `actorUserId` first, then attempt sign-in with that exact
   email. Returns boolean only — never the hash, never a structured error. (Alternative: query
   `app.auth_accounts` for the hashed password and use better-auth's verifier directly — decide
   at build time; signInEmail path is the spec-cited precedent.)
3. No DB write; safe to retry.

**Exit:** typecheck green; unit-ish coverage folded into the Task 7 integration suite.

---

## Task 4 — New `me-account-routes.ts` + `GET /api/me` extension + DI wiring

**Files:**

- NEW `packages/settings/src/me-account-routes.ts`
- `packages/settings/src/routes.ts` (DI field + register call + extend `/api/me` handler)
- `packages/settings/src/index.ts` (export the new module)

**`me-account-routes.ts` shape** (mirrors `me-sessions-routes.ts`):

```ts
export interface MeAccountRoutesDependencies {
  readonly resolveAccessContext;
  readonly dataContext;
  readonly repository; // for getUserById + assertNotLastActiveAdmin
  readonly bootstrapConnectionString?;
  readonly verifySelfPassword?: (input: { actorUserId; password }) => Promise<boolean>;
}
export function registerMeAccountRoutes(server, deps): void {
  server.delete(
    "/api/me/account",
    {
      schema: deleteMyAccountRouteSchema,
      config: {
        rateLimit: { max: 5, timeWindow: "1 minute", keyGenerator: authPrincipalRateLimitKey }
      }
    },
    handler
  );
}
```

Handler flow (spec §Contract + Locked decisions 3–8), ALL pre-checks inside `withDataContext`:

1. resolveAccessContext; target = `accessContext.actorUserId` (no `:id`).
2. Load user via `repository.getUserById`; if missing → 404 (idempotent).
3. Read `hasPasswordCredential` (existence of `app.auth_accounts` row, `provider_id='credential'`
   AND `password IS NOT NULL`) — re-used for the GET extension too (factor out a tiny helper).
4. Bootstrap owner (`is_bootstrap_owner`) → 409 `code: "bootstrap_owner"` (hard block, before
   factor checks — cheap and decisive; spec decision 4).
5. Confirmation factors (any miss → **single** generic 400, no per-factor detail):
   - `confirmEmail` case-insensitive == user.email (read from DB, not JWT).
   - `confirmPhrase` exact case-sensitive == `DELETE_MY_ACCOUNT_PHRASE`.
   - If `hasPasswordCredential`: `verifySelfPassword({ actorUserId, password })` must return `true`
     AND body must include `password`. (OAuth-only: skip.)
6. If `is_instance_admin`: `repository.assertNotLastActiveAdmin(scopedDb, actorUserId)` (fast-path
   409, commits + releases its advisory lock — same two-phase pattern as admin route).
7. Outside `withDataContext`: `deleteUserData({ userId: actorUserId, confirmUserId: actorUserId,
actorUserId, requestId, bootstrapConnectionString, dryRun: false, auditAction: "user.delete.self" })`.
8. Map `LastActiveAdminError` → 409 `code: "last_admin"`; `result.deleted === false` → 404; else
   200 `{ deletedUserId: actorUserId }`. (Successful 200 = caller signed out everywhere; cascade
   destroyed the session.)

**`routes.ts` edits:**

- `SettingsRoutesDependencies` gains `readonly verifySelfPassword?: ...`.
- Call `registerMeAccountRoutes(server, { resolveAccessContext, dataContext, repository,
bootstrapConnectionString, verifySelfPassword })` next to `registerMeSessionsRoutes`.
- Extend the `GET /api/me` handler to compute `hasPasswordCredential` (same helper) and include
  it in the response object.

**Exit:** new route registered, typecheck green. `routes.ts` ~895 → ~925 (under gate).

---

## Task 5 — Wire `verifySelfPassword` in the composition root

**Files:**

- `apps/api/src/server.ts`

**Change:** at the `revokeUserSessions`/`meSessions` wiring block (~line 316), add
`verifySelfPassword: authRuntime.verifySelfPassword`. One line.

**Exit:** runtime wired, server boots.

---

## Task 6 — Route coverage (`onReady` assertRouteCoverage)

**Files:**

- The settings manifest's `routes[]` (find it at build time — likely
  `packages/settings/src/manifest.ts`) — add `DELETE /api/me/account` so the ADR-0009 §4 coverage
  hook stays green.

**Exit:** `pnpm verify:foundation` coverage assertion passes.

---

## Task 7 — Integration tests: new `tests/integration/account-self-deletion.test.ts`

**Files:**

- NEW `tests/integration/account-self-deletion.test.ts`
- (optional) NEW `tests/integration/account-self-deletion.helpers.ts` if the cookie/signUp helpers
  deserve reuse; otherwise inline.

**Setup:** `beforeAll` resetEmptyFoundationDatabase + setInstanceSetting(registration.requires_approval=false)

- createApiServer + ready. Local `signUp` (POST /api/auth/sign-up/email) + `cookieHeader`.

**Scenarios (spec §Verification 1–10):**

1. **Happy path:** member with rows seeded in EVERY matrix table (incl. new extras) calls
   `DELETE /api/me/account` with correct email + phrase + password → 200; subsequent `GET /api/me`
   with same cookie → 401; every owned row count 0 (verify via bootstrap conn, FORCE-RLS bypass);
   audit row `action='user.delete.self'` exists with `countsBeforeDelete` covering the new tables
   and `metadata` containing nothing private (no token/password/email beyond the actor's own).
2. Wrong email → 400 generic; wrong phrase → 400 generic; missing password on password-bearing
   account → 400; **no row deleted, no audit written** in each.
3. OAuth-only account (seed a user whose `app.auth_accounts` row has `provider_id != 'credential'`
   OR `password IS NULL`) → succeeds with email + phrase only.
4. Cross-user isolation: User A deletes; User B's rows untouched except documented SET-NULL
   anonymizations (notifications A authored on B's feed → `actor_user_id IS NULL`;
   admin_audit_events → `actor_user_id IS NULL`).
5. Bootstrap owner self-delete → 409 `code: "bootstrap_owner"`; row intact.
6. Last active admin self-delete → 409 `code: "last_admin"`; row intact.
7. Rate limit: burst over 5/min → 429.
8. Vault: after happy-path delete, user's vault directory is gone; a second `deleteUserVaultDir`
   call does not throw (idempotency).
9. Retention: `app.admin_audit_events` + cross-user `app.notifications` rows referencing the
   deleted user have `actor_user_id IS NULL` and intact content.
10. (Rolled into 1) audit `action` discriminator + private-payload invariant.

**Exit:** all scenarios green against `jarvis_build_239`.

---

## Task 8 — Web: `deleteMyAccount` client + Danger-zone UI

**Files:**

- NEW `apps/web/src/api/account-client.ts` (`deleteMyAccount(body)`)
- `apps/web/src/api/client.ts` (one re-export line: `export * from "./account-client.js";`)
- NEW `apps/web/src/settings/delete-account.tsx` (the destructive dialog component)
- `apps/web/src/settings/settings-personal-panes.tsx` (replace the `coming` Danger-zone Row with `<DeleteAccount />`)

**`DeleteAccount` component:**

- Reads `me.hasPasswordCredential` (from the `MeResponse` the pane already has) to decide whether
  to render the password field.
- Dialog collects `confirmEmail` + `confirmPhrase` (show the literal phrase to type) + `password`
  when applicable. Explains what's deleted (personal data, sessions, vault files) and retained
  (anonymized audit metadata). Honest "data export is not available yet" note per spec Q3
  recommendation (link to the existing DataExport group).
- `useFeedback().confirm` for the final destructive gate; `mutate()` called directly in `onConfirm`
  (StrictMode-safe — never inside a setState updater).
- On 200: `queryClient.removeQueries({ queryKey: queryKeys.auth.me })` (or setQueryData undefined)
  - route to signed-out root (same transition sign-out uses).
- On 409: surface the server's `code`/message (bootstrap_owner → "Transfer ownership first";
  last_admin → "Demote or appoint another admin first").

**Exit:** UI test (Settings) — `coming` row gone; dialog renders email + phrase (+ password when
`hasPasswordCredential`); submit on 200 clears `queryKeys.auth.me` and routes to signed-out root;
409 shows the specific guidance.

---

## Task 9 — Gate (before PR)

Per handoff:

```bash
pnpm check:file-size
JARVIS_PGDATABASE=jarvis_build_239 pnpm verify:foundation   > /tmp/build-239-vf.log   2>&1; echo "VF_EXIT=$?"
pnpm audit:release-hardening                              > /tmp/build-239-audit.log 2>&1; echo "AUDIT_EXIT=$?"
pnpm prettier --check <changed files>
pnpm lint
pnpm typecheck
```

Retry `verify:foundation` ONCE only if it fails with the known `tuple concurrently updated`
grant-contention signature.

Pre-push trio every push: `pnpm format:check && pnpm lint && pnpm typecheck` + `git fetch origin
main && git rebase origin/main`.

---

## Exit criteria (spec §Acceptance) — all met before PR

- [ ] `DELETE /api/me/account` self-deletes; no admin role needed.
- [ ] No `:id` param; target always the caller.
- [ ] Confirmation = email + typed phrase + (when password credential exists) password; OAuth-only
      uses email + phrase floor.
- [ ] Bootstrap owner never self-deletes (409 `bootstrap_owner`). Last active admin never
      self-deletes (409 `last_admin`, TOCTOU-safe via `deleteUserData` advisory-lock re-assert).
- [ ] Delegates to `deleteUserData` — no route-local table cleanup.
- [ ] Matrix covers every owner-scoped module table; integration test asserts every owned row
      removed + every retained audit/notification row anonymized.
- [ ] Caller's cookie + legacy bearer sessions invalidated by the user-row cascade.
- [ ] No secret/private payload in response, audit metadata, or client.
- [ ] Settings > Danger zone no longer "coming soon".
- [ ] `check:file-size`, `verify:foundation`, `audit:release-hardening`, `prettier`, `lint`,
      `typecheck` all green.

## Non-goals (spec §Out of scope)

Soft delete/grace period; owner transfer UI (#260); operator CLI changes; data export dependency
on #238; admin semantics changes; password/2FA/passkey management; deletion email; email reservation.
