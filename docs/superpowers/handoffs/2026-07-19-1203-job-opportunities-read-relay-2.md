# Relay 2 — #1203 Job Search opportunities read (context checkpoint, mid Task 2)

**Read first, in full (both short):**
1. `docs/superpowers/handoffs/2026-07-19-1203-job-opportunities-read.md` (original build handoff)
2. `docs/superpowers/handoffs/2026-07-19-1203-job-opportunities-read-relay.md` (relay 1 — root cause + enforcement-site investigation)

**Issue:** GitHub #1203. **Branch:** `fix/1203-job-opportunities-read` off `origin/main`. **Worktree/tab:** same, `w1:t33`. **Coordinator label:** `Coordinator` (pane confirmed unique via `herdr pane list` at relay-1 time: `w1:pXS`, `agent_session.value: 019f7cd5-b4d7-7f71-9958-7aace3d9ead7` — re-resolve fresh, don't reuse this pane id).

## Status: Coordinator APPROVED the plan. Now executing TDD Task 2 of 5. Do NOT re-ask for approval.

Coordinator's exact approval message (verbatim, so you don't second-guess it):
> "PLAN APPROVED. Proceed exactly as proposed: red real-RPC risk:read empty-KV regression first;
> extract pure buildFeedIndex; keep rebuildFeed persistence unchanged for its three write-risk
> callers; update only the stale read-path unit expectation; prove opportunities.list stays
> risk:read and shared host policy untouched; full gate/rebase/wrap-up. No scope expansion."

**Plan doc (already committed... check — see below):** `docs/superpowers/plans/2026-07-19-1203-job-opportunities-read.md` — 5 tasks, read it in full before continuing, it's the authoritative task list.

## What's done (uncommitted — see git status below)

- **Task 1 (RED, verified failing correctly):** added test `"read-risk actor with no stored feed: list succeeds, no KV row is created (#1203)"` to `tests/integration/external-module-job-search-kv-isolation.test.ts`, right after the `"admin actor gets the same denials"` test in the `describe("job-search opportunity feed + decision isolation (#937)", ...)` block. Confirmed RED via:
  ```
  pnpm test:integration tests/integration/external-module-job-search-kv-isolation.test.ts -t "#1203"
  ```
  Failed exactly as expected: `ExternalModuleRpcError: forbidden_kv_mutation` thrown at `worker-rpc-host.ts:284`, via `writeRecord` → `rebuildFeed` (feed.ts:162) → `opportunities.ts:128`.

- **Task 2 (GREEN, edit made, verification NOT yet confirmed — background run was still in flight at relay time):** edited `external-modules/job-search/src/domain/feed.ts`:
  - Extracted a new private `async function buildFeedIndex(kv, now): Promise<FeedIndex>` — the old `rebuildFeed` body (job loop, gate/evaluation, sort) **minus** the `writeRecord` call, returning the index directly.
  - `rebuildFeed(kv, now)` is now: `const index = await buildFeedIndex(kv, now); await writeRecord(kv, NS.feed, keys.feedActive, index); return index;` — behavior-identical for its 3 write-risk callers.
  - `readFeedOrRebuild` now calls `buildFeedIndex(kv, now)` in **both** branches (corrupt-index catch, and the `feed ?? ...` fallback) instead of `rebuildFeed`.

  **A background verification run was launched but not confirmed complete before this relay fired:**
  ```
  pnpm test:integration tests/integration/external-module-job-search-kv-isolation.test.ts -t "#1203"
  ```
  Its output (if it finished) is at:
  `/tmp/claude-1000/-home-ben-Jarv1s--claude-worktrees-fix-1203-job-opportunities-read/a3150d45-8be6-4ba1-97f4-f9929a10e438/tasks/bnjkdrc2m.output`
  — that tmp dir belongs to the OLD session, but the file itself is a plain file on disk and should still be `Read`-able by absolute path. **If it's gone or inconclusive, just re-run the command above** — it takes ~5 min (mostly vitest import/transform overhead, not the actual test), and is the very next thing to do.

**First action as successor: confirm Task 2's test run is actually green** (read the tmp output file above, or re-run the `-t "#1203"` command). Only mark Task 2 complete (TaskUpdate id 2) once you've seen it pass — don't assume it passed just because the edit looks right.

## Git status at relay time (nothing committed yet — none of this is on disk elsewhere)

```
 M external-modules/job-search/src/domain/feed.ts
 M tests/integration/external-module-job-search-kv-isolation.test.ts
?? docs/superpowers/plans/2026-07-19-1203-job-opportunities-read.md
```
(`.claude/context-meter.log` also shows modified — that's the harness's own meter file, ignore/don't stage it.)

**Do not lose these edits.** Stage and commit them once Task 2 is confirmed green — `git add` only:
`external-modules/job-search/src/domain/feed.ts tests/integration/external-module-job-search-kv-isolation.test.ts` (Task 2 commit), the plan doc can go in its own small commit or ride along.

## Remaining tasks (task-list ids 3, 4, 5 already created via TaskCreate — TaskList to see them)

- **Task 3:** rewrite the stale persistence assertions in `tests/unit/external-module-job-search-kv-feed.test.ts` — see plan doc Task 3 for exact before/after snippets (both `readFeedOrRebuild` tests at ~lines 125-141 must assert `await readFeed(kv)` is `null` afterward, i.e. NO persistence on the read path — the current test literally has a comment saying "The repaired index is persisted, not just returned," which is now false and must be replaced).
- **Task 4:** grep-confirm (no edits) that `rebuildFeed`'s 3 write-risk callers (`run.ts:227`, `decisions.ts:69`, `retention.ts:180`) are unchanged, and `job-search.opportunities.list` is still `"risk": "read"` in `jarvis.module.json`. Exact grep commands are in the plan doc Task 4.
- **Task 5:** full gate — `pnpm format:check && pnpm lint && pnpm typecheck`, targeted vitest runs (unit + the two integration/unit feed files), `pnpm verify:foundation` (drop/create fresh gate DB first per CLAUDE.md), `git fetch origin main && git rebase origin/main`, re-run pre-push trio, then **`coordinated-wrap-up`** (PR + report to Coordinator — DO NOT merge, DO NOT touch the board).

## Locked decisions (do not weaken — repeated from plan/handoff for convenience)

- `job-search.opportunities.list` stays `risk: "read"`.
- Do not touch `worker-rpc-host.ts` or weaken `forbidden_kv_mutation`.
- Missing/corrupt feed reads build and return the result without persistence.
- The 3 write-risk `rebuildFeed` callers keep persisting, untouched.
- One real-RPC, `toolRisk: "read"`, empty-KV regression proves success + zero KV row (Task 1, done).

## Run-specific bans (unchanged)

Work only in this worktree/branch; stage explicit paths, never `git add -A`. Never touch
`docs/coordination/`, project board, milestones, shared host policy, or merge. No scope expansion
beyond the approved plan.
