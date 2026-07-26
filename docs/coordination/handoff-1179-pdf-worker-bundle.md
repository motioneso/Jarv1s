# Build Handoff — #1179 PDF worker bundle

**Approved input:** GitHub issue #1179 plus `docs/superpowers/plans/2026-07-19-1179-pdf-worker-bundle.md`  
**GitHub issue:** #1179  
**Risk tier:** `routine`; mandatory live-path proof before merge because PDF attachments are user-facing  
**Worktree:** `~/Jarv1s/.claude/worktrees/fix-1179-pdf-worker-bundle`  
**Branch:** `fix/1179-pdf-worker-bundle` from CI-green `origin/main` at `01fd7d412bb2e612eab204cedfbc9d1b7aa2c2e0`  
**Build skill:** `~/Jarv1s/.claude/skills/coordinated-build/SKILL.md`  
**Coordinator label:** `Coordinator` — resolve fresh with `herdr pane list`; exactly one pane must have this label  
**Coordinator session id:** `019f7975-ef57-7b62-9c11-71dc76cc9053`  
**Agent model:** `gpt-5.6-luna` per Ben's explicit overnight-build directive

## Start

1. Run `[ -d node_modules ] || pnpm install`.
2. Read this handoff and the approved plan by current task section. The plan is already human-approved; do not pause for a second product-plan gate.
3. Invoke `coordinated-build` and execute Task 1 -> Task 2 -> Task 3 serially with TDD and explicit-path commits.
4. Use `coordinated-wrap-up` to push the branch and open the PR. Report the PR/head and compact verification status to `Coordinator`.
5. A context-meter warning or compaction summary triggers immediate `relay`; message the coordinator first.

## Collision notes

- One builder owns the whole lane. Tasks 1 and 2 both edit `packages/chat/src/attachments-service.ts`; do not delegate overlapping implementation to another worktree or agent.
- Planned files: `scripts/build-app.ts`, `packages/chat/src/attachments-service.ts`, `tests/unit/pdf-attachment-bundle.test.ts`, and `tests/integration/chat-attachments-service.test.ts`.
- The only drift after the plan's original grounding touched unrelated settings UI/test files; there is no planned-file collision on current main.
- Keep `pdf-parse` bundled. Use Node stdlib and the installed package; add no dependency or speculative abstraction.
- Do not expand into timeout/retry work. If the ~157-second timeout survives successful extraction, record it for a follow-up issue.

## Run-specific bans

- Work only in this worktree/branch. Stage explicit paths; never `git add -A`, `git add .`, or repo-wide `pnpm format`.
- Do not modify any file under `docs/coordination/`, including this handoff.
- Do not move the project board, close the issue, merge the PR, or delete branches/worktrees.
- Never log or publish attachment bytes, extracted text, filenames, actor IDs, vault paths, or private UAT content.
- Do not treat CI green as merge-ready. The PR needs recorded real drawer proof: a text PDF with a unique phrase is extracted without the fallback or timeout.

## Completion contract

- Focused bundled regression and malformed-PDF warning test pass.
- `pnpm verify:foundation`, `pnpm audit:release-hardening`, `pnpm build:api`, worker-file existence, and `node --check dist/server.js` are green, or any external blocker is precisely documented.
- Existing #1133 attachment UAT passes.
- Real live PDF drawer proof is attached/commented on the PR if the environment permits; otherwise mark the PR code-complete but unproven and do not claim merge-ready.
