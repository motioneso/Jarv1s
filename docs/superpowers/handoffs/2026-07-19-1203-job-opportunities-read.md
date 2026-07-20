# Build Handoff — #1203 Job Search opportunities read

**Approved bug contract:** GitHub issue #1203  
**Risk tier:** `routine` (module-local read-path correction; shared host policy and tool risk stay unchanged)  
**Worktree:** `~/Jarv1s/.claude/worktrees/fix-1203-job-opportunities-read`  
**Branch:** `fix/1203-job-opportunities-read` off `origin/main` at `97b5bd52`  
**Build skill:** `~/Jarv1s/.claude/skills/coordinated-build/SKILL.md`  
**Coordinator label:** `Coordinator`  
**Coordinator session id:** `019f7cd5-b4d7-7f71-9958-7aace3d9ead7`  
**Relay trigger:** context-meter warning at 70%, or any compaction summary → message the coordinator and invoke `relay` immediately.

## Start

1. `[ -d node_modules ] || pnpm install`.
2. Read GitHub issue #1203 and invoke `coordinated-build`.
3. Present the smallest test-first plan to the coordinator before editing.
4. After plan approval: red regression → minimal module-local fix → gates → `coordinated-wrap-up`.

## Locked decisions

- `job-search.opportunities.list` remains `risk: "read"`.
- Do not weaken the shared host `forbidden_kv_mutation` policy.
- Missing/corrupt feed reads build and return the result without persistence.
- Existing write-risk flows may retain persisted rebuild behavior.
- One real-RPC empty-KV regression must prove HTTP 200 and no KV row creation.

## Expected scope

- `external-modules/job-search/src/worker/handlers/opportunities.ts`
- `external-modules/job-search/src/domain/feed.ts`
- `tests/unit/external-module-job-search-handlers-opportunities.test.ts`
- `tests/unit/external-module-job-search-kv-feed.test.ts`
- `tests/integration/external-module-job-search-kv-isolation.test.ts`

## Run-specific bans

- Work only in this worktree/branch; stage explicit paths, never `git add -A` or repo-wide format.
- Never touch `docs/coordination/`, the project board, milestones, shared host policy, or merge.
- No secrets, private data, or private payloads in logs, docs, tests, or prompts.

## Collision notes

- #1197 Lane D confirmed no overlap: it touches only Job Search web root/tests/docs, not the worker/domain files above.
- #1179/#1182/#1185/#1187/#1188 do not touch the expected files.
