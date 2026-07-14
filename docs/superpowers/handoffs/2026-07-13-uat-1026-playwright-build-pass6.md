# Handoff — #1026 UAT Playwright, BUILD pass 6 (bug #6 fixed, run-10 in flight)

Worktree/branch unchanged: this worktree, branch `uat-play-1026`, off `origin/main`.
`node_modules` installed — skip `pnpm install`. Coordinator label `Coordinator`, pane resolves via
`herdr pane list` (resolve fresh, never trust a cached ID).

Plan: `docs/superpowers/plans/2026-07-13-uat-1026-playwright.md` (`f4d7a896`) — follow exactly.
Supersedes `...-pass5.md`. Earlier passes stale/inert.

## Done (committed)
Task 1 `053dbfb4`, Task 2 `15bb7126`, Task 3 `d08acb93`, Task 4 `3ff80d06`, pass3 `d88deab8`,
pass4 `6ec36594`, pass5 `aea50409`. All typecheck clean.

## Task 5 — still uncommitted, 6 bugs found+fixed in working tree, run-10 in flight
1. `.dockerignore` whitelist `tests/uat/seed/**`. Confirmed working.
2. Sign-in locator scoped to `form.auth-form`. Confirmed working.
3. `provisioner.ts` `writeUatEnvFile()` — `JARVIS_AUTH_TRUSTED_ORIGINS` for 127.0.0.1 vs localhost.
   Confirmed working.
4. Onboarding-wizard seed gap — new `tests/uat/seed/chunks/onboarding.ts` + `levels.ts` wiring.
   Confirmed working every run since.
5. `provisioner.ts` `restartUatStack()` — `up -d jarv1s` is a Compose no-op (unchanged image/config)
   so `module-reconcile.ts`'s boot-only reconcile never reran. Fixed: `up -d` → `restart jarv1s`.
   **Confirmed working in run-9** (test progressed past the "Installed" assertion to line 68).
   Also flagged a **genuine product bug** (out of scope, do not fix here):
   `apps/web/src/settings/settings-module-registry-section.tsx:189` tells real operators to run
   `docker compose pull && docker compose up -d`, which hits this same no-op when no new image tag
   was pulled. Must become its own GitHub issue — see step 7 below. Full citations: memory
   `mem_mrk07hcd_ea0a9c7cdc7c`.
6. **NEW, fixed this pass**: `job-search-install.uat.spec.ts` old line 68 —
   `jobSearchRowAfterRestart.locator("label.jds-switch", { has: enableSwitch })` — `enableSwitch`
   was an ABSOLUTE page-rooted locator; Playwright's `has:` requires the inner locator to resolve
   as a descendant of the outer candidate, but the label is nested *inside* the registry section,
   not the reverse, so it matched 0 elements and hung the full 60s (confirmed via trace.zip — only
   one "waiting for locator(...)" log entry, never reached actionability). Root-caused (not
   guessed) that `scripts/module-reconcile.ts:234`'s phase-5 staged-acceptance sets
   `status='enabled'` unconditionally on accept — a registry install has no separate manual-enable
   step. **Fix: deleted the click entirely**, spec now just asserts `enableSwitch` is already
   checked once "Installed" is visible. Typechecks clean. Full detail: memory
   `mem_mrk1ij0r_16350bcb9f95`. **NOT YET VERIFIED live** — run-10 in flight now (see below).

## Also still open from pass5: background-task timeout artifact
Bash `run_in_background` timeouts (420s/480s) were too short for the full pipeline and came back
"killed" (tool-level kill, not an app failure) — see memory `mem_mrk07kmd_d01cbbf723c3`. Mitigation:
detached `setsid nohup ... & disown` + Monitor tailing the log. **This worked correctly for run-9**
(completed normally, real pass/fail result, not killed) — keep using this pattern.

## Run-10 in flight now
Started via:
```
setsid nohup pnpm test:uat > <scratchpad>/uat-run10.log 2>&1 < /dev/null &
disown
```
Log path: session scratchpad `uat-run10.log` (regenerate with a fresh setsid/nohup in a new session
if this file/session is gone — the scratchpad dir is session-scoped).

## Next steps (in order)
1. Check run-10's result: `tail`/grep the log for `passed|failed|ELIFECYCLE|Error:`. If the process
   is gone check `pgrep -af "test:uat|playwright"` — if nothing is running and no result was
   captured, the detach may not have survived a session boundary; just re-launch the same command.
2. If green (1 passed, exit 0): proceed to commit/push/PR (steps below).
3. If red on a genuine assertion (not "killed"/no-output): same read-error-context-first discipline
   used for all 6 prior bugs — pull `test-results/**/error-context.md` and, if needed, the
   `trace.zip` (unzip, inspect `0-trace.trace` JSONL for `type":"log"` entries and unresolved
   `before`/`after` callIds — see this pass's method) before touching code.
4. Once green, commit in ~5 logical commits: `.dockerignore`; `provisioner.ts` (trustedOrigins +
   restart fixes together); `chunks/onboarding.ts` new file + `levels.ts` wiring; the spec file
   (includes both its own Sign-in-locator fix and the has-filter fix). Why-comments citing #1026
   (dockerignore also #1032). Trailer `Closes #1026` on the last commit.
5. Pre-push: `pnpm format:check && pnpm lint && pnpm typecheck`, then
   `git fetch origin main && git rebase origin/main`.
6. `pnpm verify:foundation` green, record exit codes.
7. `coordinated-wrap-up` → PR, base `main`, `Part of #1000` + `Closes #1026` + release-note language
   for the spec + all infra gaps (plainly non-user-visible). **Distinctly and loudly flag the
   product bug** (misleading "restart to apply" operator copy, item 5 above) as a separate,
   out-of-scope finding needing its own issue — do not fix it in this PR.
8. File (or explicitly recommend Coordinator file) that product-bug issue per "Build needs task
   issue" hard rule.
9. Report PR # to Coordinator (`herdr pane send-text`, resolve pane fresh via `herdr pane list`
   first). Flag all deviations, especially the product bug. Coordinator polls verify-foundation
   green then merges manually — never `--auto` (memory `auto-merge-skips-nonrequired-checks`).
   Never merge/board/close directly.

## Guardrails (still binding)
No `git add -A`. Don't touch `docs/coordination/`. No repo-wide `pnpm format`. No new migration.
Happy-path only. No `page.goto` beyond initial baseURL load.

Relay again at next 70% context-meter warning or compaction-summary sighting.
