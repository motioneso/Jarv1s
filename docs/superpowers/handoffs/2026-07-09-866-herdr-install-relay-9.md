# #866 herdr-install — relay-9 continuation

Spec: `docs/superpowers/specs/2026-07-08-herdr-install-and-attach-hint.md` (approved)
Plan: `docs/superpowers/plans/2026-07-09-866-herdr-install-and-attach-hint.md` (7 TDD tasks, all done)
Branch/worktree: `build/866-herdr-install` (this worktree — reuse, do NOT create a new one)
Coordinator label: `Coordinator` (resolve pane fresh via `herdr pane list`; never reuse a `…-N`)

## State: All 7 tasks done+committed (HEAD `9e19a7fd`). Elevated QA in progress — 2 real bugs found, NOT yet fixed.

- Task 7 (install-herdr.sh) done: commits `a37e137d` (script+test), `9e19a7fd` (prettier drift
  cleanup, unrelated pre-existing files). Both verified independently (checksums matched live
  GitHub release artifacts; end-to-end fresh-install + idempotent-rerun smoke tested).
- `pnpm verify:foundation` ran clean through unit (300 files/2097 passed) and was finishing
  integration tests in background (PID `2633013`, log
  `/tmp/claude-1000/-home-ben-Jarv1s--claude-worktrees-866-herdr-install/2a5d81bf-8e42-4bda-863a-901ea81004c5/scratchpad/verify-foundation.log`)
  when this relay fired — **check that log for the final result first**, don't re-run blind.
- `/security-review` already ran clean: **zero HIGH/MEDIUM findings.**
- `/code-review` (high effort, 8 finder angles) already ran and returned. Two real,
  independently-cross-verified bugs — I confirmed both by reading the actual current code myself
  (not just trusting the finders):

### Bug 1 — `apps/web/src/settings/settings-admin-panes.tsx` `attachHintNote()` (~line 713-769)

Found independently by 3 finders (line-by-line, simplification, altitude). Two sub-issues:
- Line 744 (`mux.herdrInstalled && !mux.available.herdr`) is checked BEFORE line 753
  (`mux.active === "tmux"`). When tmux is actually active/working AND herdr is separately
  installed-but-broken (no root pane), the UI shows ONLY the herdr nag and hides the tmux attach
  command the operator actually needs. This ordering is intentional per relay-8's documented
  deviation (moving herdr-check before tmux-check to make it reachable at all) — but it
  overcorrected: it should show BOTH, not hide tmux.
- The final fallback (line 762-768) is byte-identical JSX to the `active === "tmux"` branch
  (line 753-761), but fires whenever `active === null` too (nothing usable) — telling the operator
  to run `tmux attach` commands that will fail instead of saying nothing is usable.

**Recommended fix:** stop treating "herdr installed but broken" as mutually exclusive with the
active-mux branches. Compute the primary note from `mux.active` (herdr / tmux / null-with-distinct-
"nothing usable" copy, NOT the tmux copy), then independently append the herdr-broken hint
whenever `mux.herdrInstalled && !mux.available.herdr && mux.active !== "herdr"`. Existing test
`tests/unit/settings-admin-panes.test.tsx:135-149` ("shows installed-but-not-usable guidance...")
only asserts `JARVIS_HERDR_ROOT_PANE` is present — it does NOT assert tmux text is absent — so a
"show both" fix still passes it unchanged. Add two new fixture cases: (a) `active:"tmux"` +
herdr-installed-but-broken → assert BOTH tmux attach text AND `JARVIS_HERDR_ROOT_PANE` present;
(b) `active:null`, `herdrInstalled:false` → assert neither tmux nor herdr attach commands shown,
distinct "not usable" copy shown instead.

### Bug 2 — `packages/module-registry/src/chat-multiplexer.ts` `makeChatMultiplexerStatusProbe` (line 101-121)

Found independently by 2 finders (removed-behavior, cross-file tracer). Confirmed by direct read:
line 108 calls `decideMultiplexer(...)` with NO try/catch. `decideMultiplexer` throws a plain
`Error` on an invalid `JARVIS_MULTIPLEXER` value. The sibling function in the SAME file,
`resolveChatEngineFactory` (line 394-434), wraps the equivalent `resolveMultiplexer` call in
try/catch specifically for this ("Only thrown for an invalid JARVIS_MULTIPLEXER value — a deploy
config error" — degrades to `unavailableEngineFactory`, never crashes). The new probe doesn't
re-establish that guard. Confirmed unhandled at the call sites: `packages/settings/src/routes.ts`
GET/PUT `/api/admin/chat-multiplexer` (~line 630, 662) and
`packages/settings/src/host-diagnostics-routes.ts` (~line 78) all only wrap this in a generic
`try { ... } catch (error) { return handleRouteError(error, reply); }` — so a typo'd
`JARVIS_MULTIPLEXER` 500s the exact admin page meant to help diagnose it.

**Recommended fix:** wrap the `decideMultiplexer(...)` call at chat-multiplexer.ts:108 in
try/catch mirroring `resolveChatEngineFactory`'s pattern — on catch, degrade to
`active: null, activeSource: null` (do not rethrow). Add a case to
`tests/unit/chat-multiplexer-status.test.ts` asserting the probe function RESOLVES (not rejects)
with `active: null` for an invalid `JARVIS_MULTIPLEXER` value (there's already a test there for
`envOverride` being null in this case, per finder B — extend it or add a sibling case for
`active`). Optionally add a route-level case in
`tests/integration/chat-multiplexer-admin.test.ts` hitting GET with an invalid override, asserting
200 not 500.

### Lower-severity findings — note in PR, do not block on fixing

Multiple finders (D/E/F/G) independently flagged: `LiveChatMultiplexerStatus` type shape declared
3x (chat-multiplexer.ts, platform-api.ts, routes.ts inline); the same default-status fallback
object literal copy-pasted 3x across routes.ts (x2) and host-diagnostics-routes.ts; `readEnvOverride`
duplicates `decideMultiplexer`'s own env-parsing logic; `createBinaryProbe(env)` constructed 3x per
request in `makeChatMultiplexerStatusProbe` instead of once/shared (F also flagged
`host-diagnostics-routes.ts` awaiting `pgBossOk` then `getChatMultiplexerStatus` sequentially
instead of `Promise.all`). These are real but not correctness bugs — mention as a follow-up note
in the PR description (or file a small follow-up issue) rather than expanding this PR's scope.

Finder H (CLAUDE.md conventions): clean, no violations found.

## Next steps in order

1. Check the verify:foundation log above for final pass/fail; re-run only if it didn't finish
   clean or the log is gone (background process may have exited already).
2. Fix Bug 1 via TDD in `settings-admin-panes.tsx` + `tests/unit/settings-admin-panes.test.tsx`,
   commit.
3. Fix Bug 2 via TDD in `chat-multiplexer.ts` + `tests/unit/chat-multiplexer-status.test.ts`
   (+ optionally the integration test), commit.
4. Pre-push trio: `pnpm format:check && pnpm lint && pnpm typecheck`, then
   `git fetch origin main && git rebase origin/main` (rebase again — main may have moved).
5. Full gate: `pnpm verify:foundation` (background + Monitor if it risks a >~5min timeout again).
6. Confirm spec Exit Criteria all met, then `coordinated-wrap-up`: open PR mentioning (a) Task 3 +
   Task 6 implementation deviations (see relay-8 handoff), (b) these 2 code-review bugs found+fixed,
   (c) security-review clean result, (d) the noted-but-not-fixed DRY/efficiency follow-ups.
7. Report PR + evidence to coordinator (label `Coordinator`, fresh `herdr pane list`). Never
   merge/board/close — that's the coordinator's.

## Bans still in force

- Worktree/branch only as above; explicit `git add <path>`, never `-A`/`.`.
- Never touch `docs/coordination/`.
- No secrets in any doc/payload/log.
- No web API route may install Herdr — hard non-goal.
- Never assume a migration number (not applicable — no migrations touched).
