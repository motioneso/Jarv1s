# Handoff — #1026 UAT Playwright, BUILD pass 5 (bug #5 fix applied, run-9 in flight)

Worktree/branch unchanged: this worktree, branch `uat-play-1026`, off `origin/main`.
`node_modules` installed — skip `pnpm install`. Coordinator label `Coordinator`, pane resolves via
`herdr pane list` (resolve fresh — do not trust any cached pane ID or session ID from prior docs).

Plan: `docs/superpowers/plans/2026-07-13-uat-1026-playwright.md` (committed `f4d7a896`) — follow it
exactly for any remaining code, don't re-derive.

Supersedes `...-pass4.md`. Earlier passes (`...-relay*.md`, `...-pass1/2/3.md`) are stale/inert.

## Done (committed)
Task 1 `053dbfb4`, Task 2 `15bb7126`, Task 3 `d08acb93`, Task 4 `3ff80d06`, pass3 doc `d88deab8`,
pass4 doc `6ec36594`. All typecheck clean.

## Task 5 — still uncommitted, spec written, 5 bugs found+fixed in working tree
1. `.dockerignore` — whitelisted `tests/uat/seed/**` (seed runs inside the built image). Confirmed
   working.
2. `tests/uat/specs/job-search-install.uat.spec.ts` Sign-in locator scoped to `form.auth-form`.
   Confirmed working.
3. `tests/uat/provisioner.ts` `writeUatEnvFile()` — added
   `JARVIS_AUTH_TRUSTED_ORIGINS=deriveTrustedOrigins(...)` for the `127.0.0.1` vs `localhost`
   origin mismatch. Confirmed working.
4. Onboarding-wizard seed gap — new `tests/uat/seed/chunks/onboarding.ts` (`seedOnboardingChunk`,
   real `SettingsRepository.setOnboardingState` via RLS-scoped runner) wired into
   `tests/uat/seed/levels.ts`. Confirmed working (seed step succeeds every run since).
5. **Restart no-op — fix applied, NOT YET VERIFIED live.** `docker compose up -d jarv1s` is a
   documented no-op when image/env/config is unchanged (module Download only touches a volume +
   DB row). `scripts/module-reconcile.ts` only runs at container boot, so a no-op `up -d` means it
   never reruns → row stays "Downloaded — restart to apply" forever. Confirmed via dispatched
   Explore agent (file:line citations in memory `mem_mrk07hcd_ea0a9c7cdc7c`). Fix in
   `tests/uat/provisioner.ts` `restartUatStack()`: `up -d jarv1s` → `restart jarv1s` (unconditional
   kill+restart of the same container, reruns start-jarv1s.ts's CMD incl. migrate+reconcile).
   Typechecks clean. **This is a DUAL bug** — also a genuine **product bug**:
   `apps/web/src/settings/settings-module-registry-section.tsx`'s operator-facing copy tells real
   operators to run `docker compose pull && docker compose up -d`, which hits this exact no-op when
   no new image tag was pulled. **Do NOT fix the product copy/mechanism under #1026** — flag it as
   its own GitHub issue when reporting to Coordinator (spec-before-build gate, "Build needs task
   issue" hard rule).

## New problem this pass, separate from the 5 bugs above
Two consecutive `pnpm test:uat` runs via Bash `run_in_background` (timeouts 420s/480s) came back
task status **"killed"**, not a normal pass/fail — the full pipeline (build+boot+migrate+seed+
Playwright+a real container restart) exceeds those timeouts on this shared host. This is a
tool/harness timeout artifact, not an app bug (memory `mem_mrk07kmd_d01cbbf723c3`).

**Mitigation applied, run in flight now:** started `pnpm test:uat` via
`setsid nohup ... > uat-run9.log 2>&1 & disown` (fully detached, no Bash-tool timeout can kill it),
logging to
`/tmp/claude-1000/.../scratchpad/uat-run9.log` (session-scratchpad path — regenerate via a fresh
`setsid nohup` if this file is gone in a new session). A persistent Monitor (task `bkl7qhyar`) is
tailing that log for terminal markers (`passed|failed|ELIFECYCLE|Error:|Timeout|...`).

## Next steps (in order)
1. Await/check the run-9 result (Monitor `bkl7qhyar`, or `tail`/`Read` the log file directly if the
   monitor was lost across a session boundary). Does the row flip to "Installed" after the
   `restart` fix? Does the full spec pass (1 passed, exit 0)?
2. If still red on a genuine assertion: same read-error-context-first discipline used for all 5
   prior bugs — do not guess.
3. If green: commit in ~5 logical commits (dockerignore; provisioner.ts — both trustedOrigins AND
   restart fixes; `chunks/onboarding.ts` new file + `levels.ts` wiring; spec file) with why-comments
   citing #1026 (dockerignore also #1032). Trailer `Closes #1026` on the last.
4. Pre-push: `pnpm format:check && pnpm lint && pnpm typecheck`, then
   `git fetch origin main && git rebase origin/main`.
5. `pnpm verify:foundation` green, record exit codes.
6. `coordinated-wrap-up` → PR, base `main`, body `Part of #1000` + `Closes #1026` + release-note
   language covering the spec AND all infra gaps found — plainly non-user-visible. **Distinctly and
   loudly flag the product bug** (misleading "restart to apply" operator copy) as a separate,
   out-of-scope finding needing its own issue.
7. File (or explicitly recommend Coordinator file) the new product-bug issue per "Build needs task
   issue" hard rule.
8. Report PR # to Coordinator (`herdr pane send-text`, resolve pane fresh via `herdr pane list`
   first). Flag all deviations, especially the product bug. Coordinator polls verify-foundation
   green then merges manually — never `--auto` (memory `auto-merge-skips-nonrequired-checks`).
   Never merge/board/close directly.

## Guardrails (still binding)
No `git add -A`. Don't touch `docs/coordination/`. No repo-wide `pnpm format`. No new migration.
Happy-path only. No `page.goto` beyond initial baseURL load.

Relay again at next 70% context-meter warning or compaction-summary sighting.
