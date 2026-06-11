## Phase 18 — Module settings

### CRIT / HIGH / MED / LOW / INFO counts

- CRIT: 0
- HIGH: 3
- MED: 5
- LOW: 3
- INFO: 2

### Findings

#### [HIGH] Resource-grants admin surface is dead — granting/revoking has zero effect on access
**File:** `packages/settings/src/repository.ts:262-346` (also `routes.ts:223-277`, `manifest.ts:97-111`)  
**Invariant violated / concern:** Hard invariant 2 (Private by default / cross-user access requires explicit grants) + "No Stale Concepts" quality rule. Security-relevant dead code.  
**Detail:** The settings module exposes full `list/upsert/delete` over `app.resource_grants`, and `app.has_resource_grant()` (migration `0002_app_rls.sql:55`) reads that table. But the real cross-user sharing mechanism is now `app.shares` (`infra/postgres/migrations/0017_shares.sql`), and Slice 1f (`0028_workspace_teardown.sql`) converted the live RLS policies off the workspace/resource_grants model. A grep confirms `app.has_resource_grant()` / `app.resource_grants` are referenced ONLY in their defining migration (0002) and the teardown migration (0028) — **no live RLS policy on any product/module table calls them**. Consequence: an instance admin who uses `POST /api/admin/resource-grants` to "grant" or `DELETE` to "revoke" access believes they have changed who can see a resource, but the operation has no effect on actual data visibility (which is governed by `app.shares`). This is a silent-no-op security trap: false sense of having granted/revoked access. It is also confirmed unused — no consumer of `listResourceGrants` exists outside the settings package and DB types.  
**Suggested fix:** Remove the resource-grants routes, repository methods, manifest routes, and DTOs in the same pass; if a real admin-facing share-management surface is wanted, build it against `app.shares` under an approved spec. At minimum, wire these endpoints to `app.shares` so they actually affect access.

#### [HIGH] Repository takes a raw `Kysely<JarvisDatabase>` and bypasses `withDataContext` / RLS entirely
**File:** `packages/settings/src/repository.ts:64` (`constructor(private readonly db: Kysely<JarvisDatabase>)`)  
**Invariant violated / concern:** Hard invariant 3 (DataContextDb only — repositories accept only the branded `DataContextDb`, never a root Kysely) and invariant 1 (RLS applies to all actors).  
**Detail:** Every other data-touching repository in the codebase is required to accept the branded `DataContextDb` and run inside `DataContextRunner.withDataContext`, which sets `app.actor_user_id` / `app.request_id` so RLS policies evaluate against the acting user (`packages/db/src/data-context.ts:19-39`). This repository instead holds a root `Kysely` and runs all queries with **no actor GUC set**. Because the four admin tables it touches (`workspaces`, `workspace_memberships`, `instance_settings`, `resource_grants`) have NO RLS enabled at all (see next finding), the ONLY thing standing between any authenticated session and full read/write of these tables is the app-layer `requireAdmin` check in `routes.ts:331-344`. There is zero defense-in-depth: a single missed `requireAdmin` (e.g. a future route added without it, or the `/api/me` path which does NOT call it) exposes the whole admin surface. The only documented sanctioned raw-Kysely repo is `auth-session.ts` (better-auth pool); settings is not auth-runtime and should not be exempt.  
**Suggested fix:** Either (a) move these reads/writes behind `DataContextDb` + per-table RLS policies scoped to `is_instance_admin` (defense-in-depth), or (b) if these must stay app-gated admin tables, document the exemption explicitly and add a self-row RLS arm so `/api/me`'s membership/workspace reads cannot leak other users' rows.

#### [HIGH] `/api/me` reads other users' workspace/membership rows through an unguarded raw-Kysely repo
**File:** `packages/settings/src/routes.ts:86-102` + `repository.ts:95-132`  
**Invariant violated / concern:** Hard invariant 2 (Private by default) and 1 (RLS applies to all actors).  
**Detail:** `/api/me` (permission `settings.view`, available to every user — `manifest.ts:58-61`) calls `listMembershipsForUser` and `listWorkspacesForUser`, which filter by `actorUserId` in application code only (`where("user_id", "=", userId)`). There is no RLS backstop: `app.workspace_memberships` and `app.workspaces` have no `ENABLE ROW LEVEL SECURITY` anywhere in the migrations, and the repo runs as `jarvis_app_runtime` with no actor GUC. The correctness of "you only see your own memberships" rests entirely on a hand-written WHERE clause. A typo or refactor that drops/loosens that predicate becomes a cross-user data leak with no database-level safety net — exactly the failure mode the RLS-everywhere invariant exists to prevent.  
**Suggested fix:** Enable + FORCE RLS on `app.workspaces` and `app.workspace_memberships` with self-membership policies, and route `/api/me` through `withDataContext` so the actor GUC is set, making the WHERE clause redundant rather than load-bearing.

#### [MED] `instance_settings` is a write-only store with no consumer and no per-key/value validation (incl. AI model config)
**File:** `packages/settings/src/routes.ts:294-313` + `repository.ts:352-386` + `packages/shared/src/platform-api.ts:597-605`  
**Invariant violated / concern:** Quality rule (dead / speculative infrastructure) + module-focus question (AI model config not validated against an allowed list). Borders on invariant 7 if ever consumed.  
**Detail:** `PATCH /api/admin/settings/:key` accepts an arbitrary URL `key` (no allowlist — `routes.ts:295,301`) and an arbitrary JSON object `value` (`additionalProperties: true`, `platform-api.ts:603`; only "is a non-array object" is checked in `parseInstanceSettingBody`). There is no schema, no key registry, no per-key value validation. A grep across `packages/` and `apps/` shows **nothing reads `instance_settings`** — it is a write-only KV bucket. So today the "is AI model config validated against an allowed list?" question is moot (no config is consumed), but the surface is a latent provider-hardcoding / injection risk the moment any feature starts reading it: it would consume unvalidated free-form JSON. SQL injection is not possible (parameterized Kysely + jsonb), so this is data-modeling/validation debt, not an injection hole.  
**Suggested fix:** Either delete the instance-settings surface until a spec defines real keys, or introduce a typed key registry with per-key value schemas validated at the route boundary (and, for any future AI-model key, validate against the capability router's allowed set rather than `any` JSON).

#### [MED] Workspace CRUD machinery survives Slice 1f and is effectively orphaned
**File:** `packages/settings/src/repository.ts:86-260` (`listWorkspaces`, `createWorkspace`, `upsert/deleteWorkspaceMembership`, owner-guard helpers)  
**Invariant violated / concern:** "No Stale Concepts" quality rule; tension with invariant 4 (workspaceId permanently removed from `AccessContext` in Slice 1f).  
**Detail:** Slice 1f (`0028_workspace_teardown.sql`) tore workspaces out of the product/RLS model and permanently removed `workspaceId` from `AccessContext`. Yet settings still ships a full workspace + membership admin surface with bespoke "must keep at least one owner" guards (`assertWorkspaceHasAnotherOwner`, lines 422-466). The only remaining non-settings consumer is `packages/auth/src/index.ts:269-300`, which seeds a default workspace + owner membership on user creation — i.e. workspaces are written but never used for any access decision. This is a large block of incidental complexity (roughly half the repository) preserved around a concept the rest of the system abandoned.  
**Suggested fix:** Decide explicitly: if workspaces are dead, remove the CRUD + guards + manifest routes + the auth seed in one pass; if they are a planned future feature, gate behind a spec and document why the surface exists ahead of any consumer.

#### [MED] Error mapping by string matching couples the route layer to repository message literals
**File:** `packages/settings/src/routes.ts:514-541` (`handleRouteError`)  
**Invariant violated / concern:** Quality rule (incidental complexity, brittle special-case sprawl) + error-handling dimension (string-compared control flow).  
**Detail:** `handleRouteError` switches on raw `error.message` string equality ("User not found", "Workspace not found", "Workspace must keep at least one owner", "Invalid bearer token", "Workspace context is unavailable", etc.) to choose a status code. These literals are produced far away (`repository.ts` throws `new Error("User not found")`, auth runtime throws "Invalid bearer token"). Any reword of a message silently changes HTTP behavior (a 400 becomes a 500 re-throw), and the handler reaches across module boundaries to know auth-runtime's exact strings. It also conflates genuinely-different conditions ("not found" vs "invariant violation") into one 400 bucket.  
**Suggested fix:** Throw typed errors (a small `DomainError` with a `kind`/`statusCode`, mirroring the existing `HttpError`) from the repository and map on the type, not the message. Delete the string ladder.

#### [MED] `requireAdmin` makes 2 sequential round-trips per admin call; admin check could be one query
**File:** `packages/settings/src/routes.ts:331-344` + every admin route  
**Invariant violated / concern:** Quality rule (unnecessarily sequential orchestration / incidental complexity).  
**Detail:** Each admin request resolves the access context, then `requireKnownUser` selects the full user row, then the route handler issues its own queries. `requireAdmin` selects `*` from `app.users` only to read `is_instance_admin` and (for some routes) discard the rest. For read-only list endpoints this is a fixed 2-query preamble before the actual work. Minor, but it is per-request overhead on the hot admin path and `selectAll()` pulls columns (email, etc.) that are only sometimes needed.  
**Suggested fix:** Select only `id, is_instance_admin` in the admin gate; or fold the admin assertion into a single query where the handler already needs the user. Keep the row fetch only where the route actually serializes the user.

#### [MED] Owner-guard for membership changes is racy (TOCTOU) — last-owner invariant can be violated under concurrency
**File:** `packages/settings/src/repository.ts:422-466` (`assertWorkspaceHasAnotherOwner` then upsert/delete)  
**Invariant violated / concern:** Quality rule (non-atomic multi-step update that can leave invalid state).  
**Detail:** `assertCanChangeWorkspaceMembershipRole` / `assertCanRemoveWorkspaceMembership` read "is there another owner?" and then write the demotion/delete in the same transaction, but the check uses a plain `SELECT` with no row lock. Two concurrent transactions each demoting/removing a different owner can both observe "another owner exists" and both commit, leaving the workspace with zero owners — the exact state the guard exists to prevent. (Lower real-world severity given workspaces appear orphaned per the MED above, but it is a genuine correctness bug in the guard.)  
**Suggested fix:** If the surface is kept, take a `FOR UPDATE` lock on the owner rows (or a unique partial-index / deferred constraint enforcing ≥1 owner) so the invariant holds under concurrency.

#### [LOW] `SettingsDb` union type re-derives the DataContextDb concept locally
**File:** `packages/settings/src/repository.ts:16` (`type SettingsDb = Kysely<JarvisDatabase> | Transaction<JarvisDatabase>`)  
**Invariant violated / concern:** Quality rule (bespoke type duplicating canonical machinery; obscures the real handle invariant).  
**Detail:** The module invents its own "either a root db or a transaction" union so private helpers can accept both `this.db` and an in-flight `transaction`. This exists only because the repository holds a raw root Kysely instead of the branded `DataContextDb`/`Transaction` the rest of the codebase standardizes on. It is a symptom of the HIGH raw-Kysely finding.  
**Suggested fix:** Remove once the repository is migrated to `DataContextDb`; helpers then uniformly take the branded transaction handle.

#### [LOW] Manual body parsers duplicate validation that the Fastify route schema already enforces
**File:** `packages/settings/src/routes.ts:364-443` (`parseCreateWorkspaceBody`, `parseWorkspaceMembershipBody`, `parseResourceGrantBody`, `parseInstanceSettingBody`, `requireObject`, `requiredString`, ...)  
**Invariant violated / concern:** Quality rule (duplicate helpers / incidental complexity).  
**Detail:** Routes are registered with `{ schema: ... }` from `@jarv1s/shared` (e.g. `upsertInstanceSettingRouteSchema` has `body` with `required`/`type`/`additionalProperties:false`). Fastify already validates and rejects malformed bodies before the handler runs, yet each handler then re-parses `request.body` from `unknown` with hand-rolled `requireObject`/`requiredString`/enum checks. This is two validation layers that must be kept in sync. Note the enum checks (`requiredGrantLevel`, `requiredWorkspaceRole`) are the part actually adding value beyond the schema — those could move into the shared schema as `enum` constraints.  
**Suggested fix:** Trust the registered schema for shape/required/type, type `request.body` via the route generic, and push the role/grant-level enums into the shared JSON schema so the manual ladder collapses.

#### [LOW] `requireRequestId` throws 500 for a condition the type system already guarantees won't happen
**File:** `packages/settings/src/routes.ts:356-362`  
**Invariant violated / concern:** Quality rule (over-defensive internal check on an established invariant).  
**Detail:** `resolveAccessContext` is the trusted producer of `AccessContext`; `requestId` is optional on the type but in practice always set by the auth runtime. Guarding every admin write with a `throw new HttpError(500, "Request id is missing")` adds a branch on a should-never-happen path. If the contract is "requestId is always present post-resolve," encode that in the resolved type rather than re-checking at five call sites.  
**Suggested fix:** Have `resolveAccessContext` return a context whose `requestId` is non-optional (or default it once at resolution), and delete `requireRequestId`.

#### [INFO] No SQL injection / secret-exposure issues found in this module
**File:** `packages/settings/src/repository.ts:1-506`, `routes.ts:445-512`  
**Invariant violated / concern:** Review dimensions A (injection) and invariant 5 (secrets never escape) — reviewed, clean.  
**Detail:** All queries are parameterized Kysely or the single `sql\`SELECT app.count_all_users()\`` template (no interpolated user input). Serializers (`serializeUser`, etc.) project only non-secret columns — `app.users` here has no password/token columns (auth secrets live in `auth_accounts`/`better_auth_sessions`, which this module never touches), so password hashes and session tokens cannot leak through `/api/me` or `/api/admin/users`. Audit-event metadata stores only IDs/keys/roles, never values or secrets. No `is_instance_admin` write path exists, so settings cannot be used for privilege escalation.  
**Suggested fix:** None.

#### [INFO] No `sql/` directory and no foreign-table access — module isolation respected
**File:** `packages/settings/` (no `sql/` dir) + `repository.ts` table list  
**Invariant violated / concern:** Invariant 9 (module isolation) and 11 (module SQL placement) — reviewed.  
**Detail:** Settings is a `required`/built-in platform module; its tables (`users`, `workspaces`, `workspace_memberships`, `resource_grants`, `instance_settings`, `admin_audit_events`) are all `app.`-schema platform tables defined in `infra/postgres/migrations/`, which is correct for a core platform surface (not a pluggable module that would own a `sql/` dir). It does not import another module's internals nor query a feature module's tables. No file approaches the 1000-line limit (largest is `routes.ts` at 551). Note: this module legitimately spans many `app.` tables because it IS the platform admin surface, so the "only its own tables" lens applies loosely — flagging for awareness, not as a violation.  
**Suggested fix:** None.
