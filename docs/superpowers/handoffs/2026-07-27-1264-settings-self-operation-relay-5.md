# #1264 settings self-operation — relay 5 (Task 7 DONE, Task 8 next)

**Branch/worktree:** `1264-settings-self-operation` (this worktree, reuse — do NOT `pnpm install`,
`node_modules` present). **Coordinator:** resolve fresh via `herdr pane list`, label `Coordinator`
(session id `43e5f5e2-0deb-4ab5-9237-436e8795b611` as of this writing — re-resolve, don't trust a
stale session id if it doesn't show up). **Risk tier:** security (Opus QA before merge).

## RUN RULE — read before ANY db command

```bash
export JARVIS_PGDATABASE=jarvis_build_1264
```

Set in every new shell (does not persist). Verify it actually took on the process you run tests
with, not just the exporting shell. DB already exists, migrations through 0177 applied — reuse.

## Coordinator rulings — binding, do not re-litigate

1. **Digest is OUT OF SCOPE.** Do not build `settings.digest.*` tools. Do not rename a tool to
   dodge the security exclusion denylist — that's a hole, not a fix.
2. **Task 10 rebases inventory to EXACTLY** `grantedAtInstall=31, confirmAlways=5,
   userPromotable=4` (sum 40). Keep the assertion exact — never `toBeGreaterThan` or a range.

## State: Tasks 0a-7 DONE and committed. 5 tasks left (8, 9, 10, 11, 13).

Plan: `docs/superpowers/plans/2026-07-27-module-self-operation-settings-commands.md`. **Read BY
TASK SECTION ONLY.** Current confirmed line map (re-verify with
`grep -n "^## Task"` — it has drifted before):
8=935-1038 9=1039-1087 10=1088-1113 13=1114-1197 11=1198-end.

## Commits so far

`5851d825` 0a · `96edbcaa` 0a manifest-array follow-up · `c366b877` 0b · `7a52e28d` 0c ·
`c449e22c` Task 1 · `69cb940f` Task 2 (`settings.themeMode.set`) · `bd8acd24` Task 3 (locale) ·
`1ab1f649` Task 4 (quietHours) · `11d16069` Task 5 (weatherLocation) · `fc2a42b7` Task 6
(notificationPreference.setEnabled) · `1e7f57ec` Task 7 (`chat.setResponseStyle` on chat's own
manifest — new precedent: first tool NOT in `packages/settings`, added a brand-new
`chat.preference-write` action family since chat's manifest had none).

**0176 and 0177 are FROZEN.** Any content change needs a new migration file, never in-place edit.
Next free global migration version: **0178**.

## Task 8 — the one open decision, read this before touching undo-stack

Plan's pseudocode for Task 8 is doubly wrong (confirmed by grounding, not assumed): there is no
`ctx.chatId` (real field: `chatSessionId`) and no `ctx.settingsUndoStack` context slot — no
`ModuleAssistantToolContext` shape exists at all. Correct approach: a package-level singleton
exported from `packages/settings/src/undo-stack.ts`, imported directly by each tool file (same
pattern as each file's own `const preferences = new PreferencesRepository();`) — no
`ToolServices`/composition-host threading needed, undo-stack is internal to `packages/settings`.

**Blocking snag:** 4 of the 5 target tools (`theme-mode-tool.ts`, `locale-tools.ts` ×2 execute
fns, `quiet-hours-tool.ts`, `weather-location-tool.ts`) are CAS-based via
`PreferencesRepository.getWithRevision`/`upsertWithRevision`, so `previousValue`/`previousRevision`
are cheap to capture. The 5th, `notification-preference-tool.ts` (Task 6), delegates to
`setNotificationPreferenceEnabled` in `notification-preference-application.ts`, which calls the
**plain, non-CAS** `preferencesRepository.upsert(scopedDb, KEY, { enabled })` — no read-before-write,
no revision. **Decide before building:** (a) skip undo-stack wiring for that one tool, document the
gap explicitly in its manifest description/comment, or (b) extend the application function to
read-before-write so it can supply a `previousValue` — larger change touching the Task 6
composition-host contract, needs its own verification pass. Recommend (a) unless the coordinator
says otherwise — escalate if unsure, don't silently pick.

**Corrected file locations** (plan's suggestions are stale — no `assistant-tools/` subdirectory
convention exists anywhere in this repo):
- `packages/settings/src/undo-stack.ts` (implementation + exported singleton)
- `tests/unit/settings-undo-stack.test.ts` — flat, NOT colocated `packages/settings/src/undo-stack.test.ts`.
  Confirmed via `find tests/unit -iname "*settings*"` (~35 files, all flat `tests/unit/settings-<feature>.test.ts`)
  and `find packages/settings -iname "*.test.ts"` (empty — no colocated tests in this package).

## Ground-truth corrections — apply to every remaining task (9, 10, 11, 13)

- `ToolExecute = (scopedDb, input, ctx, services?) => Promise<ToolResult>` — 4 positional args.
- `assertDataContextDb(scopedDb)` first line of every execute body.
- Return `{ data: {...} }` — spread a typed local, never assign a typed DTO directly (TS2322).
- `ToolContext = { actorUserId, requestId, chatSessionId, localTimezone? }` — `chatSessionId`
  REQUIRED. Test helper: `chatSessionId: ""`.
- No `assistant-tools/` subdirectory anywhere — tool files live flat at
  `packages/<pkg>/src/<feature>-tool.ts` (or `-tools.ts` for 2+ related tools).
- New `actionFamilyId` needs a matching `assistantActionFamilies` entry in that module's OWN
  manifest.ts (build-time assertion in `packages/ai/src/gateway/self-operation.ts`).
  `granted_at_install` tools: `allowedTiers` must include `trusted_auto` AND `always_confirm`;
  `defaultTier` must NOT be `always_confirm`. Reuse `settings.preference-write` (settings tools) or
  `chat.preference-write` (chat tools, added Task 7) unless a task genuinely needs a new family.
- Cast `input` with an inline structural type, not the shared DTO type (TS2352).
- Package public API (`packages/<pkg>/src/index.ts`) is a manual re-export list.

## Test placement rule

DB-backed `ToolExecute` (real `PreferencesRepository`/Postgres) → `tests/integration/`:
```bash
export JARVIS_PGDATABASE=jarvis_build_1264
pnpm exec tsx scripts/test-integration.ts tests/integration/<file>.test.ts
```
Fakeable-port-only (all deps via `ToolServices`) → `tests/unit/`, run via
`pnpm exec vitest run tests/unit/<file>.test.ts`. Task 8's undo-stack itself is pure logic → unit.

## Known pre-existing noise (not yours to fix)

Root `pnpm typecheck` OK; `pnpm --filter <pkg> typecheck` throws pre-existing `TS6059 rootDir`
errors, don't use it. `pnpm format:check` flags 2 pre-existing unrelated files
(`docs/superpowers/plans/2026-07-27-module-self-operation-settings-commands.md`,
`tests/integration/structured-state.test.ts`) — not yours. No per-package `lint` script — use
`pnpm exec eslint <touched files> --max-warnings=0`, root `pnpm lint` is the only whole-repo option.

## PR body MUST include (coordinator ruling, do not drop)

`structured-state/src/manifest.ts`'s migrations array drifted pre-epic (0111, 0167 missing);
corrected in `96edbcaa`; package still has no pinning test for that array — tracked as **#1272**,
cite it in the PR body.

## Immediate next step

1. `export JARVIS_PGDATABASE=jarvis_build_1264` in your shell before any db work; verify it took.
2. `grep -n "^## Task" docs/superpowers/plans/2026-07-27-module-self-operation-settings-commands.md`
   to re-verify line numbers before reading Task 8.
3. Task 8 — read `## Task 8` only. Decide the notification-preference gap per above, build, test,
   green commit. Then 9 → 10 (exact rebase counts) → 13 → 11 (full gate/UAT, reads best last, but
   re-check plan ordering/dependencies before assuming this sequence still holds).
4. Root `pnpm typecheck` + `format:check` + `lint` before every commit, plus the actual new test.
5. Self-monitor context; relay again at the 70% meter warning or on a compaction summary. Commit
   before relaying — reading is not progress.
6. Once Task 13/11 land, invoke `coordinated-wrap-up` (gate, push, PR citing #1272, report to
   coordinator).

## Full detail if needed

`memory_smart_search` project `jarv1s`, query `"1264 settings self-operation"`. Prior relays:
`docs/superpowers/handoffs/2026-07-27-1264-settings-self-operation-relay.md`,
`-relay-2.md`, `-relay-3.md`, `-relay-4.md`.
