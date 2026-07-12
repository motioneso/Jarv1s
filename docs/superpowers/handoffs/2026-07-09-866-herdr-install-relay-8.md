# #866 herdr-install — relay-8 continuation

Spec: `docs/superpowers/specs/2026-07-08-herdr-install-and-attach-hint.md` (approved)
Plan: `docs/superpowers/plans/2026-07-09-866-herdr-install-and-attach-hint.md` (commit `cc126a3e`,
**coordinator-approved**, 7 TDD tasks) — read it IN FULL before touching anything.
Branch/worktree: `build/866-herdr-install` (this worktree — reuse, do NOT create a new one)
Coordinator label: `Coordinator` (resolve pane fresh via `herdr pane list`; never reuse a `…-N`)

## State: Tasks 1-6 done+committed. Only Task 7 remains.

- Task 1 (live multiplexer status probe) — DONE, commit `3e3e4350`.
- Task 2 (DTO+schema) — DONE, commit `da1e1834`.
- Task 3 (wire probe through composition root) — DONE, commit `5df0d7fd`.
- Task 4 (settings routes consume the live probe) — DONE, commit `f229b85e`. Verified via
  `pnpm exec tsx scripts/test-integration.ts tests/integration/chat-multiplexer-admin.test.ts` (9 passed).
- Task 5 (host-diagnostics-routes rewire to `getChatMultiplexerStatus`) — DONE, commit `d2ed41cf`.
  Verified via `pnpm exec tsx scripts/test-integration.ts tests/integration/host-diagnostics-admin.test.ts`
  (4 passed) + `pnpm --filter @jarv1s/settings typecheck` clean.
- Task 6 (mux-aware `HostPane` UI: attach hint + install guidance) — DONE, commit `bd0b8e3b`.
  Verified via `pnpm vitest run tests/unit/settings-admin-panes.test.tsx` (8 passed, re-confirmed
  fresh just now on the current committed tree — not stale).

## Known deviation from the plan (already handled, no action needed)

Task 6's plan snippet for `attachHintNote()` ordered branches: envOverride → `active==="herdr"` →
`active==="tmux"` → `if (mux.herdrInstalled && !mux.available.herdr)` → fallback. Applied verbatim,
this made the "herdr installed but no root pane" branch **unreachable** in the realistic case
(herdr installed but unusable → tmux picked as active fallback — `active==="tmux"` always matched
first). Fixed by moving the `herdrInstalled && !available.herdr` check to right after the
`active==="herdr"` check, before `active==="tmux"`. All 8 fixture cases in
`tests/unit/settings-admin-panes.test.tsx` pass with this ordering. This is analogous to Task 3's
previously-documented deviation (relay-7) — a real implementation detail the plan's literal snippet
didn't fully account for, not a defect worth escalating, but worth naming at wrap-up QA.

## Next steps in order

1. Read the plan file in full if not already in context, specifically **Task 7** (line ~1082:
   "Pinned, checksum-verified host-level install script").
2. Execute Task 7 via `superpowers:test-driven-development`:
   - Write `tests/unit/install-herdr-script.test.ts` per the plan's exact spec first, confirm it
     fails (script doesn't exist yet → ENOENT or similar).
   - Write `scripts/install-herdr.sh` exactly as specified in the plan: pinned SHA-256 checksums for
     `herdr-linux-x86_64` / `herdr-linux-aarch64`, version `v0.7.3`, idempotent install into
     `${JARVIS_CLI_TOOLS_PREFIX:-/data/cli-tools}/bin/herdr`, Node's `https` module for fetch with
     redirect-following, `set -euo pipefail`, abort on checksum mismatch.
   - `chmod +x scripts/install-herdr.sh`.
   - Confirm the test passes: `pnpm vitest run tests/unit/install-herdr-script.test.ts` (plain
     vitest — this is a unit test, not integration; no isolated-DB runner needed).
   - `git add scripts/install-herdr.sh tests/unit/install-herdr-script.test.ts` (never `-A`), commit
     with message "feat(scripts): add pinned, checksum-verified host-level herdr install script"
     (or the plan's exact message if it specifies one — check the plan text first).
3. Confirm the spec's Exit Criteria are all met (see spec doc) — this closes all 7 tasks.
4. Before push: `pnpm format:check && pnpm lint && pnpm typecheck` then
   `git fetch origin main && git rebase origin/main`.
5. Full local gate before wrap-up: `pnpm verify:foundation` (or record commands+exit codes used if
   CI is unavailable, per CLAUDE.md).
6. Invoke `coordinated-wrap-up` (PR + report only — never merge/board/close). Elevated QA per this
   spec's risk tier: run `/security-review` + `/code-review` before reporting to the coordinator.
   Mention the Task 3 and Task 6 deviations in the PR description/report as implementation notes.
7. Coordinator already approved the plan — no re-approval needed. Coordinator has been pinged three
   times now (Task 3 done, relay-7, this relay-8) — ping again at PR-ready or if blocked.

## Bans still in force

- Worktree/branch only as above; explicit `git add <path>`, never `-A`/`.`.
- Never touch `docs/coordination/`.
- No secrets in any doc/payload/log.
- No web API route may install Herdr — hard non-goal (STOP + escalate if the build ever seems to
  need one).
- Never assume a migration number (not applicable — no migrations touched by this feature).
