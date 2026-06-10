# Plan: Fix app.auth_sessions bearer table (Fable H1 / issue #74)

**Branch:** p1-fix-auth-sessions  
**Date:** 2026-06-09  
**Spec:** GitHub issue #74

---

## Dead-or-alive verdict: LIVE

`app.auth_sessions` is actively used at runtime.

Call chain:

- `packages/db/src/auth-session.ts` — `AuthSessionResolver` queries `app.auth_sessions` directly
- `packages/auth/src/index.ts:57` — `createJarvisAuthRuntime` instantiates `new AuthSessionResolver(options.appDb)` as `legacySessions` (uses `jarvis_app_runtime` pool)
- `packages/auth/src/index.ts:62-67` — `resolveAccessContext` calls `legacySessions.resolveAccessContext(bearerToken)` when an `Authorization: Bearer <token>` header is present
- `apps/api/src/server.ts:100,180` — every authenticated API route uses `authRuntime.resolveAccessContext`

The gap: migration 0001 grants `SELECT ON app.auth_sessions TO jarvis_app_runtime, jarvis_worker_runtime`. Migration 0045 closed the same gap for `auth_accounts`, `better_auth_sessions`, and (REVOKE only, no RLS) `auth_verifications` — but never touched `auth_sessions`.

Secondary gap (`auth_verifications`): migration 0045 revoked the 0004 grant from `jarvis_app_runtime`, but never added ENABLE/FORCE RLS or a policy. The table is inaccessible to app_runtime but is not policy-guarded.

---

## Fix approach

**For `app.auth_sessions` (LIVE):** REVOKE + FORCE RLS + SECURITY DEFINER by-token lookup function, following the `count_all_users()` pattern from 0045. `AuthSessionResolver` calls the function instead of querying the table directly.

**For `app.auth_verifications` (secondary):** ENABLE + FORCE RLS + `jarvis_auth_runtime` policy, finishing what 0045 started.

**Audit:** Add both tables to `authSecretTables` in `scripts/audit-release-hardening.ts` so future gaps are caught automatically.

---

## Tasks

### Task 1 — Regression test (RED on origin/main)

**File:** `tests/integration/release-hardening.test.ts`

Add assertions inside the existing "audit report" test (`it("generates a hardening audit report…")`):

- `auth_sessions` appears in `report.authSecretTables` with `{ appCanSelect: false, forceRls: true, rlsEnabled: true }`
- `auth_verifications` appears in `report.authSecretTables` with `{ appCanSelect: false, forceRls: true, rlsEnabled: true }`

Also add a standalone `it("jarvis_app_runtime cannot SELECT from app.auth_sessions", ...)` that connects as `jarvis_app_runtime` and asserts the SELECT is denied.

These tests MUST fail on origin/main before migration 0046.

Commit: `test(release-hardening): add failing regression tests for auth_sessions + auth_verifications gaps`

---

### Task 2 — Migration 0046

**File:** `infra/postgres/migrations/0046_auth_sessions_rls.sql` (new)

```
-- 1. REVOKE SELECT on app.auth_sessions from app+worker runtime
REVOKE SELECT ON app.auth_sessions FROM jarvis_app_runtime, jarvis_worker_runtime;

-- 2. ENABLE + FORCE RLS
ALTER TABLE app.auth_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.auth_sessions FORCE ROW LEVEL SECURITY;

-- 3. Policy: only jarvis_auth_runtime
CREATE POLICY auth_sessions_auth_runtime ON app.auth_sessions
  FOR ALL TO jarvis_auth_runtime USING (true) WITH CHECK (true);

-- 4. SECURITY DEFINER lookup function (same pattern as count_all_users)
CREATE OR REPLACE FUNCTION app.resolve_auth_session(p_session_id uuid)
  RETURNS TABLE(user_id uuid)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = app, pg_temp
AS $$ SELECT user_id FROM auth_sessions WHERE id = p_session_id AND expires_at > now() $$;

GRANT CREATE ON SCHEMA app TO jarvis_auth_runtime;
ALTER FUNCTION app.resolve_auth_session(uuid) OWNER TO jarvis_auth_runtime;
REVOKE CREATE ON SCHEMA app FROM jarvis_auth_runtime;
SET LOCAL ROLE jarvis_auth_runtime;
REVOKE EXECUTE ON FUNCTION app.resolve_auth_session(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.resolve_auth_session(uuid) TO jarvis_app_runtime;
RESET ROLE;

-- 5. ENABLE + FORCE RLS on auth_verifications (REVOKE already done in 0045)
ALTER TABLE app.auth_verifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.auth_verifications FORCE ROW LEVEL SECURITY;

-- 6. Policy: only jarvis_auth_runtime (already has GRANT from 0045)
CREATE POLICY auth_verifications_auth_runtime ON app.auth_verifications
  FOR ALL TO jarvis_auth_runtime USING (true) WITH CHECK (true);
```

Note: `jarvis_auth_runtime` already has `SELECT, INSERT, UPDATE, DELETE` on both tables from 0045 (line 29-31).

Commit: `feat(migration): 0046 — FORCE RLS + resolve_auth_session SECURITY DEFINER for app.auth_sessions`

---

### Task 3 — Update AuthSessionResolver

**File:** `packages/db/src/auth-session.ts`

Replace the direct table query:

```ts
const session = await this.db
  .selectFrom("app.auth_sessions as sessions")
  .select(["sessions.user_id as actorUserId"])
  .where("sessions.id", "=", sessionId)
  .where("sessions.expires_at", ">", sql<Date>`now()`)
  .executeTakeFirst();
```

With SECURITY DEFINER function call:

```ts
const result = await sql<{ user_id: string }>`
  SELECT user_id FROM app.resolve_auth_session(${sessionId}::uuid)
`.execute(this.db);
const session = result.rows[0];
```

Adjust downstream access to use `session.user_id` instead of `session.actorUserId`.

Commit: `refactor(db): AuthSessionResolver uses resolve_auth_session() security definer`

---

### Task 4 — Update audit script

**File:** `scripts/audit-release-hardening.ts`

Change:

```ts
const authSecretTables = ["auth_accounts", "better_auth_sessions"] as const;
```

To:

```ts
const authSecretTables = [
  "auth_accounts",
  "auth_sessions",
  "auth_verifications",
  "better_auth_sessions"
] as const;
```

Commit: `fix(audit): add auth_sessions + auth_verifications to authSecretTables`

---

### Task 5 — Green gate

```bash
export JARVIS_PGDATABASE=jarvis_fix74
pnpm db:up
pnpm db:migrate
pnpm test:release-hardening   # must be green
pnpm verify:foundation        # full gate
```

---

## Exit criteria

- [ ] All tests in `release-hardening.test.ts` pass, including new assertions for `auth_sessions` + `auth_verifications`
- [ ] `jarvis_app_runtime` cannot SELECT from `app.auth_sessions` (verified by test)
- [ ] `pnpm verify:foundation` green
- [ ] `pnpm audit:release-hardening` green (both tables now in `authSecretTables`)
- [ ] No runtime auth regression (bearer token auth still works via SECURITY DEFINER function)
- [ ] `app.auth_sessions` direct SELECT replaced with `resolve_auth_session()` call

## Migration number

Using **0046** — highest current migration is 0045. Confirm coordinator approves this number before applying.
