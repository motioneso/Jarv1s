# Relay — #1187 module library (build lane), relay 2 (2026-07-19, context 73%)

**Spec:** `docs/superpowers/specs/2026-07-19-1187-module-inventory-feedback.md`
**Plan:** `docs/superpowers/plans/2026-07-19-1187-module-library.md`
**Worktree/branch:** this worktree, `feedback/1187-module-library`.
**Coordinator:** label `Coordinator`, session `019f7c33-1d00-76c3-97ae-b637ff77faa9` — re-resolve
pane by label+session id at message time, never a baked `…-N`.
**Tier:** security.

Read plan/spec BY SECTION for the current task only, never front-to-back.

## Run overrides still in force

- **Wrap-up override (this run only):** after the full verification gate, stop at a compact
  verification report to the Coordinator. Do **NOT** push, open a PR, merge, or touch the project
  board — the Coordinator integrates this branch itself for #1178 visual QA and cuts a clean
  main-based PR later.
- Relay only after real work past ~80% context is the normal rule; this relay fired early (73%)
  because the user explicitly instructed relay-now, overriding the threshold for this handoff only.

## Done — all committed, working tree clean except hook-managed `.claude/context-meter.log`

- `6ed3d788` (Task 1) + `64db5e61` (bugfix): `libraryAction`, `describeCapabilityConsequences`,
  external-modules trust-warning fix.
- `dec8f95c` (Task 2): merged built-in + registry modules into one "Module library" group —
  `settings-instance-modules-pane.tsx` / `settings-module-registry-section.tsx`. Tests green.
- `167d6542` (Task 4): updated `tests/e2e/settings-modules.spec.ts` copy assertion
  ("Available modules" → "Module library").
- `14b98a1c`: fixed pre-existing prettier drift in 3 files untouched by my diffs (plan/spec docs +
  `tests/unit/module-registry-row-model.test.ts`), whitespace-only.
- Verified via 3 passing e2e tests (`settings-modules.spec.ts` + `external-modules.spec.ts`),
  run against an isolated scratch Playwright config on port 4183 — another worktree
  (`feedback-1188-connector-onboarding`) was squatting the default port 4173's dev server; did NOT
  touch that process, dodged it with a scratch config instead
  (`pnpm exec playwright test --config=<scratch-path> tests/e2e/settings-modules.spec.ts tests/e2e/external-modules.spec.ts`).
  That scratch config lived in `/tmp/.../scratchpad/`, not the repo — recreate ad hoc on any free
  port if re-running e2e.

## Diagnosed but NOT fixed yet — do this first

`pnpm typecheck` (root) fails in `apps/web/src/settings/settings-module-registry-section.tsx`:

- **TS2835** ×6 — relative imports missing explicit `.js` extension (current HEAD lines 9, 15-19:
  `../api/client`, `../api/query-keys`, `./module-credentials-section`, `./settings-feedback`,
  `./settings-types`, `./settings-ui`).
- **TS18046** ×3 — `result` is `unknown` in `downloadMutation`/`removeMutation` `onSuccess`
  callbacks (current HEAD ~lines 142, 156, 157).
- **TS7006** ×3 — implicit `any` on `row`/`row`/`value` params (current HEAD ~lines 241, 256, 302 —
  the `.some((row) => ...)`, `.map((row) => ...)`, `Switch onChange={(value) => ...}` sites).

**Confirmed pre-existing, not a Task 2/4 regression**: reproduced the same error class (plus one
extra TS7053 that Task 2's rewrite happened to eliminate) against Task-1 commit `6ed3d788` via a
`git stash` + `git checkout 6ed3d788 -- <4 files>` + `pnpm exec tsc --noEmit` diagnostic, then
restored the tree with `git checkout HEAD -- <4 files>` + `git stash pop`. Tree is clean now — that
diagnostic is already reverted, do not repeat it.

Root cause: root `tsconfig.json` uses strict NodeNext resolution; its `include` does not cover
`apps/web/**/*.tsx` directly, but `tests/unit/module-registry-row-model.test.ts` imports
`settings-module-registry-section.js`, pulling that file into the root's strict pass transitively.
`apps/web`'s OWN `pnpm --filter @jarv1s/web typecheck` (bundler resolution, lenient) is clean —
confirmed via `cd apps/web && pnpm exec tsc --noEmit` (zero errors).

**Recommended fix (not yet executed)** — small, mechanical, confined to a file already owned this
session (mirrors how the prettier drift was handled):

1. Add `.js` to the 6 relative imports on lines 9-19.
2. Type the 3 `result` params in the mutation `onSuccess` callbacks — check `../api/client.ts` for
   `downloadRegistryModule`/`removeRegistryModule`'s actual return types and annotate accordingly.
3. Type the 3 implicit-any params (`row: ModuleRegistryRowDto` ×2, `value: boolean`).

After the fix, re-run `pnpm format:check && pnpm lint && pnpm typecheck` from repo root to confirm
all three green — this is the very next action for the successor.

## Remaining steps (full verification gate, in order)

1. Fix the typecheck errors above (or escalate to Coordinator if the inline fix turns out
   non-trivial once attempted).
2. `pnpm format:check && pnpm lint && pnpm typecheck` — all three green.
3. `pnpm test:unit` (full suite, not just targeted files).
4. Re-confirm the 2 targeted e2e specs pass
   (`tests/e2e/settings-modules.spec.ts tests/e2e/external-modules.spec.ts`) — check if anything is
   still squatting port 4173 before assuming; if so, dodge with a scratch config on a free port,
   never kill a foreign process.
5. Run full gate `pnpm verify:foundation`.
6. Send a compact verification report to the Coordinator (label `Coordinator`, session
   `019f7c33-1d00-76c3-97ae-b637ff77faa9`, re-resolved fresh). Include: files touched across all
   commits (`dec8f95c`, `167d6542`, `14b98a1c`, plus the new typecheck-fix commit), gate exit
   codes, spec acceptance-box status, and a note that the typecheck drift found+fixed this segment
   was pre-existing since Task 1, not attributable to Task 2/4 scope. Do NOT push, PR, merge, or
   touch the board.

## Coordinator correction (already applied, from before Task 1)

`libraryAction` lives in `settings-module-registry-section.tsx`, not
`settings-instance-modules-pane.tsx` (avoids a circular import) — already reflected in committed
code, no action needed.

## Key design judgment already made (flag if reconsidering)

Decision-4 capability translation: no hardcoded permission-id→phrase table (vocabulary is
open/module-extensible). Instead lead the confirm-dialog description with a consequence sentence
built from structured DTO fields (`fetchHosts`→network access, `tools[].risk`→side-effecting
tools, `ownsTables`→stored data), and keep raw permission ids as a secondary detail line.

## Guardrails (unchanged)

No edits to `settings-page.tsx`, routes, schema, auth/RLS, hash/integrity, worker, or lifecycle
state derivation. If any of those turn out necessary, stop and escalate to the Coordinator (label
`Coordinator`, re-resolve pane fresh) before touching them.

## Coordination notes

- Never `git add -A` — explicit paths only, shared host discipline.
- `.claude/context-meter.log` shows modified in `git status` — hook-managed, not yours to
  stage/commit; ignore it.
- Another worktree (`feedback-1188-connector-onboarding`) runs its own vite dev server on port
  4173 — do not touch that process; use a different port for any e2e run here.
