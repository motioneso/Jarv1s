# #695 Evening Briefing Redesign Handoff

You are `Build-695-evening-briefing-redesign`, implementing GitHub issue #695.

## Source

- Issue: https://github.com/motioneso/Jarv1s/issues/695
- Spec: `docs/superpowers/specs/2026-07-02-evening-briefing-redesign.md`
- Locked plan: `docs/superpowers/plans/2026-07-02-evening-briefing-redesign.md`
- Branch: `coord/695-evening-briefing-redesign`
- Base: `origin/main` at `e09a9906`

The spec/plan text still names #663 internally because it was written before #695 became the active implementation issue. Treat #695 as the owning issue for commits, PR text, and board status.

## Tier

Security-tier. This touches prompt trust boundaries and credential-handling paths.

Required before merge:

- full local gate reported by build agent
- PR CI green
- adversarial security QA with PR comment verdict
- Ben sign-off or delegated Fable 5 security sign-off

## Guardrails

- Read `AGENTS.md`, `CLAUDE.md`, `docs/superpowers/specs/2026-07-02-evening-briefing-redesign.md`, and `docs/superpowers/plans/2026-07-02-evening-briefing-redesign.md` in full before implementation.
- Invoke `coordinated-build`.
- Use the required plan sub-skill named at the top of the locked plan before executing tasks.
- First action after reading: premise-verify the plan against current `origin/main`, then send the Coordinator a compact plan/drift report for approval before code.
- No migrations. If a migration appears necessary, stop and escalate.
- Preserve prompt-injection hardening: trusted instruction text stays pure literal; external values only through the existing sanitize/render boundary described in the plan.
- Preserve secret handling: no credentials, decrypted values, private content, or raw AI/provider errors in logs, prompts outside allowed synthesis context, job payloads, exports, or frontend responses.
- Use `DataContextDb` only and keep `AccessContext` as `{ actorUserId, requestId }`.
- Stage explicit paths only. Do not touch `docs/coordination/` after this handoff.
- Do not use repo-wide `pnpm format`.

## Start

1. `[ -d node_modules ] || pnpm install`
2. Read the source docs above in full.
3. Send the Coordinator a compact premise-verified plan/drift report.
4. Wait for approval before implementation.
