# Build Handoff — chat-model-override-241

**Spec (approved):** docs/superpowers/specs/2026-06-15-chat-model-override.md
**GitHub issue:** #241
**Risk tier:** `sensitive`
**Worktree:** /home/ben/Jarv1s/.claude/worktrees/chat-model-override-241 **Branch:** chat-model-override-241
**Build skill path (absolute):** /home/ben/Jarv1s/.claude/skills/coordinated-build/SKILL.md
**Coordinator label:** `Coordinator`
**Coordinator session id:** `0dadd466-352f-48c1-82ec-b859e045b149`
**Relay threshold:** ~80–100k tokens or compaction summary → relay immediately.
**JARVIS_PGDATABASE:** `jarvis_build_chatmodel241`

## Start

1. `[ -d node_modules ] || pnpm install`
2. `JARVIS_PGDATABASE=jarvis_build_chatmodel241 pnpm db:migrate` — bootstraps the fresh DB.
3. Read the spec at `docs/superpowers/specs/2026-06-15-chat-model-override.md` IN FULL.
4. Write your plan → escalate to coordinator for approval via `herdr-pane-message` → on approval,
   build TDD/green → pre-push trio (`pnpm format:check && pnpm lint && pnpm typecheck`) + fresh
   rebase before push → open PR via `coordinated-wrap-up`, report done to coordinator.

## Your compact (non-negotiable)

- Work ONLY in this worktree/branch. `git add` only this task's files.
  `Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>` on all commits.
- Plan approval comes from the **coordinator** (label `Coordinator`), NOT Ben. No code before approval.
- Escalate to coordinator the moment you hit: plan ready, blocker, design fork, or done.
- **Never touch** `docs/coordination/`, the project board, or merge — coordinator owns those.
- **Never run `pnpm format` + broad `git add` / `git add -A`** — scope staging to your own files.
- **No touching `apps/web/src/onboarding/**`\*\* — an unrelated Codex session owns it.
- Caveman mode for all status/escalation messages (terse, full technical accuracy, saves tokens).
- Honor all CLAUDE.md Hard Invariants. Secrets never escape.

## Collision notes

- **Migration number: do NOT pick a final number.** Use placeholder filename
  `0091_chat_model_override.sql` in the appropriate module `sql/` dir. The coordinator assigns the
  real number at merge (landing order = migration order).
- **`apps/web/src/api/client.ts`** and **`packages/chat/src/routes.ts`** are collision targets with
  other Wave 3 agents (#243, #247). Your PR may need a rebase keep-both before merge — the
  coordinator handles this; just build cleanly.
- **`settings-ai-admin-pane.tsx`**: add the global toggle + per-model flag UI. Issues #252/#253
  (admin AI test-connection/routing) are NOT yet queued — do not import or depend on their changes.
- **`settings-ai-pane.tsx`**: #240 persona is already merged — scope only to the `ChatModel`
  component; do not retouch the Persona section.
- RLS: per-user override pref is owner-only (existing preferences RLS). Admin global toggle and
  per-model flags are admin-only writes. Verify both in integration tests.
- No migration needed for the user-override pref (stored in `app.preferences`). Migration is only
  for `allow_user_override` column on the model-config table in `packages/ai`.

## Verification target

- Unit: override resolution truth table (global off → default; global on + allowed + present →
  override; global on + disallowed → default; global on + allowed + removed → default).
- Integration: admin enables global + allows model X; user A overrides to X → chat resolves to X;
  user B (no override) → default; global off → override ignored + read-only UI; RLS isolation.
- `JARVIS_PGDATABASE=jarvis_build_chatmodel241 pnpm verify:foundation` green before PR.
