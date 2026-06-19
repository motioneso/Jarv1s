# Coordinated Build Handoff — #255 Host diagnostics

Coordinator: `Coordinator`
Branch/worktree: `deploy-255-host-diagnostics` at `.claude/worktrees/deploy-255-host-diagnostics`
Issue: #255
Spec: `docs/superpowers/specs/2026-06-18-host-diagnostics-safe-ops.md`
Tier: security
Isolated DB: `JARVIS_PGDATABASE=jarv1s_255_host_diag`

## Goal

Implement the approved #255 host diagnostics safe-ops spec.

## Required Process

1. Run `pnpm install`.
2. Read `CLAUDE.md` and the spec in full.
3. Use the `coordinated-build` skill/process if available; otherwise follow this handoff.
4. Send a concise implementation plan to `Coordinator` before editing.
5. After coordinator approval, implement only #255.

## Scope

- Add safe admin-only host diagnostics.
- Wire Settings -> Admin -> Advanced host setup "Run diagnostics".
- Keep diagnostics read-only and secret-safe.
- Do not ship a blind restart endpoint.

## Guardrails

- Use `JARVIS_PGDATABASE=jarv1s_255_host_diag` for DB/integration commands.
- Do not touch `docs/coordination/` except this handoff.
- Do not run repo-wide `pnpm format` unless specifically needed; format/stage only changed paths.
- Do not use `git add -A`.
- Never expose env values, DB URLs, secrets, tokens, raw stack traces, or user-data paths.

## Verification

Run the smallest meaningful checks first, then broader gate if time allows:

- targeted unit/integration tests for admin diagnostics;
- relevant web/settings tests if touched;
- `JARVIS_PGDATABASE=jarv1s_255_host_diag pnpm verify:foundation` before PR if feasible.

## Report Back

Send Coordinator:

- plan approval request before implementation;
- final root summary;
- files changed;
- exact verification commands and exit codes;
- PR link if opened.
