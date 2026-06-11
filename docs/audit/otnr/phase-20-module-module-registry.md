## Phase 20 — Module module-registry

### CRIT / HIGH / MED / LOW / INFO counts

- CRIT: 0
- HIGH: 0
- MED: 4
- LOW: 3
- INFO: 3

### Findings

#### [MED] Registry is the canonical isolation boundary but enforces nothing it aggregates
**File:** `packages/module-registry/src/index.ts:95-175`  
**Invariant violated / concern:** Hard invariant 9 (Module isolation) — the registry is the single place where all modules are composed, yet it performs zero validation of the contract it owns.  
**Detail:** `BUILT_IN_MODULES` is a hand-curated array whose accessors blindly `map`/`flatMap` over it. There is no check for: duplicate module `id`s, duplicate `queueDefinitions[].name` across modules (`getAllQueueDefinitions` at line 189 concatenates `FOUNDATION_QUEUES` + every module's queues with no de-dup — a colliding queue name would be silently passed to `migratePgBoss` in `scripts/migrate.ts:33`), duplicate route paths, or overlapping `database.ownedTables` (two modules claiming the same table — the textbook isolation violation — would pass undetected). The registry is the one chokepoint where "module A reaches module B's tables" could be caught structurally, and it abstains. Because registration is static (no dynamic/third-party module loading exists), a module cannot claim *arbitrary* capabilities at runtime — but the registry also does not assert that what each module *does* claim is internally consistent or non-overlapping.  
**Suggested fix:** Add a one-time `assertModuleRegistryConsistency()` invariant run (in a test under `tests/integration/` and/or eagerly at module-load) that fails on duplicate module ids, duplicate queue names (including vs `FOUNDATION_QUEUES`), duplicate route method+path, and overlapping `ownedTables`. This converts the registry from a passive list into the enforced isolation boundary it is documented to be.

#### [MED] `availability` / `lifecycle` manifest fields are dead at the registration layer
**File:** `packages/module-registry/src/index.ts:197-213`  
**Invariant violated / concern:** Quality — contract surface that promises behavior the code never honors (cast-free but misleading contract; "private by default" / toggleability implied, not enforced).  
**Detail:** `ModuleAvailabilityManifest` (`packages/module-sdk/src/index.ts:42-48`) carries `defaultEnabled`, `required`, `supportsUserDisable`, `supportsWorkspaceDisable`, and `lifecycle` is `"required" | "optional" | "user-toggleable" | …`. Modules populate these (e.g. `packages/tasks/src/manifest.ts:50-56`). But `registerBuiltInApiRoutes` (line 197) and `registerBuiltInModuleWorkers` (line 207) unconditionally register routes and workers for **every** module regardless of `availability`/`lifecycle`; `getBuiltInSqlMigrationDirectories` likewise runs every module's migrations unconditionally. A reader auditing for "is this module actually disable-able?" will be misled — the answer today is "no, the field is decorative." CLAUDE.md ("When per-user module enable/disable ships") confirms this is intentional future work, which is why this is MED not HIGH, but the gap should be explicit.  
**Suggested fix:** Either gate registration on `availability`/`lifecycle` now, or add a short comment at the array (and on `ModuleAvailabilityManifest`) stating these fields are declarative-only until per-user enable/disable lands, so the contract does not over-promise.

#### [MED] Chat module is special-cased inline with a hardcoded MCP URL built from `process.env`
**File:** `packages/module-registry/src/index.ts:139-154`  
**Invariant violated / concern:** Quality — feature logic / environment plumbing leaked into the shared composition layer; ad-hoc special case bolted into an otherwise uniform table.  
**Detail:** Every other entry in `BUILT_IN_MODULES` is a flat `{ manifest, sqlMigrationDirectories, queueDefinitions, registerRoutes }` record that simply forwards `registerRoutes`/`registerWorkers`. The chat entry is the outlier: it inlines an arrow that (a) cherry-picks five fields off `deps`, (b) renames `listModuleManifests` → `resolveActiveModules`, and (c) **constructs the MCP server URL** `http://127.0.0.1:${process.env.PORT ?? 3000}/api/mcp` inside the registry. The registry should not know the MCP URL shape or read `process.env.PORT` — that is chat/server wiring. This duplicates the `PORT ?? 3000` default already present in `apps/api/src/server.ts:128`, so the two can drift, and it embeds a feature-specific localhost assumption in shared infrastructure.  
**Suggested fix:** Move the MCP-URL construction and the `deps` adaptation into `@jarv1s/chat`'s own `registerChatRoutes` (or a thin `registerChatModule` it exports), so the registry entry collapses back to the uniform shape. Source the port from a single shared config rather than re-reading `process.env.PORT` here.

#### [MED] Self-referential `getBuiltInModuleManifests()` call inside the array initializer
**File:** `packages/module-registry/src/index.ts:160-163`  
**Invariant violated / concern:** Quality — incidental complexity / fragile initialization-order coupling.  
**Detail:** The briefings entry's `registerWorkers` closure calls `getBuiltInModuleManifests()` (line 162), which itself reads the very `BUILT_IN_MODULES` constant being defined. This works only because the call is deferred inside a closure executed later, but it is a non-obvious circular dependency: the registry hands a module the full manifest list of *all* modules (including itself) at worker-registration time. Two different idioms for "give a module the manifest list" now coexist — chat uses `deps.listModuleManifests` (injected, line 146) while briefings uses the module-local `getBuiltInModuleManifests()` (line 162). The injected form is the better boundary (it lets the host control which modules are "active"); the direct call hard-wires briefings to the static built-in set and bypasses any future filtering.  
**Suggested fix:** Pass the manifest list to briefings via the injected dependency (add `moduleManifests`/`resolveActiveModules` to `BuiltInWorkerDependencies` the same way `BuiltInRouteDependencies.listModuleManifests` works) instead of calling `getBuiltInModuleManifests()` from inside the array. Removes the self-reference and unifies the two idioms.

#### [LOW] `registerRoutes` typed without `resolveAccessContext` awareness — silent auth-wiring divergence
**File:** `packages/module-registry/src/index.ts:85-93`  
**Invariant violated / concern:** Quality / Security-adjacent — the uniform `registerRoutes(server, deps)` signature gives every module the full `BuiltInRouteDependencies` (including `appDb`, `boss`, `resolveAccessContext`), but the type does not express which deps a module is *expected* to use.  
**Detail:** All modules receive the full dependency bag including the raw `appDb: Kysely<JarvisDatabase>` (line 66). Most modules route through `dataContext`/`resolveAccessContext`, but the registry contract hands every `registerRoutes` callback an un-scoped root Kysely handle. Nothing in the registry prevents a module from binding `appDb` directly and bypassing `DataContextDb` (hard invariant 3). The registry can't fully enforce this, but exposing the root handle to every module by default widens the blast radius.  
**Suggested fix:** Consider whether `appDb` truly needs to be in the shared `BuiltInRouteDependencies` bag, or whether the one consumer that needs it (settings/platform) can receive it through a narrower, module-specific channel. At minimum document why the root handle is exposed here.

#### [LOW] `registerBuiltInApiRoutes` returns `void`, discarding any per-module registration outcome
**File:** `packages/module-registry/src/index.ts:193-200`  
**Invariant violated / concern:** Quality / Error handling — fire-and-forget loop with no success signal.  
**Detail:** Unlike `registerBuiltInModuleWorkers` (which collects and returns worker ids, line 202-213, enabling the worker process to log/verify what registered), `registerBuiltInApiRoutes` loops and returns nothing. If a module's `registerRoutes` throws, Fastify's plugin lifecycle will surface it, but there is no positive confirmation of which modules registered routes, making startup diagnostics weaker than the worker path. Asymmetric design between the two otherwise-parallel registration functions.  
**Suggested fix:** Optionally return the list of module ids whose routes were registered, mirroring `registerBuiltInModuleWorkers`, for symmetric startup observability.

#### [LOW] Hand-maintained array is the only guard against missing wiring
**File:** `packages/module-registry/src/index.ts:95-175`  
**Invariant violated / concern:** Quality — the single source of truth for "what is installed" is an append-only manual array; omissions fail silently.  
**Detail:** Adding a new module requires manually appending to `BUILT_IN_MODULES`. If a developer ships a module package with a manifest, SQL, queues, and routes but forgets to add the entry here, nothing fails — the module simply does not exist at runtime, and no test catches it (the integration tests assert membership *for modules already in the list*). The accessor functions are correct and minimal; the risk is purely the manual maintenance contract.  
**Suggested fix:** Add a test that asserts every `@jarv1s/*` package exporting a `*ModuleManifest` appears in `getBuiltInModuleManifests()` (or document the manual-registration requirement prominently). Low priority because the set is small and stable.

#### [INFO] No SQL in the package — migration ownership lives correctly in owning modules
**File:** `packages/module-registry/src/index.ts:104-172`  
**Invariant violated / concern:** None — confirming compliance with hard invariant 11.  
**Detail:** `packages/module-registry` has no `sql/` directory. It only references each module's `*ModuleSqlMigrationDirectory` export (e.g. line 104, 110), which point into the owning module's own `sql/` directory. Migration SQL correctly lives in the owning module, never in the registry or `infra/`. `getBuiltInSqlMigrationDirectories` (line 185) simply flattens those references for `scripts/migrate.ts`. Compliant.

#### [INFO] Registry surface is `any`-free and uses typed, readonly contracts
**File:** `packages/module-registry/src/index.ts:65-93`  
**Invariant violated / concern:** None — confirming TypeScript-soundness expectations.  
**Detail:** `BuiltInRouteDependencies`, `BuiltInWorkerDependencies`, and `BuiltInModuleRegistration` are fully typed with `readonly` members and no `any`/`unknown`/non-null assertions. Manifests are typed `JarvisModuleManifest` (imported as a type, line 47), preserving module isolation (no value import of another module's internals). The one `unknown` in the manifest contract (`ToolExecute`'s `scopedDb`, `packages/module-sdk/src/index.ts:29-33`) is a deliberate, documented seam to avoid a module-sdk → db dependency and lives in module-sdk, not the registry. Clean.

#### [INFO] No dynamic/third-party module loading — capability claims are statically bounded
**File:** `packages/module-registry/src/index.ts:1-61`  
**Invariant violated / concern:** None — answering the module-specific focus question.  
**Detail:** Modules are imported as static workspace dependencies (lines 5-61) and composed in a compile-time-frozen array. There is no plugin loader, no filesystem/registry scan, and no path by which a module could register itself or claim a capability not present in this file at build time. The "can a module claim arbitrary capabilities?" risk is therefore bounded to "what a workspace-internal module hardcodes," which is reviewable in each module's manifest. The remaining gap is the absence of *consistency* validation across those static claims (see MED finding on duplicate ids/queues/ownedTables).
