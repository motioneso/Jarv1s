# Relay 15 — #1264 settings self-operation

## State: Task 13 DONE, committed, pushed. Task 11 is next.

Commit `bad7fc66` on `1264-settings-self-operation` (pushed to origin):
`feat(ai): add per-actor, per-tool rate limiting to gateway auto-run dispatch`.
All 9 tests in `tests/integration/mcp-gateway-self-operation.test.ts` are green.
Prettier/eslint/tsc all clean on touched files. No debug instrumentation left
(`grep -n DBG` in `gateway.ts` returns nothing).

**Root cause of the 2 hanging tests (do not re-derive — full diagnosis in
agentmemory, `memory_smart_search "rate-limit test hang"`, project `jarv1s`):**
test-order pollution, not a gateway/policy bug. An earlier test in the same file
(`"stored always_confirm override still produces an action card"`) permanently
sets tier `"always_confirm"` for `ids.userA` on the `dummy` family, and
`grantSelfOperationForModule` deliberately never overwrites an existing tier row.
The two rate-limit tests reused `ids.userA`, so their own grant was a silent
no-op and the very first loop call hung in `confirmAndRun`. Fix: both tests now
use `ids.userB` instead. Zero changes to `policy.ts` or `gateway.ts` dispatch
logic — fully compliant with "change the test, never the policy."

Run command (never raw vitest):

```
JARVIS_PGDATABASE=jarvis_build_1264 pnpm exec tsx scripts/test-integration.ts tests/integration/mcp-gateway-self-operation.test.ts
```

## Next: Task 11

Governed by the standing relay-11 5-condition ruling (see agentmemory
`self-operation-user-promotable` and earlier relay docs in this same directory
for full text — do not re-litigate, just execute):

1. UAT spec with inline `test.fixme` citing reopened #1121.
2. Mutation-tight backend proof against the real gateway event stream.
3. Mutation-tight frontend mocked-e2e proof.
4. Cite already-passing undo direct-tests.
5. PR body states plainly the automated exit criterion is unmet for a
   structural harness reason, not silently.

## After Task 11

1. Full `pnpm verify:foundation` green.
2. `coordinated-wrap-up`: clean tree, pre-push trio
   (`format:check && lint && typecheck`), fresh rebase against `origin/main`,
   push, open PR citing **#1264 and #1272**. PR must call out
   `packages/chat/src/manifest.ts` as a third module outside the Phase-0
   collision map, and note `chat.setResponseStyle` (tool `1e7f57ec`) is this
   branch's **own new tool**, not pre-existing on main.
3. Report PR + evidence to coordinator `coord-1262` (resolve its herdr pane
   fresh via `herdr pane list` first — never trust a cached pane id, they
   reflow).
4. **Never merge**, never touch the project board, never close issues — Ben's
   manual LAN pass gates merge regardless of CI green.

## Standing bans (unchanged, still binding)

- Never edit `packages/settings/src/app-map-tool.ts` (owned by #1265).
- Never `git add -A` / `git add .` — this worktree may be shared; stage
  explicit paths only.
- Rate limiter is in-memory/per-process only; frame as a runaway-loop guard,
  never a security boundary or a tier/policy input. Ceiling/window are never
  tool parameters.
- Inventory-assertion rebase falls on whichever lane lands PR second — do not
  assume either way.
