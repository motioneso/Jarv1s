# Relay 14 — #1264 settings self-operation

## State: AutoRunRateLimiter implemented and wired; 7/9 gateway tests green, 2 hang at 30s timeout

Implementation from relay-13 is in place and mostly working:
- `packages/ai/src/gateway/auto-run-rate-limit.ts` — `AutoRunRateLimiter` class, exported from
  `packages/ai/src/gateway/index.ts`. Not in question — re-read in full this session, correct.
- `packages/ai/src/gateway/gateway.ts` — yolo branch and auto branch both gate on
  `this.autoRunLimiter.consume(ctx.actorUserId, found.dto.name)` before running; a tripped
  auto-branch call records a `rate_limited` audit row then falls to `confirmAndRun`. Matches
  relay-13's grounded insertion points.
- Currently carries **temporary `console.error("[DBG] ...")` instrumentation at 5 points** —
  must be stripped before commit. Locations: auto branch's trip block (3 lines), the start of
  `resolveActionRequest` (2 lines, ~line 421/426), and the start of `confirmAndRun`'s
  `createPendingAssistantAction` call (2 lines, ~line 501/513). `grep -n DBG gateway.ts` to find all.

Run command (never raw vitest):
```
JARVIS_PGDATABASE=jarvis_build_1264 pnpm exec tsx scripts/test-integration.ts tests/integration/mcp-gateway-self-operation.test.ts
```

## The 2 failing tests and the diagnosis

`auto branch: the (max+1)th unconfirmed call ... (condition 2)` and
`the confirmation path is never rate-limited ...` both hang the full 30000ms vitest timeout —
a generic timeout, no assertion error.

Full diagnosis is saved in agentmemory (`memory_smart_search "rate-limit test hang"` or
`"gateway.ts recordAudit maxConnections"`, project `jarv1s`) — read it before touching code
again, don't re-derive. Summary: console.error evidence proves the 11th (throttled) call in
each test invokes `confirmAndRun` via the **pre-existing bottom-of-method fallback**, not my
new rate-limit trip block (the trip block's own logs never fire). That means
`resolvePolicy(...)` is returning something other than `"run"` for that specific call, even
though it returned `"run"` for calls 1-10. Leading hypothesis: the test DB pool has
`maxConnections: 1`; every successful call also fires `void this.recordAudit(...)`
(fire-and-forget, unawaited); `dbBackedActionPolicy` does a real DB round-trip on every
`resolvePolicy` call; by call 11 a still-draining fire-and-forget audit transaction from an
earlier call starves the connection pool for the policy lookup, which falls back to a safe
"confirm" (path/location of that fallback not yet pinpointed). The failing tests then
`vi.waitFor` on a `rate_limited` audit row that never gets written (because the trip block
was never entered), spinning until the outer 30s test timeout kills it.

**Not yet confirmed.** Next step: add temporary logging of `resolvePolicy`'s actual return
value (and/or `dbBackedActionPolicy`'s tier lookup result/errors) per call in the full-file
run, to nail down exactly where the fallback-to-"confirm" happens. Do NOT widen `defaultTier`
or loosen policy semantics as a workaround — the rate limiter must stay a runaway-loop guard
only, never a tier/policy input (see the doc comment atop `auto-run-rate-limit.ts`).

## Remaining steps, in order

1. Confirm the root cause above with targeted instrumentation.
2. Fix it — likely means not treating `recordAudit` as fire-and-forget in these paths (await
   it), or otherwise removing the connection contention under `maxConnections: 1`.
3. Strip all `[DBG]` console.error instrumentation from `gateway.ts` (grep first, verify zero
   left).
4. Get all 9 tests green via the run command above.
5. Commit ONLY these 4 files, explicit paths (never `git add -A`):
   `packages/ai/src/gateway/gateway.ts`, `packages/ai/src/gateway/index.ts`,
   `packages/ai/src/gateway/auto-run-rate-limit.ts`,
   `tests/integration/mcp-gateway-self-operation.test.ts`.
   Message: `feat(ai): add per-actor, per-tool rate limiting to gateway auto-run dispatch`.
6. Proceed to Task 11 (wrap-up task) — governed by relay-11's standing 5-condition ruling:
   UAT spec with inline `test.fixme` citing reopened #1121; mutation-tight backend proof
   against the real gateway event stream; mutation-tight frontend mocked-e2e proof; cite
   already-passing undo direct-tests; PR body states plainly the automated exit criterion is
   unmet for a structural harness reason, not silently. PR must also cite #1272, call out
   `packages/chat/src/manifest.ts` as a third module outside the collision map, and state the
   in-memory/restart-clearing limitation under the runaway-loop-guard framing.
7. After Task 11: full `pnpm verify:foundation` green, then `coordinated-wrap-up` (clean tree,
   pre-push trio `format:check && lint && typecheck`, fresh rebase against `origin/main`, push,
   open PR citing #1264 and #1272). Report PR + evidence to coordinator `coord-1262` (resolve
   its herdr pane fresh via `herdr pane list` first — never trust a cached pane id). Never
   merge, never touch the project board, never close issues — Ben's manual LAN pass gates
   merge.

## Standing corrections/bans (unchanged, still binding — full text in relay-12/relay-13)

- Rate limiter is in-memory/per-process only; frame as runaway-loop guard, never security
  boundary, never a tier/policy input.
- Never edit `packages/settings/src/app-map-tool.ts` (owned by #1265).
- Never `git add -A`/`git add .` — this worktree may be shared; stage explicit paths only.
- Only relay/hand off after real progress, not just reading — this relay follows a confirmed
  diagnosis, not a restart from scratch.
