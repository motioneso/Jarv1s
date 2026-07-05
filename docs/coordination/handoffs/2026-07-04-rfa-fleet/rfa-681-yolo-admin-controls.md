# Build Handoff - rfa-681-yolo-admin-controls

**Spec (approved):** `docs/superpowers/specs/2026-07-04-yolo-admin-controls-move.md`
**GitHub issue:** #681
**Risk tier:** `security`
**Worktree:** `~/Jarv1s/.claude/worktrees/coord-2026-06-30-rfa-fleet/.claude/worktrees/rfa-681-yolo-admin-controls`
**Branch:** `rfa-681-yolo-admin-controls`
**Coordinator label:** `Coordinator`
**Coordinator session id:** `019f2b95-774b-7541-870d-eadfd431af47`

## Start

1. `[ -d node_modules ] || pnpm install`.
2. Read this handoff and the spec in full.
3. Invoke/follow `coordinated-build`; if the skill is unavailable, follow the same lifecycle:
   inspect current code, write a short plan, send it to `Coordinator`, wait for approval, then build.
4. Before coding, verify the existing YOLO routes/client calls still support the requested UI.

## Scope

- Move admin YOLO controls from Admin > People & access to Admin / Setup > Assistant & AI.
- Keep current backend policy and existing endpoint behavior unless proven insufficient.
- Keep "Allow all current members".
- Replace the full per-user toggle wall with active-member search/add plus compact remove controls.

## Collision Limits

- Stay in admin AI/settings YOLO UI and existing YOLO client calls.
- No new action execution semantics.
- Do not touch Email, Calendar, Chat, notifications, or `docs/coordination/`.
- Do not run broad repo formatting or `git add -A`.

## Security Bar

- Preserve existing confirmations for enabling broad auto-approval.
- Do not weaken admin checks or expose private user data beyond existing admin settings responses.
- Report any required backend/policy change to `Coordinator` before implementing it.

## Done

- Local focused checks plus `pnpm format:check && pnpm lint && pnpm typecheck`.
- Push branch, open PR for #681, report PR + evidence to `Coordinator`.
- PR needs alternate-model review by Codex and Ben sign-off after security QA.
