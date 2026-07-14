# Relay — #1026 UAT harness Phase 3 (Playwright), pass 2

Predecessor relayed at 70% context checkpoint (pure research, zero code written, zero commits).
Worktree/branch unchanged: `.claude/worktrees/uat-play-1026`, branch `uat-play-1026`, off
`origin/main`. `node_modules` already installed — skip `pnpm install`.

## What's done
- Read handoff `docs/superpowers/handoffs/2026-07-13-uat-1026-playwright.md` in full.
- Read spec `docs/superpowers/specs/2026-07-12-dev-uat-harness.md` §Status, §0-6, §8 (through
  item 3). Have NOT read §7 (out of scope) or §9 (open questions) — check §9 quickly, it may
  answer one of the open items below.
- Read `tests/uat/provisioner.ts`, `tests/uat/seed/{levels,types,admin,connections,cli}.ts`,
  `tests/uat/seed/chunks/job-search.ts` in full.
- Read `tests/e2e/settings-modules.spec.ts` (real-nav locator pattern to mirror),
  `apps/web/src/settings/settings-module-registry-section.tsx` (component under test — exact
  state labels, confirm-dialog copy, aria-labels), `apps/web/src/auth/auth-screen.tsx` (real
  login form), `apps/web/src/app.tsx` lines ~120-220 (no dedicated `/login` route — AuthScreen
  gates the whole app on 401, not a URL path), `playwright.config.ts` (existing mocked-REST
  config, don't reuse its webServer), `package.json` (no `test:uat` script yet),
  `.github/workflows/ci.yml:54` (existing `playwright install --with-deps chromium` step to
  reuse), `scripts/module-reconcile.ts` header (restart re-runs migrate→reconcile — the #999
  bug path).
- **Sent escalation to Coordinator (label `Coordinator`, session
  `58a78927-385c-4b1d-8fa0-94db20255d6f`) flagging 3 open items** (below) and said I'm relaying.
  Coordinator was mid-task (drafting/dashboard) when message landed — verified queued/delivered,
  did NOT yet see an explicit reply. **Successor: check for a reply first** (`herdr pane read` the
  Coordinator pane, bounded `--source recent --lines 30`) before proceeding — it may already
  contain the nod on all 3, or a correction.

## Open items needing Coordinator confirmation (escalated, reply not yet seen)
1. **`provisioner.ts` has no exported provision-and-hold function.** Only a non-exported `main()`
   that provisions, waits for health, then `finally`-teardowns immediately. The Playwright harness
   needs `provision(level) → baseURL → run specs → teardown` — i.e. hold the instance open across
   the whole spec run, not teardown on return. Proposed: add a new exported function, e.g.
   `provisionForUat(level: UatSeedLevel, opts?: {excludeChunks?}): Promise<{baseURL: string,
   teardown: () => Promise<void>}>` that reuses `createUatProvisionPlan` but returns before the
   `down -v` step, plus a separate teardown closure. Keep `main()`'s existing behavior intact
   (it's presumably still used elsewhere / as a manual smoke entrypoint) — additive only, not a
   rewrite. This is a touch to P1's file — flagged per handoff guardrail, do not do it silently.
2. **`tests/uat/seed/admin.ts`'s `UAT_ADMIN_EMAIL`/`UAT_ADMIN_PASSWORD` are module-private.** Only
   `seedSoloAdmin()` is exported (returns them but only inside the seed CLI's own process). The
   Playwright spec needs these two string constants to fill the real `/login`-gated form. Proposed
   fix: just add `export` to both `const` declarations in `admin.ts` — no logic change. Minimal,
   legitimate-need touch to P2's file — flagged per handoff guardrail.
3. **Handoff's #868 citation is factually wrong.** Handoff text: "assert it fails closed... per
   the #868 capture-fail ruling ('868 hard fail...')." Verified via `gh issue view 868 --json
   number,title,body,state,labels`: #868 is entirely about
   `packages/chat/src/live/private-transcript-cleanup.ts` / Gemini transcript-purge coverage —
   unrelated to job-search module install. Spec §6 (the actual 10-step blueprint, §8 item 3 points
   here) is a **happy-path install-succeeds proof**, not a failure-injection/fail-closed test —
   its acceptance criterion (step 9) is "job-search row = Installed, Switch checked, no error
   text." Recommendation: build §6 exactly as written; for the "why" comments about fail-closed
   *philosophy* (if any belong at all, since §6 is happy-path not failure-injection), cite the
   codebase's own grounded pattern instead of #868 — `apps/web/src/app.tsx`'s `myModulesEnabled()`:
   `if (myModulesQuery.isError) return "denied"; // fail closed: cannot prove enabled`. Do NOT
   write a fail-closed/failure-injection test that isn't in the spec's §6 blueprint unless the
   Coordinator explicitly asks for one in addition.

## Spec §6 blueprint (the actual 10-step spec to implement — already extracted, don't re-read
full spec, just this + provisioner.ts + the component file above)
1. Provision `uatLevel = { level: "admin+data", without: ["job-search"] }` (i.e.
   `excludeChunks: ["job-search"]` per `SeedOptions`/`seedLevel` in `tests/uat/seed/*`).
2. Real login: navigate to the app root (no `/login` route exists — `AuthScreen` gates on 401,
   see `apps/web/src/app.tsx`), fill email (`UAT_ADMIN_EMAIL` from item 2 above) + password
   (`JARVIS_UAT_ADMIN_PASSWORD` env var per handoff — confirm this matches
   `UAT_ADMIN_PASSWORD`'s actual value or whether it's a separate env override; check
   `seed/admin.ts`), submit, assert landed on authenticated shell.
3. Navigate to `/settings` (use `webRoutePath("settings")` convention if reachable, else real nav
   click — check how `tests/e2e/settings-modules.spec.ts` does its `page.goto("/settings")`, that
   precedent already exists in the mocked e2e suite so a literal settings URL is apparently
   allowed as the *entry* point; only in-app *subsequent* navigation must be by role/label click
   per the HARD RULE). Click `getByRole("button", {name: "Admin / Setup"})` →
   `getByRole("button", {name: "Instance modules"})`, assert heading "Instance modules" visible.
4. Assert `aria-label="Module registry"` section lists job-search row state "Not installed" +
   "Install" button — real registry fetch to
   `https://github.com/motioneso/jarv1s/releases/download/modules/index.json` (NODE_ENV=production
   forbids mocking — this is the whole point per spec, real egress).
5. Click "Install" → assert confirm dialog title `"Install Job Search?"` (module name confirmed
   from `external-modules/job-search/jarvis.module.json`: `"name": "Job Search"`) → click
   "Download".
6. Assert state transitions off "Not installed" to pending-restart; pending-restart `<Note>` text
   visible; NO "install-failed" state; no `lastInstallError` text rendered.
7. Real activation: `docker compose -p uat-<runId> -f infra/docker-compose.prod.yml restart
   jarv1s` (re-runs migrate→reconcile — the exact #999 bug path per
   `scripts/module-reconcile.ts`), wait `/health/ready` again.
8. Re-authenticate if needed (verify empirically — may or may not be required after restart) then
   re-navigate to Settings → Instance modules.
9. Assert acceptance: job-search row = "Installed" (installed-enabled state), Switch
   `ariaLabel="Enable Job Search"` checked/checkable, no error text — this is the #999 acceptance
   proof.
10. Teardown: `down -v` regardless of pass/fail (try/finally).

## Next concrete steps
1. Check for Coordinator's reply on the 3 open items (bounded pane read).
2. If approved (or no objection + reasonable to proceed — use judgement, these are minimal
   additive touches, not architecture changes): implement items 1 and 2 above in `provisioner.ts`
   / `admin.ts` first (small, testable in isolation).
3. Write the plan via `superpowers:writing-plans` → `docs/superpowers/plans/2026-07-13-uat-1026-playwright.md`
   covering: `tests/uat/playwright.uat.config.ts` (testDir `./tests/uat/specs`, no `webServer`,
   `baseURL` resolved at runtime), `provisioner.ts` additive export, `admin.ts` export, `tests/uat/run-uat.ts`
   wrapper (provision → set baseURL env/config → spawn playwright → teardown in finally),
   `tests/uat/specs/job-search-install.uat.spec.ts` (§6 above), `package.json`'s
   `"test:uat": "tsx tests/uat/run-uat.ts"` script addition.
4. Message Coordinator: "plan ready: <path>. Approve, or flag a fork." STOP, wait for approval
   before writing code (coordinated-build gate).
5. Build via `superpowers:test-driven-development`, one task per commit, explicit `git add`
   paths only (shared tree — never `-A`).
6. Pre-push: `pnpm format:check && pnpm lint && pnpm typecheck` + `git fetch origin main && git
   rebase origin/main`.
7. `pnpm verify:foundation` green, record exit codes → `coordinated-wrap-up` → PR (`Part of
   #1000` + `Closes #1026`, base `main`, "What's new: Internal — adds the Playwright UAT spec
   that drives the real UI to prove job-search install completes end-to-end.") → report PR # to
   Coordinator. Never merge/board/close.
8. Relay again at next 70% context-meter warning.

## Guardrails (from handoff, still binding)
No `git add -A`. Don't touch `docs/coordination/`. Don't run repo-wide `pnpm format`. No new
migration. Don't touch `provisioner.ts`/`seed/*` beyond the two flagged additive exports without
Coordinator sign-off (see items 1-2 above — already flagged, not yet confirmed).
