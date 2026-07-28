# #1264 settings self-operation — relay 2 (Tasks 0a/0b/0c/1/2 DONE, Task 3 next)

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

1. **Digest is OUT OF SCOPE.** Do not build `settings.digest.*` tools. See prior relay doc for
   full detail (`2026-07-27-1264-settings-self-operation-relay.md`).
2. **Rebase inventory counts on #1265's numbers, not main's**: `grantedAtInstall=31,
   confirmAlways=5, userPromotable=4` (sum 40). Task 10 rebases onto this, not the plan's assumed
   38. Walk `getBuiltInModuleManifests()` to count — People module declares grants in
   `packages/people/src/tools.ts`, not a manifest.ts.

## State: Tasks 0a, 0b, 0c, 1, 2 DONE and committed. 10 tasks left (3 through 11+13).

Plan: `docs/superpowers/plans/2026-07-27-module-self-operation-settings-commands.md`. **Read BY
TASK SECTION ONLY.** Line map: 3=446-590 4=591-680 5=681-763 6=764-854 7=855-934 8=935-1038
9=1039-1087 10=1088-1113 11=1114-1129 (Task 13 inserted before 11's heading —
`grep -n "^## Task 13"`).

## Commits so far

`5851d825` 0a · `96edbcaa` 0a manifest-array follow-up · `c366b877` 0b (0176 migration + catalog
row) · `7a52e28d` 0c (0177 migration, widened outcome CHECK) · `c449e22c` Task 1 (extracted
`setNotificationPreferenceEnabled`) · `69cb940f` Task 2 (`settings.themeMode.set` tool +
`settings.preference-write` action family).

**0176 and 0177 are FROZEN** (checksum-recorded, applied). Any content change needs a new migration
file, never in-place edit.

## Task 2's ground-truth corrections — the plan's pseudocode was WRONG on these, apply to every remaining task

The plan describes a `ModuleAssistantToolContext` two-arg `(input, ctx)` execute signature with
`ctx.scopedDb` — **this type does not exist**. The real contract (verify against
`packages/module-sdk/src/index.ts` and a sibling like `packages/wellness/src/tools.ts`, not the
plan):

- `ToolExecute = (scopedDb, input, ctx, services?) => Promise<ToolResult>` — **4 positional args**.
- `assertDataContextDb(scopedDb)` first line of every execute body (from `@jarv1s/db`).
- Return `{ data: {...} }`, never a bare object.
- `ToolContext` is `{ actorUserId, requestId, chatSessionId, localTimezone? }` — **`chatSessionId`
  is REQUIRED**, not optional. A test `toolCtx()` helper that omits it fails typecheck
  (`TS2741`). Use `chatSessionId: ""` in test helpers, matching `tests/integration/wellness.test.ts`.
- No `assistant-tools/` subdirectory convention exists anywhere — tool files live flat at
  `packages/<pkg>/src/<feature>-tool.ts`, sibling to the manifest.
- A new `actionFamilyId` referenced by a tool MUST have a matching entry added to that module's own
  `assistantActionFamilies` array in its manifest.ts, or the build-time assertion in
  `packages/ai/src/gateway/self-operation.ts` fails ("does not resolve in its own module"). For
  `granted_at_install` tools specifically: `allowedTiers` must include both `trusted_auto` AND
  `always_confirm`; `defaultTier` must NOT be `"always_confirm"`.

## NEW drift found in Task 2 — corrects prior relay's guidance, apply to remaining tasks

Prior relay said "use `tests/unit/settings-<feature>.test.ts`" for all new tool tests — **that's
only right for fakeable-port scenarios (like Task 1's)**. Task 2's tool hits a real,
non-injectable `PreferencesRepository` against actual Postgres — for **any DB-backed
`ToolExecute`**, the test belongs in `tests/integration/`, not `tests/unit/`. Template:
`tests/integration/wellness.test.ts` (heavier, manual user seeding) or
`tests/integration/settings-themes.test.ts` (lighter, uses shared `ids`/`resetFoundationDatabase()`
from `tests/integration/test-database.ts`) — prefer the lighter pattern. Run it via:

```bash
export JARVIS_PGDATABASE=jarvis_build_1264
pnpm exec tsx scripts/test-integration.ts tests/integration/<file>.test.ts
```

(Bare `tsx` is not on PATH in this worktree — must go through `pnpm exec`.) Decide unit vs
integration **per task** based on whether the tool's execute touches a real repository/DB, not by
copying the prior task's placement blindly.

## Trap avoided in Task 2 (already fixed, just documented for awareness)

If a new package import doesn't already exist in a package's `dependencies` (e.g.
`packages/settings` didn't declare `@jarv1s/structured-state` before Task 2 even though a sibling
file already imported from a similar package) — check `package.json` for the target package before
assuming an import will resolve at build time. Not every package that could plausibly need a
workspace dep already has it declared.

## TRAP — apply to every future migration

`tests/integration/foundation-schema-catalog.test.ts` pins the full migration list via
`toEqual([...])`. Next free global version: **0178**.

## Known pre-existing noise (not yours to fix)

`pnpm --filter <pkg> typecheck` in isolation throws pre-existing `TS6059 rootDir` errors — use root
`pnpm typecheck`. `pnpm format:check` currently also flags 2 pre-existing files unrelated to this
lane (`docs/superpowers/plans/2026-07-27-module-self-operation-settings-commands.md`,
`tests/integration/structured-state.test.ts`) — not yours, don't reformat them.

## PR body MUST include (coordinator ruling, do not drop)

`structured-state/src/manifest.ts`'s migrations array had drifted pre-epic (0111, 0167 missing);
corrected in `96edbcaa`; package still has no pinning test for that array — tracked as **#1272**,
cite it in the PR body.

## Immediate next step

1. `export JARVIS_PGDATABASE=jarvis_build_1264` in your shell before any db work.
2. Task 3 — read `## Task 3` only (plan lines 446-590). Verify every claim (file paths, existing
   function signatures, test placement) against actual current branch state before implementing —
   the plan has been wrong on execute-signature and test-placement details on every task so far.
3. Continue Task 4 → 11 → 13 (or wherever it's ordered), one section at a time, per-task green
   commit. Root `pnpm typecheck` + `format:check` + `lint` before every commit, plus the actual new
   test (unit or integration per the rule above).
4. Self-monitor context; relay again at the 70% meter warning or on a compaction summary. Commit
   before relaying — reading is not progress.

## Full detail if needed

`memory_smart_search` project `jarv1s`, query `"1264 settings self-operation"`. Prior relay doc:
`docs/superpowers/handoffs/2026-07-27-1264-settings-self-operation-relay.md`.
