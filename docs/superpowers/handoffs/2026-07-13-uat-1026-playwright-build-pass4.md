# Handoff — #1026 UAT Playwright, BUILD pass 4 (Tasks 1-4 done, Task 5 mid-live-run, 5 bugs found)

Worktree/branch unchanged: this worktree, branch `uat-play-1026`, off `origin/main`.
`node_modules` installed — skip `pnpm install`. Coordinator label `Coordinator`, pane resolves via
`herdr pane list` (resolve fresh — do not trust any cached pane ID or session ID from prior docs).

Plan: `docs/superpowers/plans/2026-07-13-uat-1026-playwright.md` (committed `f4d7a896`) — follow it
exactly for any remaining code, don't re-derive.

Supersedes `...-build-pass3.md`. The `...-relay.md` / `...-relay2.md` / `...-pass1.md` /
`...-pass2.md` docs in this same directory are earlier passes (pre-code grounding, or superseded
mid-build snapshots) — stale/inert, safe to ignore.

**Correction to pass3**: pass3 described bug #4 (onboarding-wizard seed gap) as a raw
`migrationDb` insert living in `admin.ts`. That design was WRONG (RLS violation, see below) and has
been **reverted and replaced**. The real fix is in `tests/uat/seed/chunks/onboarding.ts` (new file)
+ `tests/uat/seed/levels.ts` wiring. `admin.ts` is back to its original, unmodified state.

## Done (committed)
Task 1 `053dbfb4`, Task 2 `15bb7126`, Task 3 `d08acb93`, Task 4 `3ff80d06`. All typecheck clean.
Pass3 handoff doc itself: `d88deab8`.

## In progress — Task 5, NOT YET COMMITTED
`tests/uat/specs/job-search-install.uat.spec.ts` written per plan. FIVE real (not code-review-visible)
bugs found via live `pnpm test:uat` runs and fixed/being-fixed in the working tree — this is exactly
the failure mode CLAUDE.md's "e2e dev UAT for UI/UX features" rule (2026-07-12) predicts.

1. **`.dockerignore`** — blanket-excluded `tests/`, but the `seed` compose service
   (`infra/docker-compose.prod.yml`, #1032) runs `tests/uat/seed/cli.ts` *inside* the built image.
   Fixed: itemized excludes, `tests/uat/seed/**` whitelisted. Confirmed working. **Uncommitted.**
2. **`tests/uat/specs/job-search-install.uat.spec.ts`** Sign-in locator — ambiguous accessible name
   collided with the auth-mode tab button. Fixed: scoped to `form.auth-form`. Confirmed working.
   **Uncommitted (part of the new spec file itself).**
3. **`tests/uat/provisioner.ts`** `writeUatEnvFile()` — better-auth's `trustedOrigins` exact-match
   check rejected login because Playwright drives `http://127.0.0.1:<port>` but the default
   trusted-origin is `http://localhost:<port>` (distinct origins). Fixed: added
   `JARVIS_AUTH_TRUSTED_ORIGINS=deriveTrustedOrigins({webPort, publicOrigin: "127.0.0.1"})`, reusing
   `scripts/setup-prod-origins.ts`'s existing helper (same one `scripts/setup-prod.ts` uses for real
   deploys, #379). Confirmed working. **Uncommitted.**
4. **Onboarding-wizard seed gap** — the freshly-seeded bootstrap-owner had no `"onboarding.state"`
   instance setting, so `shouldShowOnboarding()` (`apps/web/src/onboarding/resume.ts`) defaulted to
   `"pending"` and `app.tsx` rendered `OnboardingWizard` instead of `AppShell`, hiding
   `.jds-usermenu__trigger` from every spec. **First design (raw `migrationDb` insert in
   `admin.ts`) was architecturally wrong** — `app.instance_settings` has FORCE RLS with its INSERT
   policy scoped `TO jarvis_app_runtime` (migration 0059); `jarvis_migration_owner` is not a member
   of that role and is reserved by spec #1025 §4.1 exclusively for the `app.users`/
   `app.auth_accounts` bootstrap. Live run #5 failed loudly with a real RLS violation
   (`42501`) — caught before merge, not silently wrong. **Corrected fix**: new file
   `tests/uat/seed/chunks/onboarding.ts` (`seedOnboardingChunk`), using the established seed-chunk
   convention — `createAppRuntimeRunner()` + `runner.withDataContext({actorUserId}, ...)` + the real
   `SettingsRepository.setOnboardingState(scopedDb, {state:"completed",...})` — mirrors
   `chunks/ai.ts`/`chunks/job-search.ts` exactly. Wired into `tests/uat/seed/levels.ts` as an
   unconditional first step in the admin+data/multi-user branch. **Confirmed working via live run
   #6** — seed succeeds, no RLS error, no onboarding-wizard interception; spec now runs 34.1s
   through login/install/download/restart before hitting bug #5. **Uncommitted.**
5. **NEW, NOT YET FIXED**: after `restartUatStack()` (real `docker compose up -d jarv1s`) +
   `page.reload()`, the Job Search module row still shows "Downloaded — restart to apply" instead
   of "Installed" (`jobSearchRowAfterRestart.getByText("Installed")` times out at spec line 63).
   `error-context.md` confirms the exact stuck state. **Theory (being verified by an Explore agent,
   ID `ad504683bab804a7a`, dispatched just before this doc was written — check its result first)**:
   `docker compose up -d <service>` is a documented no-op when the service's image/env/config is
   unchanged — since a module "Download" only writes into a volume, not a new image, Compose may
   never actually recreate the container, so `scripts/module-reconcile.ts`'s boot-time reconcile
   never reruns. If confirmed, this could be UAT-harness-only (fix `restartUatStack` to use
   `docker compose restart jarv1s` or `up -d --force-recreate`) **or a genuine product bug** — real
   operators following the documented `docker compose pull && docker compose up -d` recipe would
   hit the exact same no-op if they haven't pulled a new image tag. Do not assume harness-only
   without reading the Explore agent's findings.

## Next steps (in order)
1. Read the Explore agent's result (`ad504683bab804a7a`) on module-reconcile's trigger mechanism.
2. Apply whichever fix is correct (harness-only in `tests/uat/provisioner.ts`, or flag as a real
   product bug — if the latter, do NOT silently "fix" it into the test; surface it to Coordinator
   explicitly rather than routing around a real bug with harness changes).
3. Re-run `pnpm test:uat` (7th live run). Expect full green (1 passed, exit 0) or a further
   downstream bug — if so, same discipline (read actual error-context.md/source, never assume).
4. If green: commit in ~5 logical commits (dockerignore fix; provisioner.ts trustedOrigins fix +
   whatever bug-5 fix lands there; `chunks/onboarding.ts` new file + `levels.ts` wiring; spec file)
   with why-comments citing #1026 (dockerignore also #1032). Trailer `Closes #1026` on the last.
5. Pre-push: `pnpm format:check && pnpm lint && pnpm typecheck`, then
   `git fetch origin main && git rebase origin/main`.
6. `pnpm verify:foundation` green, record exit codes.
7. `coordinated-wrap-up` → PR, base `main`, body `Part of #1000` + `Closes #1026` + release-note
   language covering the spec AND all five discovered infra gaps — release-note language, not
   implementation jargon; say plainly these are internal/non-user-visible. If bug #5 turned out to
   be a real product bug (not harness-only), call that out distinctly and loudly in the PR body.
8. Report PR # to Coordinator (`herdr pane send-text`, resolve pane fresh via `herdr pane list`
   first). Flag all five deviations explicitly, especially if #5 is a real product bug. Coordinator
   polls verify-foundation to green then merges manually — never `--auto` (verify:foundation isn't a
   required check on this repo, see memory `auto-merge-skips-nonrequired-checks`). Never
   merge/board/close directly.

## Guardrails (still binding)
No `git add -A`. Don't touch `docs/coordination/`. No repo-wide `pnpm format`. No new migration.
Happy-path only. No `page.goto` beyond initial baseURL load.

Relay again at next 70% context-meter warning or compaction-summary sighting.
