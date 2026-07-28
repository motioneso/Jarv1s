# Relay 12 — #1264 settings self-operation

Branch/worktree: `1264-settings-self-operation` (this worktree). Coordinator: agent name
`coord-1262` (resolve pane fresh via `herdr pane list` — never trust a cached pane id).
`JARVIS_PGDATABASE=jarvis_build_1264` for all DB work. Integration tests only via
`pnpm exec tsx scripts/test-integration.ts <files>`, never raw vitest on integration files.

## State: Task 13 plan approved, zero code written yet

Coordinator **approved Task 13 (rate limiting) to build**, with 2 binding conditions (verbatim
below). Plan itself is written and current in
`docs/superpowers/plans/2026-07-27-module-self-operation-settings-commands.md` (Task 13 section,
~line 1114+, last fixed by commit `14d0f6c5`). Read that section fresh, not from memory.

**Coordinator's 2 build conditions (do not re-litigate, both are settled):**

1. **Guard bug in the plan as written:** the yolo branch (`gateway.ts` callTool ~line 161) already
   gates on `found.tool.risk !== "read"` before doing anything, so it's safe as-is. The **auto**
   branch (`resolvePolicy(...) === "run"`, ~line 178) is NOT symmetric — its own
   `if (found.tool.risk !== "read")` (line 180) wraps only the notify+audit call, not `runHandler`
   above it (line 179). A limiter check inserted at the top of that branch unguarded would
   rate-limit every read tool in the product (search, `news.previewSource`, etc). **The limiter
   check itself must be gated by `found.tool.risk !== "read"`.** Add a test proving a read tool
   (fixture `example.read` in `tests/integration/fixtures/example-tool-module.ts`) is never
   limited even under heavy repetition.
2. **A tripped limit must never be a silent no-op** — user must be able to tell "throttled" from
   "it worked". Coordinator's stated preference (may be argued against, wasn't): on the **auto**
   branch, degrade to `confirmAndRun` (the existing action_request card path, `gateway.ts` ~line
   457) instead of hard-denying — a loop can't click a button, and it stays in the
   tightening-only direction. On the **yolo** branch, a visible hard denial is fine (user opted
   into unattended ops). **Either way, emit a `recordAudit` row with
   `{ approvalMode: "auto" | "yolo", outcome: "denied", errorClass: "rate_limited" }` at the
   moment the limiter trips** — this is a distinct audit event from whatever confirmAndRun/deny
   produces afterward.

No migration needed: `outcome: "denied"` is already in the DB check constraint (migration `0177`,
applied/frozen, don't touch). `errorClass` is free-form `string | null` on `recordAudit` — no
schema change for `"rate_limited"`.

**Keying/semantics already settled (from earlier coordinator groundwork, also in the plan doc):**
nested `Map<actorUserId, Map<toolName, {count, windowStart}>>` — mirror `undo-stack.ts`'s
`actors: Map<string, Map<string, ChatUndoStack>>` shape, never a concatenated string key. Bound
outer map size with LRU eviction like `undo-stack.ts` does. This is a **runaway-loop guard, not a
security boundary** — in-memory + restart-clearing is accepted ONLY under that framing; state it
plainly in a code comment on the limiter AND in the PR body. Ceiling/window overridable via env var
following the `JARVIS_RL_*` convention (grep existing examples — `packages/chat/src/live-routes.ts`,
`packages/ai/src/routes.ts`) and read via `parsePositiveIntEnv` from `packages/shared/src/env.ts`
(fails closed to the fallback on a bad/typo'd value — reuse it, don't hand-roll parsing). Never a
tool-callable parameter. This task must never justify widening any family's `defaultTier`.

## Grounded insertion points (already read, don't re-read in full — these line numbers are current)

- `packages/ai/src/gateway/gateway.ts`:
  - `callTool` method starts at line 128.
  - Yolo auto-run branch: lines 161-177 (already gated on risk!==read).
  - Auto (`resolvePolicy==="run"`) branch: lines 178-196. Insert the (gated) limiter check here,
    before `runHandler` at line 179.
  - `confirmAndRun` (the degrade target for condition 2's auto-branch path): lines 457-546. Takes
    `(found, input, ctx, notice?)`, returns `Promise<GatewayToolResponse>`. Its own internal audit
    logic (confirmed/denied/timeout/cancelled) is separate from and additional to the rate-limit
    trip's own audit row.
  - `recordAudit` helper: line 675 (wraps `recordAuditRaw` at 628).
- `packages/ai/src/gateway/policy.ts` — `resolvePolicy` (57 lines, read in full already): read
  tools always return `"run"` immediately (line 35) — this is WHY the guard matters, per condition
  1 above.
- Test fixture: `tests/integration/fixtures/example-tool-module.ts` already has `example.autoWrite`
  (risk write, executionPolicy auto, actionFamilyId "dummy") and `example.read` (risk read) — no
  new fixture tool needed.
- Test file: `tests/integration/mcp-gateway-self-operation.test.ts` (287 lines, read in full
  already) — has the exact pattern needed: grant `selfOperationGrant: "granted_at_install"` on
  `example.autoWrite`, mint a token, call `callTool` in a loop, assert on `emitted` records and
  `exampleToolCalls`. Extend this file per the plan's own instruction — do not create a new
  top-level test file.

## Next steps, in order

1. Write the failing test(s) in `mcp-gateway-self-operation.test.ts`: (a) N+1 rapid auto-branch
   calls to `example.autoWrite` under one `(actorUserId, toolName)` → the (N+1)th degrades to an
   action_request card (condition 2) rather than executing directly, and a `denied`/`rate_limited`
   audit fires — audit rows aren't directly asserted in this file today (no repository read helper
   for it here — check `AiRepository`/`repository.ts` for a way to read back audit rows, or assert
   via the emitted notifier records + `exampleToolCalls` count staying frozen until confirm); (b) a
   differing actorUserId or toolName in the same burst is unaffected; (c) `example.read` hammered
   the same N+1 times is never limited (condition 1's regression guard).
2. Implement the limiter class in `gateway.ts` (private, nested map, LRU-bounded, env-overridable
   ceiling/window via `parsePositiveIntEnv`), wire into both branches per conditions 1 and 2.
3. Run tests green. Commit (per task, `git add` only the touched files — never `-A`).
4. Task 11 (wrap-up) — governed by the coordinator's standing 5-condition ruling already relayed in
   prior handoffs (relay-11, still binding): UAT spec with inline `test.fixme` citing reopened
   #1121; mutation-tight backend proof (no confirmation card for a granted-tier tool against the
   real gateway event stream); mutation-tight frontend mocked-e2e proof; cite the already-passing
   undo direct-tests; PR body states plainly the automated exit criterion is unmet for a
   **structural harness reason**, not silently — Ben's manual LAN pass is still required.
5. After Task 11: full `pnpm verify:foundation` green, then `coordinated-wrap-up` (clean tree,
   pre-push trio `format:check && lint && typecheck` + fresh rebase against `origin/main`, push, PR
   citing **#1264 and #1272**). Report PR + evidence to coordinator. Never merge/board/close —
   coordinator's job. **Do not expect to merge tonight even if green — Ben's manual LAN pass gates
   it, per coordinator's explicit reaffirmation.**

## Standing corrections/bans (unchanged, still binding)

- `chat.setResponseStyle` is NOT pre-existing/PR #1268 — it's this branch's own tool
  (`1e7f57ec`). Never describe it as out-of-scope in the PR body, a test comment, or a report.
  `packages/chat/src/manifest.ts` is a third module outside the Phase-0 collision map — say so
  plainly in the PR body.
- Inventory-count rebase vs #1265: **whichever of you lands second rebases** — not settled which
  one that is. Don't encode either assumption.
- Never `git add -A`. Never commit `.claude/context-meter.log`. Never assume a migration number.
  Never edit `packages/settings/src/app-map-tool.ts` (owned by #1265). Read spec/plan by section
  only, never in full.
