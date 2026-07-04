# Build Handoff - rfa-727-people-notes-source

**Spec (approved):** `docs/superpowers/specs/2026-07-04-people-notes-source-of-truth.md`
**GitHub issue:** #727
**Risk tier:** `security`
**Worktree:** `~/Jarv1s/.claude/worktrees/coord-2026-06-30-rfa-fleet/.claude/worktrees/rfa-727-people-notes-source`
**Branch:** `rfa-727-people-notes-source`
**Coordinator label:** `Coordinator`
**Coordinator session id:** `019f2b95-774b-7541-870d-eadfd431af47`

## Start

1. `[ -d node_modules ] || pnpm install`.
2. Read this handoff and the spec in full.
3. Invoke/follow `coordinated-build`; if the skill is unavailable, follow the same lifecycle:
   inspect current code, write a short plan, send it to `Coordinator`, wait for approval, then build.
4. Before coding, verify current People/Notes/Vault state on this branch.

## Scope

- Notes are the source of truth for People.
- One person maps 1:1 to one canonical note.
- Structured People data is a projection over notes and writes back to notes.
- Use the existing `off | suggest | auto` automation model from the spec.

## Collision Limits

- Stay in People, Notes, Vault, and directly required settings surfaces.
- Do not touch Email, Calendar, Chat, notifications, or `docs/coordination/`.
- Do not run broad repo formatting or `git add -A`.

## Security Bar

- Preserve `VaultContext` for vault I/O and `DataContextDb` for repository access.
- No raw note contents, secrets, or private content in job payloads/logs/prompts beyond existing
  intended user-facing flows.
- Escalate any migration, RLS, or data-loss risk before implementing it.

## Done

- Local focused checks plus `pnpm format:check && pnpm lint && pnpm typecheck`.
- Push branch, open PR for #727, report PR + evidence to `Coordinator`.
- PR needs alternate-model review by Codex/AGY and Ben sign-off after security QA.
