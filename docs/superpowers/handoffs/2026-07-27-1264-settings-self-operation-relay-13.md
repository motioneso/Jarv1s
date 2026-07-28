# Relay 13 — #1264 settings self-operation

Branch/worktree: `1264-settings-self-operation` (this worktree). Coordinator: agent name
`coord-1262` (resolve pane fresh via `herdr pane list` — never trust a cached pane id).
`JARVIS_PGDATABASE=jarvis_build_1264` for all DB work. Integration tests only via
`pnpm exec tsx scripts/test-integration.ts <files>`, never raw vitest.

## State: Task 13 has 4 tests written, RED. Implementation not started.

`c2fc68dc` (committed) has the original 3 tests. **On top of that, uncommitted in the working
tree right now**, is a 4th test the coordinator required mid-build (see "Coordinator corrections"
below) — your first action should be to `git add`+commit it (it's already written and confirmed
RED for the expected reason), not to write it yourself. All 4 new tests fail with the same
expected error: `TypeError: Cannot destructure/read property 'maxCalls' of
'GATEWAY_AUTO_RUN_RATE_LIMIT_DEFAULTS' as it is undefined` — the export doesn't exist yet. All 5
pre-existing tests in the file still pass (9 total, 4 failed/5 passed). Verified this session. Run:
```
JARVIS_PGDATABASE=jarvis_build_1264 pnpm exec tsx scripts/test-integration.ts tests/integration/mcp-gateway-self-operation.test.ts
```

## Coordinator corrections (arrived mid-build this session, both binding, both already applied to the test file)

1. **`confirmAndRun` is NOT a limiter insertion point — scope correction to relay-12.** The
   limiter goes ONLY on the yolo branch (~161) and the auto/`resolvePolicy==="run"` branch (~178).
   Do not add any limiter check inside `confirmAndRun` (457-546). Reasoning: a human clicking
   confirm is itself what breaks a runaway loop — limiting there would throttle the *user*, not
   the loop, and would turn condition 2's degrade-to-card behavior into a dead end (card shown,
   user clicks confirm, nothing happens — the exact silent-comply failure condition 2 exists to
   prevent, reintroduced one step later).
2. **4th test added, already in the working tree**: `"the confirmation path is never
   rate-limited, because condition 2's degrade target must remain reachable"` (inserted right
   after the first "auto branch...degrades to a confirmation card" test). It trips the
   `example.autoWrite` bucket for `ids.userA` past the ceiling (drives `maxCalls` successes, then
   3 more calls that all degrade to cards), asserts none of the throttled calls executed, then
   calls `gateway.resolveActionRequest(ids.userA, <id>, "confirmed")` on one of the pending cards
   and asserts (via `vi.waitFor`) `exampleToolCalls` grows by exactly 1 — proving the confirm path
   itself is never consulted against the rate limit no matter how tripped the bucket is. Cleans up
   remaining pending cards with `"cancelled"` before awaiting the outstanding `pending` promises.

## Coordinator's 2 build conditions (settled, do not re-litigate — full text also in relay-12)

1. **Guard bug:** yolo branch (`gateway.ts` callTool ~161) already gates `risk!=="read"`, fine
   as-is. Auto branch (`resolvePolicy(...)==="run"`, ~178) is NOT symmetric — its own
   `if (found.tool.risk!=="read")` (line 180) wraps only notify+audit, not `runHandler` (179).
   **The new limiter check inserted in the auto branch needs its OWN explicit
   `found.tool.risk!=="read"` guard**, else every read tool gets throttled (root cause:
   `policy.ts` line 35 returns `"run"` immediately for read tools).
2. **Never a silent no-op.** Auto branch: on trip, degrade to `confirmAndRun(found, input, ctx,
   notice)` (existing card path, ~line 457) instead of hard-denying — "a loop can't click a
   button." Yolo branch: on trip, hard-deny is fine (`{ok:false, denied:true, reason}`, same shape
   `confirmAndRun` denials use). **Either way**, call `recordAudit(access, found, {approvalMode:
   "auto"|"yolo", outcome:"denied", errorClass:"rate_limited", chatSessionId: ctx.chatSessionId})`
   at the moment the limiter trips — distinct from whatever audit `confirmAndRun`/deny produces
   after.

No migration needed (`outcome:"denied"` already in CHECK constraint, migration 0177, frozen;
`errorClass` is free-form `string|null`).

## Keying/framing (settled)

Nested `Map<actorUserId, Map<toolName, {count, windowStart}>>` — mirror
`packages/settings/src/undo-stack.ts`'s `actors`/`lru` LRU pattern exactly (touch = delete+set for
move-to-end, evict oldest while `lru.size > cap`). Runaway-loop guard, NOT a security boundary —
in-memory + restart-clearing is accepted only under that framing; **say so in a code comment on
the limiter class AND in the eventual PR body**. Ceiling/window overridable via env vars following
`JARVIS_RL_*` (see `packages/chat/src/live-routes.ts`, `packages/ai/src/routes.ts` for the
pattern), parsed via `parsePositiveIntEnv` from `packages/shared/src/env.ts` (fails closed to
fallback). Never a tool-callable parameter. Never justifies widening any family's `defaultTier`.

**Decided but not yet written into code:** `maxCalls` default 10, `windowMs` default 10_000 (10s),
outer-map LRU actor bound ~2000. These must be the exported `GATEWAY_AUTO_RUN_RATE_LIMIT_DEFAULTS`
constant's values (the test file imports and uses this constant directly — do not hardcode
different numbers in the test file or they'll fight each other).

## Grounded insertion points (line numbers confirmed current as of this session)

- `packages/ai/src/gateway/gateway.ts` (782 lines):
  - `callTool` starts line 128.
  - Yolo branch: `if (found.tool.risk !== "read" && (await this.deps.yoloMode?.(ctx)) === true) {`
    at line 161, `runHandler` call at line 162. Insert limiter check right after the `if` line,
    before line 162's `runHandler` call. On trip: build+return `{ok:false, denied:true, reason:
    "rate_limited"}` (or similar — match existing denial shape in this branch) + fire
    `recordAudit` with `approvalMode:"yolo"`. Do NOT call `runHandler`.
  - Auto branch: `if ((await resolvePolicy(...)) === "run") {` at line 178, `runHandler` call at
    line 179, existing `if (found.tool.risk !== "read")` guard at line 180 (wraps only
    notify+audit, unchanged). Insert limiter check right after line 178's `if`, gated by **its own
    `found.tool.risk !== "read"`** check, before line 179's `runHandler`. On trip: call
    `recordAudit` with `approvalMode:"auto"`, then `return this.confirmAndRun(found, input, ctx,
    "<rate-limit notice string>")` instead of falling through to `runHandler`.
  - `confirmAndRun(found, input, ctx, notice?)`: lines 457-546. `notice` (optional string) is
    prepended to the card summary via `[notice, this.summaryFor(...)].filter(Boolean).join(" ")`.
    **Do NOT add a limiter check inside this method** — see "Coordinator corrections" above.
  - `recordAudit`: line 675 (wraps `recordAuditRaw` at 628). Signature:
    `recordAudit(access, found, {approvalMode, outcome, errorClass?, chatSessionId?})`.
  - Constructor at line 121 (`constructor(private readonly deps: ...) {}`) — add a private field
    e.g. `private readonly autoRunLimiter = new AutoRunRateLimiter();` (no new DI dependency
    needed; plan says a private field is sufficient unless reuse elsewhere is discovered).
- `packages/ai/src/gateway/index.ts` (44 lines) — barrel file. Add
  `export { GATEWAY_AUTO_RUN_RATE_LIMIT_DEFAULTS } from "./gateway.js";` (or similar, matching
  existing export style in this file) once the constant exists in `gateway.ts`. `packages/ai/src/
  index.ts` already re-exports `./gateway/index.js` wholesale — no further edit needed there.
- `packages/settings/src/undo-stack.ts` (114 lines) — the exact LRU pattern to replicate
  (`actors`/`lru` maps, `touch`/`evictLeastRecentlyUsed`). Read this file directly, don't
  reconstruct from memory — copy the eviction-loop shape faithfully.
- `packages/shared/src/env.ts` — `parsePositiveIntEnv(raw, fallback)`, reuse directly.

## Remaining steps, in order

1. In `gateway.ts`: add `AutoRunRateLimiter` class (nested-map + LRU per undo-stack.ts shape),
   `GATEWAY_AUTO_RUN_RATE_LIMIT_DEFAULTS` exported const (`{maxCalls:10, windowMs:10_000}` unless
   env overrides via `JARVIS_RL_GATEWAY_AUTO_RUN_MAX`/`JARVIS_RL_GATEWAY_AUTO_RUN_WINDOW_MS`), and
   an actor-LRU-bound constant (`JARVIS_RL_GATEWAY_AUTO_RUN_MAX_ACTORS`, default ~2000). Wire into
   both branches per the two conditions above. Add a code comment stating the runaway-loop-only
   framing (not a security boundary).
2. Re-export the constant from `packages/ai/src/gateway/index.ts`.
3. Run tests green:
   `JARVIS_PGDATABASE=jarvis_build_1264 pnpm exec tsx scripts/test-integration.ts tests/integration/mcp-gateway-self-operation.test.ts`
   — expect 8/8 passing (5 pre-existing + 3 new).
4. Commit only `packages/ai/src/gateway/gateway.ts`, `packages/ai/src/gateway/index.ts`,
   `tests/integration/mcp-gateway-self-operation.test.ts` (never `-A`). Message:
   `feat(ai): add per-actor, per-tool rate limiting to gateway auto-run dispatch`.
5. **Task 11** (wrap-up) — governed by relay-11's standing 5-condition ruling (not re-read this
   session, re-ground before starting): UAT spec with inline `test.fixme` citing reopened #1121;
   mutation-tight backend proof (no confirmation card for a granted-tier tool against the real
   gateway event stream); mutation-tight frontend mocked-e2e proof; cite already-passing undo
   direct-tests; PR body states plainly the automated exit criterion is unmet for a **structural
   harness reason**, not silently — Ben's manual LAN pass is still required.
6. After Task 11: full `pnpm verify:foundation` green, then `coordinated-wrap-up` (clean tree,
   pre-push trio `format:check && lint && typecheck` + fresh rebase against `origin/main`, push,
   PR citing **#1264 and #1272**). Report PR + evidence to coordinator. Never merge/board/close.
   **Do not expect to merge tonight even if green — Ben's manual LAN pass gates it.**

## Standing corrections/bans (unchanged, still binding)

- `chat.setResponseStyle` is NOT pre-existing — this branch's own tool (`1e7f57ec`). Never call it
  out-of-scope. `packages/chat/src/manifest.ts` is a third module outside the Phase-0 collision
  map — say so plainly in the PR body.
- Inventory-count rebase vs #1265: whichever lands second rebases — not settled which. Don't
  assume.
- Never `git add -A`. Never commit `.claude/context-meter.log`. Never assume a migration number.
  Never edit `packages/settings/src/app-map-tool.ts` (owned by #1265). Read spec/plan by section
  only, never in full.
