# Handoff — #1026 UAT Playwright, BUILD pass 3 (Tasks 1-4 done, Task 5 mid-live-run, 4 bugs found)

Worktree/branch unchanged: this worktree, branch `uat-play-1026`, off `origin/main`.
`node_modules` installed — skip `pnpm install`. Coordinator label `Coordinator`, pane resolves via
`herdr pane list` (resolve fresh — do not trust any cached pane ID or session ID from prior docs).

Plan: `docs/superpowers/plans/2026-07-13-uat-1026-playwright.md` (committed `f4d7a896`) — follow it
exactly for any remaining code, don't re-derive.

Supersedes `...-build-pass2.md`. The `...-relay.md` / `...-relay2.md` / `...-pass1.md` docs in this
same directory are earlier PRE-CODE grounding passes (plan not yet approved) — now stale/inert,
safe to ignore; the plan they were building toward is long since approved and Tasks 1-4 are done.

## Done (committed)
Task 1 `053dbfb4`, Task 2 `15bb7126`, Task 3 `d08acb93`, Task 4 `3ff80d06`. All typecheck clean.

## In progress — Task 5, NOT YET COMMITTED
`tests/uat/specs/job-search-install.uat.spec.ts` written per plan. Four real (not code-review-visible)
bugs found via live `pnpm test:uat` runs and fixed in the working tree — this is exactly the failure
mode CLAUDE.md's "e2e dev UAT for UI/UX features" rule (2026-07-12) predicts. All four fixes are
uncommitted:

1. **`.dockerignore`** — blanket-excluded `tests/`, but the `seed` compose service
   (`infra/docker-compose.prod.yml`, #1032) runs `tests/uat/seed/cli.ts` *inside* the built image.
   Fixed: itemized excludes, `tests/uat/seed/**` whitelisted. Confirmed working (2 live runs).
2. **`tests/uat/specs/job-search-install.uat.spec.ts`** Sign-in locator — ambiguous accessible name
   collided with the auth-mode tab button. Fixed: scoped to `form.auth-form`. Confirmed working.
3. **`tests/uat/provisioner.ts`** `writeUatEnvFile()` — better-auth's `trustedOrigins` exact-match
   check rejected login because Playwright drives `http://127.0.0.1:<port>` but the default
   trusted-origin is `http://localhost:<port>` (distinct origins). Fixed: added
   `JARVIS_AUTH_TRUSTED_ORIGINS=deriveTrustedOrigins({webPort, publicOrigin: "127.0.0.1"})`, reusing
   `scripts/setup-prod-origins.ts`'s existing helper (same one `scripts/setup-prod.ts` uses for real
   deploys, #379) rather than hand-rolling. Confirmed working (1 live run, login succeeds).
4. **`tests/uat/seed/admin.ts`** `seedSoloAdmin()` — never wrote `app.instance_settings`'s
   `"onboarding.state"` row, so the freshly-seeded bootstrap-owner always landed on the onboarding
   wizard (`apps/web/src/app.tsx` → `shouldShowOnboarding()`) instead of the main shell, hiding
   `.jds-usermenu__trigger`. Fixed: raw insert (`key: "onboarding.state"`, `value: {value:
   "completed"}`, matching `packages/settings/src/repository.ts`'s `setOnboardingState` write
   shape exactly), same raw-`migrationDb`-insert pattern already used in that function for
   `app.users`/`app.auth_accounts` — no `DataContextDb`/audit row needed for seed data.
   **Typechecked clean, NOT YET verified via a live run** — this is the next action.

## Next steps (in order)
1. Re-run `pnpm test:uat` (5th live run; needs Docker, ~3-4min). Expect either full green (1 passed,
   exit 0) or a further downstream bug — if so, read it with the same discipline as the four above
   (Explore subagent / actual error-context.md and source, never assume "pre-existing/out of scope").
2. If green: commit in ~4 logical commits (dockerignore fix; provisioner.ts trustedOrigins fix;
   admin.ts onboarding-bypass fix; spec file) with why-comments citing #1026 (dockerignore also
   #1032). Trailer `Closes #1026` on the last commit.
3. Pre-push: `pnpm format:check && pnpm lint && pnpm typecheck`, then
   `git fetch origin main && git rebase origin/main`.
4. `pnpm verify:foundation` green, record exit codes.
5. `coordinated-wrap-up` → PR, base `main`, body `Part of #1000` + `Closes #1026` + release-note
   language covering the spec AND all four discovered infra gaps (seed build-context exclusion,
   UAT auth trusted-origins, spec locator ambiguity, onboarding-wizard seed gap) — release-note
   language, not implementation jargon; say plainly these are internal/non-user-visible.
6. Report PR # to Coordinator (`herdr pane send-text`, resolve pane fresh via `herdr pane list`
   first). Flag all four deviations explicitly. Coordinator polls verify-foundation to green then
   merges manually — never `--auto` (verify:foundation isn't a required check on this repo, see
   memory `auto-merge-skips-nonrequired-checks`). Never merge/board/close directly.

## Guardrails (still binding)
No `git add -A`. Don't touch `docs/coordination/`. No repo-wide `pnpm format`. No new migration.
Happy-path only. No `page.goto` beyond initial baseURL load.

Relay again at next 70% context-meter warning or compaction-summary sighting.
