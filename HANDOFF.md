# Build Handoff — admin-per-user-ai-provider

**Spec (approved):** docs/superpowers/specs/2026-06-25-admin-per-user-ai-provider.md
**GitHub issue:** #485
**Risk tier:** `security` (admin pins a model per-user; the pin is BINDING — user cannot self-override while pinned; stored in app.preferences key `ai.admin_pinned_model_id`; resolver checks pin before instance route. This is an authorization/privilege surface. **Cross-model Opus/Gemini QA + `gh pr comment` verdict + BEN'S EXPLICIT MERGE SIGN-OFF. Build to that bar.**)
**Worktree:** /home/ben/Jarv1s/.claude/worktrees/admin-per-user-ai-provider **Branch:** build/admin-per-user-ai-provider (off origin/main @ ac56457)
**Build skill path (absolute):** /home/ben/Jarv1s/.claude/skills/coordinated-build/SKILL.md (use this exact path if `coordinated-build` does not resolve by name)
**Coordinator label:** `Coordinator` (UNIQUE — escalate via `herdr-pane-message`; verify single Coordinator pane before messaging.)
**Coordinator session id:** `ses_0fef45f35ffeEJBGhPxqAsabKB` (immutable authority.)
**Relay threshold:** ~80–100k tokens OR compaction summary.

## Start

1. Resolve skills (`coordinated-build` or absolute path).
2. `pnpm install` only if `node_modules` missing.
3. Read spec IN FULL.
4. **Verify spec against branch.** Confirm `packages/ai/src/repository.ts:476-551` (`listCapabilityRoutes` + `resolveModelForCapability`) is where you inject the per-user pin check. Confirm admin user-management view exists.
5. Invoke **`coordinated-build`**: plan → coordinator approval → build TDD/green → pre-push trio + rebase → **`coordinated-wrap-up`**.

## Your compact (non-negotiable)

- **CI gate:** run `pnpm format:check && pnpm lint && pnpm typecheck` + relevant vitest locally and record exit codes; CI also runs via `gh pr checks`.
- Work only in this worktree/branch. Commit green per task; scope `git add`.
- Plan approval from coordinator. No code before it.
- **SECURITY TIER — build to a high bar.** The pin is BINDING: while an admin has pinned a model for a user, the user CANNOT select a different model. Verify this enforcement at the resolver layer (not just UI hiding) — a user hitting the API directly must still be pinned. Add tests for: pinned user's API calls use the pinned model; unpinning restores user choice; admin-only mutation of the pin (user cannot self-pin/self-unpin).
- Escalate to `Coordinator` on blocker / plan-ready / design-fork / done. **Tag your message `[SECURITY]` for any privilege/authorization question** — guarantees coordinator escalation routing.
- Never touch board/milestones/merge.
- Self-monitor context → relay at threshold.
- Honor CLAUDE.md Hard Invariants. No secrets.
- Caveman status; conventional commits/PR/code.

## Collision notes (from the coordinator)

- **No file collisions** with other wave-2 specs (your files: `packages/ai/src/repository.ts` resolver, admin user-management view, new admin route for pin mutation).
- **No migration** (reuses `app.preferences`, key `ai.admin_pinned_model_id`).
- **Authorization invariants (critical):**
  - Only admins can set/clear a pin (`requireAdmin` on the mutation route).
  - The pin check in `resolveModelForCapability` runs BEFORE the instance-wide route — pin wins.
  - A pinned user's model selection is locked (UI shows locked state; API enforces).
- **Capability routes** are stored instance-wide in `app.instance_settings` key `AI_CAPABILITY_ROUTES_SETTING_KEY` — your pin is a per-user override ABOVE that.
- Never touch `docs/coordination/`; never repo-wide format + broad add.
