# Build Handoff — #672 wellness export worker RLS category reads

**Approved source:** GitHub issue #672 plus #671 escalation notes in
`docs/coordination/2026-06-30-rfa-fleet.md` around `2026-07-02T05:27:00Z`–`05:32:00Z`
**GitHub issue:** #672
**Risk tier:** `security` — RLS/grant shape and worker data access.
**Worktree:** `~/Jarv1s/.claude/worktrees/672-wellness-export-rls`
**Branch:** `coord/672-wellness-export-rls` off `origin/main` at `5bbffb8e`
**Build skill path:** `~/Jarv1s/.claude/skills/coordinated-build/SKILL.md`
**Coordinator label:** `Coordinator`
**Coordinator session id:** `019f23ce-8811-7573-a554-db21fff67cff`
**Relay threshold:** ~80-100k tokens or a compaction summary; relay immediately if hit.

## Start

1. `[ -d node_modules ] || pnpm install`.
2. Read this handoff, `CLAUDE.md`, and `~/Jarv1s/.claude/skills/coordinated-build/SKILL.md`.
3. Premise-verify against current branch before planning. Do not write code before coordinator
   approval.
4. Write a compact plan and escalate it to `Coordinator` for approval via Herdr.

## Problem

#672 follows #671. #671 fixed blocking worker permission errors so the export job can complete.
This issue is separate: direct category reads as `jarvis_worker_runtime` can silently return zero
rows under RLS instead of failing. That can make a wellness export omit owner data while appearing
successful.

Observed category tables from #671:

- `app.wellness_checkins`
- `app.medications`
- `app.medication_logs`
- `app.wellness_therapy_notes`

## Required Scope

- Preserve owner-only wellness privacy.
- No broad worker bypasses and no `BYPASSRLS`.
- Add a worker-role regression that fails if seeded owner data in the categories above is silently
  omitted by the wellness export path.
- Review the RLS/grant shape and use the minimum policy/function change required by the export path.
- Keep pg-boss payloads metadata-only.
- Do not modify applied migrations. Add a new migration if schema/policy changes are required.
- Update release-hardening/audit tests only if a security invariant intentionally changes, and keep
  the invariant stricter rather than broader.

## Collision Notes

- #671 landed bounded worker status-update/audit changes. Do not undo them.
- #672 should fix category read completeness only. If you find another job-failure blocker, escalate
  before widening scope.
- This is security-tier: final PR needs cross-model security QA and explicit Ben/Fable sign-off
  before merge.

## Local Gate

At minimum, run the focused worker/export regression, any changed migration tests, and:

- `pnpm format:check`
- `pnpm lint`
- `pnpm typecheck`

Wrap-up must report exact commands and exit codes.
