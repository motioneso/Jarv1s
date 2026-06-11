## Phase 5 — Auth, Settings & Multi-User Lifecycle

**Model:** claude-sonnet-4-6
**Date:** 2026-06-10
**Scope:** `packages/auth/src/index.ts`, `packages/settings/src/{routes,repository,manifest}.ts`, `infra/postgres/migrations/0045_auth_secret_rls.sql`, `infra/postgres/migrations/0046_auth_sessions_rls.sql`, `packages/db/src/types.ts`, `tests/integration/auth-settings.test.ts`, `tests/integration/release-hardening.test.ts`, `docs/superpowers/specs/2026-06-09-p1-auth-secret-rls.md`, `docs/superpowers/specs/2026-06-10-p2-multi-user-accounts-design.md`

---

### Counts

- CRIT: 0
- HIGH: 2
- MED: 3
- LOW: 1
- INFO: 3

---

### Findings

#### [HIGH] RLS self-row UPDATE on `app.users` has no column-level restriction — a user can self-escalate to `is_instance_admin`

**File:** `infra/postgres/migrations/0045_auth_secret_rls.sql:96-102`
**Invariant violated / concern:** Private by default; no admin private-data bypass
**Detail:**
Migration 0045 creates the following UPDATE policy for `jarvis_app_runtime` on `app.users`:

```sql
CREATE POLICY users_app_runtime_update
  ON app.users FOR UPDATE TO jarvis_app_runtime
  USING (id = app.current_actor_user_id())
  WITH CHECK (id = app.current_actor_user_id());
```

This policy restricts *which rows* can be updated (own row only) but does not restrict *which columns*. PostgreSQL column-level grants are separate from row-level policies. Because `GRANT SELECT, INSERT, UPDATE ON app.users TO jarvis_app_runtime` (migration 0004 line 79) is table-level, any code running as `jarvis_app_runtime` that calls `UPDATE app.users SET is_instance_admin = true WHERE id = $actor_id` would succeed against the RLS policy.

Today, no application route exposes a "update my own profile" endpoint with a writable `isInstanceAdmin` field — `serializeUser` writes it out but no route accepts it back in. However:

1. better-auth exposes a built-in `PUT /api/auth/update-user` endpoint. The `isInstanceAdmin` field is declared `input: false` in `additionalFields`, which prevents better-auth from writing it on sign-up and profile-update payloads. This is the primary protection.
2. The planned Phase 2 implementation plan (`2026-06-10-p2-multi-user-accounts.md`) introduces an **admin-scoped UPDATE policy** (`USING (app.current_actor_is_admin())`). Until that migration lands, the self-row policy is the only DB-level guard, and it does not distinguish `is_instance_admin` from any other column.
3. If a future route ever accepted a user-controlled profile body and passed it through Kysely's `updateTable("app.users").set(body)`, escalation would be possible at the DB level.

The risk is mitigated today by the application layer (`input: false`), but the DB layer offers no independent backstop. This is a defense-in-depth gap against the project's stated philosophy (DB-level invariants, not conventions).

**Suggested fix:**
Apply column-level REVOKE for sensitive columns before Phase 2 lands. One approach is to use column-level GRANT instead of table-level:
```sql
REVOKE UPDATE ON app.users FROM jarvis_app_runtime;
GRANT UPDATE (name, email, email_verified, image, updated_at) ON app.users TO jarvis_app_runtime;
```
This makes `is_instance_admin` (and future `status`, `is_bootstrap_owner`) unwritable by `jarvis_app_runtime` except through SECURITY DEFINER helper functions with explicit guardrails — which is exactly what the Phase 2 plan already intends (`app.current_actor_is_admin()` helper). Pull that protection to the current migration (or a new one now) rather than waiting until Phase 2.

---

#### [HIGH] Phase 2 lifecycle routes do not exist yet — `status` and `is_bootstrap_owner` columns are entirely unimplemented; admin-bypass negative test has no coverage

**File:** `packages/settings/src/routes.ts` (entire file), `packages/auth/src/index.ts` (entire file)
**Invariant violated / concern:** Spec before build; multi-user lifecycle security is Phase 2 scope — flagging absence, not a code bug
**Detail:**
The approved Phase 2 spec (`2026-06-10-p2-multi-user-accounts-design.md`) defines a comprehensive multi-user lifecycle: `status` column (`pending`/`active`/`deactivated`), `is_bootstrap_owner` flag, registration gate (`before` databaseHook), status check in `resolveRequestAccessContext`, session revocation on deactivate, and admin lifecycle routes (approve/reject/deactivate/reactivate/promote/demote/delete). None of these exist in the current codebase:

- `app.users` has no `status` or `is_bootstrap_owner` columns (confirmed: `UsersTable` in `packages/db/src/types.ts:27-36`, migrations list ends at `0046`).
- `resolveRequestAccessContext` returns `{ actorUserId, requestId }` with zero status checks — a future `pending` or `deactivated` user would have full app access the moment they get a valid session.
- No admin lifecycle routes exist in `packages/settings/src/routes.ts`.
- The spec's headline security assertion — "admin cannot read another user's private content" (`multi-user-isolation` integration suite) — has no test.
- There is no sign-up gate (`registration.enabled` / `registration.requires_approval`); sign-up via better-auth is currently open to any visitor with no approval step.

This finding is raised as HIGH (not CRIT) because Phase 2 is unstarted per the plan file; however, it means the instance is currently operating without the security controls the approved spec describes. The implementation plan exists (`docs/superpowers/plans/2026-06-10-p2-multi-user-accounts.md`) and is detailed; the gap is a timeline risk, not a code defect.

**Regarding the five key questions:**

- **Q2 (deactivation durably revokes all session types):** Deactivation does not exist yet. When implemented per spec, it must revoke `better_auth_sessions` (via `jarvis_auth_runtime`) and the legacy `app.auth_sessions` bearer path. The spec notes this explicitly. The plan routes session revocation through `jarvis_auth_runtime` and the `deleteUserData` bootstrap path for full delete. Verify at implementation that both session tables are covered.
- **Q3 (bootstrap-owner protection on all mutation paths):** The `is_bootstrap_owner` column does not exist yet; no protection is in place. The spec and plan define guardrails for demote/deactivate/delete paths. Implementation must ensure all three mutation paths check `is_bootstrap_owner`, not just the most obvious one.
- **Q4 (last-admin guardrail on all paths):** The workspace "at least one owner" guardrail already exists in `SettingsRepository.assertWorkspaceHasAnotherOwner`. The instance-admin last-admin guardrail for is_instance_admin is not yet implemented.

**Suggested fix:**
No code fix now — this is scope-correct for Phase 2. Flag for reviewers: when Phase 2 PR arrives, require independent verification that `resolveRequestAccessContext` checks status on BOTH the better-auth path (line 221) and the legacy bearer-token path (`legacySessions.resolveAccessContext`, line 218), and that the `multi-user-isolation` suite includes the admin-bypass negative test.

---

#### [MED] `app.users` has `ENABLE` RLS but not `FORCE` RLS — table owner (`jarvis_migration_owner`) bypasses all row policies

**File:** `infra/postgres/migrations/0045_auth_secret_rls.sql:51`
**Invariant violated / concern:** Private by default; RLS applies to all actors
**Detail:**
Migration 0045 intentionally applies only `ENABLE ROW LEVEL SECURITY` (not `FORCE`) to `app.users`:

```sql
-- ENABLE (not FORCE) on users: the table owner (jarvis_migration_owner) must be able to
-- bypass RLS when executing SECURITY DEFINER functions...
ALTER TABLE app.users ENABLE ROW LEVEL SECURITY;
```

The rationale given is that SECURITY DEFINER functions owned by `jarvis_migration_owner` need to bypass RLS to perform admin checks (e.g., `list_connector_account_safe_metadata`). This is architecturally intentional and matches the release-hardening test assertion that `users.forceRls = false`.

The risk is that `jarvis_migration_owner` (a LOGIN role, not just a migration-time role) can read any user row, including `is_instance_admin`, `email`, `name`, and `image`. Although `jarvis_migration_owner` is not a runtime application role and has no exposed HTTP surface, it is a credential that exists in the environment. If the migration credentials were compromised, all user profile data would be accessible without RLS restriction.

Contrast with `auth_accounts` and `better_auth_sessions` which correctly use `FORCE ROW LEVEL SECURITY`.

**Suggested fix:**
The decision is documented and architecturally reasoned. The mitigation path (if desired) would be to transfer ownership of SECURITY DEFINER functions from `jarvis_migration_owner` to `jarvis_auth_runtime` (as was done for `app.count_all_users()`), then apply `FORCE RLS`. This should be evaluated as part of Phase 2 migration work, since that migration already adds a `current_actor_is_admin()` SECURITY DEFINER function and will need to resolve the same ownership question.

---

#### [MED] `/api/bootstrap/status` leaks exact user count without authentication

**File:** `packages/settings/src/routes.ts:77-84`
**Invariant violated / concern:** Information disclosure; private by default
**Detail:**
The bootstrap status endpoint is intentionally unauthenticated (it must be reachable before any user exists to allow the setup wizard to detect first-run). However it returns `userCount` — the precise number of registered users on the instance:

```typescript
server.get("/api/bootstrap/status", { schema: bootstrapStatusRouteSchema }, async () => {
  const userCount = await repository.countUsers();
  return { needsBootstrap: userCount === 0, userCount };
});
```

An unauthenticated visitor can learn the exact account count at any time. This is a reconnaissance signal — it reveals when new accounts are added, which is especially sensitive under the Phase 2 approval-gate model (a pending attacker could poll to see when their account is approved). The field also leaks the instance size.

`countUsers()` calls `app.count_all_users()` — the SECURITY DEFINER function — which bypasses owner-scoped RLS to give a true total. This function is callable by `jarvis_app_runtime` without authentication.

**Suggested fix:**
Return only `needsBootstrap: boolean` from this endpoint. The `userCount` field can be removed (or gated behind `requireAdmin`) once the frontend setup wizard no longer needs it. If the wizard needs to distinguish "0 users" from "1+ users", the boolean is sufficient. When Phase 2 lands and the registration gate is added, audit whether `userCount` leakage matters to the threat model.

---

#### [MED] `SettingsRepository` accepts raw `Kysely<JarvisDatabase>`, not `DataContextDb` — violates the branded handle invariant for admin writes

**File:** `packages/settings/src/repository.ts:64`
**Invariant violated / concern:** DataContextDb only — repositories must accept only branded `DataContextDb` handle
**Detail:**
```typescript
export class SettingsRepository {
  constructor(private readonly db: Kysely<JarvisDatabase>) {}
```

The `SettingsRepository` accepts a raw `Kysely<JarvisDatabase>` rather than the branded `DataContextDb` handle that the CLAUDE.md hard invariant requires. This means:

1. The `actor_user_id` GUC that drives self-row RLS policies is **never set** when the repository executes queries. The repository relies entirely on the application-layer `requireAdmin` check in `routes.ts` to enforce authorization, with no DB-level backstop via `DataContextRunner`.
2. Admin reads work without the GUC because `users_app_runtime_select` is `USING(true)` — reads are intentionally unscoped. But writes (`updateTable("app.users")`) go through the `users_app_runtime_update` policy which checks `id = app.current_actor_user_id()`. Without the GUC being set, those writes currently fail silently at the RLS level (returns 0 rows updated) unless another session context set the GUC previously.
3. The current admin write paths (`createWorkspace`, `upsertWorkspaceMembership`, etc.) do not write to `app.users` directly, so this is not exploitable today. However, the Phase 2 plan explicitly calls out that the lifecycle write methods (approve/deactivate/promote/demote) need the GUC set — and Task 7 in the plan adds it only to lifecycle methods, not to the repository constructor. This is a structural debt that will require careful per-method GUC setting rather than a constructor-level fix.

**Suggested fix:**
The Phase 2 implementation plan already acknowledges this (the `current_actor_is_admin()` helper requires the GUC). Consider refactoring `SettingsRepository` to use `DataContextRunner` for writes, or at minimum document which methods require manual GUC setting and add an assertion. For now, the admin-route calls are safe because `requireAdmin` enforces authorization at the HTTP layer; the DataContextDb invariant is violated in principle but not exploitable through current routes.

---

#### [LOW] `is_instance_admin` field declared `required: true` in better-auth `additionalFields` — may cause schema mismatch on INSERT

**File:** `packages/auth/src/index.ts:150`
**Invariant violated / concern:** Correctness; potential registration failure
**Detail:**
```typescript
isInstanceAdmin: {
  type: "boolean",
  fieldName: "is_instance_admin",
  required: true,
  input: false,
  defaultValue: false
}
```

The field is `required: true` but `input: false`, meaning the client cannot supply it. better-auth must supply the `defaultValue` on all INSERT paths. In combination, `required: true` + `input: false` should work — better-auth injects the default. However if better-auth's INSERT ever omits the `defaultValue` injection (e.g., a version change in how it handles `input: false` + `required: true`), the INSERT would fail with a NOT NULL constraint violation (the column is `NOT NULL DEFAULT false`).

Since `is_instance_admin` has a DB-level default of `false` (migration 0001), even if better-auth omits it, the column default would apply. The `required: true` is arguably redundant noise that could mask intent — `required` normally means the client must supply it, but `input: false` contradicts that for external callers.

**Suggested fix:**
Change to `required: false` with `defaultValue: false`. The DB-level NOT NULL + DEFAULT false is the authoritative constraint. This reduces dependency on better-auth's internal handling of a contradictory required+no-input combination.

---

#### [INFO] `app.count_all_users()` SECURITY DEFINER function callable by `jarvis_app_runtime` without an actor GUC — intentional but worth auditing

**File:** `infra/postgres/migrations/0045_auth_secret_rls.sql:127-135`
**Invariant violated / concern:** Observation; no current risk
**Detail:**
`app.count_all_users()` is STABLE, SECURITY DEFINER, owned by `jarvis_auth_runtime`, callable by `jarvis_app_runtime`. It runs `SELECT count(*) FROM users` without any owner filter. This is necessary for the bootstrap-first-user detection path and the `countUsers()` call in `SettingsRepository`. The function is narrowly scoped (returns only a count, no row data) and the EXECUTE grant is explicitly restricted to `jarvis_app_runtime`. No risk currently, but note that this is the only path where `jarvis_app_runtime` can learn the total user count without the GUC being set.

---

#### [INFO] `resolveRequestAccessContext` bearer-token path delegates to `AuthSessionResolver` without status check — Phase 2 must not miss this path

**File:** `packages/auth/src/index.ts:217-218`
**Invariant violated / concern:** Observation; future Phase 2 implementation risk
**Detail:**
```typescript
if (bearerToken) {
  return options.legacySessions.resolveAccessContext(bearerToken, requestId);
}
```
The bearer-token (legacy CLI) path returns early before any status check would be applied. The Phase 2 spec explicitly calls this out: "Bearer-token path: the legacy `AuthSessionResolver` path (CLI bridge) must apply the same status check." The plan's Task 3 covers this. Flagging for reviewers to verify Task 3 is not skipped in the Phase 2 PR.

---

#### [INFO] No test proves that `is_instance_admin: true` in a registration payload is silently ignored by better-auth

**File:** `tests/integration/auth-settings.test.ts`
**Invariant violated / concern:** Test coverage gap for privilege escalation path
**Detail:**
The `auth-settings.test.ts` integration test verifies that the first user becomes `isInstanceAdmin: true` and subsequent users become `isInstanceAdmin: false`. It does not test that submitting `{ name: "Attacker", email: "...", password: "...", isInstanceAdmin: true }` to `/api/auth/sign-up/email` results in `isInstanceAdmin: false` in the response. The protection (`input: false`) is exercised indirectly, but a targeted negative test would make the invariant explicit and regression-proof.

**Suggested fix:**
Add a test case that submits a sign-up payload with `isInstanceAdmin: true` and asserts the returned user has `isInstanceAdmin: false`. This tests the actual protection mechanism rather than inferring it from the happy-path flow.

---

### Key Question Answers

**Q1 — Can a user register with `is_instance_admin: true` in the payload?**
Verified OK at the framework level. `is_instance_admin` is declared `input: false` in `createBetterAuthOptions` (`packages/auth/src/index.ts:151`), which instructs better-auth to strip this field from any client-supplied registration or update payload. The `bootstrapFirstJarvisUser` after-hook then sets `is_instance_admin` based on whether the user is first (advisory-locked check via `app.count_all_users()`). No application route independently accepts `isInstanceAdmin` from clients. The DB column has `DEFAULT false`. The primary gap is that no integration test directly asserts the `input: false` behavior (INFO finding above).

**Q2 — Does deactivation durably revoke ALL session types?**
Not applicable yet — deactivation does not exist. Phase 2 must revoke both `better_auth_sessions` (via `jarvis_auth_runtime`) and `app.auth_sessions` (via the bootstrap connection, since `jarvis_app_runtime` / `jarvis_worker_runtime` no longer have any privilege on `auth_sessions` after migration 0046). The timing window risk is: if the status DB write and the session DELETE happen in separate transactions, a deactivated user could still use an active session for a brief window. The spec says "live sessions die immediately" — implementation should use a single transaction or at minimum delete sessions before committing the status change. Verify at Phase 2 PR review.

**Q3 — Is the bootstrap-owner protected on EVERY mutation path?**
Not applicable yet — `is_bootstrap_owner` column does not exist and the lifecycle routes are not built. The plan acknowledges the PR #93 Fable review gap on the delete path. When Phase 2 lands, all three paths (demote, deactivate, delete) must check `is_bootstrap_owner`. The plan's Task 5 (guardrails) covers this — security QA must verify all three paths, not just the most obvious one.

**Q4 — Is the last-admin guardrail applied on ALL paths?**
Partially: the workspace "at-least-one-owner" guardrail is implemented (`assertWorkspaceHasAnotherOwner` in repository.ts). The instance-admin last-admin guardrail (for `is_instance_admin`) is not yet implemented — Phase 2 Task 5. The guardrail must cover demote, deactivate, and delete. The plan includes this; flag for Phase 2 security QA.

**Q5 — Does the admin UPDATE RLS policy on `app.users` correctly scope to non-secret columns only?**
No migration 0050 exists yet (confirmed: migrations list ends at 0046). The current `users_app_runtime_update` policy (0045) is self-row only and has no column restriction — this is the HIGH finding above. `app.users` does not contain `password_hash` or `encrypted_credential` (those live in `auth_accounts` and `ai_provider_configs` / `connector_accounts` respectively, which are under FORCE RLS and inaccessible to `jarvis_app_runtime`). So there is no encrypted credential exposure risk through the users UPDATE path today. The concern is `is_instance_admin` self-escalation, addressed in the HIGH finding.

---

### Summary

The Phase 1 auth-secret RLS work (migrations 0045 and 0046) is well-implemented and closes the original gap cleanly: `auth_accounts`, `better_auth_sessions`, `auth_sessions`, and `auth_verifications` are now under FORCE RLS with access restricted to `jarvis_auth_runtime`, BYPASSRLS is absent from all runtime roles, and the release-hardening audit suite verifies this automatically. The auth package correctly prevents `is_instance_admin` escalation via better-auth's `input: false` mechanism, and the bootstrap-first-user path is protected by an advisory lock. The two HIGH findings are a DB-layer defense-in-depth gap on column-level UPDATE restrictions (which Phase 2's `current_actor_is_admin()` migration will address) and the expected absence of Phase 2 multi-user lifecycle controls — the instance currently has no account approval gate, no status enforcement, and no session revocation on deactivation, all of which are scoped to Phase 2 and well-documented in the plan. Phase 2's security tier review must rigorously verify that `resolveRequestAccessContext` applies status checks on both the better-auth and bearer-token paths, that all three lifecycle mutation paths (demote, deactivate, delete) enforce bootstrap-owner and last-admin guardrails, and that session revocation is atomic with the status transition.
