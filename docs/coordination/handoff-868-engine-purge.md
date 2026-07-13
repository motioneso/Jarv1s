# Coordinated build handoff — #868 engine-less private transcript purge

- Issue: #868
- Branch/worktree: `security/868-engine-purge` / `~/Jarv1s/.claude/worktrees/security-868-engine-purge`
- Tier: security
- Build coordinator: `UX Coordinator`, immutable session
  `019f5adf-594d-7623-8259-69e1657f4e6b`
- Merge authority: Primary `Coordinator`, immutable session
  `58a78927-385c-4b1d-8fa0-94db20255d6f`

## Approved scope

Implement issue #868 under the approved private-chat design:

- `docs/superpowers/specs/2026-07-05-private-chat-mode.md`, especially decision 7
- `docs/superpowers/plans/2026-07-06-private-chat-mode-plan.md`, Tasks 3–4
- #868's durable issue body

Extend engine-less cleanup to purge Gemini, agy-print, and codex-exec private transcripts after
crash/restart, and tighten interactive Codex cleanup from per-user to per-session matching. Leave
SQL bookkeeping and already-landed normal cleanup behavior unchanged. Add real on-disk fixture tests
for every engine shape; mocks that skip the filesystem are insufficient.

## Collision and scope locks

- #984 is frozen on PR #1015 and owns its manager/UI/history work plus preserved UAT evidence.
- Do not edit `chat-session-manager.ts`, #984's worktree/evidence, or any #984 UI path.
- The runner/RPC input-ready event is a distinct dependency awaiting its own approved security spec.
  Do not implement readiness, timers, or manager consumer seams in this lane.
- Do not touch `docs/coordination/`; it is coordinator-owned.
- Never run repo-wide formatting or use `git add -A` / `git add .`; stage explicit owned paths only.

## Finish line

Plan to the locked scope, obtain coordinator approval, implement with focused checks, run the full
gate once, push, open a PR, and report exact head/evidence. Never merge, close issues, release other
lanes, or touch the board. Security QA and Primary/Fable sign-off happen after your handoff.
