# Build Handoff — runtime-config-framework

**Spec (approved):** docs/superpowers/specs/2026-06-25-runtime-config-framework.md
**GitHub issue:** #454
**Risk tier:** `sensitive` (generalizes the Brave-key pattern; RUNTIME_CONFIG_REGISTRY + RuntimeConfigResolver DB-first/env-fallback; migrates embedding key as first consumer; full env-var audit per spec §8. Cross-module config-resolution contract. Auto-merge after green QA + Ben digest.)
**Worktree:** /home/ben/Jarv1s/.claude/worktrees/runtime-config-framework **Branch:** build/runtime-config-framework (off origin/main @ ac56457 — INCLUDES the merged #487 settings atoms you'll reuse)
**Build skill path (absolute):** /home/ben/Jarv1s/.claude/skills/coordinated-build/SKILL.md (use this exact path if `coordinated-build` does not resolve by name)
**Coordinator label:** `Coordinator` (UNIQUE — escalate via `herdr-pane-message`; verify `herdr pane list` shows EXACTLY ONE Coordinator pane before messaging. Re-resolve by label each time.)
**Coordinator session id:** `ses_0fef45f35ffeEJBGhPxqAsabKB` (immutable authority.)
**Relay threshold:** ~80–100k tokens OR compaction summary.

## Start

1. Resolve skills (`coordinated-build` by name, or the absolute path above).
2. `pnpm install` only if `node_modules` missing.
3. Read the spec IN FULL.
4. **Verify spec against branch.** The #487 `@jarv1s/settings-ui` atoms just merged — confirm they're present (your spec §126 says "Reuses @jarv1s/settings-ui atoms now extracted via the settings-connector spec"). If the atom API differs, escalate.
5. Invoke **`coordinated-build`**: plan → coordinator approval → build TDD/green → pre-push trio + rebase → **`coordinated-wrap-up`**.

## Your compact (non-negotiable)

- **CI gate:** run `pnpm format:check && pnpm lint && pnpm typecheck` + relevant vitest locally and record exit codes; CI also runs via `gh pr checks`.
- Work only in this worktree/branch. Commit green per task; scope `git add` to your files.
- Plan approval from the coordinator. No code before it.
- Escalate to `Coordinator` on blocker / plan-ready / design-fork / done.
- Never touch board/milestones/merge.
- Self-monitor context (~80–100k tokens / compaction → relay).
- Honor CLAUDE.md Hard Invariants. No secrets in docs/payloads/logs/prompts.
- Caveman status; conventional commits/PR/code.

## Collision notes (from the coordinator)

- **You consume #487's `@jarv1s/settings-ui` atoms** for any admin UI surface (ac56457 includes them).
- **No DB migration** — reuses `app.instance_settings` as-is. The resolver reads instance_settings first, falls back to env var.
- **Embedding is your first migrated key** — the comment at `packages/memory/src/embedding-provider-config.ts:24` ("M-A3 replaces this with DB-backed reader") is YOUR work fulfilling it. Replace the env-only read with the resolver.
- **Secrets handling:** the Brave key (and similar) are secrets — the resolver must NOT log resolved secret values. Redact in any admin display.
- **No collision with other wave-2 specs** (your files: instance-settings, the new registry/resolver, embedding-provider-config, an admin surface).
- Never touch `docs/coordination/`; never repo-wide `pnpm format` + broad `git add`.
