# Host Diagnostics Safe Ops Implementation Plan

> **For agentic workers:** This plan is executed task-by-task by the build agent (coordination
> mode — execution sub-skills disabled). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Advanced host setup placeholders with a real, admin-only, read-only,
secret-safe host diagnostics endpoint + UI, and make the restart/verbose-logging controls honest.

**Architecture:** New `GET /api/admin/host/diagnostics` route owned by the settings module's admin
surface (platform-allowlisted, gated by `assertAdminUser`). Process/runtime facts are gathered by a
composition-root-injected `HostDiagnosticsProvider` seam (so the settings package gains no new
package dependency — same pattern as `onboardingProbes`/`chatMultiplexerAvailability`). The DTO is
built by a pure, unit-tested serializer with an allowlist + a defensive "no secrets" guard. The web
HostPane gains a "Run diagnostics" query that renders pass/warn/fail rows, a read-only verbose-log
level readout, and an honest restart card.

**Tech Stack:** Fastify, Kysely (DataContextDb), pg-boss, React + TanStack Query, Vitest, TypeScript.

## Global Constraints

- **Admin-only.** Every diagnostics field is gated behind `assertAdminUser` (instance admin).
- **Read-only.** No mutations, no shell execution. Each check is fixed and audited.
- **No secret/env dumping.** Never return env var _values_, DB URLs, connection strings, tokens,
  secrets, user-data file paths, or raw stack traces. Only the explicit allowlisted fields below.
- **DataContextDb only.** DB connectivity check runs through a `DataContextDb` repository method,
  never a root Kysely handle.
- **Module isolation.** Settings imports no new package; runtime facts arrive via an injected
  `HostDiagnosticsProvider`. The new route is added to `PLATFORM_UNGUARDED_ROUTES`.
- **No blind restart.** Do not ship an in-process restart endpoint. Restart stays operator-managed
  and honest (documented command for the detected/declared deploy mode).
- **File-size gate:** no source file > 1000 lines. New diagnostics code lives in its own files;
  `routes.ts` (867 lines) only gains a small delegating call.
- DB/test commands use `JARVIS_PGDATABASE=jarv1s_255_host_diag`.
- Commit trailer: `Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>`. Stage only the
  task's own paths (no `git add -A`).

## DTO shape (single source of truth — shared)

```ts
type HostDiagnosticStatus = "pass" | "warn" | "fail";

interface HostDiagnosticCheckDto {
  readonly id: string; // "database" | "pgboss" | "multiplexer"
  readonly label: string;
  readonly status: HostDiagnosticStatus;
  readonly detail: string; // short safe message, no secrets
}

// Sync runtime facts supplied by the composition root (no I/O, no secrets).
interface HostDiagnosticsInfo {
  readonly uptimeSeconds: number;
  readonly environment: "production" | "development" | "test" | "unknown";
  readonly version: string | null; // from JARVIS_APP_VERSION, else null
  readonly commit: string | null; // from JARVIS_GIT_COMMIT, else null
  readonly host: string; // bind host e.g. "0.0.0.0" (not a secret)
  readonly port: number;
  readonly logLevel: string; // readout only (env-configured)
  readonly deployMode: "compose" | "systemd" | "dev" | "unknown";
  readonly restartCommand: string | null; // documented operator command, or null
  readonly moduleCount: number; // # registered built-in modules
  readonly routeCount: number; // total declared module routes
}

interface HostDiagnosticsDto extends HostDiagnosticsInfo {
  readonly multiplexer: ChatMultiplexerChoice;
  readonly available: ChatMultiplexerAvailability;
  readonly checks: readonly HostDiagnosticCheckDto[];
}
```

## File Structure

- `packages/shared/src/platform-api.ts` (modify) — add DTO interfaces + `hostDiagnosticsSchema` +
  `getHostDiagnosticsRouteSchema`. Browser-safe (pure data/JSON-schema only; no node imports).
- `packages/settings/src/host-diagnostics.ts` (create) — pure, no I/O:
  `buildHostDiagnostics(input): HostDiagnosticsDto` and `assertDiagnosticsSafe(dto): void`
  (defensive guard throwing on connection-URL / known-secret-key substrings). Plus the
  `HostDiagnosticsProvider` seam interface.
- `packages/settings/src/host-diagnostics-routes.ts` (create) —
  `registerHostDiagnosticsRoutes(server, deps)` registering `GET /api/admin/host/diagnostics`.
- `packages/settings/src/repository.ts` (modify) — add `pingDatabase(db: DataContextDb)`.
- `packages/settings/src/routes.ts` (modify) — delegate to `registerHostDiagnosticsRoutes`, passing
  injected helpers (`assertAdminUser`, `repository`, `requireRequestId`, `handleRouteError`,
  `chatMultiplexerAvailability`, `hostDiagnostics`).
- `packages/settings/src/manifest.ts` — **no change** (admin routes are platform-allowlisted, not
  module-owned — mirror chat-multiplexer).
- `packages/module-registry/src/route-guard.ts` (modify) — add
  `routeKey("GET", "/api/admin/host/diagnostics")` to `PLATFORM_UNGUARDED_ROUTES`.
- `packages/module-registry/src/index.ts` (modify) — add `hostDiagnostics?` to
  `BuiltInRouteDependencies` (and `SettingsRoutesDependencies` forward) + forward in the settings
  registration.
- `apps/api/src/server.ts` (modify) — build the `HostDiagnosticsProvider` (info closure +
  `pgBossInstalled` probe) and pass it into `registerBuiltInApiRoutes`.
- `apps/web/src/api/client.ts` (modify) — `getHostDiagnostics()`.
- `apps/web/src/api/query-keys.ts` (modify) — `settings.hostDiagnostics` key.
- `apps/web/src/settings/settings-admin-panes.tsx` (modify) — wire `HostPane`.
- Tests: `tests/integration/host-diagnostics-admin.test.ts` (create),
  `packages/settings/src/host-diagnostics.test.ts` (create, unit — vitest under the package; run via
  the integration runner config if a co-located unit run isn't wired — see Task 2).

---

### Task 1: Shared DTO + route schema

**Files:**

- Modify: `packages/shared/src/platform-api.ts` (after the chat-multiplexer block, ~line 622)

**Interfaces:**

- Produces: `HostDiagnosticStatus`, `HostDiagnosticCheckDto`, `HostDiagnosticsInfo`,
  `HostDiagnosticsDto`, `hostDiagnosticsSchema`, `getHostDiagnosticsRouteSchema`.

- [ ] **Step 1:** Add the interfaces (exactly the DTO shape above) and a JSON schema mirroring it
      with `additionalProperties: false` on every object, `checks` as an array of the check schema, the
      `getHostDiagnosticsRouteSchema` with `response: { 200: hostDiagnosticsSchema, 401:
errorResponseSchema, 403: errorResponseSchema }`. Reuse `ChatMultiplexerChoice` enum + the
      existing availability sub-schema shape.
- [ ] **Step 2:** `pnpm --filter @jarv1s/shared typecheck` (or root `pnpm typecheck`) — expect PASS.
- [ ] **Step 3:** Commit `packages/shared/src/platform-api.ts`.

### Task 2: Pure serializer + safety guard (unit-tested)

**Files:**

- Create: `packages/settings/src/host-diagnostics.ts`
- Create: `packages/settings/src/host-diagnostics.test.ts`

**Interfaces:**

- Consumes: `HostDiagnosticsInfo`, `HostDiagnosticsDto`, `HostDiagnosticCheckDto`,
  `ChatMultiplexerChoice`, `ChatMultiplexerAvailability` from `@jarv1s/shared`.
- Produces:
  - `interface HostDiagnosticsProvider { readonly info: () => HostDiagnosticsInfo; readonly pgBossInstalled: () => Promise<boolean>; }`
  - `buildHostDiagnostics(input: { info: HostDiagnosticsInfo; multiplexer: ChatMultiplexerChoice; available: ChatMultiplexerAvailability; dbOk: boolean; pgBossOk: boolean }): HostDiagnosticsDto`
  - `assertDiagnosticsSafe(dto: HostDiagnosticsDto): void`

- [ ] **Step 1: Write failing unit tests** covering:
  - `buildHostDiagnostics` produces `checks` with ids `database`/`pgboss`/`multiplexer`, mapping
    `dbOk:false → status:"fail"`, `pgBossOk:true → "pass"`, and a multiplexer check that is `warn`
    when neither tmux nor herdr is available (else `pass`).
  - Output object keys are exactly the allowlisted DTO keys (no extra/unknown keys).
  - `assertDiagnosticsSafe` throws when a `detail`/string field contains a connection URL
    (`postgres://...`) or a known secret env key name (`JARVIS_CONNECTOR_SECRET_KEY`,
    `JARVIS_AI_SECRET_KEY`, `BETTER_AUTH_SECRET`, `DATABASE_URL`), and does NOT throw for the normal
    happy-path DTO (host `0.0.0.0`, etc.).
- [ ] **Step 2: Run** `JARVIS_PGDATABASE=jarv1s_255_host_diag vitest run packages/settings/src/host-diagnostics.test.ts`
      — expect FAIL (module not found).
- [ ] **Step 3: Implement** `host-diagnostics.ts`:
  - `buildHostDiagnostics` builds the three checks (only `detail` strings are short, fixed,
    secret-free, e.g. `"Connected"`/`"Unreachable"`), spreads `info` + multiplexer/available +
    checks into the DTO, then calls `assertDiagnosticsSafe` before returning (belt-and-suspenders).
  - `assertDiagnosticsSafe` collects every string field (info strings + each check's label/detail),
    throws `Error("host diagnostics contains forbidden content")` if any matches
    `/postgres(ql)?:\/\//i`, `/\b\w+:\/\/[^\s]*@/` (creds-in-URL), or any name in the secret-key
    list. Keep the secret-key list as a small `const` array.
- [ ] **Step 4: Run** the unit test — expect PASS.
- [ ] **Step 5: Commit** both files.

> Note: if `vitest run packages/settings/...` isn't picked up by a config, add the file under the
> integration glob is NOT desired (it touches no DB). Confirm the repo runs co-located `*.test.ts`
> via the root `vitest` before committing; if not, place the unit test at
> `tests/integration/host-diagnostics-unit.test.ts` (still pure, no DB) so it runs in the gate.

### Task 3: Repository DB ping (DataContextDb)

**Files:**

- Modify: `packages/settings/src/repository.ts` (SettingsRepository class)

**Interfaces:**

- Produces: `async pingDatabase(db: DataContextDb): Promise<void>` — runs `sql\`SELECT 1\`.execute(db)`(throws on failure).`sql` is already imported.

- [ ] **Step 1:** Add the method (one-liner + short doc comment).
- [ ] **Step 2:** `pnpm typecheck` — expect PASS.
- [ ] **Step 3:** Commit `repository.ts`.

### Task 4: Diagnostics route (settings) + wiring

**Files:**

- Create: `packages/settings/src/host-diagnostics-routes.ts`
- Modify: `packages/settings/src/routes.ts` (import + delegate near `registerOnboardingRoutes`;
  thread `hostDiagnostics` through `SettingsRoutesDependencies`)
- Modify: `packages/module-registry/src/route-guard.ts` (allowlist the route)
- Modify: `packages/module-registry/src/index.ts` (`BuiltInRouteDependencies.hostDiagnostics?` +
  forward in the settings registration block)

**Interfaces:**

- Consumes: `HostDiagnosticsProvider` + `buildHostDiagnostics` from `./host-diagnostics.js`;
  `SettingsRepository`; injected `assertAdminUser`, `requireRequestId`, `handleRouteError`,
  `dataContext`, `resolveAccessContext`, `chatMultiplexerAvailability`.
- Produces: `registerHostDiagnosticsRoutes(server, deps)`.

- [ ] **Step 1:** Add `routeKey("GET", "/api/admin/host/diagnostics")` to `PLATFORM_UNGUARDED_ROUTES`
      in `route-guard.ts` (next to the chat-multiplexer entries, with a comment).
- [ ] **Step 2:** Write `host-diagnostics-routes.ts`. Handler:
  1. `resolveAccessContext`.
  2. `withDataContext`: `assertAdminUser` → `repository.pingDatabase` (try/catch → `dbOk`) →
     `repository.getChatMultiplexerSetting` (→ `multiplexer`).
  3. `pgBossOk = await deps.hostDiagnostics.pgBossInstalled().catch(() => false)`.
  4. `const dto = buildHostDiagnostics({ info: deps.hostDiagnostics.info(), multiplexer,
available: deps.chatMultiplexerAvailability ?? { tmux: false, herdr: false }, dbOk, pgBossOk })`.
  5. `return dto`. Errors → injected `handleRouteError`.
  - If `deps.hostDiagnostics` is undefined (defensive), throw `HttpError(503, "Host diagnostics are
not available")` AFTER the admin check.
- [ ] **Step 3:** In `routes.ts`: add `hostDiagnostics?: HostDiagnosticsProvider` to
      `SettingsRoutesDependencies`; export `HostDiagnosticsProvider` re-export is unnecessary — import
      the type from `./host-diagnostics.js`. Call `registerHostDiagnosticsRoutes(server, { dataContext,
resolveAccessContext, repository, chatMultiplexerAvailability: dependencies.chatMultiplexerAvailability,
hostDiagnostics: dependencies.hostDiagnostics, assertAdminUser, requireRequestId, handleRouteError })`
      near the other `register*Routes` calls. (assertAdminUser/requireRequestId/handleRouteError are
      module-scoped functions in routes.ts — pass them in, mirroring `registerOnboardingRoutes`.)
- [ ] **Step 4:** In `module-registry/src/index.ts`: add
      `readonly hostDiagnostics?: HostDiagnosticsProvider;` to `BuiltInRouteDependencies` (import the
      type from `@jarv1s/settings`), and add `hostDiagnostics: deps.hostDiagnostics,` to the
      `registerSettingsRoutes({...})` call.
- [ ] **Step 5:** `pnpm typecheck` — expect PASS.
- [ ] **Step 6:** Commit the four files.

### Task 5: Composition root provider (server.ts)

**Files:**

- Modify: `apps/api/src/server.ts`

**Interfaces:**

- Consumes: `apiServerConfig` (host/port), `boss`, `getBuiltInModuleManifests`.
- Produces: a `HostDiagnosticsProvider` passed into `registerBuiltInApiRoutes`.

- [ ] **Step 1:** Build, inside `server.after()` before `registerBuiltInApiRoutes`, a
      `hostDiagnostics: HostDiagnosticsProvider`:
  - `info()` returns `HostDiagnosticsInfo` computed from: `process.uptime()` (rounded),
    `mapEnv(process.env.NODE_ENV)` → production/development/test/unknown, `process.env.JARVIS_APP_VERSION ?? null`,
    `process.env.JARVIS_GIT_COMMIT ?? null` (sliced to 12 chars if present), `apiServerConfig.host`,
    `apiServerConfig.port`, `process.env.LOG_LEVEL ?? "info"`, deploy mode from
    `process.env.JARVIS_DEPLOY_MODE` (compose/systemd/dev else unknown) with a fixed
    `restartCommand` per mode (`docker compose restart api` / `systemctl restart jarvis-api` /
    `restart the dev process (Ctrl-C, re-run)` / null), and `moduleCount`/`routeCount` from
    `getBuiltInModuleManifests()` (`length` and sum of `routes?.length ?? 0`).
  - `pgBossInstalled: () => boss.isInstalled().then((v) => v === true).catch(() => false)`.
  - Define small helpers `mapEnvMode` / `resolveDeployMode` as module-scoped functions in server.ts
    (pure, no secrets).
- [ ] **Step 2:** Add `hostDiagnostics,` to the `registerBuiltInApiRoutes({...})` deps.
- [ ] **Step 3:** `pnpm typecheck` — expect PASS.
- [ ] **Step 4:** Commit `server.ts`.

### Task 6: Integration tests (admin/non-admin/unauth + secret-safety)

**Files:**

- Create: `tests/integration/host-diagnostics-admin.test.ts` (mirror `chat-multiplexer-admin.test.ts`
  HTTP block: `createApiServer({ appDb, logger:false })`, owner sign-up = admin, second = member).

- [ ] **Step 1:** Write tests:
  - admin GET `/api/admin/host/diagnostics` → 200; body has `checks` array incl. a `database` check
    with `status:"pass"`; `uptimeSeconds` is a number ≥ 0; `environment` is a string; `multiplexer`
    is `"auto"`.
  - body JSON string contains none of: `postgres://`, `DATABASE_URL`, `JARVIS_CONNECTOR_SECRET_KEY`,
    `BETTER_AUTH_SECRET`, `password` (case-insensitive scan).
  - non-admin GET → 403.
  - unauthenticated GET → 401.
- [ ] **Step 2: Run** `JARVIS_PGDATABASE=jarv1s_255_host_diag vitest run tests/integration/host-diagnostics-admin.test.ts`
      — expect FAIL first (route 404/missing), then PASS after Tasks 1–5 are in. (Tasks 1–5 already
      committed, so this should PASS on first run; if 404, the allowlist/coverage step regressed.)
- [ ] **Step 3:** Commit the test file.

### Task 7: Web client + query key

**Files:**

- Modify: `apps/web/src/api/query-keys.ts` (add `hostDiagnostics: ["settings","host-diagnostics"]`)
- Modify: `apps/web/src/api/client.ts` (add `getHostDiagnostics(): Promise<HostDiagnosticsDto>` →
  `requestJson("/api/admin/host/diagnostics")`; import `HostDiagnosticsDto`)

- [ ] **Step 1:** Add the key + client fn.
- [ ] **Step 2:** `pnpm --filter web typecheck` (or root web typecheck) — expect PASS.
- [ ] **Step 3:** Commit both files.

### Task 8: HostPane UI (honest restart + diagnostics rows)

**Files:**

- Modify: `apps/web/src/settings/settings-admin-panes.tsx` (`HostPane`)

- [ ] **Step 1:** Add a `useQuery` for diagnostics with `enabled:false` + a `run` flag toggled by the
      "Run diagnostics" button (`refetch()` on click, or `enabled` gated by a `useState` `ran` flag).
      Render results: a "Diagnostics" group with one `Row` per check showing label + a `Badge`
      (pass→pine/dot, warn→amber, fail→red/`tone="amber"` with "Failed") and the `detail`; plus info
      rows (uptime humanized, environment, version/commit or "—", `host:port`, modules `N` / routes `N`).
- [ ] **Step 2:** Replace the "Verbose logging" placeholder `Row ... coming` with a read-only `Row`
      showing the current `logLevel` (from diagnostics, or "Run diagnostics to view") + a `Note` that it
      is env-configured (`LOG_LEVEL`).
- [ ] **Step 3:** Replace the fake "Restart server" button (confirm→"coming soon" toast) with an
      honest restart card: show deploy mode + `restartCommand` (copyable via existing pattern or a plain
      `<code>` the operator can copy) and text "Restart is operator-managed". Remove the
      `confirm({...restart...})` block and the now-unused `NotWired` placeholder line.
- [ ] **Step 4:** `pnpm --filter web typecheck` + `pnpm lint` on changed paths — expect PASS.
- [ ] **Step 5:** Commit the file.

### Task 9: Gate + wrap-up

- [ ] **Step 1:** Pre-push trio: `pnpm format:check && pnpm lint && pnpm typecheck`.
- [ ] **Step 2:** `pnpm check:file-size` (confirm no file > 1000 lines — esp. `routes.ts`,
      `settings-admin-panes.tsx`).
- [ ] **Step 3:** `JARVIS_PGDATABASE=jarv1s_255_host_diag pnpm verify:foundation` (full gate) if
      feasible; else at minimum the new integration test + chat-multiplexer-admin (regression on the
      route-coverage assertion) + a web build/typecheck.
- [ ] **Step 4:** `git fetch origin main && git rebase origin/main`, re-run trio, then hand to
      `coordinated-wrap-up` (PR + report to Coordinator). Do NOT touch board/milestone/merge.

## Self-Review

- **Spec coverage:** diagnostics endpoint (Tasks 1–5), admin-only (Task 4 `assertAdminUser` + Task 6
  403), safe fields incl. uptime/host-port/multiplexer/db/pgboss/module-summary/env/version-commit
  (Task 1 DTO + Task 5 info), never returns env values/URLs/secrets/paths/stacks (Task 2 guard +
  Task 6 substring scan), UI run-diagnostics pass/warn/fail (Task 8), verbose-logging readout-first
  (Task 8 Step 2), honest restart with operator command, no blind endpoint (Task 8 Step 3),
  guardrails read-only/no-shell (no mutation/exec anywhere). Verification matches spec's 5 bullets.
- **Out of scope respected:** no log viewer, no command runner, no restart endpoint, no metrics.
- **Type consistency:** `HostDiagnosticsInfo`/`HostDiagnosticsDto`/`HostDiagnosticsProvider`/
  `buildHostDiagnostics`/`assertDiagnosticsSafe`/`pingDatabase`/`getHostDiagnostics` names are used
  identically across tasks.
