# Handoff — #1026 UAT Playwright, BUILD pass 2 (Tasks 1-4 done, Task 5 mid-live-run)

Worktree/branch unchanged: this worktree, branch `uat-play-1026`, off `origin/main`.
`node_modules` installed — skip `pnpm install`. Coordinator label `Coordinator`, pane resolves via
`herdr pane list` (session `58a78927-385c-4b1d-8fa0-94db20255d6f` — resolve fresh).

Plan: `docs/superpowers/plans/2026-07-13-uat-1026-playwright.md` (committed `f4d7a896`) — follow it
exactly for any remaining code, don't re-derive.

## Done (committed)
- Task 1 `053dbfb4`, Task 2 `15bb7126`, Task 3 `d08acb93`, Task 4 `3ff80d06`. All typecheck clean.

## In progress — Task 5
`tests/uat/specs/job-search-install.uat.spec.ts` written (exact code per plan Task 5 Step 1),
**not yet committed**. First live run (`pnpm test:uat`) failed before Playwright even started —
found and (uncommitted) fixed a **pre-existing infra bug**, not something this build introduced:

- `.dockerignore` blanket-excludes `tests/` (commit `b035b791`). The `seed` compose service
  (`infra/docker-compose.prod.yml`, added by already-merged #1032) runs `tests/uat/seed/cli.ts`
  **inside the built image** — so seed has apparently never worked end-to-end since #1032 merged.
- Fix (uncommitted, in `.dockerignore`): replaced the blanket `tests` line with itemized excludes
  that leave `tests/uat/seed/**` included. Verified via grep that `tests/uat/seed`'s transitive
  imports never reach outside that directory — safe to whitelist just that subtree.

## Next steps (in order)
1. Re-run `pnpm test:uat` (needs Docker; ~3min build + boot). Confirm: seed container now finds
   `cli.ts` and runs, full flow reaches Playwright, spec passes (1 passed, exit 0). Record
   wall-clock + exit code.
2. If green: commit `.dockerignore` + `tests/uat/specs/job-search-install.uat.spec.ts` (one or two
   commits, your judgement) — message must include a why-comment citing #1026/#1032 for the
   dockerignore fix specifically (it's a flagged deviation from the approved plan, same discipline
   as the `provisionForUat` return-shape change already flagged in Task 1). Suggested trailer:
   `Closes #1026`.
3. If still red: read the new failure carefully — don't assume it's another infra gap, could be a
   real locator/flow bug in the spec itself now that seed actually runs.
4. Pre-push: `pnpm format:check && pnpm lint && pnpm typecheck`, then
   `git fetch origin main && git rebase origin/main`.
5. `pnpm verify:foundation` green, record exit codes.
6. `coordinated-wrap-up` skill → PR, base `main`, body must include `Part of #1000`, `Closes #1026`,
   **and explicitly call out the `.dockerignore` fix as a discovered pre-existing bug** (not scope
   creep) in the description. What's-new line: "Internal — adds the Playwright UAT spec that drives
   the real UI to prove job-search install completes end-to-end; also fixes a pre-existing bug
   where the UAT seed container couldn't find its own entrypoint inside the built image."
7. Report PR # to Coordinator (`herdr pane send-text`, resolve pane fresh first, caveman voice).
   Coordinator polls verify-foundation to green then merges manually — NOT `--auto`. Never
   merge/board/close directly.

## Guardrails (still binding)
No `git add -A`. Don't touch `docs/coordination/`. No repo-wide `pnpm format`. No new migration.
Happy-path only. No `page.goto` beyond initial baseURL load. Why-comments about fail-closed module
gating cite `apps/web/src/app.tsx`'s `myModulesEnabled()` + #1026/#1000, never #868.

Relay again at next 70% context-meter warning or compaction-summary sighting.
