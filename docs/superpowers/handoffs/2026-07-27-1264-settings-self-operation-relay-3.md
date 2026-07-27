# #1264 settings self-operation — relay 3 (Tasks 0a-5 DONE, Task 6 next)

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

## State: Tasks 0a, 0b, 0c, 1, 2, 3, 4, 5 DONE and committed. 7 tasks left (6 through 11+13).

Plan: `docs/superpowers/plans/2026-07-27-module-self-operation-settings-commands.md`. **Read BY
TASK SECTION ONLY.** Line map: 6=764-854 7=855-934 8=935-1038 9=1039-1087 10=1088-1113
11=1114-1129 (Task 13 inserted before 11's heading — `grep -n "^## Task 13"`).

## Commits so far

`5851d825` 0a · `96edbcaa` 0a manifest-array follow-up · `c366b877` 0b (0176 migration + catalog
row) · `7a52e28d` 0c (0177 migration, widened outcome CHECK) · `c449e22c` Task 1 (extracted
`setNotificationPreferenceEnabled`) · `69cb940f` Task 2 (`settings.themeMode.set` tool +
`settings.preference-write` action family) · `bd8acd24` Task 3 (`settings.locale.setTimezone` +
`settings.locale.setRegionAndDateFormat`) · `1ab1f649` Task 4 (`settings.quietHours.set`) ·
`11d16069` Task 5 (`settings.weatherLocation.set`).

**0176 and 0177 are FROZEN** (checksum-recorded, applied). Any content change needs a new migration
file, never in-place edit.

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
  satisfies this — Tasks 3/4/5 reused it without modification. Reuse it again unless a task
  genuinely needs a new family.**
- When casting `input` inside execute, use an inline structural type
  (`input as { lat: number; lon: number; label: string }`), not a cast to the shared DTO type
  itself (`as WeatherLocationDto` fails TS2352, insufficient overlap with `ToolInput`).

## Test placement rule

Any DB-backed `ToolExecute` (real `PreferencesRepository`/Postgres) → `tests/integration/`, run via:

```bash
export JARVIS_PGDATABASE=jarvis_build_1264
pnpm exec tsx scripts/test-integration.ts tests/integration/<file>.test.ts
```

(Bare `tsx` not on PATH — must go through `pnpm exec`.) Fakeable-port-only tools → `tests/unit/`.
Every tool built so far (2-5) has been DB-backed → integration. Template:
`tests/integration/settings-weather-location-tool.test.ts` (lightest, uses shared
`ids`/`resetFoundationDatabase()`/`DataContextRunner` from `tests/integration/test-database.ts`).

## TRAP — apply to every future migration

`tests/integration/foundation-schema-catalog.test.ts` pins the full migration list via
`toEqual([...])`. Next free global version: **0178**.

## Known pre-existing noise (not yours to fix)

Root `pnpm typecheck` (not per-package — `pnpm --filter <pkg> typecheck` throws pre-existing
`TS6059 rootDir` errors). `pnpm format:check` flags 2 pre-existing files unrelated to this lane
(`docs/superpowers/plans/2026-07-27-module-self-operation-settings-commands.md`,
`tests/integration/structured-state.test.ts`) — not yours, don't reformat them.

## PR body MUST include (coordinator ruling, do not drop)

`structured-state/src/manifest.ts`'s migrations array had drifted pre-epic (0111, 0167 missing);
corrected in `96edbcaa`; package still has no pinning test for that array — tracked as **#1272**,
cite it in the PR body.

## Immediate next step

1. `export JARVIS_PGDATABASE=jarvis_build_1264` in your shell before any db work.
2. Task 6 — read `## Task 6` only (plan lines 764-854). Verify every claim (file paths, existing
   function signatures, preference key names, test placement) against actual current branch state
   before implementing — the plan has been wrong on execute-signature and file-layout details on
   every task so far.
3. Continue Task 7 → 8 → 9 → 10 (rebase counts per ruling above) → 11 → 13, one section at a time,
   per-task green commit. Root `pnpm typecheck` + `format:check` + `lint` before every commit, plus
   the actual new integration test.
4. Self-monitor context; relay again at the 70% meter warning or on a compaction summary. Commit
   before relaying — reading is not progress.
5. Once Task 13/11 land, invoke `coordinated-wrap-up` (gate, push, PR citing #1272, report to
   coordinator) — not this session's job unless it gets that far.

## Full detail if needed

`memory_smart_search` project `jarv1s`, query `"1264 settings self-operation"`. Prior relays:
`docs/superpowers/handoffs/2026-07-27-1264-settings-self-operation-relay.md`,
`docs/superpowers/handoffs/2026-07-27-1264-settings-self-operation-relay-2.md`.
