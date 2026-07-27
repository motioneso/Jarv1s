# #1264 settings self-operation — relay 6 (Task 8 step 1-2 DONE, step 3 next)

**Branch/worktree:** `1264-settings-self-operation` (this worktree, reuse — do NOT `pnpm install`,
`node_modules` present). **Coordinator:** resolve fresh via `herdr pane list`, label `Coordinator`
(session id `43e5f5e2-0deb-4ab5-9237-436e8795b611` as of this writing — re-resolve, don't trust a
stale session id if it doesn't show up). **Risk tier:** security (Opus QA before merge).

## RUN RULE — read before ANY db command

```bash
export JARVIS_PGDATABASE=jarvis_build_1264
```

Set in every new shell (does not persist). DB already exists, migrations through 0177 applied.

## COORDINATOR RULING on Task 8 — binding, supersedes relay-5's framing

relay-5 said "decide (a) skip notification-preference undo wiring, or (b) extend to CAS — recommend
(a) unless coordinator says otherwise." **The coordinator said otherwise, mid-turn, with evidence.**
Full ruling (paraphrased, do not re-litigate):

- The CAS the other six tools rely on was **already defeated**: plain `upsert()` in
  `packages/structured-state/src/preferences-repository.ts` did NOT bump `revision` on conflict, so
  any key with both a CAS writer and a plain-upsert writer had a revision number that stopped
  tracking mutations (confirmed on 3 keys: theme-mode, locale, chat response-style — REST routes
  write plain, tools write CAS). Concrete failure: user changes theme via REST (revision stays 1) →
  assistant tool holding stale revision 1 CAS-writes successfully → user's REST change silently
  clobbered.
- **Ordered fix, do in this exact order:**
  1. ✅ **DONE, committed `b61009db`.** Bump `revision` in plain `upsert()`'s `onConflict.doUpdateSet`
     (`revision: sql\`app.preferences.revision + 1\`` — must be schema/table-qualified as
     `app.preferences.revision + 1`, an unqualified `revision + 1` throws "ambiguous column
     reference" in this Kysely/pg context).
  2. ✅ **DONE, same commit.** Regression test in `tests/integration/structured-state.test.ts`
     (inside `describe("PreferencesRepository", ...)`, after the "getWithRevision returns null for
     an absent key" test): CAS read → plain `upsert()` lands in between → CAS write with the stale
     revision must throw `PreferenceRevisionConflictError`, and the stored value must be the plain
     writer's, not clobbered. `pnpm exec tsx scripts/test-integration.ts
     tests/integration/structured-state.test.ts` → **31 passed (31)**.
  3. ⏳ **NOT STARTED — your first job.** Convert `setNotificationPreferenceEnabled`
     (`packages/settings/src/notification-preference-application.ts:56`, key
     `` `notifications:${manifest.id}` ``) from plain `upsert()` to the same `getWithRevision` +
     `upsertWithRevision` pair the other six tools use (reference pattern:
     `packages/settings/src/theme-mode-tool.ts`, `packages/settings/src/locale-tools.ts`). Map
     `PreferenceRevisionConflictError` to HTTP 409 on the REST route
     (`packages/settings/src/notification-preferences-routes.ts`, PUT handler, currently routes all
     errors through `handleSettingsRouteError` — **read that function first**, it may already have a
     generic-error→500 fallback you need to special-case before it, or it may already look for named
     error classes and just need one more branch). This is NOT hand-rolled read-before-write — the
     `UPDATE ... WHERE revision = expected` is atomic; a race conflicts, it doesn't clobber. Identical
     pattern already shipped 6x in this branch.
  - **HARD STOP condition** (still live): if you find any OTHER writer of a CAS key that can't be
    routed through the same primitive, STOP and message the coordinator — do not ship a mixed key.
    None found so far beyond the 3 the coordinator already named (all 3 now fixed by step 1's
    primitive change; step 3 is the last mixed key, `notifications:<moduleId>`).
- **Explicit prohibitions, still binding:** do not widen any `defaultTier`. Do not touch
  `docs/coordination/`. Digest (`settings.digest.*`) stays out of scope.

## Known type-widening needed for step 3 (not yet designed)

`setNotificationPreferenceEnabled`'s `deps.preferencesRepository` is currently typed as the plain
`ProfilePreferencesPort` (`get`/`getWithMetadata`/`upsert` only — see
`packages/settings/src/preferences-port.ts` and `packages/db/src/data-context.ts:25-65`). It needs
`getWithRevision`/`upsertWithRevision` too. Real callers already pass a full
`new PreferencesRepository()` (has all 5 methods — confirmed at
`packages/module-registry/src/index.ts:1045` and `packages/chat/src/routes.ts:747`), so widening the
*type* costs those callers nothing. Two places to check/update:
- `NotificationPreferenceApplicationDeps` (in `notification-preference-application.ts`)
- `NotificationPreferencesRoutesDependencies` (in `notification-preferences-routes.ts`)
- **Also check** `packages/settings/src/routes.ts:285-289` — a fallback stub object
  (`{ get: async()=>null, getWithMetadata: async()=>null, upsert: async()=>undefined }`) used when
  `dependencies.preferencesRepository` isn't injected (only `tests/integration/data-export.test.ts`
  relies on this fallback — grep confirms). If you widen the type to require CAS methods, this stub
  needs no-op `getWithRevision`/`upsertWithRevision` added too, or `data-export.test.ts` won't
  typecheck/run. Simplest: define the CAS-extended interface scoped to just the notification files
  (don't touch the shared `ProfilePreferencesPort` used everywhere else) — but check whether
  `routes.ts`'s single shared `preferencesRepository` const (threaded into ~10 route registrations
  including notification's) makes that awkward; if so, the fallback stub is the one place to extend.

After step 3: update `tests/unit/settings-notification-preference-application.test.ts`'s fake
in-memory port (currently only implements `get`/`getWithMetadata`/`upsert`) to also implement
`getWithRevision`/`upsertWithRevision` with real revision-bumping semantics, matching the real
repository's behavior, so the CAS conversion is actually exercised.

Run `pnpm exec vitest run tests/unit/settings-notification-preference-application.test.ts` green
before committing step 3.

## Then: Task 8's original deliverable — undo-stack (steps 4-6)

Plan pseudocode (already read, not stale for this part) — `packages/settings/src/undo-stack.ts`,
package-level singleton, `SettingsUndoStack` class keyed by `` `${actorUserId}:${chatId}` ``, LIFO,
cap 20 dropping oldest. Corrected file locations (plan's `assistant-tools/` subdir doesn't exist
anywhere in this repo):
- `packages/settings/src/undo-stack.ts` (implementation + exported singleton)
- `tests/unit/settings-undo-stack.test.ts` (flat, not colocated — confirmed convention via
  `find tests/unit -iname "*settings*"`, all ~35 files flat; `find packages/settings -iname
  "*.test.ts"` is empty)

Then wire `push()` into **all six** now-CAS-capable tools: theme-mode, locale ×2 execute fns,
quiet-hours, weather-location, **and now notification-preference** (no longer skipped — that was
relay-5's now-superseded plan). Import the singleton directly in each tool file (same pattern as
each file's own `const preferences = new PreferencesRepository();`) — no `ToolServices`/
composition-host threading needed.

Commit Task 8 once green (steps 3-6 in one commit, or split step 3 and steps 4-6 into two commits —
either is fine, prefer two: "CAS-convert notification preference writes" then "add settings
undo-stack, wire into all 6 tools").

## Remaining tasks after Task 8 (9, 10, 13, 11) — unchanged from relay-5

Plan: `docs/superpowers/plans/2026-07-27-module-self-operation-settings-commands.md`. **Read BY TASK
SECTION ONLY** — re-verify line numbers first (`grep -n "^## Task"`, it has drifted before). Last
confirmed map: 9=1039-1087, 10=1088-1113, 13=1114-1197, 11=1198-end.

- **Task 9**: no-op suppression for CAS writes — not read/started.
- **Task 10**: rebase self-operation manifest inventory. MUST assert EXACTLY
  `grantedAtInstall=31, confirmAlways=5, userPromotable=4` (sum 40), exact `toBe`, never a range.
  Coordinator reconfirmed this mid-turn, citing #1265's PR #1273 as already using these counts.
- **Task 13**: per-actor per-tool rate limiting (gateway-level) — not started.
- **Task 11**: full local gate + UAT golden-path, then `coordinated-wrap-up` (gate, push after
  pre-push trio, PR citing #1272, report to coordinator — not merge/board/close).

## Ground-truth corrections — apply to every remaining task (still valid from relay-5)

- `ToolExecute = (scopedDb, input, ctx, services?) => Promise<ToolResult>` — 4 positional args.
- `assertDataContextDb(scopedDb)` first line of every execute body.
- Return `{ data: {...} }` — spread a typed local, never assign a typed DTO directly (TS2322).
- `ToolContext = { actorUserId, requestId, chatSessionId, localTimezone? }` — `chatSessionId`
  REQUIRED. Test helper: `chatSessionId: ""`.
- No `assistant-tools/` subdirectory anywhere — tool files live flat at
  `packages/<pkg>/src/<feature>-tool.ts` (or `-tools.ts` for 2+ related tools).
- New `actionFamilyId` needs a matching `assistantActionFamilies` entry in that module's OWN
  manifest.ts. `granted_at_install` tools: `allowedTiers` must include `trusted_auto` AND
  `always_confirm`; `defaultTier` must NOT be `always_confirm`. Reuse `settings.preference-write` or
  `chat.preference-write` unless a task genuinely needs a new family.
- Cast `input` with an inline structural type, not the shared DTO type (TS2352).
- Package public API (`packages/<pkg>/src/index.ts`) is a manual re-export list.

## Test placement rule

DB-backed `ToolExecute` (real `PreferencesRepository`/Postgres) → `tests/integration/`:
```bash
export JARVIS_PGDATABASE=jarvis_build_1264
pnpm exec tsx scripts/test-integration.ts tests/integration/<file>.test.ts
```
Fakeable-port-only → `tests/unit/`, run via `pnpm exec vitest run tests/unit/<file>.test.ts`.
Undo-stack itself is pure logic → unit.

## Known pre-existing noise (not yours to fix)

Root `pnpm typecheck` OK; `pnpm --filter <pkg> typecheck` throws pre-existing `TS6059 rootDir`
errors, don't use it. `pnpm format:check` flags 2 pre-existing unrelated files
(`docs/superpowers/plans/2026-07-27-module-self-operation-settings-commands.md`,
`tests/integration/structured-state.test.ts` — verify your own added lines in the latter are
correctly formatted even though the file overall pre-existingly fails). No per-package `lint`
script — use `pnpm exec eslint <touched files> --max-warnings=0`, root `pnpm lint` is the only
whole-repo option.

## PR body MUST include (coordinator ruling, do not drop)

`structured-state/src/manifest.ts`'s migrations array drifted pre-epic (0111, 0167 missing);
corrected in `96edbcaa`; package still has no pinning test for that array — tracked as **#1272**,
cite it in the PR body.

## Commits so far

`5851d825` 0a · `96edbcaa` 0a manifest-array follow-up · `c366b877` 0b · `7a52e28d` 0c ·
`c449e22c` Task 1 · `69cb940f` Task 2 (`settings.themeMode.set`) · `bd8acd24` Task 3 (locale) ·
`1ab1f649` Task 4 (quietHours) · `11d16069` Task 5 (weatherLocation) · `fc2a42b7` Task 6
(notificationPreference.setEnabled) · `1e7f57ec` Task 7 (`chat.setResponseStyle`) · `b61009db`
Task 8 step 1-2 (revision-bump primitive fix + regression test).

**0176 and 0177 are FROZEN.** Any content change needs a new migration file, never in-place edit.
Next free global migration version: **0178** (Task 8 needs none — no schema change).

## Immediate next step

1. `export JARVIS_PGDATABASE=jarvis_build_1264` in your shell before any db work; verify it took.
2. Read `packages/settings/src/notification-preference-application.ts`,
   `packages/settings/src/notification-preferences-routes.ts` (esp. `handleSettingsRouteError`), and
   `packages/settings/src/theme-mode-tool.ts` (as the CAS reference pattern) — all already read once
   this session, contents summarized above and in prior relay context if you have it, but re-read if
   unsure.
3. Implement Task 8 step 3 (CAS-convert `setNotificationPreferenceEnabled` + 409 mapping + widen
   types + update fake port in the unit test), green, commit.
4. Implement Task 8 steps 4-6 (undo-stack + wire into all 6 tools), green, commit.
5. Root `pnpm typecheck` + `format:check` + `lint` before every commit, plus the actual new test.
6. Task 9 → 10 (exact rebase counts) → 13 → 11 (full gate/UAT), re-checking plan ordering before
   assuming this sequence still holds.
7. Self-monitor context; relay again at the 70% meter warning or on a compaction summary. Commit
   before relaying — reading is not progress.
8. Once Task 13/11 land, invoke `coordinated-wrap-up` (gate, push, PR citing #1272, report to
   coordinator).

## Full detail if needed

`memory_smart_search` project `jarv1s`, query `"1264 settings self-operation"`. Prior relays:
`docs/superpowers/handoffs/2026-07-27-1264-settings-self-operation-relay.md`, `-relay-2.md`,
`-relay-3.md`, `-relay-4.md`, `-relay-5.md`.
