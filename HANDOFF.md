# Build Handoff — source-behavior-policy-247

**Spec (approved):** docs/superpowers/specs/2026-06-15-source-behavior-policy.md
**GitHub issue:** #247
**Risk tier:** `sensitive`
**Worktree:** /home/ben/Jarv1s/.claude/worktrees/source-behavior-policy-247 **Branch:** source-behavior-policy-247
**Build skill path (absolute):** /home/ben/Jarv1s/.claude/skills/coordinated-build/SKILL.md
**Coordinator label:** `Coordinator`
**Coordinator session id:** `0dadd466-352f-48c1-82ec-b859e045b149`
**Relay threshold:** ~80–100k tokens or compaction summary → relay immediately.
**JARVIS_PGDATABASE:** `jarvis_build_sourcebhv247`

## Start

1. `[ -d node_modules ] || pnpm install`
2. `JARVIS_PGDATABASE=jarvis_build_sourcebhv247 pnpm db:migrate` — bootstraps the fresh DB.
3. Read the spec at `docs/superpowers/specs/2026-06-15-source-behavior-policy.md` IN FULL.
4. Write your plan → escalate to coordinator for approval via `herdr-pane-message` → on approval,
   build TDD/green → pre-push trio → fresh rebase before push → open PR via `coordinated-wrap-up`,
   report done to coordinator.

## Your compact (non-negotiable)

- Work ONLY in this worktree/branch. `git add` only this task's files.
  `Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>` on all commits.
- Plan approval comes from the **coordinator** (label `Coordinator`), NOT Ben. No code before approval.
- Escalate to coordinator the moment you hit: plan ready, blocker, design fork, or done.
- **Never touch** `docs/coordination/`, the project board, or merge — coordinator owns those.
- **Never run `pnpm format` + broad `git add` / `git add -A`** — scope staging to your own files.
- **No touching** `apps/web/src/onboarding/**` — an unrelated Codex session owns it.
- Caveman mode for all status/escalation messages.
- Honor all CLAUDE.md Hard Invariants.

## Collision notes

- **No migration required** — store per-user policy in `app.preferences` (already has RLS). No
  migration number to worry about.
- **`apps/web/src/api/client.ts`** is a collision target with #241 and #243. Your PR may need a
  rebase keep-both at merge — coordinator handles it.
- **Route file cap:** check `packages/settings/src/routes.ts` line count before adding routes. If
  it is near 1000 lines, put source-behavior routes in a **new file** (same pattern as #249 used
  locale-routes.ts). Do not exceed 1000 lines in any source file.
- **Module isolation is critical.** Behaviors must be declared in module manifests; the policy
  service reads them via the registry's `listModuleManifests` API. Briefings gating calendar must
  go via the `isBehaviorEnabled` helper — NOT by importing the calendar module directly.
- **Reuse the injected `PreferencesRepository` port** established by #235 in
  `packages/settings/src/routes.ts`. Do NOT add `@jarv1s/structured-state` as a settings package
  dep or instantiate `new PreferencesRepository()` directly in settings.
- Replace the hardcoded `DATA_SOURCES` list in `settings-personal-data-panes.tsx` with API-driven
  data from `GET /api/me/source-behaviors`. Calendar and email modules declare their behaviors in
  their module manifests.
- Owner-only policy reads/writes (preferences RLS). Verify per-user isolation in integration tests.
- Enforce ONLY the "include in briefings" behavior end-to-end (the only live one). All others ship
  as coming-soon: disabled in UI, always `false` in the helper regardless of stored pref.

## Verification target

- Unit: `isBehaviorEnabled` (override > default; coming-soon always false); manifest aggregation.
- Integration: set "include in briefings" off → briefings omits that source; per-user isolation;
  newly-declared test-module behavior appears in list-API; non-admin can set only own toggles.
- `JARVIS_PGDATABASE=jarvis_build_sourcebhv247 pnpm verify:foundation` green before PR.
