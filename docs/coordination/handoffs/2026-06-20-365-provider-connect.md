# Build Handoff — onboarding provider-connect (#365)

**Spec (approved):** docs/superpowers/specs/2026-06-20-onboarding-provider-connect.md
**GitHub issue:** #365 ("Onboarding: wire provider install + login into the wizard")
**Risk tier:** `routine` + **blast-radius bump → `sensitive` QA depth** (high-fan-in onboarding wizard + shared `packages/shared/onboarding-api.ts` contract). Build to the sensitive bar: invariant-clean, no secret escape, contract changes backward-compat.
**Worktree:** /home/ben/Jarv1s/.claude/worktrees/365-provider-connect **Branch:** `365/provider-connect` (off origin/main `8a14664`)
**Build skill path (absolute):** /home/ben/Jarv1s/.claude/skills/coordinated-build/SKILL.md
**Coordinator label:** `Coordinator` (UNIQUE — escalate via `herdr-pane-message`; re-resolve the live pane by label from `herdr pane list` each time — never reuse a `w…-N` number.)
**Coordinator session id:** `11d3e71c-5d93-4983-8b63-6a0d266c28ab` (immutable authority; confirm live before relying on it.)
**Relay threshold:** read your OWN pane (`herdr pane read "$HERDR_PANE_ID" --source visible --lines 5`) and relay when its context indicator shows ~⅔–¾ consumed, OR after plan-approval + ~5–8 committed tasks, OR immediately on a compaction summary.

## Start

1. **Resolve your skills.** Confirm you can invoke `coordinated-build` by name; else open the absolute Build skill path above.
2. `[ -d node_modules ] || pnpm install`.
3. Read the spec above IN FULL.
4. Invoke **`coordinated-build`**: write the plan → escalate to `Coordinator` for approval → on approval build TDD/green → pre-push trio (`pnpm format:check && pnpm lint && pnpm typecheck`) + fresh rebase before every push → close with **`coordinated-wrap-up`** (PR + report).

## Your compact (non-negotiable)

- Work **only** in this worktree/branch. Commit green per task; `git add` only that task's files (`Co-Authored-By:` your real model — you are Claude/Opus).
- Plan approval comes from the **coordinator**, not a human. No code before approval.
- **Escalate to `Coordinator`** (label, session `11d3e71c`) on: blocker, plan ready, design fork outside the spec, review request, or done. Tag `[DESIGN-FORK]`/`[SECURITY]` for guaranteed routing.
- **Never touch** the project board, milestones, merge, or `docs/coordination/` — coordinator-only.
- **Self-monitor context** by reading your OWN pane; relay via the `relay` skill when ~⅔–¾.
- Honor every CLAUDE.md Hard Invariant. **No secrets** (the pasted OAuth code + minted token are auth material) in any doc, payload, log, or prompt.
- **Caveman mode** for all status/escalations to the coordinator (terse, full technical accuracy). Commit messages / PR body / code stay conventional.

## Key context (read carefully)

- **#367 (auto-register default chat model on provider login) IS MERGED (`8a14664`, on your base).** On a provider login reaching `ready`, the backend now auto-registers a per-provider interactive `default` chat model — so after your connect flow hits `ready`, chat is live with **zero manual model entry**. Do NOT add any model-id entry UI. Chat is gated on provider-login only, never on model selection.
- The install/login backend routes ALREADY EXIST (landed #362/#364): `POST /api/onboarding/provider-install`, `/api/onboarding/provider-login/{begin,submit-token,poll}`. Your job is the **UI + a thin frontend API client** that drives them — do NOT rebuild the routes.
- Spec decisions are LOCKED (single "Connect" button chains install→login; providers = claude[guaranteed] + codex[may ship degraded — show "login unavailable headless" if `begin` returns no `authorizationUrl`]; step is steered-but-skippable, `done` once ≥1 provider `ready`; provider-generic/data-driven from catalog `supported`, no provider hardcoded in control flow).

## Collision notes (from the coordinator)

- **WIZARD serial lane.** You are NEXT in the wizard chain. **#369 (skip-no-dead-end) and #368 (ask-jarvis Finish-step) come AFTER you** — they also edit `apps/web/src/onboarding/onboarding-wizard.tsx`. They are NOT running yet; you currently have the wizard files to yourself. Still: **fresh `git rebase origin/main` before every push.**
- Files in scope: replace `apps/web/src/onboarding/cli-auth-step.tsx` (detect-only → provider-connect step), `onboarding-wizard.tsx` (step slot "02 Assistant"), `apps/web/src/api/client.ts` (new client methods), `packages/shared/src/onboarding-api.ts` + `assembleOnboardingStatus` (extend `steps.cliAuth` per-provider `{kind, installState, loginState}` — **keep existing host-detection fields for backward-compat**), `packages/settings/src/onboarding-routes.ts` (status assembly only — routes exist).
- **No new migration** in this spec — do not author one.
- `@jarv1s/shared` is Vite-bundled into the browser — **never** add `node:*` imports there.
- Single-active-user gate (#347): install/login are one-at-a-time; surface an inline "busy" state on a 503, don't crash the step.
