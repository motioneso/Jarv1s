# Build Handoff — overnight-244-corrections-log

**Spec (approved):** `docs/superpowers/specs/2026-06-15-corrections-log.md`  
**GitHub issue:** #244  
**Risk tier:** `sensitive` (memory lifecycle; LLM-driven writes to user beliefs)  
**Worktree:** `/home/ben/Jarv1s/.claude/worktrees/overnight-244-corrections-log` **Branch:** `overnight-244-corrections-log`  
**Build skill path (absolute):** `/home/ben/Jarv1s/.claude/skills/coordinated-build/SKILL.md`  
**Coordinator label:** `Coordinator`  
**Coordinator session id:** `019edba6-76f5-7d13-9de9-2b5a8b4e5d1f`  
**Relay threshold:** countable events — about 80-100k tokens or a compaction summary in your own context.

## Start

1. Resolve your skills. Confirm you can invoke `coordinated-build` by name; if not, open the
   absolute build skill path above and follow it directly.
2. `[ -d node_modules ] || pnpm install`.
3. Read the approved spec above IN FULL, then read this handoff IN FULL.
4. Invoke the `coordinated-build` skill and follow it: write the plan, escalate it to
   `Coordinator` for approval, then build after approval.

## Current State

- Lower-risk prerequisites are merged: #297 via PR #303, #299 tasks via PR #304, and #299
  settings/scripts/jobs via PR #302.
- #243 has already landed the shared suppression store:
  `packages/memory/sql/0092_inferred_patterns_suppression.sql`,
  `packages/memory/src/suppressions-repository.ts`, and the reject/suppression route/job guard.
- Current migration head includes `0095`; do not assume the old spec note "next free >= 0090" is
  current. If this lane needs schema, add a new forward migration in `packages/memory/sql/` with the
  next free number at implementation time. Never edit applied migration `0092`.
- GitHub Actions is still billing-blocked for this run. Use local gate evidence per the manifest.

## Scope

Build the #244 corrections log end to end:

- Extend/reuse `app.chat_memory_suppressions` as the shared corrections log store. It currently only
  supports rejected inferred facts (`reason = rejected`). Add the minimal additive schema/repository
  support needed for `corrected` entries, before/after data, source (`chat` / `pattern-reject`), and
  chronological reads.
- Preserve owner-only RLS and metadata-only job payloads. Worker/app runtime access must stay scoped
  to `app.current_actor_user_id()`.
- Extend `chat.extract-facts` so the LLM can emit grounded corrections when a user corrects an
  existing active fact. A correction is logged only when a real fact is updated/superseded/suppressed.
  Do not fabricate corrections from ordinary disagreement/noise.
- Add `GET /api/chat/memory/corrections` with owner-scoped, paginated results.
- Wire the settings Memory & context pane: replace the "Corrections" coming-soon row with a real
  chronological corrections section.
- Add focused unit/integration/web coverage for the spec verification:
  - rejecting an inferred pattern writes a `rejected` correction row;
  - a chat turn correcting an existing belief writes a `corrected` row and fixes/suppresses the old
    fact;
  - corrections route is owner-scoped;
  - extract-facts job payload remains metadata-only;
  - settings UI renders real corrections state instead of the coming-soon control.

## Likely Files

- `packages/memory/sql/*`
- `packages/memory/src/suppressions-repository.ts`
- `packages/memory/src/facts-repository.ts`
- `packages/memory/src/index.ts`
- `packages/memory/src/manifest.ts`
- `packages/chat/src/jobs.ts`
- `packages/chat/src/routes.ts`
- `packages/shared/src/chat-api.ts` or another shared API contract file if memory DTOs live there
- `apps/web/src/api/client.ts`
- `apps/web/src/api/query-keys.ts`
- `apps/web/src/settings/settings-memory-pane.tsx`
- `tests/integration/chat-recall.test.ts`
- `tests/integration/chat-live.test.ts`
- focused web/unit tests if an existing test harness covers settings memory UI

## Compact

- Work only in this worktree/branch. Commit green per task. Stage explicit files only.
- Do not touch `docs/coordination/`.
- Do not run repo-wide `pnpm format` or broad `git add`; format/stage only your changed files.
- Plan approval comes from the coordinator, not a human gate. Do not code before approval.
- Escalate to `Coordinator` via `herdr-pane-message` for plan-ready, blocker, design fork, review
  request, or done.
- Never touch the project board, milestones, or merge.
- Honor every `CLAUDE.md` Hard Invariant. No secrets in docs, payloads, logs, job payloads, AI
  prompts, or frontend responses.
- Use a lane-specific DB for DB-touching verification: `JARVIS_PGDATABASE=jarvis_build_corr244`.
- Use lane-specific log paths such as `/tmp/cb-vf-244-corrections.log`; do not write shared
  `/tmp/cb-vf.log`.
- Sensitive lane invariant check: DataContextDb only, owner-only RLS, metadata-only payloads, and
  module isolation. If the plan touches auth/session/token/RLS policy beyond owner-only extension,
  tag the escalation `[SECURITY]`.
- Caveman mode for coordinator status/escalations.

## Collision Notes

- #243 already owns the suppression baseline; extend it additively. Do not duplicate the store.
- #299 residual AI/chat, memory/file-size, frontend mirror, and provider-list design question remain
  out of scope.
- The untracked onboarding Webwright handoff existed before this run; do not stage or edit it.
