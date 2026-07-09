# #866 herdr-install — relay-4 continuation

Spec: `docs/superpowers/specs/2026-07-08-herdr-install-and-attach-hint.md` (Approved).
Branch/worktree: `build/866-herdr-install`, this worktree, on top of `origin/main@33270eef`.
Coordinator label: `Coordinator` (resolve fresh via `herdr pane list` before messaging — confirm
exactly one pane holds that label).

## State: grounding is 100% COMPLETE. Next action is to WRITE THE PLAN FILE.

Do not re-read the spec-grounding files below unless something looks wrong — everything needed to
write `docs/superpowers/plans/2026-07-09-866-herdr-install-and-attach-hint.md` is captured here.
Go straight to invoking `superpowers:writing-plans` and drafting the plan, then self-review, then
message the Coordinator with the plan path and STOP (no code yet — coordinator approval gate).

## Locked design (7 points — write these into the plan as tasks)

1. **New live probe** `makeChatMultiplexerStatusProbe(env)` in
   `packages/module-registry/src/chat-multiplexer.ts`, returning
   `(configured: ChatMultiplexerChoice) => Promise<LiveChatMultiplexerStatus>` where:
   ```ts
   interface LiveChatMultiplexerStatus {
     available: ChatMultiplexerAvailability; // existing local {tmux, herdr} shape, untouched
     herdrInstalled: boolean;
     active: MultiplexerKind | null;
     activeSource: MultiplexerSource | null;
     envOverride: MultiplexerKind | null;
   }
   ```
   - `available.tmux`/`available.herdr` — reuse `makeMultiplexerUsableProbe(env)` AS-IS (lines
     75-89 of chat-multiplexer.ts). Do NOT touch its logic (it's the tested #343 regression fix:
     herdr usable = `probe.has("herdr") && (env.JARVIS_HERDR_ROOT_PANE?.trim() || env.HERDR_PANE_ID?.trim())`).
   - `herdrInstalled` — `createBinaryProbe(env).has("herdr")` (presence-only, distinct signal from usable).
   - `active`/`activeSource` — from `decideMultiplexer({ env, configured, isInstalled: (b) => probe.has(b) })`
     imported from `@jarv1s/ai` (already exported via `packages/ai/src/index.ts`
     `export * from "./adapters/multiplexer-resolve.js"` — confirmed). Add `decideMultiplexer` to
     the existing `@jarv1s/ai` import line in chat-multiplexer.ts (currently:
     `import { cliAvailable, createBinaryProbe, createRealTmuxIo, resolveMultiplexer, type TmuxIo } from "@jarv1s/ai";`).
     `decideMultiplexer` returns `{ok:true,kind,source} | {ok:false,reason}` — map `ok:false` to
     `active:null, activeSource:null`.
   - `envOverride` — raw `env.JARVIS_MULTIPLEXER` lowercased/trimmed, cast to `MultiplexerKind | null`
     (only "tmux"/"herdr" are valid; anything else → null).
   - **DELETE** `probeChatMultiplexerAvailability` (old sync boot-snapshot fn, chat-multiplexer.ts
     lines 42-47) entirely — no more callers once this lands.

2. **DTO/schema changes** in `packages/shared/src/platform-api.ts`:
   - Redeclare `MultiplexerKind = "tmux" | "herdr"` and `MultiplexerSource = "env" | "configured" | "auto"`
     LOCALLY in this file (same pattern as existing `ChatMultiplexerChoice` — do NOT import from
     `@jarv1s/ai`, which is server-only/node-heavy and this package is Vite-bundled into the browser).
   - `ChatMultiplexerSettingsDto` gains 4 fields:
     ```ts
     export interface ChatMultiplexerSettingsDto {
       readonly multiplexer: ChatMultiplexerChoice;
       readonly available: ChatMultiplexerAvailability;
       readonly herdrInstalled: boolean;
       readonly active: MultiplexerKind | null;
       readonly activeSource: MultiplexerSource | null;
       readonly envOverride: MultiplexerKind | null;
     }
     ```
   - `chatMultiplexerSettingsSchema` (the `as const` JSON schema) needs all 4 new properties added
     to BOTH `properties` and `required` (this is a Fastify response schema with
     `additionalProperties: false` — the fast-json-stringify schema-strip trap: any field emitted
     by the route but missing from the schema is silently dropped). Nullable enum fields use:
     ```ts
     active: { type: ["string", "null"], enum: ["tmux", "herdr", null] },
     activeSource: { type: ["string", "null"], enum: ["env", "configured", "auto", null] },
     envOverride: { type: ["string", "null"], enum: ["tmux", "herdr", null] },
     herdrInstalled: { type: "boolean" }
     ```
   - `HostDiagnosticsDto`/`hostDiagnosticsSchema` need NO field changes (only the source feeding
     `available` becomes live instead of boot-snapshot).

3. **Composition root** `packages/module-registry/src/index.ts` — rename
   `chatMultiplexerAvailability` → `getChatMultiplexerStatus` throughout (naming decision locked
   this session: the handoff's own code implies object-shorthand rename, and it must thread
   consistently since the value becomes a function, not a static snapshot). Exact current sites
   (all confirmed via grep this session):
   - Line 251: import `probeChatMultiplexerAvailability` from `./chat-multiplexer.js` → replace with
     `makeChatMultiplexerStatusProbe`.
   - Line 379 (`BuiltInRouteDependencies` interface):
     ```ts
     /** Boot-time multiplexer availability snapshot for the admin settings UI. */
     readonly chatMultiplexerAvailability?: { readonly tmux: boolean; readonly herdr: boolean };
     ```
     → retype to:
     ```ts
     /** Live multiplexer status probe for the admin settings UI (re-evaluated per request). */
     readonly getChatMultiplexerStatus?: (
       configured: ChatMultiplexerChoice
     ) => Promise<LiveChatMultiplexerStatus>;
     ```
     (import `LiveChatMultiplexerStatus` and `ChatMultiplexerChoice` types as needed — confirm
     `ChatMultiplexerChoice` is already imported somewhere in this file, else add from `@jarv1s/shared`).
   - Line 785 (settings module wiring call): `chatMultiplexerAvailability: deps.chatMultiplexerAvailability,`
     → `getChatMultiplexerStatus: deps.getChatMultiplexerStatus,`
   - Line 1608 (`registerBuiltInApiRoutes` body): `const availability = probeChatMultiplexerAvailability(env);`
     → `const getChatMultiplexerStatus = makeChatMultiplexerStatusProbe(env);`
   - Line 1699 (the `deps: BuiltInRouteDependencies` object literal): `chatMultiplexerAvailability: availability,`
     → `getChatMultiplexerStatus,` (shorthand).

4. **`packages/settings/src/routes.ts`** — define the shared type alias INLINE here (NOT imported
   from `packages/module-registry` — confirmed via grep zero real imports from module-registry
   exist in packages/settings today, only a doc-comment reference at routes.ts:102; keeping it
   inline preserves the Module Isolation Hard Invariant):
   ```ts
   export type GetChatMultiplexerStatus = (
     configured: ChatMultiplexerChoice
   ) => Promise<{
     available: ChatMultiplexerAvailability;
     herdrInstalled: boolean;
     active: MultiplexerKind | null;
     activeSource: MultiplexerSource | null;
     envOverride: MultiplexerKind | null;
   }>;
   ```
   (import `MultiplexerKind`/`MultiplexerSource`/`ChatMultiplexerAvailability`/`ChatMultiplexerChoice`
   from `@jarv1s/shared` — these are the redeclared-local types from task 2, so this import is
   `@jarv1s/shared` → `packages/settings`, which is a normal cross-package dependency already in use,
   not a module-boundary violation.)

   `SettingsRoutesDependencies` field (currently line 127):
   ```ts
   readonly chatMultiplexerAvailability?: { readonly tmux: boolean; readonly herdr: boolean };
   ```
   → `readonly getChatMultiplexerStatus?: GetChatMultiplexerStatus;`

   GET handler (currently lines ~606-631) and PUT handler (currently lines ~633-656) both currently
   do:
   ```ts
   return {
     multiplexer,
     available: dependencies.chatMultiplexerAvailability ?? { tmux: false, herdr: false }
   };
   ```
   → replace with a call to the probe + fail-closed default:
   ```ts
   const status = (await dependencies.getChatMultiplexerStatus?.(multiplexer)) ?? {
     available: { tmux: false, herdr: false },
     herdrInstalled: false,
     active: null,
     activeSource: null,
     envOverride: null
   };
   return { multiplexer, ...status };
   ```
   (PUT calls it with the just-written `multiplexer` value, same as GET — both already have
   `multiplexer` in scope from the repository call immediately above.)

   `registerHostDiagnosticsRoutes` call site (currently line 704):
   ```ts
   chatMultiplexerAvailability: dependencies.chatMultiplexerAvailability,
   ```
   → `getChatMultiplexerStatus: dependencies.getChatMultiplexerStatus,`

5. **`packages/settings/src/host-diagnostics-routes.ts`** (full current content already captured
   below verbatim from this session's read — use it directly, no need to re-read):
   - Import change: replace `type ChatMultiplexerAvailability` import from `@jarv1s/shared` (line 5)
     with importing `type GetChatMultiplexerStatus` from `./routes.js` (same package, not a
     cross-module import).
   - `HostDiagnosticsRoutesDependencies.chatMultiplexerAvailability?: ChatMultiplexerAvailability;`
     (line 15) → `readonly getChatMultiplexerStatus?: GetChatMultiplexerStatus;`
   - Line 82, inside the GET handler, AFTER `multiplexer` is resolved from the repository and
     BEFORE `buildHostDiagnostics` is called:
     ```ts
     available: dependencies.chatMultiplexerAvailability ?? { tmux: false, herdr: false },
     ```
     → :
     ```ts
     available:
       (await dependencies.getChatMultiplexerStatus?.(multiplexer))?.available ??
       { tmux: false, herdr: false },
     ```
     Full current file (94 lines) is reproduced in relay-3 and in this session's transcript if a
     byte-exact reference is needed; the single call-site edit above plus the two type edits are
     the complete change to this file.

   Verbatim current file (for exact line context — DO NOT re-read from disk, use this):
   ```ts
   import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

   import type { AccessContext, DataContextDb, DataContextRunner, User } from "@jarv1s/db";
   import { HttpError } from "@jarv1s/module-sdk";
   import { getHostDiagnosticsRouteSchema, type ChatMultiplexerAvailability } from "@jarv1s/shared";

   import { buildHostDiagnostics, type HostDiagnosticsProvider } from "./host-diagnostics.js";
   import type { SettingsRepository } from "./repository.js";

   export interface HostDiagnosticsRoutesDependencies {
     readonly dataContext: DataContextRunner;
     readonly resolveAccessContext: (request: FastifyRequest) => Promise<AccessContext>;
     readonly repository: SettingsRepository;
     /** Boot-time multiplexer availability snapshot (same one the chat-multiplexer route echoes). */
     readonly chatMultiplexerAvailability?: ChatMultiplexerAvailability;
     /** Runtime-facts provider; injected by the composition root. Absent → 503. */
     readonly hostDiagnostics?: HostDiagnosticsProvider;
     readonly assertAdminUser: (scopedDb: DataContextDb, userId: string) => Promise<User>;
     readonly handleRouteError: (error: unknown, reply: FastifyReply) => unknown;
   }

   export function registerHostDiagnosticsRoutes(
     server: FastifyInstance,
     dependencies: HostDiagnosticsRoutesDependencies
   ): void {
     server.get(
       "/api/admin/host/diagnostics",
       { schema: getHostDiagnosticsRouteSchema },
       async (request, reply) => {
         try {
           const accessContext = await dependencies.resolveAccessContext(request);
           const { dbOk, multiplexer, latestAvailableVersion, releaseNotes } =
             await dependencies.dataContext.withDataContext(accessContext, async (scopedDb) => {
               await dependencies.assertAdminUser(scopedDb, accessContext.actorUserId);
               if (!dependencies.hostDiagnostics) {
                 throw new HttpError(503, "Host diagnostics are not available");
               }
               let ok = true;
               try {
                 await dependencies.repository.pingDatabase(scopedDb);
               } catch {
                 ok = false;
               }
               const { multiplexer: mux } =
                 await dependencies.repository.getChatMultiplexerSetting(scopedDb);

               const latestReleaseRaw = await scopedDb.db
                 .selectFrom("app.instance_settings")
                 .select("value")
                 .where("key", "=", "latest_release")
                 .executeTakeFirst();

               let latestAvailableVersion: string | null = null;
               let releaseNotes: string | null = null;

               if (latestReleaseRaw?.value) {
                 const val = latestReleaseRaw.value as Record<string, unknown>;
                 if (typeof val.version === "string") latestAvailableVersion = val.version;
                 if (typeof val.notes === "string") releaseNotes = val.notes;
               }

               return { dbOk: ok, multiplexer: mux, latestAvailableVersion, releaseNotes };
             });

           const provider = dependencies.hostDiagnostics as HostDiagnosticsProvider;
           const pgBossOk = await provider.pgBossInstalled().catch(() => false);

           return buildHostDiagnostics({
             info: provider.info(),
             multiplexer,
             available: dependencies.chatMultiplexerAvailability ?? { tmux: false, herdr: false },
             dbOk,
             pgBossOk,
             latestAvailableVersion,
             releaseNotes
           });
         } catch (error) {
           return dependencies.handleRouteError(error, reply);
         }
       }
     );
   }
   ```

6. **`apps/web/src/settings/settings-admin-panes.tsx`** `HostPane()` — replace the hardcoded tmux
   `<Note>` block with mux-aware copy per the spec's 4 cases. Current block to replace (the exact
   JSX, confirmed present this session):
   ```tsx
   <Note icon={<Terminal size={13} aria-hidden="true" />}>
     Prefer the terminal? Chat sessions run in tmux inside the container. From your deployment
     directory, list them with <code>{"docker compose exec jarv1s tmux ls"}</code>, then attach
     with <code>{"docker compose exec jarv1s tmux attach -t jarv1s-live-<thread>"}</code>.
   </Note>
   ```
   4 cases (from spec section "Attach Hint"), keyed off the new DTO fields on `mux` (the
   `muxQuery.data` object, now typed `ChatMultiplexerSettingsDto` with the 4 new fields):
   - **Active tmux** (`mux?.active === "tmux"`): keep current tmux copy verbatim (`tmux ls` /
     `tmux attach -t jarv1s-live-<thread>`).
   - **Active herdr** (`mux?.active === "herdr"`): new copy —
     ```tsx
     <Note icon={<Terminal size={13} aria-hidden="true" />}>
       Prefer the terminal? Chat sessions run under Herdr inside the container. From your
       deployment directory, list panes with{" "}
       <code>{"docker compose exec jarv1s herdr pane list"}</code>, then attach with{" "}
       <code>{"docker compose exec jarv1s herdr pane attach <pane-id>"}</code> or read output with{" "}
       <code>{"docker compose exec jarv1s herdr pane read <pane-id>"}</code>.
     </Note>
     ```
   - **Env override present** (`mux?.envOverride != null`): append/show a note that an environment
     override is pinning the multiplexer choice and the UI selector has no effect:
     ```tsx
     <Note icon={<Terminal size={13} aria-hidden="true" />}>
       <code>{"JARVIS_MULTIPLEXER"}</code> is set on this host, pinning the multiplexer to{" "}
       <strong>{mux.envOverride}</strong>. The selector above has no effect until the environment
       override is removed.
     </Note>
     ```
   - **Herdr installed but not usable** (`mux?.herdrInstalled === true && mux?.available.herdr === false`):
     ```tsx
     <Note icon={<Terminal size={13} aria-hidden="true" />}>
       Herdr is installed but not usable yet — a root pane must be configured (
       <code>{"JARVIS_HERDR_ROOT_PANE"}</code> or <code>{"HERDR_PANE_ID"}</code>) before chat
       sessions can run under it.
     </Note>
     ```
   Render logic: pick ONE case by priority — env override present takes precedence (it explains
   *why* the active mux is what it is), else branch on `mux?.active` (tmux/herdr), else (active is
   null, meaning nothing usable was resolved) show the "herdr installed but not usable" case if
   `herdrInstalled` is true, else fall back to existing tmux copy as the safe default (matches
   current behavior when no live data yet / all probes false).
   The existing `herdrAvailable`/badge logic (`mux?.available.herdr === true`, badge line ~703-708)
   stays UNTOUCHED — only the `<Note>` block changes.

7. **New file `scripts/install-herdr.sh`** — host-level operator script (no web API route; this is
   a hard non-goal per spec). Requirements:
   - `#!/usr/bin/env bash`, `set -euo pipefail`.
   - Pinned release artifacts (from relay-2, confirmed carried forward):
     - `herdr-linux-x86_64` sha256 `043ef43ecbabda28465dcff1eec3184518150d567b8b8f20cda9c6c88770641d`
     - `herdr-linux-aarch64` sha256 `ea490094f2c7c39099870857d00c64c628ef7b5eba1967df4258033455ee2cb1`
     - Release repo: `github.com/ogulcancelik/herdr` v0.7.3.
   - Per-arch selection via `uname -m` (`x86_64` → `herdr-linux-x86_64`, `aarch64`/`arm64` →
     `herdr-linux-aarch64`; anything else → exit 1 with a clear error).
   - Fetch via Node's `https` module (write a small inline Node one-liner or a co-located `.mjs`
     helper invoked via `node` — runtime image has full node/tsx but NO curl/wget, confirmed via
     Dockerfile read: only `tmux git ca-certificates bubblewrap` installed via apt-get). No
     `curl | sh` anywhere.
   - SHA-256 verify downloaded bytes against the pinned hash for the selected arch before
     installing; abort with non-zero exit + clear message on mismatch.
   - Install target: `${JARVIS_CLI_TOOLS_PREFIX:-/data/cli-tools}/bin/herdr` (matches the
     established convention already used by `packages/cli-runner/src/main.ts` and
     `infra/docker-compose.prod.yml`).
   - Idempotent: if a file already exists at the target path with a matching SHA-256, skip
     re-download and exit 0 with a "already installed" message.
   - `chmod +x` the installed binary.
   - No required args for the common path (arch auto-detected, prefix defaults, version pinned).
   - Style reference: `scripts/verify-reboot-survival.sh` (heavy why-comments citing this issue,
     `set -euo pipefail`, `command -v` checks, clear PASS/FAIL echo + exit codes) — already read in
     full this session, follow its conventions.

## Test files to extend (all read in FULL this session — content below, do not re-read)

- **`tests/unit/chat-multiplexer-usable.test.ts`** — do NOT modify (tests `makeMultiplexerUsableProbe`,
  untouched by this feature).

- **`tests/integration/chat-multiplexer-admin.test.ts`** (182 lines, full content captured in this
  session's transcript) — extend the two `it` blocks at lines 86-97 (GET) and 99-116 (PUT) to assert
  the 4 new fields with `typeof`/value checks, e.g.:
  ```ts
  expect(typeof body.herdrInstalled).toBe("boolean");
  expect(body.active === null || ["tmux", "herdr"].includes(body.active)).toBe(true);
  expect(body.activeSource === null || ["env", "configured", "auto"].includes(body.activeSource)).toBe(true);
  expect(body.envOverride === null || ["tmux", "herdr"].includes(body.envOverride)).toBe(true);
  ```
  Add a NEW test that sets `process.env.JARVIS_MULTIPLEXER = "tmux"` before an inject call and
  restores it (`delete process.env.JARVIS_MULTIPLEXER` or restore prior value) after, asserting
  `body.envOverride === "tmux"` and `body.activeSource === "env"` — `server.inject` re-runs the
  route handler live per-request so this is safe to do inline in a single `it` block with
  try/finally.

- **`tests/integration/host-diagnostics-admin.test.ts`** (118 lines, full content captured) — the
  existing test at lines 33-52 already asserts `typeof body.available.tmux === "boolean"`; add an
  assertion that this reflects live state (no new field on `HostDiagnosticsDto` itself, per point 2
  above — just confirm the existing shape still passes with the new live-probe wiring).

- **`tests/unit/settings-admin-panes.test.tsx`** (59 lines, full content captured) — existing
  `HostPane` tests seed `queryKeys.settings.chatMultiplexer` with `{multiplexer, available}` only;
  extend the fixture to include the 4 new fields (default them to `herdrInstalled:false, active:null,
  activeSource:null, envOverride:null` in the two existing tests to keep them passing unchanged),
  then add 4 NEW tests — one per HostPane copy case from point 6 above — seeding
  `{multiplexer, available, herdrInstalled, active, activeSource, envOverride}` combinations and
  asserting the right `<Note>` copy renders (e.g. active-herdr test asserts `html.toContain("herdr pane list")`
  and `html.not.toContain("tmux ls")`; env-override test asserts `html.toContain("JARVIS_MULTIPLEXER")`).

## Key source files already fully read/grounded this session (do not re-read unless verifying an edit)

- `packages/module-registry/src/chat-multiplexer.ts` (403 lines) — full content captured in prior
  transcript; key line numbers: `ChatMultiplexerAvailability` interface 28-31,
  `probeChatMultiplexerAvailability` 42-47 (delete), `boundedProbe` 50-55,
  `makeMultiplexerUsableProbe` 75-89 (reuse untouched), imports from `@jarv1s/ai` at top.
- `packages/ai/src/adapters/multiplexer-resolve.ts` (103 lines) — `MultiplexerKind`,
  `MultiplexerSource`, `MultiplexerDecisionInput`, `MultiplexerDecision`, `decideMultiplexer`,
  `resolveMultiplexer`.
- `packages/ai/src/index.ts` — confirmed `export * from "./adapters/multiplexer-resolve.js"` present.
- `packages/ai/src/adapters/binary-probe.ts` (38 lines) — `createBinaryProbe(env, io)`, eager
  synchronous PATH scan at construction, `.has(bin)`.
- `packages/shared/src/platform-api.ts` — sections 370-400, 505-670 read; `ChatMultiplexerChoice`
  ~line 389; `ChatMultiplexerAvailability`/`ChatMultiplexerSettingsDto`/`chatMultiplexerSettingsSchema`
  ~lines 513-535ish; `HostDiagnosticsDto`/`hostDiagnosticsSchema` confirmed no changes needed.
- `packages/settings/src/routes.ts` — imports (1-40), deps interface (90-135), GET/PUT handlers +
  `registerHostDiagnosticsRoutes` call (600-715) — exact current code captured verbatim in prior
  transcript (reproduced inline in point 4 above for the handler bodies).
- `packages/module-registry/src/index.ts` — import block (240-260), `BuiltInRouteDependencies`
  (370-395), settings wiring (770-800), `registerBuiltInApiRoutes` body (1595-1710) — exact grep
  hits: lines 251, 379, 785, 1608, 1699 (all captured above in point 3).
- `apps/web/src/settings/settings-admin-panes.tsx` `HostPane()` (~lines 679-845) — full relevant
  excerpt captured in point 6 above.
- `apps/web/src/api/client-admin.ts` — lines 3-4, 116-124: generic DTO usage, no field narrowing,
  will pick up new fields automatically once `platform-api.ts` changes land — no code change needed.
- `packages/settings/src/repository.ts` — `getChatMultiplexerSetting`/`setChatMultiplexerSetting`/
  `readChatMultiplexerChoiceOrNull` signatures confirmed via grep (lines ~533-598), unchanged by
  this feature.
- `Dockerfile` (repo root, ~52 lines) — runtime stage installs only
  `tmux git ca-certificates bubblewrap` via apt-get (no curl/wget); full node/tsx present;
  `/data/vaults /data/cli-tools /data/cli-auth /run/jarv1s` writable, chowned `node:node`,
  `chmod -R 0777` on `/data/*`.
- `scripts/verify-reboot-survival.sh` — style reference for the new install script.
- Repo-wide grep confirmed `JARVIS_CLI_TOOLS_PREFIX` convention/default `/data/cli-tools` already
  established in `packages/cli-runner/src/sanitized-env.ts`, `packages/cli-runner/src/main.ts`,
  `scripts/start-jarv1s.ts`, `infra/docker-compose.prod.yml`.

## Naming decisions locked this session (write into plan explicitly)

1. **Full rename**: `chatMultiplexerAvailability` → `getChatMultiplexerStatus` across
   `BuiltInRouteDependencies`, the `registerBuiltInApiRoutes` local const, the settings-module
   wiring call, and `SettingsRoutesDependencies` — consistent naming since the value becomes an
   async function, not a static snapshot.
2. **Shared type alias** `GetChatMultiplexerStatus` defined once in `packages/settings/src/routes.ts`
   and imported into `packages/settings/src/host-diagnostics-routes.ts` (same package — NOT a
   cross-module import, does not violate Module Isolation Hard Invariant). Confirmed via grep this
   session: `packages/settings` has zero real imports from `@jarv1s/module-registry` today (only a
   doc-comment mention at routes.ts:102).

## Next steps (exact, in order)

1. Invoke `superpowers:writing-plans`. Draft
   `docs/superpowers/plans/2026-07-09-866-herdr-install-and-attach-hint.md` covering all 7 points
   above as bite-sized TDD tasks (write failing test → verify fail → implement → verify pass →
   commit), using the exact file paths, line numbers, and code snippets captured above. Include the
   test-file extensions as their own tasks (or folded into the task whose deliverable they verify —
   right-size per the writing-plans skill's Task Right-Sizing rule). Include the naming decisions
   from the section above as explicit statements in the relevant tasks (don't silently rename).
2. Run the plan's self-review checklist (spec coverage vs. the 2026-07-08 spec's Acceptance
   Criteria, placeholder scan, type consistency — especially that `GetChatMultiplexerStatus`'s
   signature matches everywhere it's used across tasks 3-5).
3. Resolve the Coordinator's pane fresh via `herdr pane list` (confirm exactly one pane holds label
   `Coordinator`). Message it: "plan ready for 866-herdr-install: docs/superpowers/plans/2026-07-09-866-herdr-install-and-attach-hint.md. Approve, or flag a fork."
4. **STOP and wait for approval. Do not write any code this session or the next until the
   Coordinator responds.**
5. Only after approval: TDD-build per `superpowers:test-driven-development` (manual, task-by-task —
   `executing-plans`/`subagent-driven-development` are disabled in this repo per `coordinated-build`),
   committing each task green with `Co-Authored-By: Claude`, explicit `git add <path>` (never `-A`).
   Pre-push trio (`pnpm format:check && pnpm lint && pnpm typecheck` + `git fetch origin main && git rebase origin/main`)
   before every push. Then `coordinated-wrap-up` (PR + report to Coordinator only — never merge,
   never touch board/milestones/issue-closing).

## Bans still in force (unchanged from relay-3)

- Worktree/branch only (`build/866-herdr-install`).
- Explicit `git add <path>` only — never `-A`/`.`.
- Never touch `docs/coordination/`.
- No secrets in any doc/payload/log.
- Elevated QA bar at wrap-up: `/security-review` + `/code-review`.
- STOP + escalate to Coordinator if the build ever seems to need a web API install route — the
  spec's non-goal ("no web API route that downloads/writes/chmods/executes a binary") is a hard
  constraint, not a suggestion.
