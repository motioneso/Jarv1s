# Relay — #1203 Job Search opportunities read (context checkpoint, no code written yet)

**Original handoff:** `docs/superpowers/handoffs/2026-07-19-1203-job-opportunities-read.md` (read it first, in full — short).
**Issue:** GitHub #1203. **Branch:** `fix/1203-job-opportunities-read` off `origin/main`. **Coordinator label:** `Coordinator`.
**Status:** Still in coordinated-build Step ½ (verify spec against branch). Zero code edits made. No plan written yet. No message sent to coordinator yet beyond confirming its pane identity.

## Root cause (confirmed by reading code, not yet fixed)

`external-modules/job-search/src/domain/feed.ts`, function `readFeedOrRebuild` (~line 191-202): both its branches (`corrupt_index` catch, and `feed ?? rebuildFeed`) call the PERSISTING `rebuildFeed`, which does `kv.set`. This function is used ONLY by `listOpportunitiesHandler` in `external-modules/job-search/src/worker/handlers/opportunities.ts` (line ~128), a `risk: "read"` tool — so a read call can trigger a KV write, which the shared host's `forbidden_kv_mutation` policy rejects (scrubbed to `handler_failed` → HTTP 500).

Three OTHER call sites call `rebuildFeed` directly (not through `readFeedOrRebuild`) and are write-risk flows — must KEEP persisting, do not touch their behavior:
- `external-modules/job-search/src/worker/handlers/run.ts` line ~227 (monitor-discovery pipeline)
- `external-modules/job-search/src/domain/decisions.ts` line ~69 (opportunity.decide flow)
- `external-modules/job-search/src/domain/retention.ts` line ~180 (retention sweep)

`external-modules/job-search/src/domain/index.ts` lines ~159-161 re-exports `readFeed`/`readFeedOrRebuild`/`rebuildFeed` — will need a new pure-builder export added.

## Fix shape (not yet built)

Extract a pure, non-persisting feed-index builder (compute-only, no `kv.set`) inside `feed.ts`, shared by:
- `rebuildFeed` (persists — keep as-is for the three write-risk callers above)
- `readFeedOrRebuild` (read path — call the pure builder, do NOT persist)

## Conflicting existing test — must rewrite, not just extend

`tests/unit/external-module-job-search-kv-feed.test.ts` lines ~125-134, test `"readFeedOrRebuild recovers from a corrupt index"` — currently asserts the OLD buggy persisting behavior explicitly ("The repaired index is persisted, not just returned"). Per the locked decision below, rewrite to assert NO persistence after `readFeedOrRebuild` on a missing/corrupt index (still assert returned index correctness). The adjacent test at ~136-141 ("builds a fresh index when none exists") should probably gain the same non-persistence assertion.

## Open question — NOT yet resolved, do this first in Step ½

Where is `forbidden_kv_mutation` actually enforced? All current matches are FINANCE-module comments referencing it (`external-modules/finance/src/worker/handlers/reports.ts:5`, `accounts.ts:16`, plus test comments in `tests/unit/external-module-finance-manifest.test.ts:81` and `tests/unit/external-module-finance-handlers-accounts.test.ts:19,47`) — grep only returned 5 matches total, "[... and 4 more matches]" was never expanded. The actual shared-host enforcement code (outside job-search, likely a shared/host RPC layer) has NOT been located yet. Also unresolved: whether `tests/integration/external-module-job-search-kv-isolation.test.ts` (real Postgres RLS + real RPC handler suite, esp. the JS-08 block at lines ~773-950) already routes through that real enforcement layer, or bypasses it — this determines whether the required "real-RPC empty-KV → 200, no KV row" regression test (per locked decisions) can extend that file directly or needs new harness plumbing.

**Next steps for successor:**
1. `grep -rn "forbidden_kv_mutation" --include="*.ts"` repo-wide (not just job-search/finance dirs) to find the enforcement code; read `external-modules/finance/src/worker/handlers/reports.ts` and `accounts.ts` for the precedent pattern.
2. Confirm whether the integration harness (`tests/integration/job-search-rpc-harness.js`) exercises real host enforcement or a bypass.
3. Write the minimal test-first plan (`superpowers:writing-plans` → `docs/superpowers/plans/YYYY-MM-DD-<slug>.md`) covering: red regression test, the pure-builder fix, the rewritten unit test, confirmation write-risk flows untouched, confirmation `opportunities.list` risk stays `"read"`.
4. Message coordinator (label `Coordinator`, confirm unique pane via `herdr pane list` first) with plan path, per `coordinated-build` Step 1. **Wait for approval before editing any code.**
5. Then TDD-build task by task, commit per task, `coordinated-wrap-up`.

## Locked decisions (do not weaken)

- `job-search.opportunities.list` remains `risk: "read"`.
- Do not weaken the shared host `forbidden_kv_mutation` policy.
- Missing/corrupt feed reads build and return the result without persistence.
- Existing write-risk flows may retain persisted rebuild behavior.
- One real-RPC empty-KV regression must prove HTTP 200 and no KV row creation.

## Run-specific bans (unchanged)

Work only in this worktree/branch; stage explicit paths, never `git add -A`. Never touch `docs/coordination/`, project board, milestones, shared host policy, or merge.
