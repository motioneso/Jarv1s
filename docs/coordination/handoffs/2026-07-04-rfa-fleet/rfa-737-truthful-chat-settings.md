# Build Handoff - rfa-737-truthful-chat-settings

**Spec (approved):** docs/superpowers/specs/2026-07-04-truthful-chat-settings.md
**GitHub issue:** #737
**Risk tier:** `sensitive`
**Worktree:** ~/Jarv1s/.claude/worktrees/rfa-737-truthful-chat-settings
**Branch:** rfa-737-truthful-chat-settings off `origin/main@6a79777d`
**Build skill path (absolute):** ~/Jarv1s/.claude/skills/coordinated-build/SKILL.md
**Coordinator label:** `Coordinator` - escalate via `herdr-pane-message`; before messaging,
verify `herdr pane list` shows EXACTLY ONE pane with this label, resolved fresh each time.
**Coordinator session id:** `019f2e2e-bed2-7031-bab2-c21e6e7598f2`
**Relay trigger:** the context-meter 70% warning, or a compaction summary in your own context.

## Start

1. `[ -d node_modules ] || pnpm install`.
2. Read `AGENTS.md`, `CLAUDE.md`, this handoff, and the spec IN FULL.
3. Invoke and follow `coordinated-build` end-to-end:
   verify the spec against this branch -> write plan -> send plan to `Coordinator` for approval ->
   wait -> TDD build -> coordinated wrap-up.

## Run-Specific Bans

- Work only in this worktree/branch.
- Do not touch `docs/coordination/`, project board, milestones, or merge.
- Stage explicit files only; never `git add -A`.
- No secrets in docs, payloads, logs, prompts, job payloads, or frontend responses.
- The spec and this handoff are coordinator bootstrap context copied into your worktree; do not
  commit them.

## Collision Notes

- #737 starts after merged #735/#766 at `origin/main@6a79777d`; re-verify every stale spec premise
  before planning.
- Sensitive tier: preserve shared TypeScript contracts, module isolation, DataContextDb boundaries,
  metadata-only job payload expectations, and cache/query coherence.
- Chat does not own automation. Remove fake/local controls instead of wiring module-owned
  automation into Chat.
- Keep the first version small: persist/apply a real response style or length preference, and make
  voice input an honest tracked/coming-soon row or absent until #738.
- #738, #679, and #739 remain serialized behind this lane; do not broaden into voice capture,
  page-aware context, or Briefings source-label work.
