# #1226 Job Search Recovery Relay

## Scope

- Issue: #1226, part of #1193
- Plan: `docs/superpowers/plans/2026-07-20-job-search-recovery-dev-hitl.md`
- Branch: `fix/1226-job-search-recovery`
- Worktree: `~/Jarv1s/.claude/worktrees/job-search-recovery`
- Coordinator label/session: `Coordinator` / `019f7da3-2d14-7ee2-a42d-c0618a7d821e` (pane resolved
  fresh via `herdr pane list` by label+session id — do not bake in a `w1:pXX` number)
- Risk: sensitive; package-hash/distribution contract plus shared-chat dependency require explicit
  PR disclosure
- Collision boundary: outside #1179 batch; protected #1179 API/web PIDs `4078120`/`4009552` on
  ports 3020/5178 must remain untouched

## Current state (this relay)

- Base: `origin/main` at `668f2709`; branch HEAD **`a1caaeb5`**; clean tree at relay.
- **Live hang FIXED and committed** (`a1caaeb5`, `fix(chat): fail fast instead of hanging when
  Enter never lands (#1226)`):
  - Root cause confirmed: `waitForUserAckWithEnterNudge()` in
    `packages/chat/src/live/cli-chat-engine.ts` fell through to a genuinely **unbounded**
    `waitForUserAck` once both Enter nudges were exhausted, even when the composer still held the
    pasted text (Enter not landing ⇒ no ack will ever arrive ⇒ infinite poll).
  - Fix: when the nudge loop exits WITHOUT the composer going empty, throw
    `VerifiedSubmitError("delivery_unknown", true)` immediately instead of waiting further. The
    existing `verifiedSubmit` catch (`entered === true`) already does purge+kill-once and
    re-throws `delivery_unknown` — unchanged. The composer-emptied path (ack genuinely lagging) is
    untouched and still falls through to the longer wait, bounded externally by the RPC's
    verified-submit deadline (`VERIFIED_SUBMIT_DEADLINE_MS = 35_000` in
    `packages/cli-runner/src/engine-host.ts`).
  - New regression test in `tests/unit/cli-chat-engine-verified-submit.test.ts`: composer that
    never empties across all nudges, raced against a short timeout (pre-fix this OOMs/hangs the
    worker — confirmed red before the fix; confirmed green after).
  - Scoped suite green: `pnpm vitest run tests/unit/composer-evidence.test.ts
    tests/unit/cli-chat-engine-verified-submit.test.ts tests/unit/chat-session-manager.test.ts
    tests/unit/chat-session-manager-selfheal.test.ts` → **85 passed**. `pnpm --filter @jarv1s/chat
    typecheck` clean. `eslint`/`prettier` clean on both touched files.
- Prior state carried forward unchanged: code-only dependency from `de501afd` folded into history
  for the module-registry distribution/hash files; trusted deployment at
  `~/Jarv1s/data/modules/job-search` boots worker contract v1; 191 earlier focused unit tests /
  typecheck/external-module / design tokens / direct worker boot all previously green (see branch
  history/plan for detail — do not re-verify unless something looks stale).

## Process state observed at this relay (verify fresh — this is a shared box, PIDs churn)

- API: root `pnpm dev:api` at PID `3398504` still alive; the actual API listener child restarted
  itself under this worktree (tsx watch auto-restart) — was PID `3538043` listening on `:3000`,
  cwd confirmed `.../job-search-recovery/apps/api`. **Re-check the current PID before trusting
  this** — auto-restart may have cycled again.
- Web: PID `3398505` (root) / `3398698` (vite listener on `:5173`) — was alive, unchanged.
- **Worker: DOWN.** Root `pnpm dev:worker` PID `3398506` was alive but no live
  `apps/worker`/`worker/src` child process was found — the worker process itself died and did not
  auto-restart. **Needs a restart before any live smoke test.** Check whether `dev:worker` uses a
  watch wrapper; if not, restart it explicitly (`pnpm --filter <worker-pkg> dev` or whatever the
  worktree's `dev:worker` script resolves to) and confirm it comes back up before smoke-testing.
- **Stale chat pane:** `w1:pZ0`, agent session `843f92ae-d691-42a3-8415-0c45187c8ca6`, cwd
  `/home/ben/.jarvis/chat/00000000-0000-4000-8000-000000000001`, `agent_status: idle`. This is the
  pane with the stuck long multiline composer from the original live blocker. **Manual Enter is
  not accepted** — clean it via the app's own kill/relaunch path (e.g. trigger the
  `purgeThenKillQuietly` / session-manager eviction path that `delivery_unknown` now exercises, or
  the CLI runner's session kill), not by typing into the pane.

## Start here (next agent)

1. Skip install: `node_modules` exists in this worktree.
2. Resume via `coordinated-build`; read the plan
   (`docs/superpowers/plans/2026-07-20-job-search-recovery-dev-hitl.md`) by section only, for
   Task 6 (gates/deploy/stop-for-Ben) — the earlier tasks are done and committed.
3. Re-verify process state fresh (`ps`, `ss -ltnp`) — do not trust the snapshot above without
   confirming; restart `dev:worker` if it's still down.
4. Clean the stale `w1:pZ0` chat pane/session programmatically (no manual Enter), let it relaunch
   fresh, then repeat the real module-onboarding chat smoke (`job-search.onboarding.get-state` →
   `/api/chat/module-onboarding` with a long multiline prompt) with **zero manual keys** — this is
   the live proof the fix actually resolves the original blocker end to end.
5. Finish the fresh Firefox 1280x1800 journey and instrumented Webwright evidence under
   `/tmp/jarvis-1226-webwright/final_runs/run_<id>/` (never `full_page=True`; visually inspect
   critical screenshots). `/tmp/jarvis-1226-webwright/plan.md` has prior exploration context.
6. Rerun scoped browser/unit/type/design checks, then the full sensitive gate
   (`pnpm verify:foundation`) in a freshly recreated isolated `jarvis_1226_gate` DB.
7. Pre-push trio (`pnpm format:check && pnpm lint && pnpm typecheck`), fetch/rebase `origin/main`,
   rerun integrated checks if main moved, rebuild/deploy the exact final artifact, report
   hashes/HEAD/PIDs.
8. Use `coordinated-wrap-up`: push, open the sensitive PR (never merge, never move the board). PR
   must disclose the shared-chat dependency and the package-hash/distribution dependency. Give Ben
   plan section 12's checklist and wait for explicit approve/reject.

## Coordinator-approved files (still the scope boundary)

- `packages/chat/src/live/cli-chat-engine.ts`
- `tests/unit/cli-chat-engine-verified-submit.test.ts`
- Parser files only if new evidence proves parser causal (still no such evidence)

Do not edit the multiplexer adapter without a red test plus fresh coordinator approval.

Preserve invariants (unchanged, now enforced by the fix):

- Empty composer ⇒ never re-press Enter (duplicate risk).
- Any failure after Enter ⇒ `delivery_unknown`, invalidate/purge, never auto-resend.
- All waits bounded — the nudge-exhausted-and-still-full case is now bounded in-process
  (fail-fast) rather than relying solely on the external RPC deadline.
