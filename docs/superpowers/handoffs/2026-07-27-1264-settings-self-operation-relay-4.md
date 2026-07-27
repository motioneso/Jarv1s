# #1264 settings self-operation — relay 4 (Tasks 0a-6 DONE, Task 7 next)

**Branch/worktree:** `1264-settings-self-operation` (this worktree, reuse — do NOT `pnpm install`,
`node_modules` present). **Coordinator:** resolve fresh via `herdr pane list`, label `Coordinator`
(session id `43e5f5e2-0deb-4ab5-9237-436e8795b611` as of this writing — re-resolve, don't trust a
stale session id either if it doesn't show up). **Risk tier:** security (Opus QA before merge).

## RUN RULE — read before ANY db command

```bash
export JARVIS_PGDATABASE=jarvis_build_1264
```

Set in every new shell (does not persist). DB `jarvis_build_1264` already exists, migrations
through 0177 applied — reuse, don't recreate.

## Coordinator rulings — binding, do not re-litigate

1. **Digest is OUT OF SCOPE.** Do not build `settings.digest.*` tools.
2. **Rebase inventory counts on #1265's numbers, not main's**: `grantedAtInstall=31,
   confirmAlways=5, userPromotable=4` (sum 40). Task 10 rebases onto this, not the plan's assumed
   38. Walk `getBuiltInModuleManifests()` to count — People module declares grants in
   `packages/people/src/tools.ts`, not a manifest.ts.

## State: Tasks 0a, 0b, 0c, 1, 2, 3, 4, 5, 6 DONE and committed. 6 tasks left (7, 8, 9, 10, 11, 13).

Plan: `docs/superpowers/plans/2026-07-27-module-self-operation-settings-commands.md`. **Read BY
TASK SECTION ONLY.** Line map: 7=855-934 8=935-1038 9=1039-1087 10=1088-1113 11=1198-end (moved —
Task 13 was inserted *before* Task 11's heading) 13=1114-1197. Confirm exact ranges with
`grep -n "^## Task"` before reading — line numbers drift as the plan file is touched.

## Commits so far

`5851d825` 0a · `96edbcaa` 0a manifest-array follow-up · `c366b877` 0b (0176 migration + catalog
row) · `7a52e28d` 0c (0177 migration, widened outcome CHECK) · `c449e22c` Task 1 (extracted
`setNotificationPreferenceEnabled`) · `69cb940f` Task 2 (`settings.themeMode.set` tool +
`settings.preference-write` action family) · `bd8acd24` Task 3 (`settings.locale.setTimezone` +
`settings.locale.setRegionAndDateFormat`) · `1ab1f649` Task 4 (`settings.quietHours.set`) ·
`11d16069` Task 5 (`settings.weatherLocation.set`) · `fc2a42b7` Task 6
(`settings.notificationPreference.setEnabled`).

**0176 and 0177 are FROZEN** (checksum-recorded, applied). Any content change needs a new migration
file, never in-place edit.

## Task 6 pattern — new precedent for future composition-host-service tasks

Task 6 needed data settings can't import directly (module manifest enumeration — `module-registry`
depends on `settings`, so the reverse import is circular). Resolved via the **composition-host
service pattern**, confirmed working end-to-end (typecheck × 3 packages, 5/5 unit tests, lint
clean):

1. Settings **owns the contract**: `NotificationPreferenceWriteService` interface in
   `packages/settings/src/notification-preference-application.ts`, exported from
   `packages/settings/src/index.ts`.
2. Tool file (`packages/settings/src/notification-preference-tool.ts`) takes the service via
   `ToolServices`, narrows/throws if absent (`narrowNotificationPreferenceWrite`), never imports
   module-registry.
3. **Concrete implementation built in the composition host**, `packages/chat/src/routes.ts`'s
   `buildChatToolServices` — a closure over an injected `listModuleManifests` collaborator, wired
   `services.notificationPreferenceWrite = {...}` only `if (deps.listModuleManifests)`.
4. New optional collaborator threaded top-down from the **true composition root**
   (`packages/module-registry/src/index.ts`, where `deps.listModuleManifests` already existed) →
   `registerChatRoutes` call site → `ChatRoutesDependencies` interface → internal `collaborators`
   object → `buildChatGatewayDependencies` → `buildChatToolServices`.
5. Manifest entry reused the existing `settings.preference-write` action family (Task 2) — no
   manifest.ts family edit needed. `requiresServices: ["notificationPreferenceWrite"]`.
6. **Deliberately skipped** wiring `notificationUnreadPort` (optional dep on the application-layer
   function) — would require adding `@jarv1s/notifications` to `packages/chat/package.json` for a
   pure UX nicety (`unreadCount` in the result). Accepted degraded `unreadCount: null` from this
   path; core `enabled` write still works fully.
7. **Test placement differs from Tasks 2-5**: Task 6 delegates ALL persistence through the injected
   service, so it's fully fakeable → went in `tests/unit/`, not `tests/integration/`. Fake DB idiom
   for a unit test needing `assertDataContextDb` to pass at runtime (NOT just type-satisfy):
   `import { dataContextBrand, type DataContextDb } from "@jarv1s/db"; const scopedDb = { db: {} as never, [dataContextBrand]: true } satisfies DataContextDb;`
   — a bare `{} as DataContextDb` cast throws `"Repository access requires withDataContext"` at
   runtime (brand check is a real symbol property, not type-level only).

If a later task (7-13) needs data outside settings' own tables, check whether this pattern applies
before assuming a new package dependency is required.

## Ground-truth corrections — the plan's pseudocode was WRONG on these, apply to every remaining task

The plan describes a `ModuleAssistantToolContext` two-arg `(input, ctx)` execute signature with
`ctx.scopedDb` — **this type does not exist**. The real contract (verify against
`packages/module-sdk/src/index.ts` and existing files in `packages/settings/src/*-tool.ts`, not
the plan):

- `ToolExecute = (scopedDb, input, ctx, services?) => Promise<ToolResult>` — **4 positional args**.
- `assertDataContextDb(scopedDb)` first line of every execute body (from `@jarv1s/db`).
- Return `{ data: {...} }` — spread a typed local (`{ ...next }`), never assign a typed DTO
  directly to `data` (fails TS2322, `Record<string, unknown>` has no index signature match).
- `ToolContext` is `{ actorUserId, requestId, chatSessionId, localTimezone? }` — **`chatSessionId`
  is REQUIRED**, not optional. Test `toolCtx()` helper: `chatSessionId: ""`.
- No `assistant-tools/` subdirectory convention exists anywhere — tool files live flat at
  `packages/<pkg>/src/<feature>-tool.ts` (or `-tools.ts` when a file exports 2+ related tools, see
  Task 3's `locale-tools.ts`), sibling to the manifest.
- A new `actionFamilyId` referenced by a tool MUST have a matching entry in that module's own
  `assistantActionFamilies` array in its manifest.ts, or the build-time assertion in
  `packages/ai/src/gateway/self-operation.ts` fails. For `granted_at_install` tools: `allowedTiers`
  must include both `trusted_auto` AND `always_confirm`; `defaultTier` must NOT be
  `"always_confirm"`. **The `settings.preference-write` action family (added Task 2) already
  satisfies this — Tasks 3/4/5/6 reused it without modification. Reuse it again unless a task
  genuinely needs a new family.**
- When casting `input` inside execute, use an inline structural type
  (`input as { lat: number; lon: number; label: string }`), not a cast to the shared DTO type
  itself (`as WeatherLocationDto` fails TS2352, insufficient overlap with `ToolInput`).
- Package public API (`packages/<pkg>/src/index.ts`) is a manual re-export list — a new file's
  exports are invisible to other packages until added there explicitly.

## Test placement rule

Any DB-backed `ToolExecute` (real `PreferencesRepository`/Postgres) → `tests/integration/`, run via:

```bash
export JARVIS_PGDATABASE=jarvis_build_1264
pnpm exec tsx scripts/test-integration.ts tests/integration/<file>.test.ts
```

(Bare `tsx` not on PATH — must go through `pnpm exec`.) Fakeable-port-only tools (all deps injected
via `ToolServices`, no direct repository/Postgres access) → `tests/unit/`, run via
`pnpm exec vitest run tests/unit/<file>.test.ts`. Tasks 2-5 were DB-backed → integration. Task 6
was service-delegated → unit (see pattern note above). Judge each remaining task on its own I/O
shape, don't assume either default.

## TRAP — apply to every future migration

`tests/integration/foundation-schema-catalog.test.ts` pins the full migration list via
`toEqual([...])`. Next free global version: **0178**.

## Known pre-existing noise (not yours to fix)

Root `pnpm typecheck` (not per-package — `pnpm --filter <pkg> typecheck` throws pre-existing
`TS6059 rootDir` errors). `pnpm format:check` flags 2 pre-existing files unrelated to this lane
(`docs/superpowers/plans/2026-07-27-module-self-operation-settings-commands.md`,
`tests/integration/structured-state.test.ts`) — not yours, don't reformat them. No per-package
`lint` script exists — use `pnpm exec eslint <touched files> --max-warnings=0` directly, root
`pnpm lint` (`eslint . --max-warnings=0`) is the only whole-repo option.

## PR body MUST include (coordinator ruling, do not drop)

`structured-state/src/manifest.ts`'s migrations array had drifted pre-epic (0111, 0167 missing);
corrected in `96edbcaa`; package still has no pinning test for that array — tracked as **#1272**,
cite it in the PR body.

## Immediate next step

1. `export JARVIS_PGDATABASE=jarvis_build_1264` in your shell before any db work.
2. `grep -n "^## Task" docs/superpowers/plans/2026-07-27-module-self-operation-settings-commands.md`
   to get current, accurate line numbers (don't trust the line map above blindly — re-verify).
3. Task 7 — read `## Task 7` only. Verify every claim (file paths, existing function signatures,
   preference key names, test placement) against actual current branch state before implementing —
   the plan has been wrong on execute-signature and file-layout details on every task so far.
4. Continue Task 8 → 9 → 10 (rebase counts per ruling above) → then Task 13 → Task 11 (Task 11 is
   the full-gate/UAT verification task and reads best last, after 13's rate limiting lands — but
   re-check plan ordering/dependencies before assuming this sequence still holds). One section at a
   time, per-task green commit. Root `pnpm typecheck` + `format:check` + `lint` before every commit,
   plus the actual new test (unit or integration per the task's I/O shape).
5. Self-monitor context; relay again at the 70% meter warning or on a compaction summary. Commit
   before relaying — reading is not progress.
6. Once Task 13/11 land, invoke `coordinated-wrap-up` (gate, push, PR citing #1272, report to
   coordinator) — not this session's job unless it gets that far.

## Full detail if needed

`memory_smart_search` project `jarv1s`, query `"1264 settings self-operation"`. Prior relays:
`docs/superpowers/handoffs/2026-07-27-1264-settings-self-operation-relay.md`,
`docs/superpowers/handoffs/2026-07-27-1264-settings-self-operation-relay-2.md`,
`docs/superpowers/handoffs/2026-07-27-1264-settings-self-operation-relay-3.md`.
