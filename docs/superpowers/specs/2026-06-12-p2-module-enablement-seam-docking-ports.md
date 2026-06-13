# Module-enablement seam (docking ports)

**Status:** draft (2026-06-12) — design spec for Phase 2 epic #47 exit criterion #4, supersedes
issue #30. Implements ADR 0009 §3–§4. To be turned into an implementation plan and built.

**Grounded on:** local `main` at the audit-remediation tip (origin/main `7611a39` per project
memory; `0059_admin_tables_rls.sql` present in `infra/postgres/migrations/`, settings on the
per-method DataContextDb pattern). Confirm `pnpm audit:preflight` exits 0 before building.

---

## Goal

Make module enablement real and load-bearing without rearchitecting the module model. Today every
module is unconditionally "on": `resolveActiveModules(actorUserId)` is wired to
`() => getBuiltInModuleManifests()` and ignores the actor
(`packages/ai/src/gateway/types.ts:11`, `apps/api/src/server.ts:153`), the manifest `routes[]`
field is decorative (declared in every manifest, consumed nowhere), and a module's
`compatibility.jarv1s` range is never checked. This slice delivers the four mechanisms ADR 0009 §3
names: (1) a **deny-list enablement store** with a layered instance-floor + per-user resolver;
(2) a **request-time route-enablement guard** keyed off the manifest `routes[]` index;
(3) a **`compatibility.jarv1s` compat gate** validated against a `CORE_VERSION` constant at
registration time; and (4) **typed admin + self-service enablement endpoints**. The day-one
behavior change is **zero**: absence of a deny-list row = enabled, every current manifest is
`defaultEnabled:true` + `required:true` + `compatibility.jarv1s:">=0.0.0"`, so nothing can be
disabled and nothing is incompatible until a future module (Wellness, Phase 5) opts in.

---

## Architecture

The seam is **storage + a real resolver + a guard**, not a contract change (ADR 0009 §3). Module
manifests are unchanged structurally — they already carry `availability.{defaultEnabled, required,
supportsUserDisable, supportsWorkspaceDisable}` (`packages/module-sdk/src/index.ts:52`) and
`compatibility.jarv1s` (`:48`) and `routes[]` (`:66`, `:148`). We make three currently-inert fields
load-bearing and add one store.

**Enablement is two layered deny-lists.** Granularity is BOTH, layered: an instance-level disable
(admin-controlled) is a **hard floor**; a per-user disable refines on top. A module is active for a
user **iff**: the manifest is registered (passed the compat gate) AND it is NOT instance-disabled
AND it is NOT user-disabled-by-this-actor AND the manifest permits the relevant disable. The store
is a **deny-list**: a row means "disabled"; absence means "enabled" (honoring
`availability.defaultEnabled`, which is `true` for all 11 modules today). `required:true` modules can
**never** be disabled by anyone — the resolver ignores any row against them and the endpoints reject
the attempt. `supportsUserDisable:false` blocks a per-user disable but an instance disable may still
apply (as long as the module is not `required`). The migration inserts **no rows**, so the live
surface is byte-for-byte identical on day one.

**The resolver becomes async.** `resolveActiveModules(actorUserId)` must read the DB, so its type
changes from sync `(actorUserId: string) => readonly JarvisModuleManifest[]` to async
`(actorUserId: string) => Promise<readonly JarvisModuleManifest[]>`
(`packages/ai/src/gateway/types.ts:11`). This ripples through the MCP gateway, the chat token-mint
path, and the wiring in `apps/api/src/server.ts` — enumerated under **Components**. The resolver
reads the deny-list **under `withDataContext`** so per-user rows are RLS-scoped to the actor;
instance rows are readable by all authed actors.

**Routes are guarded per-request, not at registration.** Fastify routes register once at boot
(`registerBuiltInApiRoutes`, `packages/module-registry/src/index.ts:199`), so enablement cannot be
enforced by skipping registration — a module's routes are always wired. Instead a single Fastify
`onRequest` hook resolves the actor, maps `method + path` to its owning module via a **boot-time
route→module index built from the manifest `routes[]` fields**, and returns **404** (never 403 — do
not leak module existence) if that module is not active for the actor. Platform routes (auth,
health, bootstrap, `/api/modules`, and the enablement endpoints themselves) are never guarded. A
boot-time assertion fails startup if any registered route is neither claimed by a manifest
`routes[]` entry nor on an explicit platform/unguarded allowlist — this closes guard blind spots
that a prefix heuristic would create (settings owns `/api/me`, `/api/bootstrap/status`,
`/api/admin/*`, so prefix matching is unsafe).

**Compat is gated at registration.** `module-sdk` exports a single `CORE_VERSION` constant and a
tiny hand-rolled `satisfiesCoreVersion(range, version)` helper (no new `semver` dependency —
`module-sdk` depends only on `fastify`). At composition-root build time, `module-registry` refuses
any manifest whose `compatibility.jarv1s` range does not admit `CORE_VERSION`, **before** its
routes/workers/tools are registered — i.e. validate/enable without executing the module's code
(ADR 0009 §3). Every current range is `">=0.0.0"`, so all 11 modules pass.

---

## Components

### 1. `CORE_VERSION` + `satisfiesCoreVersion` (in `@jarv1s/module-sdk`)

- **What it does:** exports `export const CORE_VERSION = "0.1.0";` (a single source of truth for the
  platform's module-API version) and `export function satisfiesCoreVersion(range: string, version =
  CORE_VERSION): boolean`. The helper supports exactly the range forms in use plus the small set a
  near-future module needs: a bare exact version (`"0.1.0"`), and the comparator forms `>=`, `>`,
  `<=`, `<`, `=` against a single `major.minor.patch`. It does **not** implement full node-semver
  (no `^`/`~`/`||`/hyphen ranges) — ADR 0009 §5 explicitly skips per-module semver ranges; this is a
  guard, not a resolver. Unparseable ranges return `false` (fail closed).
- **How it's used:** `module-registry`'s registration path calls
  `satisfiesCoreVersion(manifest.compatibility.jarv1s)` for each built-in module before wiring it.
- **Depends on:** nothing new. `compatibility.jarv1s` is already required on every manifest
  (`packages/module-sdk/src/index.ts:48-50`, all set to `">=0.0.0"`).

### 2. Enablement store: `app.module_enablement` table + settings repository methods

- **What it does:** persists deny-list rows. Schema (one table, two scopes):
  - `id uuid PRIMARY KEY DEFAULT gen_random_uuid()`
  - `scope text NOT NULL CHECK (scope IN ('instance','user'))`
  - `module_id text NOT NULL`
  - `user_id uuid NULL REFERENCES app.users(id) ON DELETE CASCADE` — NULL for `scope='instance'`,
    NOT NULL for `scope='user'`
  - `disabled_by_user_id uuid NULL REFERENCES app.users(id) ON DELETE SET NULL` (audit provenance)
  - `created_at timestamptz NOT NULL DEFAULT now()`, `updated_at timestamptz NOT NULL DEFAULT now()`
  - `CHECK ((scope='instance' AND user_id IS NULL) OR (scope='user' AND user_id IS NOT NULL))`
  - Partial unique indexes: `UNIQUE (module_id) WHERE scope='instance'`;
    `UNIQUE (module_id, user_id) WHERE scope='user'`.
  - A row's **presence = disabled**. There is no `enabled` boolean — re-enabling is a `DELETE`.
- **How it's used:** the resolver reads all rows visible to the actor; the admin/self endpoints
  insert (disable) / delete (enable) rows. Lives in the **settings** module (settings owns
  instance/admin config) via new repository methods on `SettingsRepository`
  (`packages/settings/src/repository.ts`), each taking `scopedDb: DataContextDb` per the post-D
  per-method pattern (`assertDataContextDb(scopedDb)` first line, mirror `upsertInstanceSetting`):
  - `listModuleDenyRowsForActor(scopedDb)` — returns all instance rows (RLS: readable by all authed)
    plus this actor's own user rows (RLS: owner-only). Used by the resolver.
  - `listInstanceModuleDenyRows(scopedDb)` — instance rows only (admin GET surface).
  - `setInstanceModuleDisabled(scopedDb, { moduleId, disabled, actorUserId, requestId })` — admin:
    insert-on-conflict-do-nothing (disable) or delete (enable). Writes an `admin_audit_events` row
    via `this.insertAuditEvent` with action `module.instance_disable` / `module.instance_enable`,
    `targetType: "module"`, `targetId: moduleId`.
  - `setUserModuleDisabled(scopedDb, { moduleId, disabled, actorUserId, requestId })` — owner-scoped:
    insert/delete the actor's own user row. No admin-audit write (self-service is not an admin act).
- **Depends on:** `@jarv1s/db` (`DataContextDb`, `assertDataContextDb`), `app.users`,
  `app.admin_audit_events`, `app.current_actor_is_admin()` (RLS), `app.current_actor_user_id()`
  (RLS). New table must be added to the `JarvisDatabase` interface in
  `packages/db/src/types.ts:450` (`"app.module_enablement": ModuleEnablementTable;` + a
  `ModuleEnablementTable` interface and `ModuleEnablementRow = Selectable<…>` export, mirroring
  `InstanceSettingsTable`).

### 3. Settings-owned SQL migration + grants

- **What it does:** creates `app.module_enablement`, its indexes, RLS policies, and runtime grants.
  Two reality checks the implementer must honor:
  1. **Settings currently has NO `sql/` directory** — its `module-registry` entry is
     `sqlMigrationDirectories: []` (`packages/module-registry/src/index.ts:105`). This slice
     **creates** `packages/settings/sql/` and exports
     `settingsModuleSqlMigrationDirectory = fileURLToPath(new URL("../sql", import.meta.url))` from
     `packages/settings/src/manifest.ts` (mirror `tasksModuleSqlMigrationDirectory`,
     `packages/tasks/src/manifest.ts:43`), wiring it into the settings entry's
     `sqlMigrationDirectories: [settingsModuleSqlMigrationDirectory]`. The migrate script already
     globs every built-in module's dir (`scripts/migrate.ts:23,36`).
  2. **Migration number is assigned by global landing order — do NOT hardcode.** The runner enforces
     globally-unique version prefixes across all dirs (`assertUniqueMigrationVersions`,
     `packages/db/src/migrations/sql-runner.ts:145`); the highest applied number at build time is
     `0063` (`packages/tasks/sql/0063_tasks_fk_indexes.sql`). Pick the next free global number at
     build time. The file lives in `packages/settings/sql/`, **never** in
     `infra/postgres/migrations/` (module SQL lives in the owning module's `sql/` dir — Hard
     Invariant).
- **RLS (mirror `instance_settings` policy from `0059_admin_tables_rls.sql:24-46`):**
  - `ENABLE ROW LEVEL SECURITY` + `FORCE ROW LEVEL SECURITY`.
  - **Instance rows** (`scope='instance'`): SELECT permissive to `jarvis_app_runtime,
    jarvis_worker_runtime` `USING (scope = 'instance')` — readable by all authed actors so the
    resolver sees the floor; INSERT/UPDATE/DELETE `TO jarvis_app_runtime` gated on
    `app.current_actor_is_admin()` (writes are admin-only).
  - **User rows** (`scope='user'`): owner-only — SELECT/INSERT/UPDATE/DELETE
    `USING (user_id = app.current_actor_user_id())` / `WITH CHECK (user_id =
    app.current_actor_user_id())` (mirror the owner-only pattern, e.g. `0002_app_rls.sql:107`).
  - The two scopes are expressed as separate policies (one set keyed on `scope='instance'`, one on
    `user_id = current_actor`) so the resolver's single SELECT returns instance-floor ∪ own-user
    rows in one query.
  - **Grants:** `GRANT SELECT, INSERT, UPDATE, DELETE ON app.module_enablement TO
    jarvis_app_runtime;` and `GRANT SELECT ON app.module_enablement TO jarvis_worker_runtime;`
    inside the migration file (the precedent for per-table app.* grants is in-migration, e.g.
    `packages/tasks/sql/0003_tasks_module.sql:93`; the `infra/postgres/grants/` dir is pgboss-only).
    Worker needs SELECT only (briefings worker resolves tools via manifests — see Component 6).
- **Depends on:** `app.users`, `app.current_actor_is_admin()`, `app.current_actor_user_id()`,
  `gen_random_uuid()` (all already present). Additive, idempotent (`CREATE TABLE IF NOT EXISTS`,
  `CREATE … INDEX IF NOT EXISTS`, `DROP POLICY IF EXISTS` before each `CREATE POLICY`).

### 4. The async resolver factory (lives in `@jarv1s/module-registry`)

- **What it does:** a new exported factory
  `createActiveModulesResolver(deps: { dataContext: DataContextRunner; manifests: readonly
  JarvisModuleManifest[] }): ActiveModulesResolver` that returns an **async** function
  `async (actorUserId) => readonly JarvisModuleManifest[]`. Algorithm:
  1. `await dataContext.withDataContext({ actorUserId }, (scopedDb) =>
     settingsRepository.listModuleDenyRowsForActor(scopedDb))` — RLS gives instance rows + this
     actor's user rows only.
  2. For each registered manifest, keep it **unless** a deny rule applies:
     - if `availability.required === true` → always keep (ignore any row; rows should never exist for
       these, but be defensive).
     - else if an `scope='instance'` row exists for `module.id` → drop (hard floor).
     - else if `availability.supportsUserDisable !== false` AND a `scope='user'` row exists for
       (`module.id`, actor) → drop.
     - else keep.
  3. Honor `availability.defaultEnabled === false` as "drop unless an explicit enable exists" — but
     since the store is deny-only and all current modules are `defaultEnabled:true`, document this as
     a forward seam: a future `defaultEnabled:false` module would need an allow-row mechanism, which
     is **out of scope** (see Out of scope). For this slice, treat `defaultEnabled:false` as an
     unsupported manifest config and fail the compat/validation step rather than silently mis-resolve
     (assert at registration that every built-in is `defaultEnabled:true`).
- **How it's used:** `apps/api/src/server.ts` constructs it once and passes it as
  `resolveActiveModules` into `registerBuiltInApiRoutes`'s dependencies (replacing
  `listModuleManifests: getBuiltInModuleManifests` for the gateway/guard paths — see Components 5,6).
- **Depends on:** `@jarv1s/db` (`DataContextRunner`), `@jarv1s/settings`
  (`SettingsRepository.listModuleDenyRowsForActor`), the registered manifest list. `module-registry`
  already depends on both packages (`packages/module-registry/package.json`).

### 5. SYNC→ASYNC ripple (every call site, exhaustively)

The `ActiveModulesResolver` type flips to async. The implementer MUST update **all** of these:

- **`packages/ai/src/gateway/types.ts:11`** — change `ActiveModulesResolver` to
  `(actorUserId: string) => Promise<readonly JarvisModuleManifest[]>`. Update the doc comment.
- **`packages/ai/src/gateway/gateway.ts`** — `executableTools(actorUserId)` (`:180`) becomes
  `async executableTools(actorUserId): Promise<ExecutableTool[]>` and `await`s the resolver
  (`:181`). Its two callers become async:
  - `listToolsForActor(actorUserId)` (`:47`) → `async listToolsForActor(actorUserId):
    Promise<AiAssistantToolDto[]>`.
  - `callTool` (`:51`) already async — change `this.executableTools(actorUserId).find(...)` (`:55`)
    to `(await this.executableTools(actorUserId)).find(...)`.
- **`packages/chat/src/routes.ts:96-104`** — the `mint` callback captures the allowlist via
  `gateway!.listToolsForActor(actorUserId)` (now async). Make `mint` `async` and `await` it.
- **`packages/chat/src/live/runtime.ts:58-66`** — the `mcpTokenLifecycle.mint` type becomes
  `(actorUserId, chatSessionId) => Promise<{ token; mcpServerUrl }>`.
- **`packages/chat/src/live/chat-session-manager.ts:64,160`** — the `mintMcpToken` dep type becomes
  async; line 160 becomes `const mcpConfig = await this.deps.mintMcpToken?.(actorUserId,
  actorUserId);`. `launchSession` is already `async` (`:147`), so this is a clean `await`.
- **`packages/ai/src/routes.ts:71,363,391,430`** — the AI REST assistant-tools surface
  (`GET /api/ai/assistant-tools`, `POST /api/ai/assistant-tools/:name/invoke`) currently uses the
  sync `listModuleManifests()`. To keep behavior consistent (a disabled module's REST tool surface
  must also vanish), switch this dependency from `listModuleManifests: () => readonly Manifest[]` to
  `resolveActiveModules: ActiveModulesResolver` and `await` it inside the existing `withDataContext`
  blocks where `accessContext.actorUserId` is in scope. This makes the REST tool path and the MCP
  gateway path consistently actor-scoped.
- **`packages/module-registry/src/index.ts:154`** — the chat entry passes
  `resolveActiveModules: deps.listModuleManifests`. Replace with the real async resolver threaded
  through `BuiltInRouteDependencies` (add `resolveActiveModules: ActiveModulesResolver` to that
  interface, `:65`; keep `listModuleManifests` for the briefings/AI-non-actor paths that need the
  full registered set — see Component 6).
- **`apps/api/src/server.ts:149-159`** — construct the resolver (Component 4) and pass it in. Keep
  `listModuleManifests: getBuiltInModuleManifests` too (briefings definition validation needs the
  full set, not the actor-filtered one).
- **Tests:** every integration test that passes a sync resolver/stub must return a Promise. Call
  sites in `tests/integration/{mcp-gateway,chat-mcp-transport,ai-tools,ai}.test.ts` (which construct
  the gateway or pass `resolveActiveModules`) must wrap their stub in `async`.

### 6. `listModuleManifests` vs `resolveActiveModules` — keep both, deliberately

- `resolveActiveModules(actorUserId)` (async, actor-filtered) → the **tool surface** (MCP gateway +
  AI REST tools) and the **route guard**. Disabled modules vanish here.
- `listModuleManifests()` (sync, full registered set) → **briefings definition validation**
  (`packages/briefings/src/routes.ts:36,77,96` and worker `getBuiltInModuleManifests()`,
  `packages/module-registry/src/index.ts:168`) and `/api/modules` (`apps/api/src/server.ts:317`).
  These describe what the platform *ships*, not what's active for one actor, so they stay on the full
  set. The spec keeps the names distinct to prevent a future contributor collapsing them.

### 7. Request-time route-enablement guard (in `@jarv1s/module-registry`, registered by `server.ts`)

- **What it does:** builds a **boot-time route→module index** from the manifest `routes[]` of every
  registered module, then registers ONE Fastify `onRequest` hook that, for each request:
  1. Matches `request.method` + `request.routeOptions.url` (Fastify's matched route pattern, e.g.
     `/api/tasks/:id` — use the matched pattern, not the raw URL, so `:id` params match the manifest
     `path` which uses the same `:param` shape, cf. `packages/tasks/src/manifest.ts:144`) against the
     index. `onRequest` runs after routing, so `request.routeOptions.url` is populated.
  2. If the path is on the **platform/unguarded allowlist** (see below) → pass through, no actor
     resolution.
  3. Else, the path belongs to module `M`. Resolve the actor
     (`resolveAccessContext(request)`; on failure let the normal 401 path handle it — do not guard
     before auth). Call `resolveActiveModules(actorUserId)`; if `M` is in the active set → pass
     through; else `reply.code(404).send({ error: "Not found" })` (404, never 403 — do not leak that
     the module exists but is disabled).
  4. If the matched route is in neither the index nor the allowlist → that is a **boot-time bug**,
     not a request-time decision (see the startup assertion). At request time, an unindexed
     non-allowlisted route fails closed (404) defensively, but the startup assertion should have
     already prevented deploy.
- **Platform/unguarded allowlist (explicit, never guarded):**
  - `/health`, `/health/ready` (`apps/api/src/server.ts:119,121`)
  - `/api/auth/*` (`:278`)
  - `/api/bootstrap/status` (pre-auth, `packages/settings/src/routes.ts:63`)
  - `/api/me` (`:73`)
  - `/api/modules` (`apps/api/src/server.ts:312`)
  - all `/api/admin/*` settings routes (admin config; gated by `assertAdminUser`, not by module
    enablement — and includes the new admin enablement endpoints)
  - the new self-service enablement endpoints `/api/me/modules`, `/api/me/modules/:id`
  - The settings module's routes are platform routes (settings is `required:true` and owns the
    enablement surface) — list them explicitly rather than relying on a `required` shortcut, because
    the allowlist is about *which routes the guard skips*, decided at boot from known platform paths.
- **How it's used:** registered in `server.ts` `after()` **after** `registerBuiltInApiRoutes` so all
  routes (and thus `request.routeOptions.url` patterns) exist; the index is built from
  `getBuiltInModuleManifests()` `routes[]` once.
- **Depends on:** `ActiveModulesResolver`, `resolveAccessContext`, the registered manifests' `routes`.

### 8. Boot-time route-coverage assertion (closes guard blind spots)

- **What it does:** at startup (in `server.ts` `after()`, after route registration), enumerate every
  registered Fastify route (`server.printRoutes()` / the route tree, or an `onRoute` hook
  accumulator) and assert each `method + url` is **either** claimed by some manifest `routes[]`
  entry **or** on the explicit platform/unguarded allowlist. If any registered route is unaccounted
  for → throw at boot (fail the process), because the guard would have a blind spot for it. Symmetric
  check: every manifest `routes[]` entry should correspond to a registered route (catches drift where
  a manifest declares a route that no longer exists).
- **Why:** the LOCKED DECISION — prefix heuristics are unsafe (settings owns `/api/me`,
  `/api/bootstrap/status`, `/api/admin/*`). The manifest must be the single source of truth
  (ADR 0009 §4), and an explicit coverage assertion is the only thing that makes "routes[] is
  load-bearing" verifiable rather than aspirational. **Implementation note for the builder:** several
  modules' actual registered routes may not yet be fully mirrored in their manifest `routes[]` (e.g.
  chat memory routes in `packages/chat/src/routes.ts:168-236`, AI assistant-tool routes). Making the
  assertion pass requires either adding the missing entries to those manifests' `routes[]` **or**
  adding those specific paths to the platform/unguarded allowlist with a documented rationale. This
  reconciliation is **in scope** and is the bulk of the careful work — budget for it.
- **Depends on:** the registered route tree + manifests + allowlist.

### 9. Admin enablement endpoints (in `@jarv1s/settings`)

Dedicated typed endpoints — **not** overloading `instance_settings`. All under
`withDataContext` + `assertAdminUser` (mirror `packages/settings/src/routes.ts:124-170`), audited
via `admin_audit_events`:

- `GET /api/admin/modules` → returns each registered module with `{ id, name, version, lifecycle,
  required, supportsUserDisable, instanceDisabled }` (instanceDisabled from the deny-list). New
  shared DTO + route schema in `packages/shared/src/platform-api.ts` (mirror
  `listModulesRouteSchema`, `:234`).
- `PATCH /api/admin/modules/:id` body `{ disabled: boolean }` → calls
  `setInstanceModuleDisabled`. **Rejects** with 409/422 if the target module is `required:true`
  ("Required modules cannot be disabled") or unknown (404). On success returns the updated row.
- These routes are on the guard's platform allowlist (admin config is gated by `assertAdminUser`,
  not by module enablement).

### 10. Self-service enablement endpoints (in `@jarv1s/settings`)

Owner-scoped, no admin gate — the actor manages their own per-user deny rows:

- `GET /api/me/modules` → for the calling actor, each registered module with `{ id, name, active,
  instanceDisabled, userDisabled, required, supportsUserDisable }`. `active` is computed identically
  to the resolver (instance floor + user row + manifest rules) so the UI and the gateway never
  disagree.
- `PATCH /api/me/modules/:id` body `{ disabled: boolean }` → calls `setUserModuleDisabled`.
  **Rejects** (409/422) if the target is `required:true` ("Required modules cannot be disabled") or
  `supportsUserDisable === false` ("This module cannot be disabled per-user"), or 404 if unknown.
- New shared DTOs + route schemas in `packages/shared/src/platform-api.ts`. These routes are on the
  guard's platform allowlist (a user must always be able to re-enable a module they disabled — if the
  guard 404'd `/api/me/modules` for a disabled… it is its own surface, never gated).

---

## Data flow

**Resolve (read path, every tool listing / guarded request):**
`actorUserId` → `createActiveModulesResolver` → `withDataContext({actorUserId})` →
`SettingsRepository.listModuleDenyRowsForActor(scopedDb)` (RLS returns instance rows ∪ own-user
rows) → filter registered manifests by the four rules (required / instance-floor / user-disable /
default) → `readonly JarvisModuleManifest[]`.

**Guarded request:** request → Fastify routing populates `request.routeOptions.url` → `onRequest`
hook → allowlist check → (if module route) resolve actor → resolver → in active set? → pass / 404.

**Disable (write path, admin):** `PATCH /api/admin/modules/:id {disabled:true}` →
`resolveAccessContext` → `withDataContext` → `assertAdminUser` → reject if `required` →
`setInstanceModuleDisabled` (insert deny row + `admin_audit_events` `module.instance_disable`) → 200.
Next request from any actor for that module's routes/tools now resolves it out.

**Disable (write path, self):** `PATCH /api/me/modules/:id {disabled:true}` → `resolveAccessContext`
→ `withDataContext` → reject if `required` or `!supportsUserDisable` → `setUserModuleDisabled`
(insert owner-scoped deny row, RLS `WITH CHECK user_id = current_actor`) → 200. That actor's tool
surface and that actor's guarded routes for the module now 404; other actors unaffected.

**Compat gate (boot):** `module-registry` build → for each built-in,
`satisfiesCoreVersion(manifest.compatibility.jarv1s, CORE_VERSION)` → if false, throw before wiring
routes/workers/tools (module code never executes). All `">=0.0.0"` → all pass.

---

## Error handling

- **Resolver DB failure:** the resolver runs in `withDataContext`; a DB error propagates. For the
  **route guard**, a resolver failure must **fail closed** (return 500 via the normal error path, not
  silently pass the request through) — never fall open to "all modules enabled," which would defeat an
  instance disable. For **tool listing** in the gateway, a failure surfaces as an empty/failed list,
  not an unfiltered list.
- **Endpoint validation:** unknown `module_id` → 404; `required:true` target → 409 (conflict with an
  immutable invariant) with a clear message; `!supportsUserDisable` on the self endpoint → 422; bad
  body (`disabled` not boolean) → 400. Mirror `parseInstanceSettingBody` validation style
  (`packages/settings/src/routes.ts:462`).
- **Guard 404 vs 403:** always 404 for "module not active for this actor" (do not leak existence).
  Genuine auth failures keep their existing 401 from `resolveAccessContext`.
- **Compat gate failure:** throw a descriptive error at boot naming the module id, its declared
  range, and `CORE_VERSION`. The process must not start with an incompatible module half-wired.
- **Coverage assertion failure:** throw at boot listing the offending route(s) and whether they were
  unindexed or undeclared, so the fix (add to manifest `routes[]` or to the allowlist) is obvious.
- **Secrets:** none of these paths touch credentials/tokens; deny rows are non-secret config. Audit
  metadata records only `moduleId` + actor + requestId (Hard Invariant: metadata-only).

---

## Security & invariants

Cites the CLAUDE.md Hard Invariants this slice touches:

- **DataContextDb only.** The resolver and all new repository methods take `scopedDb: DataContextDb`
  (never a root `Kysely`), `assertDataContextDb(scopedDb)` first line, run under
  `withDataContext` (mirror `SettingsRepository`, `packages/settings/src/repository.ts:47`). No new
  root-handle escape hatch.
- **AccessContext shape.** The resolver constructs `{ actorUserId }` only (optionally `requestId`) —
  no new fields. (`AccessContext = { actorUserId, requestId? }`, `packages/db/src/data-context.ts:7`.)
- **No admin private-data bypass / RLS applies to all.** Instance deny rows are admin-*writable* but
  this is configuration power, not a data bypass — RLS still gates writes via
  `app.current_actor_is_admin()`, no `BYPASSRLS`. Per-user rows are owner-only at the DB layer
  (`user_id = app.current_actor_user_id()`), so the resolver cannot leak one user's disabled set to
  another even if application code erred.
- **Private by default.** Per-user enablement is owner-scoped; default (no row) = the module's
  `defaultEnabled` (true today), which is the existing behavior.
- **Module isolation.** Modules collaborate only through declared public APIs. The store and resolver
  live in **settings** (owns instance/admin config); the gateway/guard consume the resolver through
  the existing `ActiveModulesResolver` type — no module imports another's internals or queries
  `app.module_enablement` directly except settings (its owner). `module-registry` is the composition
  root and is the only place that wires the resolver in.
- **Never edit applied migrations / module SQL in owning module's `sql/`.** A **new** migration file
  is added under `packages/settings/sql/` (creating that dir), numbered by global landing order,
  never under `infra/postgres/migrations/`. `0059_admin_tables_rls.sql` and all other applied files
  are untouched.
- **Metadata-only audit.** `admin_audit_events` rows carry `moduleId`, actor, requestId — no private
  content.
- **`required:true` is an immutable floor.** Enforced in three places (defense in depth): the
  resolver ignores rows against required modules; both endpoints reject disabling them; (optionally)
  a `CHECK`/trigger is *not* added at the DB layer because module ids are app-level, not enumerable
  in SQL — the app-layer triple-guard is the contract.

---

## Testing strategy

All integration tests run via Vitest against the `db:up` Postgres (per CLAUDE.md). New + updated
suites:

- **Resolver unit/integration** (`tests/integration/module-enablement.test.ts`, new):
  - Empty store → all 11 modules active (zero behavior change baseline).
  - Insert an instance deny row for a *hypothetical non-required* module fixture → resolver drops it
    for all actors; required modules with a (defensively-inserted) row stay active.
  - Insert a user deny row for actor A only → dropped for A, present for actor B (RLS isolation).
  - `supportsUserDisable:false` + user row → still active for that user (per-user disable ignored);
    `supportsUserDisable:false` + instance row → dropped (instance floor still applies).
  - Because all 11 built-ins are `required:true` today, tests use a **test-only manifest fixture**
    (a non-required, user-disablable manifest) injected into the resolver to exercise the drop paths
    without mutating real manifests.
- **Route guard** (`tests/integration/route-guard.test.ts`, new): with the test fixture module
  mounting a route, a guarded request returns 200 when active and **404** (assert not 403) when
  instance- or user-disabled; platform routes (`/api/me`, `/health`, `/api/admin/*`,
  `/api/me/modules`) are never 404'd by the guard.
- **Coverage assertion** (in the guard test or a dedicated boot test): constructing the server with a
  manifest whose `routes[]` omits a registered route → boot throws; the real server boots clean
  (proves the in-scope manifest/allowlist reconciliation is complete).
- **Compat gate** (`module-sdk` unit test for `satisfiesCoreVersion` + a registry test): `">=0.0.0"`
  / `"0.1.0"` / `">=0.1.0"` admit `CORE_VERSION`; `">=9.0.0"` / `"<0.1.0"` / garbage are refused;
  a registry built with an incompatible fixture manifest throws before wiring.
- **Admin endpoints** (extend `tests/integration/settings.test.ts` or a new admin-modules suite):
  non-admin → 403; admin disable/enable round-trips and writes `admin_audit_events`; disabling a
  `required` module → 409.
- **Self endpoints**: actor disables a (fixture) user-disablable module → `GET /api/me/modules` shows
  `active:false`; re-enable round-trips; disabling `required` → 409, `!supportsUserDisable` → 422;
  one actor's row never affects another's `GET /api/me/modules` (RLS).
- **Async ripple regression**: existing `tests/integration/{mcp-gateway,chat-mcp-transport,ai-tools}`
  suites pass with the async resolver (their stubs updated to `async`).
- **Gate:** `pnpm verify:foundation` green (lint, format, file-size <1000 lines, typecheck,
  db:migrate, integration) + `pnpm audit:release-hardening` green.

---

## Acceptance criteria

1. `@jarv1s/module-sdk` exports `CORE_VERSION` (single constant) and `satisfiesCoreVersion(range,
   version?)`; unit tests cover bare-version and `>=,>,<=,<,=` forms and fail-closed on garbage.
2. `module-registry` refuses to wire any built-in whose `compatibility.jarv1s` does not admit
   `CORE_VERSION`, **before** that module's routes/workers/tools register; a fixture-incompatible
   manifest throws at build with a message naming the module, range, and `CORE_VERSION`. All 11
   current modules (`">=0.0.0"`) pass.
3. A new settings-owned migration under `packages/settings/sql/` (numbered by global landing order,
   not hardcoded; **not** in `infra/postgres/migrations/`) creates `app.module_enablement` with the
   scope/module_id/user_id schema, partial unique indexes, RLS (instance rows readable by all authed
   + admin-only writes mirroring `0059` `instance_settings`; user rows owner-only), and runtime
   grants. `settingsModuleSqlMigrationDirectory` is exported and wired into the settings
   `BUILT_IN_MODULES` entry. `pnpm db:migrate` is idempotent (clean re-run).
4. `ActiveModulesResolver` is **async**
   (`(actorUserId) => Promise<readonly JarvisModuleManifest[]>`) and every enumerated call site
   compiles and works: gateway (`executableTools`, `listToolsForActor`, `callTool`), chat
   token-mint (`routes.ts`, `runtime.ts`, `chat-session-manager.ts`), AI REST tools surface
   (`ai/src/routes.ts`), `module-registry` wiring, and `apps/api/src/server.ts`.
5. With an **empty** `app.module_enablement`, the live tool surface and all module routes behave
   exactly as before this slice (zero behavior change) — proven by the existing suites passing
   unchanged plus the resolver baseline test.
6. The resolver enforces the layered rule: `required:true` → never droppable (by anyone);
   instance row → dropped for all actors (unless required); user row → dropped only for that actor
   and only if `supportsUserDisable !== false`. Proven against a non-required test fixture.
7. A single Fastify `onRequest` guard maps `method + matched-route-pattern` to a module via a
   boot-time index built from manifest `routes[]`, returns **404** (asserted, not 403) for a module
   not active for the actor, and never guards the platform/unguarded allowlist.
8. A boot-time coverage assertion fails startup if any registered route is neither in a manifest
   `routes[]` nor on the explicit allowlist (and vice-versa); the real server boots clean, proving
   every registered route is reconciled (manifests' `routes[]` extended and/or allowlist entries
   added as needed).
9. `GET/PATCH /api/admin/modules[/:id]` (admin, audited) and `GET/PATCH /api/me/modules[/:id]`
   (owner-scoped) exist with typed shared DTOs/schemas; both reject disabling `required` modules,
   the self endpoint also rejects `!supportsUserDisable`, unknown ids 404; admin acts write
   `admin_audit_events`.
10. `app.module_enablement` is added to `JarvisDatabase` in `packages/db/src/types.ts` with its table
    interface + `Selectable` export; no raw-`Kysely` repository handle is introduced; all new
    repository methods assert `DataContextDb`.
11. `pnpm verify:foundation` and `pnpm audit:release-hardening` are green; no source file exceeds
    1000 lines.

---

## Out of scope / deferred

- **`defaultEnabled:false` allow-list semantics.** The store is deny-only; a module that ships
  *off by default* (needing an explicit *enable* row) is a future extension. This slice asserts all
  built-ins are `defaultEnabled:true` and documents the seam.
- **Workspace-scoped disable.** `supportsWorkspaceDisable` exists on the manifest but workspaces were
  removed (AccessContext has no `workspaceId`, Slice 1f). No workspace scope here.
- **Web admin/settings UI.** API-first this slice. A thin admin "Modules" surface and a per-user
  settings toggle are a follow-up (the `/api/modules` + new endpoints already feed a UI). ADR 0009
  consequence: Wellness (Phase 5) is the first real *optional* module to exercise the seam.
- **Per-tool / per-permission enablement.** Enablement is per-module only.
- **Out-of-process / remote MCP, full node-semver ranges, OSGi-style hot-swap.** Explicitly skipped
  by ADR 0009 §5.
- **Making any current module `required:false`.** No production manifest changes its availability in
  this slice — that is a per-module decision deferred to when a module is actually meant to be
  optional.

---

## Open risks

1. **Route-coverage reconciliation is bigger than it looks.** Several registered routes are not yet
   mirrored in their module's manifest `routes[]` (chat memory routes, AI assistant-tool routes,
   notifications/connectors/email routes may be incomplete). The coverage assertion will surface
   every gap. The builder must either add accurate `routes[]` entries (preferred — makes the manifest
   truly load-bearing) or allowlist specific paths with rationale. Under-budgeting this is the most
   likely cause of an overnight build stalling. Mitigation: do the reconciliation **first**, behind
   the assertion, before wiring the guard's 404 behavior.
2. **`request.routeOptions.url` pattern vs manifest `path` shape.** The guard matches Fastify's
   matched-route pattern (`/api/tasks/:id`) to the manifest `path`. If any manifest uses a different
   param syntax than Fastify (it uses `:id` — consistent), matching breaks silently. Mitigation: the
   coverage assertion compares these exact strings at boot, so a mismatch fails startup, not prod.
3. **Per-request resolver cost.** The guard calls the resolver (a `withDataContext` round-trip) on
   every guarded request. For the small built-in set this is one indexed SELECT per request.
   Acceptable for a self-hosted single-household app; if it ever matters, a short-TTL per-actor cache
   is a clean follow-up (out of scope now). Do NOT cache in a way that makes a disable take effect
   late in a security-relevant way without documenting the window.
4. **Fail-open regression.** A subtle bug (resolver returns the full set on DB error, or the guard
   passes through on resolver throw) would silently defeat an instance disable. Mitigation: explicit
   fail-closed tests (guard returns 500/404, not 200, on resolver error) per Error handling.
5. **All-`required` today means the seam is untested by real modules.** Every drop-path test relies
   on a test-only fixture manifest. The first production exercise is Wellness (Phase 5); a latent bug
   in the required/optional interaction could lurk until then. Mitigation: make the fixture faithful
   (covers required, instance-disablable-only, and fully-user-disablable cases).
6. **Settings gaining a `sql/` dir + the next global migration number.** Two coordination hazards:
   the settings module never had a SQL dir (wiring must be added in both `manifest.ts` and the
   `module-registry` entry), and the migration number must be the next free **global** prefix at
   build time (currently `0063` is the high-water mark; pick the next, re-check at build because other
   in-flight slices may land numbers concurrently — see the Fleet Operations note that migration
   numbers are global by landing order).
