# Build Handoff — 709 over-export tightening

**Spec (approved):** GitHub issue #709
**GitHub issue:** #709
**Risk tier:** `routine`
**Worktree:** `~/Jarv1s/.claude/worktrees/709-overexport-tightening` **Branch:** `coord/709-overexport-tightening` off current green `origin/main`
**Build skill path:** `~/Jarv1s/.claude/skills/coordinated-build/SKILL.md`
**Coordinator label:** `Coordinator`
**Coordinator session id:** `019f26ad-cb6c-7fa1-99f7-3e2dd29fbf99`
**Relay threshold:** ~80-100k tokens or compaction summary.

## Source

GitHub issue #709 from dead-code audit epic #700. The referenced audit file is not present on
`origin/main`; coordinator source is the issue plus `~/Jarv1s/docs/audits/2026-07-02-dead-code-audit.md`.

## Scope

This is an API-tightening lane, not a deletion lane. Re-confirm candidate symbols and remove only
unneeded `export` keywords or unused barrel re-exports for symbols that are live internally but have
zero external/package consumers.

Candidate groups from the audit include:

- `inferTierFromModelId` in `packages/ai/src/model-discovery.ts`.
- Test-only or same-file helpers such as `herdrAvailable`, tasks-view metadata helpers, and the
  redundant `export type` re-export in `packages/ai/src/adapters/http-api.ts`.
- Connector/settings/wellness/email/calendar internal constants/types only when they are not
  package public API and not imported across files.
- `GeoLocation` only if it is still same-file-only; do not un-export `geocodeIp` or
  `fetchOpenMeteoForecast` because cross-file imports require exports.

Do not touch shared REST/API DTO contracts, module-sdk manifest contracts, provider registries,
public package subpath exports, migrations, RLS/auth/secrets, or any #706 target files. If roadmap
or public-contract intent is unclear, escalate to Coordinator before changing it.

## Required Flow

1. `[ -d node_modules ] || pnpm install`.
2. Read AGENTS.md, CLAUDE.md, this handoff, and the coordinated-build skill.
3. Re-confirm every candidate with current `origin/main`; skip anything with external consumers or
   public-contract value.
4. Submit a compact plan for coordinator approval before code, naming exact symbols/files.
5. Make the smallest export/barrel changes only; no broad formatting.
6. Run focused tests plus typecheck/format/lint as relevant; report exact commands and exits in
   wrap-up.

## Collision Notes

Do not touch `docs/coordination/`. Use explicit staging only; no `git add -A`. #706 is running in
parallel and owns goals/briefings/notifications/jobs/proactive extension-point cleanup.
