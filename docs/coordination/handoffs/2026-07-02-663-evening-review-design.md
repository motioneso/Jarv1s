# Build Handoff — 663-evening-review-design

**Spec (approved):** `docs/superpowers/specs/2026-06-25-evening-review-and-interview.md`
**Implementation plan:** `docs/superpowers/plans/2026-06-26-evening-review-and-interview.md`
**GitHub issue:** #663
**Risk tier:** `sensitive` — schema migration, shared API contracts, scheduled job payload shape,
briefing prompt trust boundary, and chat seed/briefings bridge.
**Provider:** `agy` / Gemini
**Worktree:** `~/Jarv1s/.claude/worktrees/663-evening-review-design`
**Branch:** `coord/663-evening-review-design` off `origin/main` at `9cb85cc1`
**Build skill path:** `~/Jarv1s/.claude/skills/coordinated-build/SKILL.md`
**Coordinator label:** `Coordinator`
**Coordinator session id:** `019f2305-7128-7723-9d5f-f1a8b7b11e65`
**Relay threshold:** countable events — ~80-100k tokens OR a compaction summary in your own context.

## Start

1. `[ -d node_modules ] || pnpm install`.
2. Read this handoff, issue #663, the approved spec, and the implementation plan in full.
3. Invoke/follow `coordinated-build`.
4. Verify the old plan against current `origin/main` before planning. It was written on 2026-06-26
   and may have migration-number/API drift after later merges.
5. Submit a compact plan to the coordinator for approval before implementation.

## Scope

- Implement the approved evening review + evening interview design only.
- Keep the review in `packages/briefings`; keep the interview in `packages/chat`.
- Use a distinct `briefing_type` concept instead of overloading run trigger kind unless current code
  already solved this differently and you escalate that drift.
- Preserve prompt trust boundaries: trusted prompt literals stay static; day/review data is delimited
  external content.
- Preserve metadata-only job payloads. Scheduled jobs may carry IDs/kind/type/idempotency only, no
  private briefing/chat content.
- Do not create a custom action/write path for the interview; proposals must flow through the
  existing action-request/trust-tier machinery.

## Required Cautions

- Do not assume the old plan's migration number is still valid. Inspect current module SQL and pick
  the next correct briefings migration number.
- Do not import another module's internals. Use public APIs/registry injection patterns already in
  the repo.
- Do not touch `docs/coordination/`, project board, milestones, or merge state.
- Stage only your own changed files; no `git add -A`.

## Suggested Verification

- Follow the plan's targeted tests, adjusted for current filenames/APIs after premise verification.
- At wrap-up, report exact exit codes for targeted tests, `pnpm format:check`, `pnpm lint`,
  `pnpm typecheck`, and `pnpm verify:foundation` if run.
- This PR will get sensitive QA before merge.

## Collision Notes

- #664 merged at `9cb85cc1`; start from that `origin/main`.
- #643 and #579 are queued after this lane.
- #672 remains separate sensitive backlog follow-up; do not pull it into this work.
