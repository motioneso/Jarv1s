# Phase 2 Slice A — Multi-user Accounts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add self-registration multi-user accounts to a Jarv1s instance — admin levers to disable registration and require per-account approval, a full user lifecycle (approve/reject/deactivate/reactivate/promote/demote/delete), and a proven cross-user isolation guarantee that holds even against an instance admin.

**Architecture:** Approach B — Jarv1s owns the account lifecycle in the app layer (NOT better-auth's admin plugin). Three chokepoints in `packages/auth` (sign-up gate, status assignment, access enforcement); admin routes + guardrails in `packages/settings`; status/admin-flag writes flow through `jarvis_app_runtime` under a **new admin-scoped RLS policy** gated by a `app.current_actor_is_admin()` SECURITY DEFINER helper; session revocation flows through `jarvis_auth_runtime`; full delete reuses the existing `deleteUserData` (bootstrap connection) path. The `AccessContext` shape stays frozen at `{ actorUserId, requestId }` — status is checked **during** resolution, never stored on the context.

**Tech Stack:** better-auth v1.6.x (email+password, `databaseHooks.user.create`), Fastify REST, Kysely, PostgreSQL RLS, Vitest integration tests, React + TanStack Query frontend.

**Spec:** `docs/superpowers/specs/2026-06-10-p2-multi-user-accounts-design.md` · **Epic:** #47 · **Tier:** security.

---

## 🔒 Security Decision — read before starting (security-tier QA must scrutinize this)

The approved spec said status reads "happen via the auth/admin paths that already touch users; no new policy surface on secret tables." It under-specified the **writes**. Migration 0045 restricts `jarvis_app_runtime` UPDATE on `app.users` to the **self row only** (`USING (id = app.current_actor_user_id())`). Admin lifecycle transitions (approve/deactivate/promote/…) write **other users'** rows, which that policy forbids.

**Decision baked into this plan:** add one SECURITY DEFINER helper `app.current_actor_is_admin()` (owned by `jarvis_auth_runtime`, mirroring `app.count_all_users()`) plus one **admin-scoped UPDATE policy** on `app.users` for `jarvis_app_runtime`:

```sql
USING (app.current_actor_is_admin()) WITH CHECK (app.current_actor_is_admin())
```

Why this is safe and preserves the hard invariant ("no admin private-data bypass"):

- `app.users` holds **no secrets** (id/email/name/email_verified/image/is_instance_admin/status/is_bootstrap_owner). Managing those columns IS legitimate admin configuration power.
- Content tables (tasks, vault, memory, chat, connector creds, AI keys) keep their **own owner-only RLS** untouched. The admin-bypass negative test (Task 12) proves an admin still cannot read a peer's private content.
- The admin write path requires the actor GUC (`app.actor_user_id`) to be set to the admin's id inside the transaction; the helper reads it. Settings repo write methods don't set the GUC today (Task 7 adds it for the lifecycle methods only).

Session revocation (DELETE `app.better_auth_sessions`) is **not** reachable from `jarvis_app_runtime` at all (revoked + FORCE RLS in 0045) — it MUST go through `jarvis_auth_runtime` (Task 6). Full delete uses the bootstrap connection via `deleteUserData` (Task 8).

---

## Migration numbering (global, assigned at landing)

Migration numbers are **global and assigned by landing order** — never hardcode one in advance. Before creating the migration file (Task 1), run:

```bash
ls infra/postgres/migrations/ packages/*/sql/ 2>/dev/null | grep -oE '^[0-9]{4}' | sort -n | tail -1
```

Take the next integer, zero-padded to 4 digits. This plan writes the filename as **`<NNNN>`** — substitute the real number everywhere it appears. (At authoring time the last assigned was 0049, so the likely value is `0050`, but **verify** — sibling lanes may have landed migrations since.) Core `app.users` schema changes belong in `infra/postgres/migrations/` (as 0045/0046 did), NOT a module `sql/` dir. **Never edit an applied migration** — the runner hash-checks them.

---

## File Structure

| File | Responsibility | Action |
| ---- | -------------- | ------ |
| `infra/postgres/migrations/<NNNN>_multi_user_accounts.sql` | status + is_bootstrap_owner columns, CHECK, registration settings seed, `current_actor_is_admin()` helper, admin UPDATE policy | Create |
| `packages/db/src/types.ts` | add `status` + `is_bootstrap_owner` to `UsersTable` | Modify |
| `packages/shared/src/platform-api.ts` | extend `UserDto`/`userSchema`; new lifecycle + registration route schemas | Modify |
| `packages/auth/src/index.ts` | before-hook gate, status assignment in after-hook, status enforcement in `resolveRequestAccessContext`, `revokeUserSessions`, error classes | Modify |
| `packages/settings/src/repository.ts` | lifecycle write methods + guardrails + registration get/put | Modify |
| `packages/settings/src/routes.ts` | admin lifecycle + registration endpoints | Modify |
| `apps/api/src/server.ts` | thread `revokeUserSessions` into settings route deps | Modify |
| `apps/web/src/api/client.ts` | carry machine-readable `code` on `ApiError` | Modify |
| `apps/web/src/app.tsx` | pending / deactivated screens | Modify |
| `apps/web/src/` (admin settings section) | pending approvals list, users table w/ status + actions, registration toggles | Modify |
| `tests/integration/multi-user-isolation.test.ts` | exit-gate suite incl. admin-bypass negative test | Create |

Conventions chosen for this plan:
- **instance_settings keys:** `registration.enabled` and `registration.requires_approval`. Each row's `value` jsonb is `{ "value": <boolean> }` (uniform, matches `value: Record<string, unknown>` in `UpsertInstanceSettingInput`).
- **status values:** `'pending' | 'active' | 'deactivated'`, default `'active'`.
- **403 error codes (response body `code` field):** `account_pending`, `account_deactivated`, `registration_disabled`.

---

### Task 1: Migration + db types (columns, settings seed, RLS admin path)

**Files:**
- Create: `infra/postgres/migrations/<NNNN>_multi_user_accounts.sql`
- Modify: `packages/db/src/types.ts:27-44` (UsersTable)

- [ ] **Step 1: Add the two columns to the `UsersTable` type**

In `packages/db/src/types.ts`, inside `interface UsersTable` (after `is_instance_admin: boolean;`):

```typescript
  status: "pending" | "active" | "deactivated";
  is_bootstrap_owner: boolean;
```

- [ ] **Step 2: Determine the migration number**

Run: `ls infra/postgres/migrations/ packages/*/sql/ 2>/dev/null | grep -oE '^[0-9]{4}' | sort -n | tail -1`
Expected: prints the highest assigned number (e.g. `0049`). Add 1, zero-pad → that is `<NNNN>`.

- [ ] **Step 3: Write the migration file**

Create `infra/postgres/migrations/<NNNN>_multi_user_accounts.sql`:

```sql
-- Multi-user accounts (Phase 2 Slice A): account status lifecycle + registration levers.
--
-- 1. Adds app.users.status ('pending'|'active'|'deactivated') and is_bootstrap_owner.
-- 2. Seeds the two registration instance settings (idempotent).
-- 3. Adds app.current_actor_is_admin() SECURITY DEFINER (owned by jarvis_auth_runtime)
--    so jarvis_app_runtime can write OTHER users' rows when the actor is an active admin,
--    mirroring the app.count_all_users() pattern from 0045.
-- 4. Adds an admin-scoped UPDATE policy on app.users. See the plan's Security Decision:
--    app.users holds no secrets; content tables keep their own owner-only RLS.

-- 1. Columns. NOT NULL DEFAULT 'active' keeps every existing user active on upgrade.
ALTER TABLE app.users
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('pending', 'active', 'deactivated')),
  ADD COLUMN IF NOT EXISTS is_bootstrap_owner boolean NOT NULL DEFAULT false;

-- 2. Registration settings seed. ON CONFLICT DO NOTHING so re-runs never clobber operator edits.
INSERT INTO app.instance_settings (key, value, updated_by_user_id, created_at, updated_at)
VALUES
  ('registration.enabled', '{"value": true}'::jsonb, NULL, now(), now()),
  ('registration.requires_approval', '{"value": true}'::jsonb, NULL, now(), now())
ON CONFLICT (key) DO NOTHING;

-- 3. SECURITY DEFINER helper: is the current actor an ACTIVE instance admin?
--    Owned by jarvis_auth_runtime (USING(true) on users under FORCE RLS) so it sees the row
--    despite app_runtime's self-row restriction. Returns false when the actor GUC is unset.
CREATE OR REPLACE FUNCTION app.current_actor_is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = app, public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM app.users
    WHERE id = app.current_actor_user_id()
      AND is_instance_admin = true
      AND status = 'active'
  );
$$;

-- Transfer ownership to jarvis_auth_runtime and lock down EXECUTE (mirrors 0045 step 5).
GRANT CREATE ON SCHEMA app TO jarvis_auth_runtime;
ALTER FUNCTION app.current_actor_is_admin() OWNER TO jarvis_auth_runtime;
REVOKE CREATE ON SCHEMA app FROM jarvis_auth_runtime;
SET LOCAL ROLE jarvis_auth_runtime;
REVOKE EXECUTE ON FUNCTION app.current_actor_is_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.current_actor_is_admin() TO jarvis_app_runtime;
RESET ROLE;

-- 4. Admin-scoped UPDATE policy on app.users for jarvis_app_runtime. RLS combines permissive
--    policies with OR, so this ADDS to the existing self-row users_app_runtime_update policy:
--    an actor may update its own row OR (when it is an active admin) any row.
DROP POLICY IF EXISTS users_app_runtime_admin_update ON app.users;
CREATE POLICY users_app_runtime_admin_update
  ON app.users
  FOR UPDATE
  TO jarvis_app_runtime
  USING (app.current_actor_is_admin())
  WITH CHECK (app.current_actor_is_admin());
```

- [ ] **Step 4: Run the migration**

Run: `pnpm db:up && pnpm db:migrate`
Expected: migrations apply cleanly through `<NNNN>_multi_user_accounts`, exit code 0, no hash-mismatch error.

- [ ] **Step 5: Typecheck the db package**

Run: `pnpm typecheck`
Expected: PASS (the two new non-null `UsersTable` fields compile; downstream `User` selectables now include them).

- [ ] **Step 6: Commit**

```bash
git add infra/postgres/migrations/<NNNN>_multi_user_accounts.sql packages/db/src/types.ts
git commit -m "feat(db): multi-user account status + registration settings + admin RLS path"
```

---

### Task 2: Shared contracts (DTO + route schemas)

**Files:**
- Modify: `packages/shared/src/platform-api.ts:1-10` (UserDto), `:238-251` (userSchema), end of file (new route schemas)

- [ ] **Step 1: Extend `UserDto`**

In `packages/shared/src/platform-api.ts`, add to `interface UserDto` (after `isInstanceAdmin`):

```typescript
  readonly status: "pending" | "active" | "deactivated";
  readonly isBootstrapOwner: boolean;
```

- [ ] **Step 2: Extend `userSchema` (it uses `additionalProperties: false` — both the `required` array AND `properties` must be updated)**

```typescript
const userSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "id",
    "email",
    "name",
    "isInstanceAdmin",
    "status",
    "isBootstrapOwner",
    "createdAt",
    "updatedAt"
  ],
  properties: {
    id: { type: "string" },
    email: { type: "string" },
    name: { type: "string" },
    isInstanceAdmin: { type: "boolean" },
    status: { type: "string", enum: ["pending", "active", "deactivated"] },
    isBootstrapOwner: { type: "boolean" },
    createdAt: { type: "string" },
    updatedAt: { type: "string" }
  }
} as const;
```

- [ ] **Step 3: Add the lifecycle + registration route schemas + DTOs at the end of the file**

```typescript
export interface RegistrationSettingsDto {
  readonly registrationEnabled: boolean;
  readonly requiresApproval: boolean;
}

const registrationSettingsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["registrationEnabled", "requiresApproval"],
  properties: {
    registrationEnabled: { type: "boolean" },
    requiresApproval: { type: "boolean" }
  }
} as const;

// Admin lifecycle action on a single user: approve/reject/deactivate/reactivate/promote/demote.
// The :id path param identifies the target; the verb is the URL segment (see routes).
export const adminUserActionRouteSchema = {
  params: {
    type: "object",
    additionalProperties: false,
    required: ["id"],
    properties: { id: { type: "string" } }
  },
  response: {
    200: {
      type: "object",
      additionalProperties: false,
      required: ["user"],
      properties: { user: userSchema }
    },
    401: errorResponseSchema,
    403: errorResponseSchema,
    404: errorResponseSchema,
    409: errorResponseSchema,
    422: errorResponseSchema
  }
} as const;

export const adminDeleteUserRouteSchema = {
  params: {
    type: "object",
    additionalProperties: false,
    required: ["id"],
    properties: { id: { type: "string" } }
  },
  response: {
    200: {
      type: "object",
      additionalProperties: false,
      required: ["deletedUserId"],
      properties: { deletedUserId: { type: "string" } }
    },
    401: errorResponseSchema,
    403: errorResponseSchema,
    404: errorResponseSchema,
    409: errorResponseSchema,
    422: errorResponseSchema
  }
} as const;

// Reject deletes a pending registration — the user no longer exists, so we return the id only
// (NOT a user object). Mirrors adminDeleteUserRouteSchema with a distinct response key.
export const adminRejectUserRouteSchema = {
  params: {
    type: "object",
    additionalProperties: false,
    required: ["id"],
    properties: { id: { type: "string" } }
  },
  response: {
    200: {
      type: "object",
      additionalProperties: false,
      required: ["rejectedUserId"],
      properties: { rejectedUserId: { type: "string" } }
    },
    401: errorResponseSchema,
    403: errorResponseSchema,
    404: errorResponseSchema,
    409: errorResponseSchema,
    422: errorResponseSchema
  }
} as const;

export const getRegistrationSettingsRouteSchema = {
  response: {
    200: registrationSettingsSchema,
    401: errorResponseSchema,
    403: errorResponseSchema
  }
} as const;

export const putRegistrationSettingsRouteSchema = {
  body: registrationSettingsSchema,
  response: {
    200: registrationSettingsSchema,
    401: errorResponseSchema,
    403: errorResponseSchema
  }
} as const;
```

- [ ] **Step 4: Typecheck**

Run: `pnpm typecheck`
Expected: PASS. (Adding required fields to `UserDto` will surface every place that constructs a `UserDto` — those are fixed in Task 8's serializer; if any other call site breaks now, note it and fix in its owning task.)

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/platform-api.ts
git commit -m "feat(shared): user status fields + admin lifecycle/registration route schemas"
```

---

### Task 3: Auth — registration gate (before hook)

**Files:**
- Modify: `packages/auth/src/index.ts` (add `before` hook; add a settings reader helper)
- Test: `tests/integration/auth-settings.test.ts` (add cases) — or a new `tests/integration/registration-gate.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `tests/integration/auth-settings.test.ts` (follow the existing setup: `resetEmptyFoundationDatabase`, injected `createApiServer`, `cookieHeader`):

```typescript
it("rejects sign-up with 403 registration_disabled when registration is disabled", async () => {
  // First user becomes the admin; bootstrap always succeeds regardless of the toggle.
  const admin = await signUp(server, { name: "Admin", email: "admin@example.com", password: "password12345" });
  const adminCookie = cookieHeader(admin.headers);

  // Admin disables registration.
  const put = await server.inject({
    method: "PUT",
    url: "/api/admin/registration",
    headers: { "content-type": "application/json", cookie: adminCookie },
    payload: { registrationEnabled: false, requiresApproval: true }
  });
  expect(put.statusCode).toBe(200);

  // A second sign-up is now refused.
  const blocked = await server.inject({
    method: "POST",
    url: "/api/auth/sign-up/email",
    headers: { "content-type": "application/json" },
    payload: { name: "Late", email: "late@example.com", password: "password12345" }
  });
  expect(blocked.statusCode).toBe(403);
  expect(blocked.json<{ code?: string }>().code).toBe("registration_disabled");
});
```

(If `signUp`/`cookieHeader` helpers are not yet shared in this file, define `signUp` as a thin wrapper over the existing `server.inject` sign-up call already used in this suite.)

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm test:integration -- tests/integration/auth-settings.test.ts -t "registration_disabled"`
Expected: FAIL — sign-up currently returns 200 (no gate). The PUT route also doesn't exist yet, so the test fails before the assertion; that's fine — it proves the gate is absent. (The PUT route lands in Task 8; until then this test will fail at the PUT. Mark this test `.skip` is NOT allowed — instead, order execution so Task 8 completes the green. If running strictly task-by-task, assert only the gate here by seeding the setting directly via SQL; see alternative below.)

Alternative gate-only failing test (no dependency on Task 8's PUT route) — seed the setting directly:

```typescript
it("rejects sign-up with 403 when registration.enabled is false (seeded directly)", async () => {
  await signUp(server, { name: "Admin", email: "admin@example.com", password: "password12345" });
  await appDb
    .updateTable("app.instance_settings")
    .set({ value: { value: false }, updated_at: new Date() })
    .where("key", "=", "registration.enabled")
    .execute();

  const blocked = await server.inject({
    method: "POST",
    url: "/api/auth/sign-up/email",
    headers: { "content-type": "application/json" },
    payload: { name: "Late", email: "late@example.com", password: "password12345" }
  });
  expect(blocked.statusCode).toBe(403);
  expect(blocked.json<{ code?: string }>().code).toBe("registration_disabled");
});
```

Use this alternative for strict TDD ordering; keep the PUT-driven test for Task 8.

- [ ] **Step 3: Implement the before-hook gate**

In `packages/auth/src/index.ts`, add a settings reader and wire the `before` hook. Add near the top-level helpers:

```typescript
import { APIError } from "better-auth/api";

async function readBooleanSetting(
  appDb: Kysely<JarvisDatabase>,
  key: string,
  fallback: boolean
): Promise<boolean> {
  const row = await appDb
    .selectFrom("app.instance_settings")
    .select("value")
    .where("key", "=", key)
    .executeTakeFirst();
  const value = (row?.value as { value?: unknown } | undefined)?.value;
  return typeof value === "boolean" ? value : fallback;
}

async function isFirstUser(appDb: Kysely<JarvisDatabase>): Promise<boolean> {
  const result = await sql<{ count: string }>`SELECT app.count_all_users() AS count`.execute(appDb);
  return Number(result.rows[0]?.count ?? 0) === 0;
}
```

Then in `createBetterAuthOptions`, extend `databaseHooks.user.create`:

```typescript
    databaseHooks: {
      user: {
        create: {
          before: async (user) => {
            // The very first user (instance bootstrap) is always allowed — otherwise a fresh
            // instance with registration pre-disabled could never create its owner.
            if (await isFirstUser(appDb)) {
              return { data: user };
            }
            const enabled = await readBooleanSetting(appDb, "registration.enabled", true);
            if (!enabled) {
              throw new APIError("FORBIDDEN", {
                code: "registration_disabled",
                message: "Registration is disabled for this instance"
              });
            }
            return { data: user };
          },
          after: (user) => bootstrapFirstJarvisUser(appDb, user)
        }
      }
    },
```

Note on response shape: better-auth serializes a thrown `APIError` to the HTTP status + a JSON body. Verify the body carries `code` (the `handleBetterAuthRequest` passthrough in `apps/api/src/server.ts` forwards the body verbatim). If this better-auth version nests the code differently, adjust the test's accessor to match the actual body — but keep the HTTP status at 403.

- [ ] **Step 4: Run the gate test**

Run: `pnpm test:integration -- tests/integration/auth-settings.test.ts -t "registration.enabled is false"`
Expected: PASS (403 + `registration_disabled`).

- [ ] **Step 5: Commit**

```bash
git add packages/auth/src/index.ts tests/integration/auth-settings.test.ts
git commit -m "feat(auth): gate self-registration on registration.enabled setting"
```

---

### Task 4: Auth — status assignment (after hook)

**Files:**
- Modify: `packages/auth/src/index.ts:233-307` (`bootstrapFirstJarvisUser`)
- Test: `tests/integration/auth-settings.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
it("assigns status by registration mode: first user active+admin+bootstrap_owner, later users pending when approval required", async () => {
  const admin = await signUp(server, { name: "Admin", email: "admin@example.com", password: "password12345" });
  const adminId = admin.json<{ user: { id: string } }>().user.id;

  const adminRow = await appDb.selectFrom("app.users").selectAll().where("id", "=", adminId).executeTakeFirstOrThrow();
  expect(adminRow.status).toBe("active");
  expect(adminRow.is_instance_admin).toBe(true);
  expect(adminRow.is_bootstrap_owner).toBe(true);

  // requires_approval defaults to true → second user is pending.
  const member = await signUp(server, { name: "Member", email: "member@example.com", password: "password12345" });
  const memberId = member.json<{ user: { id: string } }>().user.id;
  const memberRow = await appDb.selectFrom("app.users").selectAll().where("id", "=", memberId).executeTakeFirstOrThrow();
  expect(memberRow.status).toBe("pending");
  expect(memberRow.is_instance_admin).toBe(false);
  expect(memberRow.is_bootstrap_owner).toBe(false);
});

it("assigns active to later users when requires_approval is false", async () => {
  await signUp(server, { name: "Admin", email: "admin@example.com", password: "password12345" });
  await appDb
    .updateTable("app.instance_settings")
    .set({ value: { value: false }, updated_at: new Date() })
    .where("key", "=", "registration.requires_approval")
    .execute();

  const member = await signUp(server, { name: "Member", email: "member@example.com", password: "password12345" });
  const memberId = member.json<{ user: { id: string } }>().user.id;
  const memberRow = await appDb.selectFrom("app.users").selectAll().where("id", "=", memberId).executeTakeFirstOrThrow();
  expect(memberRow.status).toBe("active");
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `pnpm test:integration -- tests/integration/auth-settings.test.ts -t "assigns status by registration mode"`
Expected: FAIL — status is the column default `'active'` for everyone and `is_bootstrap_owner` is `false` for the admin.

- [ ] **Step 3: Implement status assignment in `bootstrapFirstJarvisUser`**

Replace the UPDATE block and add the approval read. The function already computes `isFirstUser` from `app.count_all_users()` and sets the actor GUC. Modify:

```typescript
    const isFirstUser = Number(countResult.rows[0]?.count ?? 0) === 1;

    // Status: first user is always active + admin + bootstrap owner. Later users are pending
    // only when approval is required; otherwise active immediately.
    let status: "pending" | "active" = "active";
    if (!isFirstUser) {
      const requiresApprovalRow = await sql<{ value: { value?: unknown } | null }>`
        SELECT value FROM app.instance_settings WHERE key = 'registration.requires_approval'
      `.execute(transaction);
      const requiresApproval =
        typeof requiresApprovalRow.rows[0]?.value?.value === "boolean"
          ? (requiresApprovalRow.rows[0]?.value?.value as boolean)
          : true;
      status = requiresApproval ? "pending" : "active";
    }

    await sql`SELECT set_config('app.actor_user_id', ${user.id}, true)`.execute(transaction);

    await transaction
      .updateTable("app.users")
      .set({
        name: user.name ?? "",
        email: user.email,
        is_instance_admin: isFirstUser,
        is_bootstrap_owner: isFirstUser,
        status,
        updated_at: new Date()
      })
      .where("id", "=", user.id)
      .execute();
```

(Leave the first-user workspace + audit block unchanged below this.)

- [ ] **Step 4: Run the tests**

Run: `pnpm test:integration -- tests/integration/auth-settings.test.ts -t "assigns"`
Expected: PASS (both cases).

- [ ] **Step 5: Commit**

```bash
git add packages/auth/src/index.ts tests/integration/auth-settings.test.ts
git commit -m "feat(auth): assign account status + bootstrap-owner flag on user create"
```

---

### Task 5: Auth — access enforcement (resolveRequestAccessContext)

**Files:**
- Modify: `packages/auth/src/index.ts` (error classes + `resolveRequestAccessContext` + thread `appDb`)
- Test: `tests/integration/auth-settings.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
it("blocks a pending account from authenticated routes with 403 account_pending", async () => {
  await signUp(server, { name: "Admin", email: "admin@example.com", password: "password12345" });
  const member = await signUp(server, { name: "Member", email: "member@example.com", password: "password12345" });
  const memberCookie = cookieHeader(member.headers); // pending by default

  const res = await server.inject({ method: "GET", url: "/api/me", headers: { cookie: memberCookie } });
  expect(res.statusCode).toBe(403);
  expect(res.json<{ code?: string }>().code).toBe("account_pending");
});

it("blocks a deactivated account with 403 account_deactivated", async () => {
  await signUp(server, { name: "Admin", email: "admin@example.com", password: "password12345" });
  const member = await signUp(server, { name: "Member", email: "member@example.com", password: "password12345" });
  const memberId = member.json<{ user: { id: string } }>().user.id;
  const memberCookie = cookieHeader(member.headers);
  // Force active→deactivated directly (lifecycle routes are Task 8).
  await appDb.updateTable("app.users").set({ status: "deactivated" }).where("id", "=", memberId).execute();

  const res = await server.inject({ method: "GET", url: "/api/me", headers: { cookie: memberCookie } });
  expect(res.statusCode).toBe(403);
  expect(res.json<{ code?: string }>().code).toBe("account_deactivated");
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `pnpm test:integration -- tests/integration/auth-settings.test.ts -t "account_pending"`
Expected: FAIL — `/api/me` returns 200; no status check exists.

- [ ] **Step 3: Add typed error classes (exported) near the top of `packages/auth/src/index.ts`**

```typescript
export class AccountPendingApprovalError extends Error {
  readonly code = "account_pending";
  constructor() {
    super("Account is awaiting administrator approval");
  }
}

export class AccountDeactivatedError extends Error {
  readonly code = "account_deactivated";
  constructor() {
    super("Account is no longer active");
  }
}
```

- [ ] **Step 4: Enforce status in `resolveRequestAccessContext` (both better-auth and bearer paths)**

Thread `appDb` into the resolver. Change the call site in `createJarvisAuthRuntime`:

```typescript
    resolveAccessContext: (request) =>
      resolveRequestAccessContext({
        request,
        auth,
        legacySessions,
        appDb: options.appDb
      }),
```

Update the function:

```typescript
async function resolveRequestAccessContext(options: {
  readonly request: RequestAccessContextInput;
  readonly auth: ReturnType<typeof betterAuth>;
  readonly legacySessions: AuthSessionResolver;
  readonly appDb: Kysely<JarvisDatabase>;
}): Promise<AccessContext> {
  const requestId = options.request.id ?? randomUUID();
  const headers = toWebHeaders(options.request.headers);
  const bearerToken = readBearerToken(headers);

  let actorUserId: string;
  if (bearerToken) {
    const ctx = await options.legacySessions.resolveAccessContext(bearerToken, requestId);
    actorUserId = ctx.actorUserId;
  } else {
    const session = await options.auth.api.getSession({ headers });
    if (!session) {
      throw new Error("Session is missing or expired");
    }
    actorUserId = session.user.id;
  }

  await assertAccountActive(options.appDb, actorUserId);
  return { actorUserId, requestId };
}

async function assertAccountActive(
  appDb: Kysely<JarvisDatabase>,
  actorUserId: string
): Promise<void> {
  const row = await appDb
    .selectFrom("app.users")
    .select("status")
    .where("id", "=", actorUserId)
    .executeTakeFirst();
  if (row?.status === "pending") {
    throw new AccountPendingApprovalError();
  }
  if (row?.status === "deactivated") {
    throw new AccountDeactivatedError();
  }
}
```

- [ ] **Step 5: Map the new errors to 403 + code at every resolveAccessContext caller**

The errors must reach the client as HTTP 403 with the `code`. There are two surfaces:

(a) `apps/api/src/server.ts` `registerPlatformRoutes` → `/api/modules` currently `catch { return reply.code(401)... }`. Generalize its catch:

```typescript
    } catch (error) {
      return replyForAuthError(error, reply);
    }
```

Add a shared helper in `apps/api/src/server.ts`:

```typescript
function replyForAuthError(error: unknown, reply: FastifyReply) {
  if (error instanceof Error && "code" in error) {
    const code = (error as { code: unknown }).code;
    if (code === "account_pending" || code === "account_deactivated") {
      return reply.code(403).send({ error: error.message, code });
    }
  }
  return reply.code(401).send({ error: "Session is missing or expired" });
}
```

(b) Module/settings routes go through `handleRouteError` in `packages/settings/src/routes.ts` (and the module-registry equivalent). Extend `handleRouteError` to recognize the codes — see Task 8 Step 4. For `/api/me` specifically, find its handler (in the module-registry or platform routes) and ensure its catch uses the same code-aware mapping. Locate it:

Run: `grep -rn '"/api/me"\|/api/me' packages/ apps/`
Then apply the same `replyForAuthError` style (403 + code) to that handler's catch.

- [ ] **Step 6: Run the tests**

Run: `pnpm test:integration -- tests/integration/auth-settings.test.ts -t "account_"`
Expected: PASS (both pending and deactivated).

- [ ] **Step 7: Commit**

```bash
git add packages/auth/src/index.ts apps/api/src/server.ts
git commit -m "feat(auth): enforce account status during access-context resolution"
```

---

### Task 6: Auth — session revocation via auth runtime

**Files:**
- Modify: `packages/auth/src/index.ts` (add `revokeUserSessions` to `JarvisAuthRuntime`)
- Test: `tests/integration/auth-settings.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
it("revokeUserSessions deletes all of a user's sessions", async () => {
  const member = await signUp(server, { name: "Member", email: "member@example.com", password: "password12345" });
  const memberId = member.json<{ user: { id: string } }>().user.id;

  const before = await appDb.selectFrom("app.better_auth_sessions").select("id").where("user_id", "=", memberId).execute();
  expect(before.length).toBeGreaterThan(0);

  const deleted = await authRuntime.revokeUserSessions(memberId);
  expect(deleted).toBeGreaterThanOrEqual(before.length);

  // Verify via the auth runtime pool path (app_runtime cannot read better_auth_sessions).
  const remaining = await authRuntime.revokeUserSessions(memberId);
  expect(remaining).toBe(0);
});
```

This test needs an `authRuntime` handle. In setup, build it explicitly and pass into `createApiServer`:

```typescript
authRuntime = createJarvisAuthRuntime({ appDb });
server = createApiServer({ appDb, authRuntime, logger: false });
```

(Import `createJarvisAuthRuntime` from `@jarv1s/auth`.)

- [ ] **Step 2: Run to confirm failure**

Run: `pnpm test:integration -- tests/integration/auth-settings.test.ts -t "revokeUserSessions"`
Expected: FAIL — `revokeUserSessions` is not a function on the runtime.

- [ ] **Step 3: Implement `revokeUserSessions` on the runtime (uses the auth pool = jarvis_auth_runtime, the only role that can write better_auth_sessions)**

Add to the `JarvisAuthRuntime` interface:

```typescript
  readonly revokeUserSessions: (userId: string) => Promise<number>;
```

In `createJarvisAuthRuntime`, add to the returned object:

```typescript
    revokeUserSessions: async (userId: string) => {
      const result = await pool.query(
        "DELETE FROM app.better_auth_sessions WHERE user_id = $1",
        [userId]
      );
      return result.rowCount ?? 0;
    },
```

- [ ] **Step 4: Run the test**

Run: `pnpm test:integration -- tests/integration/auth-settings.test.ts -t "revokeUserSessions"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/auth/src/index.ts tests/integration/auth-settings.test.ts
git commit -m "feat(auth): add revokeUserSessions on the auth runtime"
```

---

### Task 7: Settings repository — lifecycle methods + guardrails + registration get/put

**Files:**
- Modify: `packages/settings/src/repository.ts`
- Test: `tests/integration/auth-settings.test.ts` (repository-level cases via the running server are added in Task 8; this task's tests exercise guardrails through the routes — so write the repo code here and assert it in Task 8). To keep TDD honest, add a focused repo guardrail unit-style test in this task using `appDb` directly.

- [ ] **Step 1: Write the failing guardrail test**

```typescript
it("repository blocks demoting the last active admin", async () => {
  const admin = await signUp(server, { name: "Admin", email: "admin@example.com", password: "password12345" });
  const adminId = admin.json<{ user: { id: string } }>().user.id;
  const repo = new SettingsRepository(appDb);
  await expect(repo.setUserAdmin({ targetUserId: adminId, isInstanceAdmin: false, actorUserId: adminId, requestId: "r1" }))
    .rejects.toThrow(/last.*admin/i);
});
```

(Import `SettingsRepository` from `@jarv1s/settings` or its source path used elsewhere in tests.)

- [ ] **Step 2: Run to confirm failure**

Run: `pnpm test:integration -- tests/integration/auth-settings.test.ts -t "last active admin"`
Expected: FAIL — `setUserAdmin` does not exist.

- [ ] **Step 3: Implement the lifecycle methods + guardrails**

Add to `packages/settings/src/repository.ts`. First, input types near the other interfaces:

```typescript
export interface SetUserStatusInput {
  readonly targetUserId: string;
  readonly status: "pending" | "active" | "deactivated";
  readonly action: string; // audit action label, e.g. "user.approve"
  readonly actorUserId: string;
  readonly requestId: string;
}

export interface SetUserAdminInput {
  readonly targetUserId: string;
  readonly isInstanceAdmin: boolean;
  readonly actorUserId: string;
  readonly requestId: string;
}

export interface RegistrationSettings {
  readonly registrationEnabled: boolean;
  readonly requiresApproval: boolean;
}
```

Then the methods. The admin write path sets the actor GUC inside the transaction so the new `users_app_runtime_admin_update` policy applies:

```typescript
  async setUserStatus(input: SetUserStatusInput): Promise<User> {
    return this.db.transaction().execute(async (transaction) => {
      await sql`SELECT set_config('app.actor_user_id', ${input.actorUserId}, true)`.execute(transaction);

      const target = await this.requireUserRow(input.targetUserId, transaction);

      // Bootstrap-owner protection: the bootstrap owner cannot be deactivated by anyone.
      if (target.is_bootstrap_owner && input.status === "deactivated") {
        throw new HttpRepositoryError(409, "The bootstrap owner cannot be deactivated");
      }
      // No self-lockout: an admin cannot deactivate their own account.
      if (input.status === "deactivated" && input.targetUserId === input.actorUserId) {
        throw new HttpRepositoryError(422, "You cannot deactivate your own account");
      }
      // At-least-one-active-admin: deactivating an admin must leave another active admin.
      if (input.status === "deactivated" && target.is_instance_admin) {
        await this.assertAnotherActiveAdmin(transaction, input.targetUserId);
      }

      const updated = await transaction
        .updateTable("app.users")
        .set({ status: input.status, updated_at: new Date() })
        .where("id", "=", input.targetUserId)
        .returningAll()
        .executeTakeFirstOrThrow();

      await this.insertAuditEvent(transaction, {
        actorUserId: input.actorUserId,
        action: input.action,
        targetType: "user",
        targetId: input.targetUserId,
        metadata: { status: input.status },
        requestId: input.requestId
      });

      return updated;
    });
  }

  async setUserAdmin(input: SetUserAdminInput): Promise<User> {
    return this.db.transaction().execute(async (transaction) => {
      await sql`SELECT set_config('app.actor_user_id', ${input.actorUserId}, true)`.execute(transaction);

      const target = await this.requireUserRow(input.targetUserId, transaction);

      // Demotion guardrails: cannot demote the bootstrap owner; cannot demote the last active admin.
      if (!input.isInstanceAdmin) {
        if (target.is_bootstrap_owner) {
          throw new HttpRepositoryError(409, "The bootstrap owner cannot be demoted");
        }
        if (target.is_instance_admin) {
          await this.assertAnotherActiveAdmin(transaction, input.targetUserId);
        }
      }

      const updated = await transaction
        .updateTable("app.users")
        .set({ is_instance_admin: input.isInstanceAdmin, updated_at: new Date() })
        .where("id", "=", input.targetUserId)
        .returningAll()
        .executeTakeFirstOrThrow();

      await this.insertAuditEvent(transaction, {
        actorUserId: input.actorUserId,
        action: input.isInstanceAdmin ? "user.promote" : "user.demote",
        targetType: "user",
        targetId: input.targetUserId,
        metadata: { isInstanceAdmin: input.isInstanceAdmin },
        requestId: input.requestId
      });

      return updated;
    });
  }

  async getRegistrationSettings(): Promise<RegistrationSettings> {
    const rows = await this.db
      .selectFrom("app.instance_settings")
      .select(["key", "value"])
      .where("key", "in", ["registration.enabled", "registration.requires_approval"])
      .execute();
    const read = (key: string, fallback: boolean): boolean => {
      const value = (rows.find((r) => r.key === key)?.value as { value?: unknown } | undefined)?.value;
      return typeof value === "boolean" ? value : fallback;
    };
    return {
      registrationEnabled: read("registration.enabled", true),
      requiresApproval: read("registration.requires_approval", true)
    };
  }

  async setRegistrationSettings(
    input: RegistrationSettings & { actorUserId: string; requestId: string }
  ): Promise<RegistrationSettings> {
    await this.upsertInstanceSetting({
      key: "registration.enabled",
      value: { value: input.registrationEnabled },
      updatedByUserId: input.actorUserId,
      requestId: input.requestId
    });
    await this.upsertInstanceSetting({
      key: "registration.requires_approval",
      value: { value: input.requiresApproval },
      updatedByUserId: input.actorUserId,
      requestId: input.requestId
    });
    return { registrationEnabled: input.registrationEnabled, requiresApproval: input.requiresApproval };
  }
```

Add the private helpers (place beside `requireUser`/`assertWorkspaceHasAnotherOwner`):

```typescript
  private async requireUserRow(userId: string, db: SettingsDb = this.db): Promise<User> {
    const user = await db.selectFrom("app.users").selectAll().where("id", "=", userId).executeTakeFirst();
    if (!user) {
      throw new HttpRepositoryError(404, "User not found");
    }
    return user;
  }

  private async assertAnotherActiveAdmin(db: SettingsDb, excludingUserId: string): Promise<void> {
    const other = await db
      .selectFrom("app.users")
      .select("id")
      .where("is_instance_admin", "=", true)
      .where("status", "=", "active")
      .where("id", "!=", excludingUserId)
      .executeTakeFirst();
    if (!other) {
      throw new HttpRepositoryError(409, "At least one active admin must remain");
    }
  }
```

And a small typed error the routes can translate to HTTP status (mirrors the route layer's `HttpError`; keeping it in the repo keeps guardrails self-contained):

```typescript
export class HttpRepositoryError extends Error {
  constructor(readonly statusCode: number, message: string) {
    super(message);
  }
}
```

- [ ] **Step 4: Run the guardrail test**

Run: `pnpm test:integration -- tests/integration/auth-settings.test.ts -t "last active admin"`
Expected: PASS.

- [ ] **Step 5: Typecheck + commit**

Run: `pnpm typecheck`
Expected: PASS.

```bash
git add packages/settings/src/repository.ts tests/integration/auth-settings.test.ts
git commit -m "feat(settings): user lifecycle + registration repository methods with guardrails"
```

---

### Task 8: Settings routes — admin lifecycle + registration endpoints

**Files:**
- Modify: `packages/settings/src/routes.ts`
- Modify: `apps/api/src/server.ts` (thread `revokeUserSessions` + bootstrap connection into settings deps — see Task 9)
- Test: `tests/integration/auth-settings.test.ts`

Route table (all `requireAdmin`-gated, all audit-logged via the repo):

| Method | Path | Repo call | Notes |
| ------ | ---- | --------- | ----- |
| POST | `/api/admin/users/:id/approve` | `setUserStatus(status:'active', action:'user.approve')` | target must be `pending` (else 409) |
| POST | `/api/admin/users/:id/reject` | `deleteUserData` (bootstrap) | target must be `pending` (else 409); cascade-deletes the registration |
| POST | `/api/admin/users/:id/deactivate` | `setUserStatus(status:'deactivated', action:'user.deactivate')` then `revokeUserSessions` | guardrails in repo |
| POST | `/api/admin/users/:id/reactivate` | `setUserStatus(status:'active', action:'user.reactivate')` | |
| POST | `/api/admin/users/:id/promote` | `setUserAdmin(isInstanceAdmin:true)` | |
| POST | `/api/admin/users/:id/demote` | `setUserAdmin(isInstanceAdmin:false)` | guardrails in repo |
| DELETE | `/api/admin/users/:id` | `deleteUserData` (bootstrap) | full teardown |
| GET | `/api/admin/registration` | `getRegistrationSettings` | |
| PUT | `/api/admin/registration` | `setRegistrationSettings` | |

- [ ] **Step 1: Write the failing route tests (lifecycle happy paths + the admin-only gate)**

```typescript
it("admin approves a pending user, who can then access /api/me", async () => {
  const admin = await signUp(server, { name: "Admin", email: "admin@example.com", password: "password12345" });
  const adminCookie = cookieHeader(admin.headers);
  const member = await signUp(server, { name: "Member", email: "member@example.com", password: "password12345" });
  const memberId = member.json<{ user: { id: string } }>().user.id;
  const memberCookie = cookieHeader(member.headers);

  const approve = await server.inject({
    method: "POST",
    url: `/api/admin/users/${memberId}/approve`,
    headers: { cookie: adminCookie }
  });
  expect(approve.statusCode).toBe(200);
  expect(approve.json<{ user: { status: string } }>().user.status).toBe("active");

  const me = await server.inject({ method: "GET", url: "/api/me", headers: { cookie: memberCookie } });
  expect(me.statusCode).toBe(200);
});

it("non-admin cannot call lifecycle routes (403)", async () => {
  const admin = await signUp(server, { name: "Admin", email: "admin@example.com", password: "password12345" });
  const adminId = admin.json<{ user: { id: string } }>().user.id;
  // Approve a member, then have them try to act as admin.
  const member = await signUp(server, { name: "Member", email: "member@example.com", password: "password12345" });
  const memberId = member.json<{ user: { id: string } }>().user.id;
  const adminCookie = cookieHeader(admin.headers);
  await server.inject({ method: "POST", url: `/api/admin/users/${memberId}/approve`, headers: { cookie: adminCookie } });
  // Re-sign-in member to get a fresh active session cookie.
  const memberSignIn = await server.inject({
    method: "POST",
    url: "/api/auth/sign-in/email",
    headers: { "content-type": "application/json" },
    payload: { email: "member@example.com", password: "password12345" }
  });
  const memberCookie = cookieHeader(memberSignIn.headers);
  const res = await server.inject({ method: "POST", url: `/api/admin/users/${adminId}/demote`, headers: { cookie: memberCookie } });
  expect(res.statusCode).toBe(403);
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `pnpm test:integration -- tests/integration/auth-settings.test.ts -t "admin approves a pending user"`
Expected: FAIL — routes return 404 (not registered).

- [ ] **Step 3: Register the routes in `packages/settings/src/routes.ts`**

Extend `SettingsRoutesDependencies` with the two new collaborators:

```typescript
export interface SettingsRoutesDependencies {
  readonly appDb: Kysely<JarvisDatabase>;
  readonly resolveAccessContext: (request: RequestAccessContextInput) => Promise<AccessContext>;
  readonly listConfiguredAuthProviders?: () => readonly AuthProviderStatusDto[];
  readonly repository?: SettingsRepository;
  // New:
  readonly revokeUserSessions?: (userId: string) => Promise<number>;
  readonly bootstrapConnectionString?: string;
}
```

Add a small lifecycle-action handler factory and the routes (inside the same registration function that already adds the admin routes). Example for the status-transition verbs:

```typescript
  const lifecycleAction = (
    verb: string,
    status: "active" | "deactivated",
    action: string
  ) =>
    server.post(`/api/admin/users/:id/${verb}`, { schema: adminUserActionRouteSchema }, async (request, reply) => {
      try {
        const accessContext = await requireAdmin(request, dependencies, repository);
        const { id } = request.params as { id: string };
        const user = await repository.setUserStatus({
          targetUserId: id,
          status,
          action,
          actorUserId: accessContext.actorUserId,
          requestId: accessContext.requestId
        });
        if (verb === "deactivate" && dependencies.revokeUserSessions) {
          await dependencies.revokeUserSessions(id);
        }
        return { user: serializeUser(user) };
      } catch (error) {
        return handleRouteError(error, reply);
      }
    });

  lifecycleAction("approve", "active", "user.approve");
  lifecycleAction("reactivate", "active", "user.reactivate");
  lifecycleAction("deactivate", "deactivated", "user.deactivate");
```

`approve` should additionally reject a non-pending target. Add a guard before the call (read the row; 409 if `status !== 'pending'`) OR keep `setUserStatus` idempotent and accept re-approval. **Decision:** keep `approve` strict — add to `setUserStatus` an optional `requirePreviousStatus?: "pending"` check, or guard in the route. Simplest: guard in the `approve`-only path:

```typescript
  // Replace the generic approve registration with a strict one:
  server.post("/api/admin/users/:id/approve", { schema: adminUserActionRouteSchema }, async (request, reply) => {
    try {
      const accessContext = await requireAdmin(request, dependencies, repository);
      const { id } = request.params as { id: string };
      const existing = await repository.getUserById(id);
      if (!existing) throw new HttpError(404, "User not found");
      if (existing.status !== "pending") throw new HttpError(409, "Only pending accounts can be approved");
      const user = await repository.setUserStatus({
        targetUserId: id, status: "active", action: "user.approve",
        actorUserId: accessContext.actorUserId, requestId: accessContext.requestId
      });
      return { user: serializeUser(user) };
    } catch (error) {
      return handleRouteError(error, reply);
    }
  });
```

(Remove `"approve"` from the `lifecycleAction` calls above so it isn't double-registered.)

Promote/demote:

```typescript
  const adminFlagAction = (verb: "promote" | "demote", isInstanceAdmin: boolean) =>
    server.post(`/api/admin/users/:id/${verb}`, { schema: adminUserActionRouteSchema }, async (request, reply) => {
      try {
        const accessContext = await requireAdmin(request, dependencies, repository);
        const { id } = request.params as { id: string };
        const user = await repository.setUserAdmin({
          targetUserId: id,
          isInstanceAdmin,
          actorUserId: accessContext.actorUserId,
          requestId: accessContext.requestId
        });
        return { user: serializeUser(user) };
      } catch (error) {
        return handleRouteError(error, reply);
      }
    });
  adminFlagAction("promote", true);
  adminFlagAction("demote", false);
```

Reject + delete (both via `deleteUserData`, bootstrap connection):

Both reuse `deleteUserData`, but their response **contracts differ** — reject returns `{ rejectedUserId }`, delete returns `{ deletedUserId }` (the user no longer exists in either case, so neither returns a `user` object). Register them separately so each binds its correct schema:

```typescript
  async function tearDownAccount(
    request: FastifyRequest,
    id: string,
    requireePending: boolean
  ): Promise<string> {
    const accessContext = await requireAdmin(request, dependencies, repository);
    const existing = await repository.getUserById(id);
    if (!existing) throw new HttpError(404, "User not found");
    if (requireePending && existing.status !== "pending") {
      throw new HttpError(409, "Only pending accounts can be rejected");
    }
    if (id === accessContext.actorUserId) throw new HttpError(422, "You cannot delete your own account");
    await deleteUserData({
      userId: id,
      confirmUserId: id,
      actorUserId: accessContext.actorUserId,
      requestId: accessContext.requestId,
      bootstrapConnectionString: dependencies.bootstrapConnectionString
    });
    return id;
  }

  server.post("/api/admin/users/:id/reject", { schema: adminRejectUserRouteSchema }, async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const rejectedUserId = await tearDownAccount(request, id, true);
      return { rejectedUserId };
    } catch (error) {
      return handleRouteError(error, reply);
    }
  });

  server.delete("/api/admin/users/:id", { schema: adminDeleteUserRouteSchema }, async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const deletedUserId = await tearDownAccount(request, id, false);
      return { deletedUserId };
    } catch (error) {
      return handleRouteError(error, reply);
    }
  });
```

(Import `adminRejectUserRouteSchema` alongside the other route schemas — it was added in Task 2.)

Registration get/put:

```typescript
  server.get("/api/admin/registration", { schema: getRegistrationSettingsRouteSchema }, async (request, reply) => {
    try {
      await requireAdmin(request, dependencies, repository);
      return await repository.getRegistrationSettings();
    } catch (error) {
      return handleRouteError(error, reply);
    }
  });

  server.put("/api/admin/registration", { schema: putRegistrationSettingsRouteSchema }, async (request, reply) => {
    try {
      const accessContext = await requireAdmin(request, dependencies, repository);
      const body = request.body as { registrationEnabled: boolean; requiresApproval: boolean };
      return await repository.setRegistrationSettings({
        registrationEnabled: body.registrationEnabled,
        requiresApproval: body.requiresApproval,
        actorUserId: accessContext.actorUserId,
        requestId: accessContext.requestId
      });
    } catch (error) {
      return handleRouteError(error, reply);
    }
  });
```

- [ ] **Step 4: Extend `serializeUser` and `handleRouteError`**

`serializeUser` (in settings routes — the function building `UserDto`): add the new fields:

```typescript
function serializeUser(user: User): UserDto {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    isInstanceAdmin: user.is_instance_admin,
    status: user.status,
    isBootstrapOwner: user.is_bootstrap_owner,
    createdAt: user.created_at.toISOString(),
    updatedAt: user.updated_at.toISOString()
  };
}
```

`handleRouteError`: translate the repo's `HttpRepositoryError` (and the auth status codes, for any settings route that resolves access context):

```typescript
  if (error instanceof HttpRepositoryError) {
    return reply.code(error.statusCode).send({ error: error.message });
  }
  if (error instanceof Error && "code" in error) {
    const code = (error as { code: unknown }).code;
    if (code === "account_pending" || code === "account_deactivated") {
      return reply.code(403).send({ error: error.message, code });
    }
  }
```

(Import `HttpRepositoryError` from the repository module.)

- [ ] **Step 5: Wire the new deps in `apps/api/src/server.ts`** — see Task 9 (do that task now, then return).

- [ ] **Step 6: Run the route tests**

Run: `pnpm test:integration -- tests/integration/auth-settings.test.ts`
Expected: PASS (approve happy path, non-admin 403, plus the gate test from Task 3's PUT-driven variant).

- [ ] **Step 7: Commit**

```bash
git add packages/settings/src/routes.ts packages/shared/src/platform-api.ts apps/api/src/server.ts
git commit -m "feat(settings): admin user-lifecycle + registration REST endpoints"
```

---

### Task 9: Wire revokeUserSessions + bootstrap connection into settings deps

**Files:**
- Modify: `apps/api/src/server.ts:98-106` (the `registerBuiltInApiRoutes` call) and wherever settings routes receive their dependencies.

- [ ] **Step 1: Pass the new collaborators**

`registerBuiltInApiRoutes` forwards deps to each module's route registrar (settings included). Thread the two new fields through. In `apps/api/src/server.ts`:

```typescript
    registerBuiltInApiRoutes(server, {
      appDb,
      resolveAccessContext: authRuntime.resolveAccessContext,
      listConfiguredAuthProviders: authRuntime.listConfiguredProviders,
      listModuleManifests: getBuiltInModuleManifests,
      dataContext,
      boss,
      chatEngineFactory: options.chatEngineFactory,
      revokeUserSessions: authRuntime.revokeUserSessions,
      bootstrapConnectionString: getJarvisDatabaseUrls().bootstrap
    });
```

- [ ] **Step 2: Propagate the fields through `@jarv1s/module-registry`**

Run: `grep -rn "revokeUserSessions\|SettingsRoutesDependencies\|registerBuiltInApiRoutes" packages/module-registry/src/`
Add `revokeUserSessions?` and `bootstrapConnectionString?` to the registry's dependency interface and pass them into the settings route registrar. (Match the existing optional-field passthrough pattern there.)

- [ ] **Step 3: Confirm `getJarvisDatabaseUrls().bootstrap` exists**

Run: `grep -n "bootstrap" packages/db/src/*.ts | grep -i url`
Expected: a `bootstrap` field on the urls object (the `delete:user` script already uses a bootstrap connection — confirm the exact accessor and match it).

- [ ] **Step 4: Typecheck + commit**

Run: `pnpm typecheck`
Expected: PASS.

```bash
git add apps/api/src/server.ts packages/module-registry/src/
git commit -m "feat(api): wire session-revocation + bootstrap connection into settings routes"
```

---

### Task 10: Frontend — ApiError code + pending/deactivated screens

**Files:**
- Modify: `apps/web/src/api/client.ts` (`ApiError` carries `code`)
- Modify: `apps/web/src/app.tsx` (branch on the codes)

- [ ] **Step 1: Add a `code` field to `ApiError`**

```typescript
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string
  ) {
    super(message);
  }
}
```

In `requestJson`, parse the code from the error body alongside the message:

```typescript
  if (!response.ok) {
    const { message, code } = await readError(response);
    throw new ApiError(response.status, message, code);
  }
```

Update `readErrorMessage` → `readError` to return both:

```typescript
async function readError(response: Response): Promise<{ message: string; code?: string }> {
  try {
    const body = (await response.json()) as { error?: string; message?: string; code?: string };
    return { message: body.error ?? body.message ?? response.statusText, code: body.code };
  } catch {
    return { message: response.statusText };
  }
}
```

(Keep any existing `readErrorMessage` callers working — either re-export a thin wrapper or update call sites surfaced by typecheck.)

- [ ] **Step 2: Branch in `app.tsx`**

Where the root currently handles 401:

```typescript
  if (meQuery.error instanceof ApiError) {
    if (meQuery.error.status === 403 && meQuery.error.code === "account_pending") {
      return <AccountPendingScreen onRefresh={() => meQuery.refetch()} />;
    }
    if (meQuery.error.status === 403 && meQuery.error.code === "account_deactivated") {
      return <AccountDeactivatedScreen onSignOut={signOut} />;
    }
    if (meQuery.error.status === 401) {
      return <AuthScreen /* …existing props… */ />;
    }
  }
```

Add the two screens (no polling — manual refresh per the spec). Co-locate them as small components in `apps/web/src/app.tsx` or a sibling file matching the existing screen pattern:

```tsx
function AccountPendingScreen({ onRefresh }: { onRefresh: () => void }) {
  return (
    <div className="centered-screen">
      <h1>Awaiting approval</h1>
      <p>Your account is waiting for an administrator to approve it. Check back later.</p>
      <button onClick={onRefresh}>Refresh</button>
    </div>
  );
}

function AccountDeactivatedScreen({ onSignOut }: { onSignOut: () => void }) {
  return (
    <div className="centered-screen">
      <h1>Account no longer active</h1>
      <p>This account has been deactivated. Contact your instance administrator.</p>
      <button onClick={onSignOut}>Sign out</button>
    </div>
  );
}
```

(Match the existing `AuthScreen` styling/className conventions; `signOut` is the existing sign-out handler used elsewhere in `app.tsx`.)

- [ ] **Step 3: Typecheck the web app**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/api/client.ts apps/web/src/app.tsx
git commit -m "feat(web): surface account_pending/account_deactivated screens"
```

---

### Task 11: Frontend — admin UI (pending approvals, users table, registration toggles)

**Files:**
- Modify: the admin settings section under `apps/web/src/` (locate with the grep below)
- Modify: `apps/web/src/api/` client methods for the new endpoints

- [ ] **Step 1: Locate the admin settings UI + API client methods**

Run: `grep -rn "admin/users\|/api/admin\|InstanceSettings\|isInstanceAdmin\|UsersTable\|admin" apps/web/src/`
Identify the existing admin settings component and the API client module that wraps `/api/admin/*`.

- [ ] **Step 2: Add API client methods**

In the web API client, add typed calls (return types from `@jarv1s/shared`):

```typescript
export const approveUser = (id: string) => requestJson<{ user: UserDto }>(`/api/admin/users/${id}/approve`, { method: "POST" });
export const rejectUser = (id: string) => requestJson<{ rejectedUserId: string }>(`/api/admin/users/${id}/reject`, { method: "POST" });
export const deactivateUser = (id: string) => requestJson<{ user: UserDto }>(`/api/admin/users/${id}/deactivate`, { method: "POST" });
export const reactivateUser = (id: string) => requestJson<{ user: UserDto }>(`/api/admin/users/${id}/reactivate`, { method: "POST" });
export const promoteUser = (id: string) => requestJson<{ user: UserDto }>(`/api/admin/users/${id}/promote`, { method: "POST" });
export const demoteUser = (id: string) => requestJson<{ user: UserDto }>(`/api/admin/users/${id}/demote`, { method: "POST" });
export const deleteUser = (id: string) => requestJson<{ deletedUserId: string }>(`/api/admin/users/${id}`, { method: "DELETE" });
export const getRegistrationSettings = () => requestJson<RegistrationSettingsDto>(`/api/admin/registration`);
export const putRegistrationSettings = (body: RegistrationSettingsDto) =>
  requestJson<RegistrationSettingsDto>(`/api/admin/registration`, { method: "PUT", body: JSON.stringify(body) });
```

(Match the existing `requestJson` signature/options shape in the client.)

- [ ] **Step 3: Extend the admin settings component**

Add three sub-sections, invalidating the users query (`queryClient.invalidateQueries`) after each mutation — follow the existing query-key conventions in this app (see the `jarvis-frontend-workspace-querykey` memory):
1. **Pending approvals** — filter users with `status === "pending"`; each row has Approve / Reject buttons.
2. **Users table** — all users with a status badge (pending/active/deactivated) and contextual actions: Deactivate (active, non-self, non-bootstrap-owner), Reactivate (deactivated), Promote/Demote (guard against demoting bootstrap owner / last admin — disable the button and rely on the 409 from the server as backstop), Delete (non-self).
3. **Registration toggles** — two switches bound to `getRegistrationSettings`; on change call `putRegistrationSettings`.

- [ ] **Step 4: Typecheck + build the web app**

Run: `pnpm typecheck && pnpm build:web`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/
git commit -m "feat(web): admin pending-approvals, users table, and registration controls"
```

---

### Task 12: Exit gate — multi-user-isolation integration suite (incl. admin-bypass negative test)

**Files:**
- Create: `tests/integration/multi-user-isolation.test.ts`
- Modify: `package.json` (add a `test:multi-user` script mirroring the other per-suite scripts) — optional but matches the convention.

This is THE acceptance gate. Model it on `tests/integration/auth-settings.test.ts` (real sign-ups via injected server).

- [ ] **Step 1: Write the suite — setup + helpers**

```typescript
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createJarvisAuthRuntime, type JarvisAuthRuntime } from "@jarv1s/auth";
import { createDatabase, type JarvisDatabase } from "@jarv1s/db";
import { createApiServer } from "../../apps/api/src/server.js";
import { connectionStrings, resetEmptyFoundationDatabase } from "./test-database.js";
import type { Kysely } from "kysely";

function cookieHeader(headers: Record<string, unknown>): string {
  const setCookie = headers["set-cookie"];
  const arr = Array.isArray(setCookie) ? setCookie : [setCookie];
  return arr.map((c) => String(c).split(";")[0]).join("; ");
}

async function signUp(server: Awaited<ReturnType<typeof createApiServer>>, name: string, email: string) {
  const res = await server.inject({
    method: "POST",
    url: "/api/auth/sign-up/email",
    headers: { "content-type": "application/json" },
    payload: { name, email, password: "password12345" }
  });
  return { id: res.json<{ user: { id: string } }>().user.id, cookie: cookieHeader(res.headers) };
}

describe("multi-user isolation", () => {
  let appDb: Kysely<JarvisDatabase>;
  let authRuntime: JarvisAuthRuntime;
  let server: Awaited<ReturnType<typeof createApiServer>>;

  beforeEach(async () => {
    await resetEmptyFoundationDatabase();
    appDb = createDatabase({ connectionString: connectionStrings.app, maxConnections: 1 });
    authRuntime = createJarvisAuthRuntime({ appDb });
    server = createApiServer({ appDb, authRuntime, logger: false });
    await server.ready();
  });

  afterAll(async () => {
    await server?.close();
    await appDb?.destroy();
  });
  // … tests below
});
```

- [ ] **Step 2: Positive isolation — user B cannot read user A's private content**

Create a resource as user A (a task is the canonical owner-or-share resource), then prove user B gets 404. Disable approval first so both users are active:

```typescript
it("a member cannot read another member's task", async () => {
  const admin = await signUp(server, "Admin", "admin@example.com"); // first = active admin
  // turn off approval so subsequent users are active
  await appDb.updateTable("app.instance_settings").set({ value: { value: false } }).where("key", "=", "registration.requires_approval").execute();

  const alice = await signUp(server, "Alice", "alice@example.com");
  const bob = await signUp(server, "Bob", "bob@example.com");

  const created = await server.inject({
    method: "POST", url: "/api/tasks",
    headers: { "content-type": "application/json", cookie: alice.cookie },
    payload: { title: "Alice private task" }
  });
  expect(created.statusCode).toBe(201);
  const taskId = created.json<{ task: { id: string } }>().task.id;

  const bobRead = await server.inject({ method: "GET", url: `/api/tasks/${taskId}`, headers: { cookie: bob.cookie } });
  expect(bobRead.statusCode).toBe(404);
});
```

(If the tasks create/read route shapes differ, adjust to the canonical shapes in `packages/tasks/src/routes.ts`. The principle — A creates, B gets 404 — is the invariant.)

- [ ] **Step 3: THE admin-bypass negative test — an admin cannot read a member's private content**

```typescript
it("an instance admin CANNOT read a member's private task (no admin bypass of RLS)", async () => {
  const admin = await signUp(server, "Admin", "admin@example.com");
  await appDb.updateTable("app.instance_settings").set({ value: { value: false } }).where("key", "=", "registration.requires_approval").execute();
  const alice = await signUp(server, "Alice", "alice@example.com");

  const created = await server.inject({
    method: "POST", url: "/api/tasks",
    headers: { "content-type": "application/json", cookie: alice.cookie },
    payload: { title: "Alice private task" }
  });
  const taskId = created.json<{ task: { id: string } }>().task.id;

  // Admin tries directly…
  const adminRead = await server.inject({ method: "GET", url: `/api/tasks/${taskId}`, headers: { cookie: admin.cookie } });
  expect(adminRead.statusCode).toBe(404);

  // …and even after self-granting a resource grant (which is inert for owner-or-share tasks),
  // the admin still cannot read it.
  await server.inject({
    method: "POST", url: "/api/admin/resource-grants",
    headers: { "content-type": "application/json", cookie: admin.cookie },
    payload: { resourceType: "task", resourceId: taskId, granteeUserId: admin.id, grantLevel: "view" }
  });
  const adminReadAfterGrant = await server.inject({ method: "GET", url: `/api/tasks/${taskId}`, headers: { cookie: admin.cookie } });
  expect(adminReadAfterGrant.statusCode).toBe(404);
});
```

(Mirror the existing admin-cannot-bypass pattern already in `auth-settings.test.ts`. Confirm the resource-grant route path/shape against that file.)

- [ ] **Step 4: Secret-table isolation — auth_accounts / better_auth_sessions / connector creds / AI keys**

Assert that no API surface returns another user's secrets and that `jarvis_app_runtime` cannot read peer rows directly. Direct-DB assertion (app_runtime pool) for the secret tables:

```typescript
it("app_runtime cannot read another user's auth_accounts or sessions rows", async () => {
  const admin = await signUp(server, "Admin", "admin@example.com");
  await appDb.updateTable("app.instance_settings").set({ value: { value: false } }).where("key", "=", "registration.requires_approval").execute();
  const alice = await signUp(server, "Alice", "alice@example.com");

  // appDb is the jarvis_app_runtime pool; 0045 revoked its access to these tables entirely.
  await expect(
    appDb.selectFrom("app.auth_accounts").selectAll().where("user_id", "=", alice.id).execute()
  ).rejects.toThrow(); // permission denied (no grant) — proves app_runtime can't reach secrets
});
```

(If app_runtime has a SELECT grant but RLS filters rows, change the assertion to `expect(rows).toHaveLength(0)` instead of rejects — verify which against 0045's grants. Either outcome proves isolation; pick the one matching the actual privilege state.)

- [ ] **Step 5: Lifecycle assertions** — fold in the key transitions end-to-end:

```typescript
it("lifecycle: pending blocked → approved active → deactivated blocked + sessions revoked → reactivated active", async () => {
  const admin = await signUp(server, "Admin", "admin@example.com");
  const member = await signUp(server, "Member", "member@example.com"); // pending (approval on by default)

  // pending blocked
  expect((await server.inject({ method: "GET", url: "/api/me", headers: { cookie: member.cookie } })).statusCode).toBe(403);

  // approve → active
  await server.inject({ method: "POST", url: `/api/admin/users/${member.id}/approve`, headers: { cookie: admin.cookie } });
  // member must re-authenticate (their pre-approval session may be stale); sign in fresh
  const signIn = await server.inject({
    method: "POST", url: "/api/auth/sign-in/email",
    headers: { "content-type": "application/json" },
    payload: { email: "member@example.com", password: "password12345" }
  });
  const activeCookie = cookieHeader(signIn.headers);
  expect((await server.inject({ method: "GET", url: "/api/me", headers: { cookie: activeCookie } })).statusCode).toBe(200);

  // deactivate → blocked + sessions gone
  await server.inject({ method: "POST", url: `/api/admin/users/${member.id}/deactivate`, headers: { cookie: admin.cookie } });
  const sessions = await authRuntime.revokeUserSessions(member.id); // already revoked by the route → 0
  expect(sessions).toBe(0);
  expect((await server.inject({ method: "GET", url: "/api/me", headers: { cookie: activeCookie } })).statusCode).toBe(403);

  // reactivate → active again (after fresh sign-in)
  await server.inject({ method: "POST", url: `/api/admin/users/${member.id}/reactivate`, headers: { cookie: admin.cookie } });
  const signIn2 = await server.inject({
    method: "POST", url: "/api/auth/sign-in/email",
    headers: { "content-type": "application/json" },
    payload: { email: "member@example.com", password: "password12345" }
  });
  expect((await server.inject({ method: "GET", url: "/api/me", headers: { cookie: cookieHeader(signIn2.headers) } })).statusCode).toBe(200);
});
```

- [ ] **Step 6: Guardrail assertions** — last-admin + bootstrap-owner + self-lockout via routes:

```typescript
it("guardrails: cannot demote/deactivate the last admin or the bootstrap owner, or deactivate self", async () => {
  const admin = await signUp(server, "Admin", "admin@example.com"); // bootstrap owner + only admin

  expect((await server.inject({ method: "POST", url: `/api/admin/users/${admin.id}/demote`, headers: { cookie: admin.cookie } })).statusCode).toBe(409);
  expect((await server.inject({ method: "POST", url: `/api/admin/users/${admin.id}/deactivate`, headers: { cookie: admin.cookie } })).statusCode).toBeGreaterThanOrEqual(409);
});
```

- [ ] **Step 7: Run the whole suite**

Run: `pnpm test:integration -- tests/integration/multi-user-isolation.test.ts`
Expected: PASS (all cases).

- [ ] **Step 8: Commit**

```bash
git add tests/integration/multi-user-isolation.test.ts package.json
git commit -m "test(integration): multi-user isolation suite incl. admin-bypass negative test"
```

---

### Task 13: Full gate + finalize

- [ ] **Step 1: Stop any stray worker (it steals pg-boss jobs from integration tests)**

Run: `pgrep -af dev:worker || echo "no worker running"`
If one is running, stop it before the gate.

- [ ] **Step 2: Run the full foundation gate**

Run: `pnpm verify:foundation`
Expected: PASS — lint, format:check, check:file-size, typecheck, db:migrate, test:integration all green, exit code 0. (Run it so the real exit code is visible — do NOT pipe through `| tail`.)

- [ ] **Step 3: Release-hardening audit**

Run: `pnpm audit:release-hardening`
Expected: PASS (no secret-leak / RLS regressions).

- [ ] **Step 4: Confirm no source file exceeds the limit**

Run: `pnpm check:file-size`
Expected: PASS. If `packages/auth/src/index.ts` or `packages/settings/src/repository.ts` approaches 1000 lines, decompose (e.g., move the auth account-status helpers to `packages/auth/src/account-status.ts`, lifecycle repo methods to a `user-lifecycle.ts` collaborator) and re-run.

- [ ] **Step 5: Final commit / ensure branch is clean**

```bash
git status   # expect clean
```

---

## Self-Review

**1. Spec coverage:**

| Spec requirement | Task |
| ---------------- | ---- |
| status + is_bootstrap_owner columns | 1 |
| registration.enabled / requires_approval settings | 1 |
| Sign-up gate on registration.enabled | 3 |
| Status assignment (first=active+admin+owner; later=pending/active) | 4 |
| Access enforcement (pending→403 account_pending, deactivated→403 account_deactivated; both better-auth + bearer paths) | 5 |
| Session revocation on deactivate via auth_runtime | 6, 8 |
| Admin routes approve/reject/deactivate/reactivate/promote/demote/delete | 8 |
| Registration GET/PUT | 8 |
| requireAdmin gating + audit logging | 7 (audit), 8 (gate) |
| Guardrails: ≥1 active admin, bootstrap-owner protection, no self-lockout | 7 (repo), 8 (route-level self-delete) |
| DELETE reuses delete:user (deleteUserData) | 8, 9 |
| Frontend pending/deactivated screens (no polling) | 10 |
| Admin UI: pending list, users table, registration toggles | 11 |
| multi-user-isolation suite + admin-bypass negative test | 12 |
| verify:foundation green | 13 |

No gaps.

**2. Placeholder scan:** No "TBD/TODO/handle edge cases" left. The only deliberately-symbolic token is the migration number `<NNNN>` — that is correct project practice (numbers are global, assigned at landing) and Task 1 Step 2 resolves it concretely. Two "locate with grep" steps (Task 5 `/api/me`, Task 11 admin UI) are discovery steps for files this plan does not assume the exact path of — each gives the exact grep and the exact change to make once found.

**3. Type consistency:**
- `setUserStatus` / `setUserAdmin` / `getRegistrationSettings` / `setRegistrationSettings` signatures match between Task 7 (definition) and Task 8 (calls). ✓
- `RegistrationSettingsDto` (shared, Task 2) vs `RegistrationSettings` (repo, Task 7) — both `{ registrationEnabled, requiresApproval }`. The route returns the shared DTO shape directly. ✓
- `serializeUser` (Task 8) returns the extended `UserDto` (Task 2). ✓
- `revokeUserSessions: (userId: string) => Promise<number>` consistent across Task 6 (def), Task 8 (call), Task 9 (wiring). ✓
- **Caught + fixed inline:** `reject` cannot return `{ user }` (the user is deleted). Task 2 now defines `adminRejectUserRouteSchema` returning `{ rejectedUserId }`, and Task 8 registers `/api/admin/users/:id/reject` (POST) and `/api/admin/users/:id` (DELETE) separately so each binds its correct schema via a shared `tearDownAccount` helper. The web client method `rejectUser` (Task 11) expects `{ rejectedUserId: string }`. ✓
- `AccountPendingApprovalError.code` / `AccountDeactivatedError.code` are `"account_pending"` / `"account_deactivated"`, matched by `replyForAuthError` (Task 5), `handleRouteError` (Task 8), and `ApiError.code` branching (Task 10). ✓

All review findings are resolved inline in the tasks above — there are no deferred action items.
