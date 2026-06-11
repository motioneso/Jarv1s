# packages/settings — Thermo-Nuclear Code Quality Audit

**Audited files:**
- `packages/settings/src/index.ts`
- `packages/settings/src/manifest.ts`
- `packages/settings/src/repository.ts`
- `packages/settings/src/routes.ts`
- Related SQL: `infra/postgres/migrations/0001_app_schema.sql`, `0004_auth_workspaces_settings.sql`, `0005_admin_audit_events.sql`

---

## Summary

The settings module is the administrative backbone of the platform — it owns workspace management, resource grants, instance settings, and admin audit events. It has a well-defined permission boundary (admin-only routes behind `requireAdmin`) and good test coverage in `auth-settings.test.ts`. However, it contains three architectural violations of hard project invariants and several material security gaps that require remediation.

---

## Findings

### [CRITICAL] DataContextDb invariant violated — SettingsRepository accepts raw Kysely, bypassing RLS session variable injection

- **File:** `packages/settings/src/repository.ts:16,64`
- **Category:** Architecture / Security
- **Finding:** `SettingsRepository` accepts `Kysely<JarvisDatabase>` (root connection) rather than a `DataContextDb` branded handle. The `SettingsDb` internal type alias is `Kysely<JarvisDatabase> | Transaction<JarvisDatabase>` — neither of which is `DataContextDb`. All queries execute without `set_config('app.actor_user_id', …)` or `set_config('app.request_id', …)` being called for the connection session.
- **Evidence:**
  ```ts
  // repository.ts:16
  type SettingsDb = Kysely<JarvisDatabase> | Transaction<JarvisDatabase>;
  // repository.ts:64
  constructor(private readonly db: Kysely<JarvisDatabase>) {}
  // routes.ts:75
  const repository = dependencies.repository ?? new SettingsRepository(dependencies.appDb);
  ```
- **Impact:** The CLAUDE.md hard invariant states "Repositories accept only a branded `DataContextDb` handle, never a root Kysely instance." This violation means all queries in this repository skip the access-context session local that RLS policies depend on. If any of the managed tables ever gain RLS policies (a natural future step), the missing session variable will silently deny all queries rather than enforce them correctly. It also breaks the auditability contract — `app.request_id` is never set for any admin operation, so the request_id column in `admin_audit_events` is populated by the caller passing it explicitly rather than being enforced by the context mechanism.
- **Recommendation:** Refactor `SettingsRepository` to accept `DataContextDb` on mutating methods, or use `DataContextRunner.withDataContext` in the route handlers before calling the repository. Admin-only routes can use a synthetic or system-level `actorUserId` matching the performing admin. The `insertAuditEvent` calls already receive `actorUserId` explicitly — this architecture should stay, but the DB context must be properly initialized.

---

### [CRITICAL] No RLS on five admin-managed tables — admin role is fully trust-based at the DB level

- **File:** `infra/postgres/migrations/` (no migration ever enables RLS on these tables)
- **Category:** Security
- **Finding:** The tables `app.workspaces`, `app.workspace_memberships`, `app.resource_grants`, `app.instance_settings`, and `app.admin_audit_events` have no `ENABLE ROW LEVEL SECURITY` or `FORCE ROW LEVEL SECURITY` applied anywhere in the migration history. The only access control on these tables is the application-layer `requireAdmin` check in `routes.ts`.
- **Evidence:** Running a comprehensive grep across all SQL files for the five table names yields zero matches for `ENABLE ROW LEVEL SECURITY`, `FORCE ROW LEVEL SECURITY`, or `CREATE POLICY`. Migration `0005_admin_audit_events.sql` grants `jarvis_app_runtime` `SELECT, INSERT` on `admin_audit_events` with no policy restriction.
- **Impact:** Any SQL-injection vector, database-credential leak, or future code path that bypasses the `requireAdmin` application check would give unrestricted access to all workspace structures, all resource grants (which control cross-user data sharing), all instance settings, and the complete audit trail. The project's stated security posture is DB-level defense-in-depth. These tables hold administrative infrastructure data that is at minimum as sensitive as user-owned product data (all of which has RLS + FORCE). `instance_settings` in particular could store security-policy configuration such as provider-policy or rate-limit overrides. `resource_grants` directly controls cross-user data access.
- **Recommendation:** Add a migration that:
  1. `ENABLE ROW LEVEL SECURITY` and `FORCE ROW LEVEL SECURITY` on all five tables.
  2. For `admin_audit_events`: unrestricted INSERT for `jarvis_app_runtime` (audit writes must always succeed), SELECT restricted to `jarvis_auth_runtime` or to admin-level callers via a SECURITY DEFINER function (since app_runtime cannot self-verify admin status at the DB level without referencing `app.users`).
  3. For `workspaces`, `workspace_memberships`, `resource_grants`, `instance_settings`: policies permitting `jarvis_app_runtime` access only when `app.current_actor_user_id() IS NOT NULL` (effectively requiring a valid session context). Actual row-level filtering for admin operations can remain permissive (`USING (true)`) as the application layer enforces the admin check, but forcing context presence prevents uninitialized-session access.

---

### [HIGH] `/api/bootstrap/status` leaks exact user count to unauthenticated callers

- **File:** `packages/settings/src/routes.ts:77–84`
- **Category:** Security
- **Finding:** The bootstrap status endpoint requires no authentication and returns `{ needsBootstrap: boolean, userCount: number }`. The `userCount` field exposes the exact number of registered users to any unauthenticated client.
- **Evidence:**
  ```ts
  server.get("/api/bootstrap/status", { schema: bootstrapStatusRouteSchema }, async () => {
    const userCount = await repository.countUsers();
    return {
      needsBootstrap: userCount === 0,
      userCount  // exact count exposed to unauthenticated callers
    };
  });
  ```
- **Impact:** An attacker can enumerate the size of the user base without any credentials. In a private installation, knowing there are `N` users is reconnaissance. The only legitimate consumer of this endpoint is the setup wizard, which only needs `needsBootstrap: boolean`.
- **Recommendation:** Remove `userCount` from the response schema and the route handler. Return only `{ needsBootstrap: boolean }`. The `bootstrapStatusRouteSchema` in `packages/shared/src/platform-api.ts` should also be updated to remove `userCount` from the required/properties list.

---

### [HIGH] Instance setting key has no allowlist — arbitrary keys can be stored and read

- **File:** `packages/settings/src/routes.ts:294–313`, `packages/settings/src/repository.ts:352–386`
- **Category:** Security / Architecture
- **Finding:** `PATCH /api/admin/settings/:key` accepts any non-empty string as `key`. There is no allowlist of valid setting keys. Combined with the unrestricted `Record<string, unknown>` value type, this means any admin can create arbitrary key/value pairs in the `instance_settings` table. The value has no schema constraint beyond "must be a JSON object."
- **Evidence:**
  ```ts
  // routes.ts:294-312 — key comes directly from URL param
  server.patch<{ Params: SettingParams }>(
    "/api/admin/settings/:key",
    { schema: upsertInstanceSettingRouteSchema },
    async (request, reply) => {
      ...
      const setting = await repository.upsertInstanceSetting({
        key: request.params.key,  // any string accepted
        value: body.value,         // Record<string, unknown> — no schema validation
  ```
  ```ts
  // shared platform-api.ts:603
  value: { type: "object", additionalProperties: true }  // no constraints on content
  ```
- **Impact:** (1) An admin can pollute the settings table with arbitrary keys, creating confusion and potential attack surface if settings values are ever acted upon by logic that reads them (e.g., a future capability-router reading `provider-policy`). (2) A large or deeply-nested JSON object can be inserted without any size limit, providing a DoS vector via storage exhaustion. (3) Settings values are returned verbatim in the list/get response and could be crafted to exploit downstream consumers.
- **Recommendation:** Define a typed allowlist of valid setting keys and their value schemas in `@jarv1s/shared`. Validate both `key` (against the allowlist) and `value` (against the per-key schema) in `parseInstanceSettingBody`. This also makes the settings contract explicit and auditable.

---

### [HIGH] Resource grant `resourceId` passes as string through URL params with no UUID format validation

- **File:** `packages/settings/src/routes.ts:258–277`, `packages/settings/src/repository.ts:316–345`
- **Category:** Security / Error Handling
- **Finding:** The `DELETE /api/admin/resource-grants/:resourceType/:resourceId/:granteeUserId` route passes `request.params.resourceId` as a plain string to repository methods that use it in Kysely `.where("resource_id", "=", ...)` comparisons. The DB column is `uuid`, so Postgres will throw a type cast error on non-UUID input, but this error is not caught in `handleRouteError` — it will be re-thrown as an unhandled 500.
- **Evidence:**
  ```ts
  // routes.ts:264-270
  const grant = await repository.deleteResourceGrant({
    resourceType: request.params.resourceType,
    resourceId: request.params.resourceId,   // no UUID format check
    granteeUserId: request.params.granteeUserId,
    ...
  });
  ```
  ```ts
  // handleRouteError (routes.ts:514-541) does not catch PostgreSQL invalid_text_representation
  ```
  Similarly, `granteeUserId` from the URL params is never validated as a UUID format before use.
- **Impact:** A malformed `resourceId` or `granteeUserId` in a DELETE request causes an unhandled Postgres exception that propagates as a 500, potentially leaking internal error messages. More critically, this represents an inconsistency with the security model — the route schema has no `format: "uuid"` constraint that would trigger Fastify's JSON schema validation.
- **Recommendation:** Add `format: "uuid"` constraints to the route schemas for `resourceId`, `granteeUserId`, and workspace `id` params in `packages/shared/src/platform-api.ts`. Alternatively, add a `requiredUuidString` validator in `routes.ts` similar to how `requiredGrantLevel` validates enum values.

---

### [MEDIUM] `isInstanceAdmin` flag exposed in public `/api/me` response

- **File:** `packages/settings/src/routes.ts:445–454`, `packages/shared/src/platform-api.ts:5–8`
- **Category:** Security
- **Finding:** The `serializeUser` function includes `isInstanceAdmin: user.is_instance_admin` in the `UserDto` response. The `/api/me` endpoint returns this to every authenticated user. The `/api/admin/users` list also returns `isInstanceAdmin` for every user.
- **Evidence:**
  ```ts
  function serializeUser(user: User): UserDto {
    return {
      ...
      isInstanceAdmin: user.is_instance_admin,  // privilege flag returned to all callers
  ```
- **Impact:** Any authenticated user can determine whether they themselves are an instance admin (this is acceptable — the user needs to know to render admin UI). However, the admin user list endpoint returns `isInstanceAdmin` for _all_ users, letting an admin see which other users are admins. This is appropriate for the admin list endpoint but should be explicit in documentation/review. More concerning: the `/api/me` endpoint returning this flag means it cannot later be removed without a breaking change, even if the flag becomes more sensitive (e.g., if admin status gains additional privilege layers). No medium-severity issue, but this should be documented as a deliberate decision.
- **Recommendation:** This is acceptable design but should be explicitly documented in the CLAUDE.md or an ADR. Consider whether the admin user list needs to expose `isInstanceAdmin` for all users, or whether a separate admin-enumeration route is more appropriate.

---

### [MEDIUM] `handleRouteError` uses string-matching on error messages — fragile and incomplete

- **File:** `packages/settings/src/routes.ts:514–541`
- **Category:** Code Quality / Error Handling
- **Finding:** The error handler dispatches HTTP status codes by matching on `error.message` string literals. This is a fragile pattern: (1) a typo in any error message string in the repository breaks the mapping silently (the error becomes a 500); (2) the list of handled messages is incomplete — PostgreSQL errors from Kysely (e.g., FK violations when a userId does not exist) are not caught and will become unhandled 500s with potentially informative error text logged; (3) the pattern is duplicated — `connectors/src/routes.ts` and other modules likely have similar logic.
- **Evidence:**
  ```ts
  if (error.message === "User not found" ||
      error.message === "Workspace not found" ||
      ...
  ```
  Notably missing: no handler for `"Workspace membership not found"` thrown from `deleteWorkspaceMembership`'s guard in `assertCanRemoveWorkspaceMembership` (it throws this from a private method, not as an `HttpError`) — this is actually handled, but only by string match, so refactoring the message breaks the mapping.
- **Impact:** The fragility means refactoring error messages in `repository.ts` silently breaks HTTP status codes in `routes.ts`. The pattern also does not catch DB-level errors (type violations, constraint violations) which will surface as 500s.
- **Recommendation:** Replace string-matched errors with typed error classes (e.g., `NotFoundError`, `ConflictError`) that carry the HTTP status as a property. The `HttpError` class already exists — extend it with subclasses or use it consistently from the repository. This is a common pattern that should be extracted as a shared utility.

---

### [MEDIUM] Audit event `metadata` could leak setting values for non-metadata settings keys

- **File:** `packages/settings/src/repository.ts:373–384`
- **Category:** Security / Payloads
- **Finding:** When upserting an instance setting, the audit event metadata correctly stores only the `key` (not the `value`). This is good. However, if a future setting key holds sensitive data (e.g., an API key or secret policy configuration), the `key` itself could be informative. More critically, the current `upsertInstanceSetting` audit entry stores `{ key: input.key }` — it does NOT store the value. This is correct. But no test asserts that the value is absent from audit metadata, so a future change could accidentally add it.
- **Evidence:**
  ```ts
  metadata: {
    key: input.key  // value deliberately omitted — good, but untested
  }
  ```
- **Impact:** Currently safe, but the absence of an explicit test for "value must not appear in audit metadata" means regression risk. Given the project's explicit rule that settings values could carry security configuration, this should be tested.
- **Recommendation:** Add a test in `auth-settings.test.ts` that asserts the `instance_setting.upsert` audit event metadata does NOT contain the setting value. Similar pattern to the existing `exportedJson.not.toContain("connector-ciphertext-sentinel")` checks in `release-hardening.test.ts`.

---

### [MEDIUM] No DB-level CHECK constraint on `workspace_memberships.role`

- **File:** `infra/postgres/migrations/0001_app_schema.sql:36`
- **Category:** Architecture / Security
- **Finding:** The `app.workspace_memberships` table defines `role text NOT NULL` with no `CHECK` constraint limiting values to `('owner', 'admin', 'member')`. The application validates the role in `requiredWorkspaceRole()` in `routes.ts`, but there is no DB-level enforcement.
- **Evidence:**
  ```sql
  -- 0001_app_schema.sql:36
  role text NOT NULL,  -- no CHECK constraint
  ```
  ```ts
  // routes.ts:435-443
  function requiredWorkspaceRole(value: unknown): string {
    if (role === "owner" || role === "admin" || role === "member") return role;
    throw new HttpError(400, "role is invalid");
  }
  ```
- **Impact:** Any direct DB insert (migration, seed, or future bypass path) can insert arbitrary role values. Code that reads the role and switches on it (e.g., authorization logic that checks `role === "owner"`) would silently permit unrecognized roles through, depending on the switch logic. The DB is the last line of defense per the project's stated security model.
- **Recommendation:** Add a migration with `ALTER TABLE app.workspace_memberships ADD CONSTRAINT workspace_memberships_role_check CHECK (role IN ('owner', 'admin', 'member'))`.

---

### [MEDIUM] `/api/admin/audit-events` hard-coded to 50 rows with no pagination

- **File:** `packages/settings/src/repository.ts:388–396`
- **Category:** Architecture / Code Quality
- **Finding:** `listAdminAuditEvents` returns the 50 most-recent events with no pagination support. The route has no query params for `offset`, `limit`, or cursor, and the shared schema has no pagination fields.
- **Evidence:**
  ```ts
  async listAdminAuditEvents(): Promise<AdminAuditEvent[]> {
    return this.db
      .selectFrom("app.admin_audit_events")
      .selectAll()
      .orderBy("created_at", "desc")
      .orderBy("id", "desc")
      .limit(50)  // hardcoded, no pagination
      .execute();
  }
  ```
- **Impact:** On a production system with active admin operations, the audit trail becomes effectively unqueryable after 50 events — admins cannot page back to investigate historical changes. This is an operational gap, not a security vulnerability, but it means the audit feature is nearly useless in practice.
- **Recommendation:** Add cursor-based or offset pagination to `listAdminAuditEvents` and expose it via optional query params on the route. At minimum, increase the limit to a reasonable default (e.g., 500) with an upper bound enforced by the route.

---

### [LOW] `WorkspaceMembershipDto.role` typed as `string`, not as a union type

- **File:** `packages/shared/src/platform-api.ts:21`
- **Category:** TypeScript
- **Finding:** `WorkspaceMembershipDto.role` is `readonly role: string` rather than `"owner" | "admin" | "member"`. Frontend consumers receive no type narrowing on the role field.
- **Evidence:**
  ```ts
  export interface WorkspaceMembershipDto {
    readonly userId: string;
    readonly workspaceId: string;
    readonly role: string;  // should be "owner" | "admin" | "member"
    readonly createdAt: string;
  }
  ```
- **Impact:** Frontend code that branches on `role === "owner"` gets no TypeScript exhaustiveness checking. Typos compile silently.
- **Recommendation:** Change to `readonly role: "owner" | "admin" | "member"`. Update the JSON schema enum to match.

---

### [LOW] Shared request/response types in `platform-api.ts` not co-located with the module

- **File:** `packages/shared/src/platform-api.ts`
- **Category:** Architecture
- **Finding:** All settings-related request/response types, DTOs, and JSON schemas are in `packages/shared/src/platform-api.ts` — a single 620-line file that mixes concerns from multiple modules (settings, auth, workspace, modules API). This file will grow unboundedly as the platform grows.
- **Evidence:** `platform-api.ts` contains schemas and types for: bootstrap, me, users, workspaces, workspace memberships, resource grants, instance settings, audit events, auth providers, and module navigation — all in one file, 620 lines.
- **Impact:** This is not yet a hard violation (620 lines is under the 1000-line limit) but is trending toward it. Each new settings-related DTO or schema adds to this file. Module isolation says modules should own their public API contracts.
- **Recommendation:** Split `platform-api.ts` by domain. Settings-related types could live in a dedicated `settings-api.ts` in `packages/shared/src/`. This is a low-priority refactor that should happen before the file exceeds 1000 lines.

---

### [LOW] `parseInstanceSettingBody` silently coerces `settingValue` with an unsafe cast

- **File:** `packages/settings/src/routes.ts:392–403`
- **Category:** TypeScript
- **Finding:** After validating that `settingValue` is a non-array object, the function casts it with `settingValue as Record<string, unknown>` without the benefit of a type guard. Fastify's JSON schema validation on the body would have already validated this (the schema specifies `type: "object"`), so the manual cast is redundant. But if the schema validation is bypassed (e.g., in tests using `repository` option directly), the cast is unsound.
- **Evidence:**
  ```ts
  function parseInstanceSettingBody(body: unknown): UpsertInstanceSettingRequest {
    const value = requireObject(body);
    const settingValue = value.value;
    if (!settingValue || typeof settingValue !== "object" || Array.isArray(settingValue)) {
      throw new HttpError(400, "value must be a JSON object");
    }
    return { value: settingValue as Record<string, unknown> };  // unsafe cast
  }
  ```
- **Impact:** Minor — the check above the cast is correct. But the pattern of checking then casting (rather than using a proper type guard that returns `value is Record<string, unknown>`) is imprecise TypeScript.
- **Recommendation:** Extract a type guard: `function isRecord(v: unknown): v is Record<string, unknown> { return !!v && typeof v === "object" && !Array.isArray(v); }` and use it instead of the manual check + cast.

---

### [LOW] Test for non-admin access only covers `GET /api/admin/users` — broader negative coverage missing

- **File:** `tests/integration/auth-settings.test.ts:199–241`
- **Category:** Tests
- **Finding:** The test "keeps later users non-admin and protects admin APIs" only verifies that a non-admin cannot call `GET /api/admin/users`. It does not test `GET /api/admin/workspaces`, `POST /api/admin/workspaces`, `POST /api/admin/resource-grants`, `PATCH /api/admin/settings/:key`, `GET /api/admin/audit-events`, etc.
- **Evidence:** Only one 403 assertion in the non-admin block. All other admin routes tested only with the admin cookie.
- **Impact:** If a route is accidentally registered without the `requireAdmin` check (or with a bug in that function), the test suite would not catch it. The test coverage gives false confidence in the permission boundary.
- **Recommendation:** Add a parameterized test that calls each admin route with the non-admin cookie and asserts a 403 response. This can be a single test that iterates over a list of `[method, path]` pairs.

---

### [INFO] Dead `app.current_workspace_id()` function reference in `0002_app_rls.sql`

- **File:** `infra/postgres/migrations/0002_app_rls.sql:22–42`
- **Category:** Code Quality
- **Finding:** `app.current_workspace_id()` is defined in migration `0002` but later dropped in `0028_workspace_teardown.sql`. Migration `0002` also grants `EXECUTE` on this function. The function definition in `0002` is dead code from `0028` onward on fresh installs (where migrations run in order), but on existing DBs the teardown handles it.
- **Evidence:** `0002_app_rls.sql:22` defines `current_workspace_id`, `0028_workspace_teardown.sql` drops it with `DROP FUNCTION IF EXISTS app.current_workspace_id()`. The GRANT at `0002:91` is also orphaned after `0028`.
- **Impact:** No runtime impact — `DROP FUNCTION IF EXISTS` is idempotent. But the dead code in `0002` adds confusion during code review and makes the migration sequence harder to read.
- **Recommendation:** This is already cleaned up operationally. No action required unless a future cleanup migration is planned.

---

## Settings-Specific Dimension Summary

| Dimension | Status |
|---|---|
| **Settings isolation: user settings owner-only?** | No user-owned settings exist in this module. Instance settings are admin-only. No RLS enforces this at DB level (see CRITICAL #2). |
| **Settings schema: typed and validated?** | Key: no allowlist (see HIGH #2). Value: `Record<string, unknown>` with no per-key schema. |
| **AI model configuration: validated against allowed list?** | No AI model configuration in this module (handled by `@jarv1s/ai`). |
| **Sensitive settings: privilege escalation risk?** | Instance settings store arbitrary JSON — no current privilege escalation path, but the absence of a key allowlist means any admin could store attacker-controlled data that future code might act on. |
| **Module isolation:** | No imports of other module internals. Queries only `app.*` foundation tables, not module-owned tables. Clean. |
