# Coordinated Build Handoff — #207 route-local junk credential rate limits

Coordinator: `Coordinator`
Branch/worktree: `deploy-207-rate-limit` at `.claude/worktrees/deploy-207-rate-limit`
Issue: #207
Spec: `docs/superpowers/specs/2026-06-18-route-local-junk-credential-rate-limit-gates.md`
Tier: security
Isolated DB: `JARVIS_PGDATABASE=jarv1s_207_rate_limit`

## Goal

Make route-local rate-limit keys fall malformed bearer credentials back to the peer IP bucket while preserving per-principal buckets for valid browser/session and MCP tokens.

## Required Process

1. Run `pnpm install`.
2. Read `CLAUDE.md` and the spec in full.
3. Send a concise implementation plan to `Coordinator` before editing.
4. After coordinator approval, implement only #207.

## Guardrails

- Limiter keys must never include raw bearer tokens or cookie values.
- Keep valid browser/session callers and valid MCP tokens on per-session/principal buckets.
- Cover chat/assistant-tools policy and MCP policy.
- Use `JARVIS_PGDATABASE=jarv1s_207_rate_limit` for DB/integration commands.
- Do not touch `docs/coordination/` except this handoff.
- Do not run repo-wide `pnpm format`; format/stage only changed paths.
- Do not use `git add -A`.

## Verification

Run focused tests proving malformed bearer values share IP bucket, valid callers retain per-principal buckets, and raw credentials do not appear in keys/logs/snapshots. Run broader gate if feasible.

## Report Back

Send Coordinator: plan request, files changed, verification commands/exit codes, PR link if opened.
