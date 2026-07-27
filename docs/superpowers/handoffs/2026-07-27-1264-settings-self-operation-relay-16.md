# Relay 16 — #1264 settings self-operation

## State: Task 11 code DONE + committed. Gate is red on ONE pre-existing file-size issue. Fix it, then finish wrap-up.

Commits since relay-15 (all pushed? **NO — not yet pushed**, push comes at wrap-up per skill):
- `daa081c9` test(ai): Task 11 mutation-tight proofs + UAT fixme spec (#1264)
- `97822f10` style: prettier fixes on pre-existing formatting drift (#1264)

Task 11 deliverables are done and individually verified green:
- `tests/uat/specs/1264-settings-self-operation.uat.spec.ts` (new) — 1 real test (persona tool
  absent from `/api/ai/assistant-tools`) + 5 `test.fixme(...)` citing reopened #1121. Prettier/
  eslint/tsc clean.
- `tests/e2e/app-shell.spec.ts` — new test `"granted-tier settings tool executes with no
  Approve/Reject card (#1264)"` in the existing "Chat drawer" describe block. Ran solo (1 passed)
  and the whole describe block (3/3 passed, no regressions).
- Cite (don't re-test): backend proof = `tests/integration/mcp-gateway-self-operation.test.ts`
  `"first use after install grant runs without an action card"`; undo = already-green
  `tests/integration/settings-undo-apply-tool.test.ts` (5) + `tests/unit/settings-undo-stack.test.ts` (7).

## Immediate next step: fix the file-size gate, one file

Ran `JARVIS_PGDATABASE=jarvis_build_1264 pnpm verify:foundation` twice (fresh DB each time, per
standing rule). First run failed on `format:check` (3 pre-existing files, unrelated to Task 11:
plan doc, `auto-run-rate-limit.ts` from Task 13, `structured-state.test.ts`) — fixed with a scoped
`prettier --write` on exactly those 3 files, committed as `97822f10`. Second run failed on
`check:file-size`:

```
Files over 1000 lines:
- packages/chat/src/routes.ts: 1025
```

This is pre-existing drift from this branch's own earlier commit `fc2a42b7` (Task 8,
notificationPreference wiring added ~37 lines to `routes.ts`, tipping it over 1000) — not banned
territory (`packages/settings/src/app-map-tool.ts` is the only banned file; `packages/chat/src/routes.ts`
is fair game).

**Already scoped the extraction, not yet executed:** `packages/chat/src/routes.ts` lines 697-919
(`buildChatToolServices`, `buildChatGatewayDependencies`, `resolveYoloMode`, `buildActionPolicy`,
`buildAgencyPrefs` — ~223 lines) form one cohesive "gateway dependency assembly" concern, cleanly
separable, mirroring the existing `registerChatSkillsRoutes` → `./skills/routes.js` extraction
pattern already in this file. Plan:

1. Create `packages/chat/src/gateway-services.ts` containing those 5 functions + whatever imports
   they alone need (check which imports at the top of `routes.ts` are used ONLY by this block vs.
   also by the rest of the file before moving — don't duplicate/leave-orphaned imports).
2. In `routes.ts`: replace the moved code with `import { buildChatToolServices,
   buildChatGatewayDependencies, resolveYoloMode, buildActionPolicy, buildAgencyPrefs } from
   "./gateway-services.js";` — **but also re-export** `buildChatToolServices`,
   `buildChatGatewayDependencies`, `resolveYoloMode` from `routes.ts` (`export { ... } from
   "./gateway-services.js"`), because two test files import them directly from
   `../../packages/chat/src/routes.js`, not the `@jarv1s/chat` barrel:
   - `tests/unit/chat-gateway-dependencies.test.ts` imports `buildChatGatewayDependencies` from
     `routes.js` directly.
   - `tests/integration/chat-mcp-transport.test.ts` imports `resolveYoloMode` from `routes.js`
     directly.
   - Others (`tests/integration/focus-time.test.ts`, `tests/integration/notes-write-tools.test.ts`)
     import from `@jarv1s/chat` (the barrel, `index.ts` does `export * from "./routes.js"` — this
     will keep working automatically once `routes.ts` re-exports them).
   `buildActionPolicy`/`buildAgencyPrefs` are NOT imported anywhere outside `routes.ts` currently
   (confirmed via grep) — fine to leave un-re-exported (module-private to the new file) unless they
   were already exported from `routes.ts` — **check this before moving**, grep
   `export function buildActionPolicy` / `export function buildAgencyPrefs` in current `routes.ts`
   to see if they're already exported (if so, keep re-exporting them too, to avoid an unrelated
   breaking change).
3. Run `pnpm exec prettier --write` + `eslint` + `tsc --noEmit` on both touched files only.
4. Re-run the two test files that changed behavior surface (`tests/unit/chat-gateway-dependencies.test.ts`,
   `tests/integration/chat-mcp-transport.test.ts`, `tests/integration/focus-time.test.ts`,
   `tests/integration/notes-write-tools.test.ts`) to confirm the extraction didn't break anything,
   before trusting the full gate re-run.
5. Commit as its own small commit, explicit files only (`git add packages/chat/src/routes.ts
   packages/chat/src/gateway-services.ts`), message e.g. `refactor(chat): extract gateway
   dependency assembly out of routes.ts to clear the file-size gate`.
6. **Re-run the full gate from scratch** (drop+recreate `jarvis_build_1264` again — a stale gate DB
   causes false failures per the standing "fresh gate DB every run" rule):
   ```
   docker exec jarv1s-postgres psql -U postgres -c "DROP DATABASE IF EXISTS jarvis_build_1264;"
   docker exec jarv1s-postgres psql -U postgres -c "CREATE DATABASE jarvis_build_1264;"
   JARVIS_PGDATABASE=jarvis_build_1264 pnpm verify:foundation
   ```
   Run this as a background task and wait for the real exit code — never pipe through `tail`/`head`.

## After the gate is green

Invoke `coordinated-wrap-up`: clean tree, pre-push trio (`format:check && lint && typecheck`, cheap
— already covered by the full gate, but repo convention runs it again right before push), fresh
`git fetch origin main && git rebase origin/main`, push, open PR citing **#1264 and #1272**.

**The full PR body is already drafted and ready to paste verbatim** — read it from
`/tmp/claude-1000/-home-ben-Jarv1s--claude-worktrees-1264-settings-self-operation/c2284222-2e37-49f6-a400-197e4e3b67eb/scratchpad/pr-body.md`
(if that scratchpad path is gone in your session, the content is reconstructable from this doc's
"PR body must include" list below — but check the scratchpad file first, it's already fully written
and satisfies every constraint).

**PR body must include** (all already satisfied in the drafted body):
- Cites #1262 (part of) and #1272 (related follow-up).
- States plainly `packages/chat/src/manifest.ts` is a third module outside the Phase-0 collision
  map.
- States `chat.setResponseStyle` (commit `1e7f57ec`) is THIS branch's own new tool, never
  pre-existing on main.
- Does NOT assume which lane (this one or #1265) rebases the inventory-assertion count — states
  it's undecided.
- Documents the `grantSelfOperationForModule` non-overwrite platform behavior (safe-direction,
  previously undocumented) found while debugging the Task 13 test hang.
- States plainly the automated UAT exit criterion is unmet for a **structural harness reason**
  (#1121 — no chat-capable provider in the UAT harness), not silently, and that Ben's manual LAN
  pass is still required — this PR must NOT be expected to merge tonight even if CI is green.
- Cites the 3 mutation-tight/undo proofs by exact file+test name (backend, frontend, undo).
- User-facing "What's new" summary paragraph at the top (repo convention — every PR needs one).

## After opening the PR

1. Report the PR URL + verified gate evidence (exit codes, test counts) to coordinator `coord-1262`
   — resolve its herdr pane **fresh** via `herdr pane list` first, never a cached pane id.
2. **STOP.** Never merge, never touch the project board, never close #1264 — Ben's manual LAN pass
   gates merge regardless of CI green. This is the coordinator's job, not yours.

## Standing bans (unchanged, still binding)

- Never edit `packages/settings/src/app-map-tool.ts` (owned by #1265).
- Never `git add -A` / `git add .` — stage explicit paths only.
- Never commit `.claude/context-meter.log` (currently shows modified in `git status` — leave it).
- Any gate run needs a fresh isolated `JARVIS_PGDATABASE` (`jarvis_build_1264`), never the shared
  dev DB, and never piped through `tail`/`head` (masks a failing gate as exit 0).
- Never run a repo-wide `pnpm format` — scope prettier fixes to named files only.
- Rate limiter (Task 13, already done) is in-memory/per-process only; frame as a runaway-loop
  guard, never a security boundary or tier/policy input, in any docs/PR text you touch.
- Inventory-assertion rebase vs #1265 falls on whichever lane lands its PR **second** — not
  settled which; never encode either assumption.
- Read spec/plan sections only, never in full.
