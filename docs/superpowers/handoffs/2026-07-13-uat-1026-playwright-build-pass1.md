# Handoff — #1026 UAT Playwright, BUILD pass 1 (approved, code started)

Worktree/branch unchanged: this worktree, branch `uat-play-1026`, off `origin/main`.
`node_modules` installed — skip `pnpm install`. Coordinator label `Coordinator`, pane resolves via
`herdr pane list` (session `58a78927-385c-4b1d-8fa0-94db20255d6f` — resolve fresh).

**Plan approved by Coordinator (approval #4)**, including both flagged deviations
(`provisionForUat` returns `{baseURL, projectName, teardown}`; `restartUatStack` new export).
Plan: `docs/superpowers/plans/2026-07-13-uat-1026-playwright.md` — 5 tasks, follow it exactly,
don't re-derive design.

## Done (committed)
- **Task 1** — `053dbfb4`: `tests/uat/provisioner.ts` now exports `buildSeedHookInput`,
  `restartUatStack`, `provisionForUat`; `main()` refactored to call `provisionForUat("bare")` then
  `teardown()` (preserves `pnpm uat:provision:smoke` behavior). `tests/unit/uat-provisioner.test.ts`
  has 2 new passing cases for `buildSeedHookInput`. Full unit file: 16/16 pass. `pnpm typecheck`:
  exit 0.

## Next (in order, per the plan doc)
- **Task 2**: `tests/uat/seed/admin.ts:8-9` — add `export` to `UAT_ADMIN_EMAIL`/`UAT_ADMIN_PASSWORD`.
  Typecheck, commit. (`admin.test.ts` untouched/out of scope — needs live dev Postgres, not gated.)
- **Task 3**: create `tests/uat/playwright.uat.config.ts` (exact code in plan Task 3).
- **Task 4**: create `tests/uat/run-uat.ts` + add `"test:uat": "tsx tests/uat/run-uat.ts"` to
  `package.json` scripts (exact code in plan Task 4).
- **Task 5**: create `tests/uat/specs/job-search-install.uat.spec.ts` (exact code in plan Task 5).
  Run live: `pnpm test:uat` (needs Docker — builds+boots the prod-shaped compose stack, real
  install+restart+reconcile). Record exit code. Commit (message includes `Closes #1026`).

## After Task 5 passes live
Follow plan's global constraints + relay2 handoff's remaining steps:
1. Pre-push: `pnpm format:check && pnpm lint && pnpm typecheck`, then
   `git fetch origin main && git rebase origin/main`.
2. `pnpm verify:foundation` green, record exit codes.
3. `coordinated-wrap-up` skill → PR, base `main`, body must include `Part of #1000`,
   `Closes #1026`, What's-new line: "Internal — adds the Playwright UAT spec that drives the real
   UI to prove job-search install completes end-to-end."
4. Report PR # to Coordinator (label `Coordinator`, `herdr pane send-text`). Coordinator polls
   verify-foundation to green then merges manually — NOT `--auto` (VF isn't a required check).
   Never merge/board/close directly.

## Guardrails (still binding)
No `git add -A` (shared tree — stage explicit paths only). Don't touch `docs/coordination/`. Don't
run repo-wide `pnpm format`. No new migration. Happy-path only, no failure-injection test. No
`page.goto` beyond the one unavoidable initial `baseURL` load — everything else is real clicks
(`RailUserMenu` → Settings → Admin/Setup → Instance modules). Why-comments about fail-closed module
gating cite `apps/web/src/app.tsx`'s `myModulesEnabled()` + #1026/#1000, never #868.

Relay again at next 70% context-meter warning or compaction-summary sighting.
