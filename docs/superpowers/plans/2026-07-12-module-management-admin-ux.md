# Module-management admin UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **This repo overrides the above:** `coordinated-build` disables both execution sub-skills. Drive
> this plan yourself, task by task, via `superpowers:test-driven-development`. One commit per task,
> `Co-Authored-By: Claude` trailer, generous why-comments citing `#996`/`#860`.

**Goal:** Make downloadable modules always-on (delete the `JARVIS_ENABLE_EXTERNAL_MODULES` gate),
make Commitments/People/Goals/Notes non-toggleable (`lifecycle:"required"`), consolidate the admin
Modules pane so a downloaded module appears in exactly one row with a working enable/disable
switch, and carry the change into the repo's prod compose file.

**Architecture:** Four independent slices (S1 gate removal, S2 manifest flip, S3 pane
consolidation, S4 compose) that touch disjoint files except where S1's config shape
(`ApiServerConfig`) flows into S3's data (`ListExternalModulesResponse.enabled`,
`GetModuleRegistryResponse.enabled`). Build S1 first (it removes a nullable type that S3 doesn't
depend on, but touches the most call sites) then S2 (independent, zero resolver code), then S3
(consolidation, depends on S2's manifest flip being live so `!module.required` renders correctly),
then S4 (compose, independent, can be done any time after S1).

**Tech Stack:** TypeScript, Fastify, React + `@tanstack/react-query`, Vitest, Playwright
(`tests/e2e`), pnpm workspaces.

## Global Constraints

- Module isolation: no module imports another module's internals or queries its tables directly.
- `AccessContext` stays `{ actorUserId, requestId }` — no new fields.
- Never edit an applied migration; **this feature adds no migration** (S2 confirmed: the resolver's
  `required === true` short-circuit already ignores per-user/per-instance deny rows for required
  modules — `packages/module-registry/src/active-modules-resolver.ts:40-41`).
- No `git add -A`. Stage only each task's own files. Don't commit `PLAN-996.md`/`BRIEF-996.md`.
- Never touch `packages/ai/**`, `packages/chat/**`, `packages/module-registry/src/index.ts`, or
  AI-admin settings surfaces (Codex-869's concurrent lane, branch `ai-admin-869`, issue #982).
- S4 is repo-side only — never touch `~/JarvisProd/` or any live box.
- Generous why-comments on every change citing `#996`/`#860` and the constraint/trap they guard
  (bundled-path-resolution trap for `resolveModulesDir`; fail-closed removal for the gate deletes).
- Pre-push trio before every push: `pnpm format:check && pnpm lint && pnpm typecheck`, then
  `git fetch origin main && git rebase origin/main`.
- Full gate before wrap-up: `pnpm verify:foundation` and `pnpm test:integration`, both green,
  exit codes recorded.

---

## Task 1: `resolveModulesDir(env)` shared helper

**Files:**

- Create: `packages/module-registry/src/resolve-modules-dir.ts`
- Modify: `packages/module-registry/src/node.ts` (add one re-export line)
- Test: `tests/unit/resolve-modules-dir.test.ts`

**Interfaces:**

- Consumes: nothing (leaf helper — `node:fs`, `node:path`, `node:url` only).
- Produces: `resolveModulesDir(env?: NodeJS.ProcessEnv): string`, exported from
  `@jarv1s/module-registry/node` — every later S1 task imports this.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/resolve-modules-dir.test.ts
import { existsSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

import { resolveModulesDir } from "../../packages/module-registry/src/resolve-modules-dir.js";

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, existsSync: vi.fn(actual.existsSync) };
});

describe("resolveModulesDir (#996, #860)", () => {
  it("honors an explicit JARVIS_MODULES_DIR override verbatim", () => {
    expect(resolveModulesDir({ JARVIS_MODULES_DIR: "/srv/modules" } as NodeJS.ProcessEnv)).toBe(
      "/srv/modules"
    );
  });

  it("resolves to <repoRoot>/data/modules via the pnpm-workspace.yaml marker walk when unset", () => {
    // This test runs from the real repo checkout, so the real marker walk finds the real
    // pnpm-workspace.yaml — asserting the suffix (not the whole path) keeps it portable
    // across CI checkout locations and local worktrees.
    const dir = resolveModulesDir({} as NodeJS.ProcessEnv);
    expect(dir.endsWith(`${"data"}/modules`.replace("/", require("node:path").sep))).toBe(true);
    expect(existsSync(dir.slice(0, dir.lastIndexOf("data") - 1))).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/unit/resolve-modules-dir.test.ts`
Expected: FAIL — `Cannot find module '../../packages/module-registry/src/resolve-modules-dir.js'`

- [ ] **Step 3: Write minimal implementation**

```typescript
// packages/module-registry/src/resolve-modules-dir.ts
// #996/#860: shared external-modules-dir resolver. Before this file, 4+ call sites
// (server.ts, worker.ts, start-jarv1s.ts, module-reconcile.ts) each independently read
// `env.JARVIS_MODULES_DIR ?? null`, which meant "no dir" and "gate off" were coupled —
// the #917 flag removal (#996) needs a dev/test default that does NOT depend on an env
// var, so this resolver adds the fallback chain those call sites lacked.
//
// CANNOT anchor on a fixed `MODULE_DIR/../..` offset: this module is consumed as SOURCE
// (never esbuild-bundled — see node.ts's header, "Server-only entry... consumed via
// workspace resolution"), but is invoked from both `tsx`-run scripts (cwd = repo root)
// and the bundled api/worker (`import.meta.url` collapses to the bundle dir under
// esbuild — the known bundled-path-resolution trap, see
// packages/cli-runner/src/catalog.ts's findRepoRoot for the same problem solved the
// same way). So: explicit env override first, then walk UP from this module's own
// directory to the nearest pnpm-workspace.yaml (the repo-root marker, present in both
// the `tsx`-from-src case and the container image, since the prod image's WORKDIR is
// the repo root copy), then the container WORKDIR fallback, then cwd.
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));

export function resolveModulesDir(env: NodeJS.ProcessEnv = process.env): string {
  if (env.JARVIS_MODULES_DIR) return env.JARVIS_MODULES_DIR;

  let dir = MODULE_DIR;
  for (let i = 0; i < 16; i++) {
    if (existsSync(path.join(dir, "pnpm-workspace.yaml"))) {
      return path.join(dir, "data", "modules");
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  if (existsSync(path.join("/app", "pnpm-workspace.yaml"))) {
    return path.join("/app", "data", "modules");
  }
  return path.join(process.cwd(), "data", "modules");
}
```

Add the re-export to `packages/module-registry/src/node.ts` (after the existing
`export * from "./distribution/pipeline.js";` line):

```typescript
export * from "./resolve-modules-dir.js";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/unit/resolve-modules-dir.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/module-registry/src/resolve-modules-dir.ts packages/module-registry/src/node.ts tests/unit/resolve-modules-dir.test.ts
git commit -m "feat(modules): add resolveModulesDir helper (#996, #860)

Shared fallback chain (env override -> pnpm-workspace.yaml marker walk ->
container WORKDIR -> cwd) replacing 4 independent JARVIS_MODULES_DIR ?? null
reads that the #917 always-on gate removal will consume.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 2: `apps/api/src/server.ts` — delete the gate from `ApiServerConfig`

**Files:**

- Modify: `apps/api/src/server.ts:114-125` (`ApiServerConfig`), `:136-156`
  (`resolveApiServerConfig`), `:165-188` (`discoverExternalModules`), `:200-209`
  (`externalRuntimeEnabled`/`workerDb`), `:349-354` (resolver call), `:374-384` (job-routes guard),
  `:528-533` (`externalModules.enabled`)
- Test: `tests/unit/api-server-config.test.ts:31-55` (replace the whole describe block)

**Interfaces:**

- Consumes: `resolveModulesDir` from Task 1 (`@jarv1s/module-registry/node` — already imported in
  `server.ts` for other symbols, add `resolveModulesDir` to the existing import list).
- Produces: `ApiServerConfig.externalModulesDir: string` (non-nullable — Task 3/4/9 consume this).
  `ApiServerConfig.enableExternalModules` is REMOVED — any later task referencing it is a bug.

- [ ] **Step 1: Write the failing test** (replaces the existing describe block wholesale)

```typescript
// tests/unit/api-server-config.test.ts — replace lines 31-55
describe("resolveApiServerConfig external modules dir (#996, #860)", () => {
  it("honors JARVIS_MODULES_DIR when set", () => {
    const config = resolveApiServerConfig({
      JARVIS_MODULES_DIR: "/srv/modules"
    } as NodeJS.ProcessEnv);
    expect(config.externalModulesDir).toBe("/srv/modules");
  });

  it("falls back to a resolved dev default when unset (never null)", () => {
    const config = resolveApiServerConfig({} as NodeJS.ProcessEnv);
    expect(typeof config.externalModulesDir).toBe("string");
    expect(config.externalModulesDir.length).toBeGreaterThan(0);
  });

  it("no longer exposes enableExternalModules", () => {
    const config = resolveApiServerConfig({} as NodeJS.ProcessEnv);
    expect((config as Record<string, unknown>).enableExternalModules).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/unit/api-server-config.test.ts`
Expected: FAIL — `config.externalModulesDir` is `null` (old code), first two assertions fail.

- [ ] **Step 3: Write minimal implementation**

In `apps/api/src/server.ts`, add `resolveModulesDir` to the existing
`@jarv1s/module-registry/node` import (line 56 area). Replace the `ApiServerConfig` interface:

```typescript
export interface ApiServerConfig {
  readonly host: string;
  readonly port: number;
  readonly mcpServerUrl: string;
  // #996/#860: external (non-compiled) trusted-operator modules are always on — the
  // JARVIS_ENABLE_EXTERNAL_MODULES flag was removed (previously required exactly "1").
  // externalModulesDir always resolves to a usable path via resolveModulesDir; it is
  // never null. Discovery still runs ONCE at boot (the mount is read-only and changes
  // only across a redeploy), so a package swap still requires a container restart.
  readonly externalModulesDir: string;
}
```

Replace `resolveApiServerConfig`'s body:

```typescript
export function resolveApiServerConfig(env: NodeJS.ProcessEnv = process.env): ApiServerConfig {
  const port = Number(env.PORT ?? 3000);
  const host = env.HOST ?? "0.0.0.0";
  return {
    host,
    port,
    mcpServerUrl: env.JARVIS_MCP_SERVER_URL ?? `http://127.0.0.1:${port}/api/mcp`,
    externalModulesDir: resolveModulesDir(env)
  };
}
```

Replace `discoverExternalModules`'s guard (delete the early return, dir is always set):

```typescript
export function discoverExternalModules(
  config: ApiServerConfig,
  log: { info: (o: object, m: string) => void; warn: (o: object, m: string) => void }
): ExternalModuleLoadResult {
  const snapshot = getExternalModuleRegistrations({
    modulesDir: config.externalModulesDir,
    coreVersion: CORE_VERSION,
    reservedQueueNames: new Set(getAllQueueDefinitions().map((queue) => queue.name))
  });
  log.info(
    { discovered: snapshot.discoveries.length, rejected: snapshot.rejected.length },
    "external modules discovered (#996 always-on)"
  );
  for (const rejection of snapshot.rejected) {
    log.warn(
      { moduleId: rejection.id, reason: rejection.reason },
      "external module rejected (#917)"
    );
  }
  return snapshot;
}
```

Replace the `externalRuntimeEnabled`/`workerDb` block (`:200-209`) — always create `workerDb`:

```typescript
const workerDb =
  options.workerDb ??
  createDatabase({
    connectionString: getJarvisDatabaseUrls().worker,
    maxConnections: Number(process.env.JARVIS_API_WORKER_DB_POOL_SIZE ?? 2)
  });
const ownsWorkerDb = options.workerDb === undefined;
const workerDataContext = new DataContextRunner(workerDb);
```

(This changes `workerDataContext` from `DataContextRunner | undefined` to always-defined —
Task 3 updates `createExternalModuleTools`'s call site to match; grep other
`workerDataContext` reads in `server.ts` at build time and drop any now-dead `?.`/undefined
checks you find, since a `DataContextRunner | undefined` reference degrading to always-defined
is a compile-time-safe narrowing, never a break.)

Replace the resolver call (`:349-354`) — drop `enabled`:

```typescript
const getActiveExternalModules = createActiveExternalModulesResolverForApi({
  appDataContext: dataContext,
  settingsRepository: externalModulesRepository,
  discoveries: externalModuleSnapshot.discoveries
});
```

Delete the job-routes guard (`:374-384`) — always register:

```typescript
registerExternalModuleJobRoutes(server, {
  boss,
  discoveries: externalModuleSnapshot.discoveries,
  resolveAccessContext: authRuntime.resolveAccessContext,
  isModuleActive: async (access, moduleId) =>
    (await getActiveExternalModules(access)).some((module) => module.id === moduleId),
  rateLimitKey: authPrincipalRateLimitKey
});
```

(Note `getActiveExternalModules` is no longer optional after Task 3 — drop the `?.` and the
`=== true` coercion since the resolver always returns an array now.)

Replace `externalModules.enabled` (`:528-533`):

```typescript
      externalModules: {
        // #996/#860: always-on since the JARVIS_ENABLE_EXTERNAL_MODULES flag removal —
        // packages/settings routes-module-registry.ts / routes-modules.ts gate on this
        // field with `if (!ext?.enabled) throw 409`; hardcoding true here means those
        // guards simply never fire, which is correct (verified — no change needed there).
        enabled: true,
        discoveries: externalModuleSnapshot.discoveries,
        rejected: externalModuleSnapshot.rejected,
        reconcile: (states) => reconcileExternalModules(externalModuleSnapshot.discoveries, states)
      },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/unit/api-server-config.test.ts`
Expected: PASS (5 tests total — 2 MCP-URL tests untouched + 3 new)

Also run: `pnpm --filter @jarv1s/api typecheck` — expect it to FAIL right now (Task 3/4 haven't
updated their call sites yet); this is expected mid-slice breakage. Do not commit until Task 4
closes the loop, OR commit this task alone only if you confirm `tsc` errors are confined to
`external-module-tools.ts`/`module-distribution-port.ts` (the next two tasks) and no other file.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/server.ts tests/unit/api-server-config.test.ts
git commit -m "feat(modules): remove JARVIS_ENABLE_EXTERNAL_MODULES gate from server.ts (#996, #860)

External modules are always-on now. ApiServerConfig.externalModulesDir is
non-nullable (resolveModulesDir always returns a path); enableExternalModules
is removed. Known follow-on typecheck errors in external-module-tools.ts and
module-distribution-port.ts are fixed in the next two commits.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 3: `apps/api/src/external-module-tools.ts` — drop `enabled` from the resolver factory

**Files:**

- Modify: `apps/api/src/external-module-tools.ts:70-89`
- Test: none new (covered by existing integration coverage of `/api/modules`; this is a pure
  signature simplification with no behavior change for the always-true case)

**Interfaces:**

- Consumes: nothing new.
- Produces: `createActiveExternalModulesResolverForApi(input: { appDataContext, settingsRepository,
discoveries }): (accessContext: AccessContext) => Promise<readonly ReconciledExternalModule[]>`
  — always-defined return (drops the `| undefined` union). Task 2's call site already matches this.

- [ ] **Step 1: Write the failing test**

No new test file — this task removes a branch (`if (!input.enabled) return undefined`) that has
no direct unit test today (grep confirms `createActiveExternalModulesResolverForApi` is only
exercised via `server.ts` integration paths). Verify via typecheck instead:

Run: `pnpm --filter @jarv1s/api typecheck`
Expected: FAIL — `Property 'enabled' is missing in type '{ appDataContext: ...; }'` at
`server.ts`'s call site (added in Task 2), because `external-module-tools.ts` still requires it.

- [ ] **Step 2: (same run as above — this IS the "verify it fails" step for a signature-only change)**

- [ ] **Step 3: Write minimal implementation**

```typescript
// apps/api/src/external-module-tools.ts:65-89, replace:
/**
 * Per-actor active-module resolver: instance-enabled minus the actor's deny
 * rows. Extracted from server.ts composition (#932) — behavior unchanged.
 * #996/#860: always-defined now — external modules are always-on, so there is
 * no "disabled by config" case to return undefined for.
 */
export function createActiveExternalModulesResolverForApi(input: {
  readonly appDataContext: DataContextRunner;
  readonly settingsRepository: SettingsRepository;
  readonly discoveries: readonly ExternalModuleDiscovery[];
}): (accessContext: AccessContext) => Promise<readonly ReconciledExternalModule[]> {
  return async (accessContext) => {
    const { states, denyRows } = await input.appDataContext.withDataContext(
      accessContext,
      async (scopedDb) => ({
        states: await input.settingsRepository.listExternalModuleStates(scopedDb),
        denyRows: await input.settingsRepository.listModuleDenyRowsForActor(scopedDb)
      })
    );
    const { modules } = reconcileExternalModules(input.discoveries, states);
    const disabled = new Set(denyRows.map((row) => row.module_id));
    return modules.filter((module) => module.active && !disabled.has(module.id));
  };
}
```

Also update the two consumers whose param type was `getActiveExternalModules?: (...) => ...`
(optional, to accommodate the old possibly-undefined resolver) — narrow them to required now that
the factory never returns undefined:

- `apps/api/src/server.ts:836-844` (`registerPlatformRoutes`): change
  `getActiveExternalModules?: (...)` to `getActiveExternalModules: (...)` (drop the `?`), and at
  its one call site (`:852-854`) drop the `getActiveExternalModules ? ... : []` ternary down to a
  direct call: `const external = (await getActiveExternalModules(accessContext)).map(serializeExternalModule);`
- `apps/api/src/external-module-web-route.ts:19-26` (`registerExternalModuleWebAssetRoute`): same
  narrowing — read the file at build time to find its exact optional-param usage and drop the `?`
  and any `?.`/ternary derived from it, mirroring the `registerPlatformRoutes` change above.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @jarv1s/api typecheck`
Expected: PASS (no more missing-`enabled`-property error)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/external-module-tools.ts apps/api/src/server.ts apps/api/src/external-module-web-route.ts
git commit -m "refactor(modules): drop enabled flag from active-modules resolver factory (#996, #860)

createActiveExternalModulesResolverForApi always returns a defined resolver now;
registerPlatformRoutes and registerExternalModuleWebAssetRoute narrow their
getActiveExternalModules param from optional to required to match.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 4: `apps/api/src/module-distribution-port.ts` — drop the gate

**Files:**

- Modify: `apps/api/src/module-distribution-port.ts:26-34`
- Test: none new (pure branch deletion; existing `/api/admin/module-registry` integration coverage
  exercises the always-defined path going forward)

**Interfaces:**

- Consumes: `ApiServerConfig.externalModulesDir` (now non-nullable, from Task 2).
- Produces: `createModuleDistributionPort(...): ModuleDistributionDependencies` (drops the
  `| undefined` union — its one call site at `server.ts:476` already tolerates either shape since
  it's just assigned to a local and threaded through, no narrowing needed there).

- [ ] **Step 1: Write the failing test**

Run: `pnpm --filter @jarv1s/api typecheck`
Expected: after Task 2, `externalModulesDir` is `string`, so the line
`if (!apiServerConfig.enableExternalModules || externalModulesDir === null)` fails to compile
(`enableExternalModules` no longer exists on `ApiServerConfig` — this IS the failing state).

- [ ] **Step 2: (verified above)**

- [ ] **Step 3: Write minimal implementation**

```typescript
// apps/api/src/module-distribution-port.ts:16-34, replace:
/**
 * #964/#996 — module-distribution port for the settings registry routes, extracted from
 * server.ts (Task 6 pushed server.ts over the 1000-line file-size cap; #9.5 restores
 * it). Network + filesystem composition only; DB writes stay in @jarv1s/settings, so
 * this file never needs a database handle (module-isolation invariant). The index
 * cache is per-process (10 min, spec §6); a failed refetch returns null (degrade) and
 * leaves any previous cache untouched so the next request can retry. Always-on since
 * #996 removed the JARVIS_ENABLE_EXTERNAL_MODULES gate — externalModulesDir is never
 * null (resolveModulesDir always resolves a path), so this always constructs the port.
 */
export function createModuleDistributionPort(
  server: Pick<FastifyInstance, "log">,
  apiServerConfig: ApiServerConfig,
  options: Pick<CreateApiServerOptions, "fetchFn">
): ModuleDistributionDependencies {
  const externalModulesDir = apiServerConfig.externalModulesDir;
  const fetchFn = options.fetchFn;
  // ... rest of the function body (REGISTRY_CACHE_TTL_MS, registryCache, return {...})
  // is UNCHANGED — only the guard above and the return type annotation change.
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @jarv1s/api typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/module-distribution-port.ts
git commit -m "refactor(modules): always construct the module-distribution port (#996, #860)

Drops the enableExternalModules/externalModulesDir-null guard now that the
flag is gone and resolveModulesDir always resolves a path.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 5: `apps/worker/src/worker.ts` — always-on external worker config

**Files:**

- Modify: `apps/worker/src/worker.ts:79-84` (`resolveExternalWorkerConfig`), and its call site
  around `:205-209`
- Test: `tests/integration/worker-lifecycle.test.ts:138-153` (rewrite the describe block)

**Interfaces:**

- Consumes: `resolveModulesDir` from Task 1.
- Produces: `resolveExternalWorkerConfig(env?): { readonly modulesDir: string }` (drops
  `| null` — the one call site's `if (externalConfig)` guard becomes always-true; simplify it away).

- [ ] **Step 1: Write the failing test**

```typescript
// tests/integration/worker-lifecycle.test.ts — replace lines 138-153
describe("external module job reconciliation (#996, #860)", () => {
  it("always resolves a modulesDir (never null — the flag was removed)", () => {
    expect(resolveExternalWorkerConfig({} as NodeJS.ProcessEnv).modulesDir).toBeTruthy();
    expect(
      resolveExternalWorkerConfig({ JARVIS_MODULES_DIR: "/modules" } as NodeJS.ProcessEnv)
    ).toEqual({ modulesDir: "/modules" });
  });
```

(Leave the following `it("creates dead-letter targets before sources...")` test at `:155+`
untouched — only the flag-behavior test above is replaced.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/integration/worker-lifecycle.test.ts -t "external module job reconciliation"`
Expected: FAIL — old `resolveExternalWorkerConfig` returns `null` for the no-env-arg case.

- [ ] **Step 3: Write minimal implementation**

```typescript
// apps/worker/src/worker.ts:74-84, replace:
export function resolveExternalWorkerConfig(env: NodeJS.ProcessEnv = process.env): {
  readonly modulesDir: string;
} {
  return { modulesDir: resolveModulesDir(env) };
}
```

Add `resolveModulesDir` to the existing `@jarv1s/module-registry/node` import at the top of
`worker.ts`. At the call site (`:205-209`), read the surrounding `if (externalConfig) {...}` block
at build time and simplify it to use `resolveExternalWorkerConfig(env).modulesDir` directly
(no longer conditional — the block's body runs unconditionally now).

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/integration/worker-lifecycle.test.ts -t "external module job reconciliation"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/worker.ts tests/integration/worker-lifecycle.test.ts
git commit -m "feat(modules): always resolve worker external-modules dir (#996, #860)

resolveExternalWorkerConfig never returns null now; the worker always wires
up external-module job reconciliation.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 6: `scripts/start-jarv1s.ts` — always push the reconcile oneShot

**Files:**

- Modify: `scripts/start-jarv1s.ts:109-119`
- Test: `tests/unit/start-jarv1s-plan.test.ts:28-42` (simplify — drop the flag env, assert
  unconditional)

**Interfaces:**

- Consumes: nothing new (doesn't need `resolveModulesDir` — it just always pushes the oneShot;
  `module-reconcile.ts` itself resolves the dir when it runs, per Task 7).
- Produces: `buildStartupPlan(env).oneShots` always includes the `module-reconcile.ts` oneShot
  (previously conditional).

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/start-jarv1s-plan.test.ts — replace the "appends module reconcile..." test at 28-42
it("always appends module reconcile after migrate (#996 always-on)", () => {
  const plan = buildStartupPlan({
    NODE_ENV: "production",
    JARVIS_HOST_UID: "1234",
    JARVIS_HOST_GID: "1235",
    JARVIS_CLI_RUNNER_RPC_SECRET: "rpc-secret"
  } as NodeJS.ProcessEnv);

  expect(plan.oneShots.map((oneShot) => oneShot.command)).toEqual([
    ["node_modules/.bin/tsx", "scripts/migrate.ts"],
    ["node_modules/.bin/tsx", "scripts/module-reconcile.ts"]
  ]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/unit/start-jarv1s-plan.test.ts -t "always appends module reconcile"`
Expected: FAIL — current code only appends when both env vars are set; this env has neither.

- [ ] **Step 3: Write minimal implementation**

```typescript
// scripts/start-jarv1s.ts:103-119, replace:
export function buildStartupPlan(env: NodeJS.ProcessEnv = process.env): StartupPlan {
  const { uid, gid } = runtimeUidGid(env);
  const oneShotEnv = { ...env, NODE_ENV: env.NODE_ENV ?? "production" };
  const oneShots: OneShotSpec[] = [
    { command: ["node_modules/.bin/tsx", "scripts/migrate.ts"], env: oneShotEnv, uid, gid },
    // #996/#860: reconcile modules AFTER core migrations (module installs depend on the
    // platform tables existing) and BEFORE the api/worker boot (they must see the
    // post-reconcile module set). Always runs now — external modules are always-on.
    { command: ["node_modules/.bin/tsx", "scripts/module-reconcile.ts"], env: oneShotEnv, uid, gid }
  ];
  return {
    uid,
    gid,
    oneShots,
    resident: [
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/unit/start-jarv1s-plan.test.ts`
Expected: PASS (all tests in the file)

- [ ] **Step 5: Commit**

```bash
git add scripts/start-jarv1s.ts tests/unit/start-jarv1s-plan.test.ts
git commit -m "feat(modules): always run module-reconcile at boot (#996, #860)

Drops the JARVIS_ENABLE_EXTERNAL_MODULES/JARVIS_MODULES_DIR conditional —
the reconcile oneShot always runs after migrate now.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 7: `scripts/module-reconcile.ts` — CLI entrypoint always runs

**Files:**

- Modify: `scripts/module-reconcile.ts:386-395`
- Test: none new (this file's CLI entrypoint guard has no existing unit test — it's an
  `if (process.argv[1] === ...)` main-module guard exercised only by actually running the script,
  which the integration/e2e suites don't invoke directly; behavior is verified by Task 6's plan
  test plus manual confirmation the script no-ops-to-success when run, see Step 4)

**Interfaces:**

- Consumes: `resolveModulesDir` from Task 1.
- Produces: the CLI always calls `reconcileModules({ modulesDir })` — no more "disabled" no-op path.

- [ ] **Step 1: Write the failing test**

No new automated test (see rationale above). Verify manually instead:

Run: `pnpm exec tsx scripts/module-reconcile.ts` (from repo root, with no
`JARVIS_ENABLE_EXTERNAL_MODULES`/`JARVIS_MODULES_DIR` env set)
Expected (current/failing behavior): logs
`[module-reconcile] external modules disabled — nothing to do` and exits 0 without touching the
DB — this is the OLD always-skips behavior we're removing.

- [ ] **Step 2: (verified above — this is the "before" state)**

- [ ] **Step 3: Write minimal implementation**

```typescript
// scripts/module-reconcile.ts:386-409, replace:
// CLI: `tsx scripts/module-reconcile.ts` (wired into container boot after migrate.ts and
// into the root `db:reconcile` script for dev parity). #996/#860: always runs now — the
// JARVIS_ENABLE_EXTERNAL_MODULES flag is gone, external modules are always-on.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const modulesDir = resolveModulesDir(process.env);
  reconcileModules({ modulesDir })
    .then((report) => {
      console.log(
        `[module-reconcile] purged=${report.purged.length} ensured=${report.ensured.length} ` +
          `accepted=${report.accepted.length} installed=${report.installed.length} ` +
          `drifted=${report.drifted.length} warnings=${report.warnings.length}`
      );
      process.exit(0);
    })
    .catch((error) => {
      console.error("[module-reconcile] fatal:", error);
      process.exit(1);
    });
}
```

Add `resolveModulesDir` to the existing `@jarv1s/module-registry/node` import at the top of
`module-reconcile.ts` (it already imports several symbols from that entry point — join the list).

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec tsx scripts/module-reconcile.ts` (needs `JARVIS_APP_DATABASE_URL`/dev DB reachable —
run against the local dev Postgres per `docs/DEVELOPMENT_STANDARDS.md`)
Expected: logs a `purged=… ensured=… accepted=… installed=… drifted=… warnings=…` summary line
(the real reconcile path, not the disabled no-op) and exits 0.

- [ ] **Step 5: Commit**

```bash
git add scripts/module-reconcile.ts
git commit -m "feat(modules): module-reconcile CLI always runs (#996, #860)

Drops the enabled/modulesDir-null early-exit; uses resolveModulesDir directly.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 8: `tests/e2e/mock-modules.ts` — drop the stale flag comment

**Files:**

- Modify: `tests/e2e/mock-modules.ts:188-201`

**Interfaces:**

- Consumes: nothing.
- Produces: nothing new — comment/doc accuracy only, no behavior change (the mock already always
  seeds `enabled:true`-shaped responses; only its comment referenced the now-deleted flag).

- [ ] **Step 1–4: N/A (comment-only change, no test to write/run)**

Read `tests/e2e/mock-modules.ts:175-230` in full at build time to confirm the exact comment text
before editing (already captured above at lines 179-201: the two comments referencing
`JARVIS_ENABLE_EXTERNAL_MODULES=1` and "mirrors the server having..."). Replace both comments to
reflect always-on:

```typescript
/**
 * Stateful mock for the #917 external-modules admin surface (Settings → Instance modules).
 * Seeds one discovered-but-inactive module; the POST toggle flips its status in-memory so the
 * pane round-trips (enable → refetch shows the switch checked), mirroring the stateful handlers
 * in mock-api.ts (e.g. handleAdminUsersRoute).
 *
 * MUST be registered AFTER mockApi(page, …): Playwright matches the most-recently-registered
 * route first, so these override mockApi's catch-all 404 for /api/*.
 */
export async function mockExternalModules(page: Page): Promise<void> {
  // #996/#860: external modules are always-on now (no server-side flag to mirror) — this
  // mock always seeds `enabled:true`, matching production's always-on ListExternalModulesResponse.
  let current: ExternalModuleDto = {
```

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/mock-modules.ts
git commit -m "docs(modules): update e2e mock comment for always-on external modules (#996, #860)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 9: `infra/docker-compose.prod.yml` + `.gitignore` — S4

**Files:**

- Modify: `infra/docker-compose.prod.yml:68`, `:107`
- Modify: `.gitignore` (add `/data/`)

**Interfaces:** none (compose env config only).

- [ ] **Step 1–4: N/A (no test framework covers compose YAML; verify by inspection + `docker compose config`)**

Delete line 68 (`module-install` service) and line 107 (`jarv1s` service) — both read
`JARVIS_ENABLE_EXTERNAL_MODULES: "${JARVIS_ENABLE_EXTERNAL_MODULES:-1}"`. Keep the adjacent
`JARVIS_MODULES_DIR: /data/modules` lines (`:69`, `:108`) exactly as-is — they already match
`resolveModulesDir`'s container fallback and compose still needs to declare the mount-path env
explicitly for the volume-backed path.

Verify: `docker compose -f infra/docker-compose.prod.yml config >/dev/null` (repo-side syntax
check only — do NOT run `up`/`pull` against `~/JarvisProd/`, out of scope per BRIEF-996.md).

Add to `.gitignore` (repo root):

```
/data/
```

(Confirmed no existing entry via grep this session — `resolveModulesDir`'s dev fallback creates
`<repoRoot>/data/modules` the first time a dev runs `module-reconcile.ts` locally, and that
directory must never be committed.)

- [ ] **Step 5: Commit**

```bash
git add infra/docker-compose.prod.yml .gitignore
git commit -m "chore(modules): drop JARVIS_ENABLE_EXTERNAL_MODULES from prod compose (#996, #860)

Repo-side only — the live ~/JarvisProd/ box refresh is a separate
Ben/coordinator action. Also gitignore the dev data/ dir resolveModulesDir's
fallback creates.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 10: manifest flip — Commitments/People/Goals/Notes become `required`

**Files:**

- Modify: `packages/commitments/src/manifest.ts`, `packages/people/src/manifest.ts`,
  `packages/goals/src/manifest.ts`, `packages/notes/src/manifest.ts`
- Test: `tests/unit/active-modules-resolver.test.ts` (add 4 cases — create the file if it does not
  already exist; grep confirms `active-modules-resolver.ts` has existing coverage somewhere under
  `tests/unit` or `tests/integration` — read the existing file's location and describe-block
  structure at build time before adding, to match its existing patterns rather than diverging)

**Interfaces:**

- Consumes: nothing new — `packages/module-registry/src/active-modules-resolver.ts:40-41`'s
  existing `if (availability?.required === true) return true;` short-circuit is UNCHANGED, this
  task only flips manifest data feeding it.
- Produces: `commitmentsManifest.lifecycle === "required"`,
  `commitmentsManifest.availability.required === true` (and same for people/goals/notes) — Task 11
  and 12 depend on this for the `!module.required` filters to render the right set.

- [ ] **Step 1: Write the failing test**

```typescript
// add to whatever describe block already exercises active-modules-resolver.ts's
// required-module short-circuit (read the existing file first; if none exists, create
// tests/unit/active-modules-resolver.test.ts and import resolveActiveModules per its
// existing exported signature)
import { commitmentsManifest } from "../../packages/commitments/src/manifest.js";
import { goalsManifest } from "../../packages/goals/src/manifest.js";
import { notesManifest } from "../../packages/notes/src/manifest.js";
import { peopleManifest } from "../../packages/people/src/manifest.js";

describe("required built-in modules (#996, #860)", () => {
  it.each([
    ["commitments", commitmentsManifest],
    ["people", peopleManifest],
    ["goals", goalsManifest],
    ["notes", notesManifest]
  ])("%s is lifecycle:required with availability.required true", (_name, manifest) => {
    expect(manifest.lifecycle).toBe("required");
    expect(manifest.availability?.required).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/unit/active-modules-resolver.test.ts -t "required built-in modules"`
Expected: FAIL — all 4 currently have `lifecycle: "user-toggleable"` (or notes'
`required: false`).

- [ ] **Step 3: Write minimal implementation**

For `packages/commitments/src/manifest.ts`, `packages/people/src/manifest.ts`,
`packages/goals/src/manifest.ts` (identical shape in all three — confirmed this session):

```typescript
// was: lifecycle: "user-toggleable", availability: { defaultEnabled: true },
  // #996/#860: Commitments (and People/Goals) moved from user-toggleable to required —
  // spec 2026-07-12-module-management-admin-ux.md decided core productivity modules
  // should never be turned off; only Wellness/Sports/News stay user-toggleable.
  lifecycle: "required",
  availability: { defaultEnabled: true, required: true },
```

For `packages/notes/src/manifest.ts` (was `availability: { defaultEnabled: true, required: false,
supportsUserDisable: true }`):

```typescript
  // #996/#860: Notes moves to required (same rationale as commitments/people/goals).
  // supportsUserDisable stays true — harmless: active-modules-resolver.ts's
  // `required === true` short-circuit runs BEFORE this field is ever read, so it has
  // no effect once required flips; leaving it avoids an unrelated schema-shape edit.
  lifecycle: "required",
  availability: { defaultEnabled: true, required: true, supportsUserDisable: true },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/unit/active-modules-resolver.test.ts`
Expected: PASS (all tests in the file, including the 4 new cases)

- [ ] **Step 5: Commit**

```bash
git add packages/commitments/src/manifest.ts packages/people/src/manifest.ts packages/goals/src/manifest.ts packages/notes/src/manifest.ts tests/unit/active-modules-resolver.test.ts
git commit -m "feat(modules): make Commitments/People/Goals/Notes required (#996, #860)

lifecycle: required + availability.required: true. No migration — the
resolver's required-module short-circuit already ignores per-instance/
per-user deny rows for these modules.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 11: `settings-module-view-model.ts` — drop the stale toggleable-ids set

**Files:**

- Modify: `apps/web/src/settings/settings-module-view-model.ts:22-28`
- Test: create `tests/unit/settings-module-view-model.test.ts` (none exists yet — grep confirmed)

**Interfaces:**

- Consumes: `MyModuleDto.required: boolean` (`packages/shared/src/platform-api-modules.ts:27`,
  unchanged).
- Produces: `visibleUserToggleModules(modules): readonly SettingsModule[]` — same signature, new
  body. Sole caller `settings-personal-data-panes.tsx:641` needs no change.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/settings-module-view-model.test.ts
import { describe, expect, it } from "vitest";

import { visibleUserToggleModules } from "../../apps/web/src/settings/settings-module-view-model.js";
import type { MyModuleDto } from "@jarv1s/shared";

function mod(id: string, required: boolean): MyModuleDto {
  return { id, name: id, active: true, required, instanceDisabled: false } as MyModuleDto;
}

describe("visibleUserToggleModules (#996, #860)", () => {
  it("shows only non-required modules, driven by the field not a hardcoded id set", () => {
    const modules = [mod("wellness", false), mod("commitments", true), mod("acme-widgets", false)];
    expect(visibleUserToggleModules(modules).map((m) => m.id)).toEqual([
      "wellness",
      "acme-widgets"
    ]);
  });

  it("excludes 'finance' when it is required, proving the old hardcoded id set is gone", () => {
    expect(visibleUserToggleModules([mod("finance", true)])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/unit/settings-module-view-model.test.ts`
Expected: FAIL — old code's `USER_TOGGLEABLE_MODULE_IDS` set includes `"finance"` unconditionally
and excludes `"acme-widgets"` (not in the hardcoded set) regardless of `required`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// apps/web/src/settings/settings-module-view-model.ts:22-28, replace:
// #996/#860: previously a hardcoded USER_TOGGLEABLE_MODULE_IDS set (including a stale
// "finance" id — no such module exists) had to be kept in sync by hand with every
// module's manifest lifecycle. Now derived directly from MyModuleDto.required, which
// the server already computes from each module's manifest (Task 10 flips
// commitments/people/goals/notes to required, so they drop out of this list for free).
export function visibleUserToggleModules(
  modules: readonly SettingsModule[]
): readonly SettingsModule[] {
  return modules.filter((module) => !module.required);
}
```

(Delete the `USER_TOGGLEABLE_MODULE_IDS` line entirely — no other reference to it exists per this
session's grep of `settings-personal-data-panes.tsx`.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/unit/settings-module-view-model.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/settings/settings-module-view-model.ts tests/unit/settings-module-view-model.test.ts
git commit -m "refactor(modules): derive user-toggleable modules from required, not a hardcoded id set (#996, #860)

Drops USER_TOGGLEABLE_MODULE_IDS (had a stale 'finance' entry). After Task 10's
manifest flip this renders exactly Wellness/Sports/News for the personal My-data pane.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 12: `settings-admin-panes.tsx` — de-dup the external group against the registry

**Files:**

- Modify: `apps/web/src/settings/settings-admin-panes.tsx:554-691` (`InstanceModulesPane`)
- Test: create `tests/unit/instance-modules-dedup.test.ts` (pure function extracted for
  testability — see Step 3) OR, if this repo's convention for React-heavy files is
  component/e2e-only coverage, add the Playwright case in Task 13 instead and skip a unit test
  here (check `apps/web/src/settings/*.test.ts*` at build time for the established pattern before
  deciding; if a sibling pane file has a co-located unit test for similar list-filtering logic,
  match its location and naming)

**Interfaces:**

- Consumes: `queryKeys.settings.adminModuleRegistry`, `getModuleRegistry` (both already imported by
  `settings-module-registry-section.tsx`, add the same imports here — React Query dedupes by
  queryKey, so this is not a second network call).
- Produces: a pure `filterUndeclaredExternalModules(externalModules, registryIds): ExternalModuleDto[]`
  helper Task 13 doesn't need but a unit test can target directly; `InstanceModulesPane` itself
  gains a `registryQuery` and passes 3 new props into `<ModuleRegistrySection />` (defined in
  Task 13: `externalModules`, `onSetEnabled`, `settingEnabledPending`).

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/instance-modules-dedup.test.ts
import { describe, expect, it } from "vitest";

import { filterUndeclaredExternalModules } from "../../apps/web/src/settings/settings-admin-panes.js";
import type { ExternalModuleDto } from "@jarv1s/shared";

function ext(id: string): ExternalModuleDto {
  return {
    id,
    name: id,
    version: "0.1.0",
    publisher: "p",
    status: "enabled",
    active: true,
    drifted: false,
    disabledReason: null,
    web: null
  };
}

describe("filterUndeclaredExternalModules (#996, #860)", () => {
  it("drops external modules already present in the registry index", () => {
    const result = filterUndeclaredExternalModules(
      [ext("acme-widgets"), ext("local-only-mod")],
      new Set(["acme-widgets"])
    );
    expect(result.map((m) => m.id)).toEqual(["local-only-mod"]);
  });

  it("keeps everything when the registry set is empty (registry unreachable)", () => {
    expect(filterUndeclaredExternalModules([ext("a")], new Set()).map((m) => m.id)).toEqual(["a"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/unit/instance-modules-dedup.test.ts`
Expected: FAIL — `filterUndeclaredExternalModules` is not exported (doesn't exist yet).

- [ ] **Step 3: Write minimal implementation**

Export a small pure helper from `settings-admin-panes.tsx` (near the top, alongside other
module-level helpers like `moduleDescription`):

```typescript
// #996/#860: a module downloaded via the registry (Task 12/13) is BOTH a registry row
// (installed-enabled/installed-disabled) AND a discovered external module (#917's
// scan of the modules dir) — before this, it rendered in BOTH the "External modules"
// group AND the "Available modules" registry list. Filter the external group down to
// modules the registry index doesn't know about (declared-not-present / truly
// local-only modules never published to the registry).
export function filterUndeclaredExternalModules(
  externalModules: readonly ExternalModuleDto[],
  registryIds: ReadonlySet<string>
): readonly ExternalModuleDto[] {
  return externalModules.filter((module) => !registryIds.has(module.id));
}
```

In `InstanceModulesPane`, add the registry subscription (React Query dedupes this against
`ModuleRegistrySection`'s identical queryKey/queryFn — confirmed no double-fetch) and use the
helper to filter the external group's render list, and thread the enable/disable wiring down to
`ModuleRegistrySection` (finished in Task 13):

```typescript
// #996/#860: subscribe to the SAME registry query ModuleRegistrySection uses
// (identical queryKey+queryFn -> React Query serves one cached fetch to both) so this
// pane can filter registry-known modules out of the "External modules" group below.
const registryQuery = useQuery({
  queryKey: queryKeys.settings.adminModuleRegistry,
  queryFn: () => getModuleRegistry(false),
  retry: false
});
const registryIds = new Set((registryQuery.data?.modules ?? []).map((row) => row.id));
```

Change the external group's render source (`external.modules.map(...)` at the current line 650)
to:

```typescript
          {filterUndeclaredExternalModules(external.modules, registryIds).length ? (
            filterUndeclaredExternalModules(external.modules, registryIds).map((module) => {
```

(Leave the rest of that `.map()` body, the empty-state branch, and the trusted-operator `<Note>`
exactly as they are — only the source list changes.) Add the imports:
`getModuleRegistry` to the existing `../api/client` import list, `queryKeys.settings
.adminModuleRegistry` already available via the existing `queryKeys` import.

Pass the new props to `<ModuleRegistrySection />` at the current line 688:

```typescript
      <ModuleRegistrySection
        externalModules={external?.modules}
        onSetEnabled={(id, enabled) => setExternalEnabled.mutate({ id, enabled })}
        settingEnabledPending={setExternalEnabled.isPending}
      />
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/unit/instance-modules-dedup.test.ts`
Expected: PASS

Also run: `pnpm --filter @jarv1s/web typecheck` — expect a FAIL here referencing
`ModuleRegistrySection`'s props (it doesn't accept them yet) — this is expected mid-slice
breakage, resolved by Task 13. Do not push until Task 13 closes the loop.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/settings/settings-admin-panes.tsx tests/unit/instance-modules-dedup.test.ts
git commit -m "feat(modules): de-dup External-modules group against the registry list (#996, #860)

A downloaded module previously appeared in both the registry rows and the
#917 external group. InstanceModulesPane now subscribes to the same
adminModuleRegistry query (no extra fetch — React Query dedupes by key) and
filters the external group to modules the registry doesn't declare.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 13: `settings-module-registry-section.tsx` — enable/disable Switch for installed rows

**Files:**

- Modify: `apps/web/src/settings/settings-module-registry-section.tsx` (whole file — add a props
  interface, thread 3 new props, render a `Switch` for `installed-enabled`/`installed-disabled` rows)
- Test: `tests/e2e/settings-modules.spec.ts` (create if no such spec exists yet — grep
  `tests/e2e/*.spec.ts` at build time for the established naming/location pattern for settings
  panes before creating; reuse `mockExternalModules`/`mockApi` from `tests/e2e/mock-modules.ts`
  and `tests/e2e/mock-api.ts`)

**Interfaces:**

- Consumes: `ExternalModuleDto` from `@jarv1s/shared` (already used elsewhere in
  `settings-admin-panes.tsx`), the 3 props Task 12 now passes:
  `externalModules: readonly ExternalModuleDto[] | undefined`,
  `onSetEnabled: (id: string, enabled: boolean) => void`, `settingEnabledPending: boolean`.
- Produces: `ModuleRegistrySection(props: ModuleRegistrySectionProps)` — no longer a zero-arg
  component; every call site must pass the 3 props (only one call site exists, updated in Task 12).

- [ ] **Step 1: Write the failing test**

```typescript
// tests/e2e/settings-modules.spec.ts (new file — read an existing tests/e2e/*.spec.ts
// for exact page-navigation/login-helper conventions before finalizing; the shape below
// follows the mockApi/mockExternalModules pattern documented in mock-modules.ts's header)
import { expect, test } from "@playwright/test";

import { mockApi } from "./mock-api";
import { mockExternalModules } from "./mock-modules";

test("admin can toggle an installed registry module's switch (#996, #860)", async ({ page }) => {
  await mockApi(page);
  await mockExternalModules(page); // seeds "acme-widgets" as a discovered external module
  await page.route("**/api/admin/module-registry*", async (route) => {
    await route.fulfill({
      json: {
        enabled: true,
        registryUnavailable: false,
        modules: [
          {
            id: "acme-widgets",
            name: "Acme Widgets",
            state: "installed-enabled",
            installedVersion: "0.1.0",
            latestVersion: "0.1.0",
            purgePending: false,
            capabilities: null,
            description: null,
            lastInstallError: null,
            requiresCore: null
          }
        ]
      }
    });
  });

  await page.goto("/settings/admin/modules");
  const row = page.getByRole("listitem").filter({ hasText: "Acme Widgets" });
  const toggle = row.getByRole("switch", { name: /Acme Widgets/i });
  await expect(toggle).toBeChecked();
  await toggle.click();
  await expect(toggle).not.toBeChecked();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec playwright test tests/e2e/settings-modules.spec.ts`
Expected: FAIL — no `switch` role exists in the registry row yet (only Install/Remove buttons).

- [ ] **Step 3: Write minimal implementation**

Add a props interface and destructure it in `ModuleRegistrySection`'s signature:

```typescript
import type { ExternalModuleDto, ModuleRegistryRowDto } from "@jarv1s/shared";
import { Switch } from "./settings-ui"; // match the import already used in settings-admin-panes.tsx

export interface ModuleRegistrySectionProps {
  readonly externalModules: readonly ExternalModuleDto[] | undefined;
  readonly onSetEnabled: (id: string, enabled: boolean) => void;
  readonly settingEnabledPending: boolean;
}

export function ModuleRegistrySection({
  externalModules,
  onSetEnabled,
  settingEnabledPending
}: ModuleRegistrySectionProps) {
```

Inside the `<ul>` row render, after the existing `{row.description ? ... : null}` block and before
the state-label `<p>`, add the switch for installed rows:

```typescript
            {row.state === "installed-enabled" || row.state === "installed-disabled" ? (
              <Switch
                ariaLabel={row.name}
                checked={
                  (externalModules?.find((module) => module.id === row.id)?.status ?? null) ===
                  "enabled"
                }
                disabled={settingEnabledPending}
                onChange={(value) => onSetEnabled(row.id, value)}
              />
            ) : null}
```

(Placed once, ahead of the existing `canInstall`/`canRemove` button block — it renders alongside
Remove/Remove+purge, not instead of them, matching spec §4c's "one row, working switch AND still
removable" requirement.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec playwright test tests/e2e/settings-modules.spec.ts`
Expected: PASS

Also run: `pnpm --filter @jarv1s/web typecheck` — expect PASS now (Task 12's props finally match).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/settings/settings-module-registry-section.tsx tests/e2e/settings-modules.spec.ts
git commit -m "feat(modules): add enable/disable switch to installed registry rows (#996, #860)

Closes the consolidation gap from spec §4c — an installed module previously
had no way to disable it from the registry row at all (only Remove/purge).
Reuses the existing ExternalModuleDto status + setExternalModuleEnabled
mutation InstanceModulesPane already owned; no new API surface.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 14: Full gate + PR

**Files:** none (verification only).

- [ ] **Step 1:** Pre-push trio: `pnpm format:check && pnpm lint && pnpm typecheck` — fix until
      green.
- [ ] **Step 2:** `git fetch origin main && git rebase origin/main` — resolve any conflicts
      (unlikely given the collision-boundary lane split with Codex-869).
- [ ] **Step 3:** Full gate: `pnpm verify:foundation`. Record the exit code.
- [ ] **Step 4:** `pnpm test:integration`. Record the exit code.
- [ ] **Step 5:** Invoke `coordinated-wrap-up` — open PR (base `main`, body `Part of #996` +
      `Part of #860`, "What's new": "Admin settings now lists downloadable modules in one place with a
      working on/off switch; only Wellness/Sports/News are toggleable — Commitments/People/Goals/Notes
      and other core modules are always on."). Report the PR number to the Coordinator pane. Do not
      merge, close, or touch the board.

---

## Self-Review (completed during plan authoring, session 3)

**Spec coverage:** S1 (env-gate deletion, all ~9 call sites across api/worker/scripts + compose) →
Tasks 1-9. S2 (4 manifests → required, no migration) → Task 10. S3 (consolidate pane: dedup +
working switch, drop stale `finance` id) → Tasks 11-13. S4 (repo-side compose) → Task 9. Exit
criteria (single row per module, working switch, always-on core modules, no gate) are each backed
by a task.

**Placeholder scan:** every step shows real code read from the actual files this session (server.ts,
external-module-tools.ts, module-distribution-port.ts, worker.ts, start-jarv1s.ts,
module-reconcile.ts, the 4 manifests, settings-module-view-model.ts, settings-admin-panes.tsx,
settings-module-registry-section.tsx) — no TBD/"similar to Task N" text. The few "read at build
time" notes (worker.ts's exact `if (externalConfig)` block body, external-module-web-route.ts's
exact optional-param usage, mock-modules.ts's full surrounding context, whether a sibling settings
pane has a co-located unit-test convention) are narrow, single-file lookups the implementer does
immediately before editing that one file — not a stand-in for undone design work.

**Type consistency:** `ApiServerConfig.externalModulesDir: string` (Task 2) flows unchanged through
Tasks 3/4/5. `ModuleRegistrySectionProps` (Task 13) matches exactly what Task 12 passes.
`filterUndeclaredExternalModules`/`resolveModulesDir` names are used identically everywhere they
appear across tasks.
