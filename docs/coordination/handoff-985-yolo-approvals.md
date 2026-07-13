# Build Handoff — #985 true YOLO, approvals, and menus

**Spec (approved):** `docs/superpowers/specs/2026-07-12-true-yolo-approval-popover-hardening.md`
**GitHub issue:** #985
**Risk tier:** `security` umbrella; routine UI slices remain in this coordinated PR unless the plan
shows a safer split
**Worktree:** `~/Jarv1s/.claude/worktrees/ux-985-yolo-approvals`
**Branch:** `ux/985-yolo-approvals` from `origin/main` `3ca138eb`
**Build skill:** `~/Jarv1s/.claude/skills/coordinated-build/SKILL.md`
**Supervising coordinator:** label `UX Coordinator`, session
`019f5a2e-03fd-71c3-95ab-1934cb1de973`
**Final merge authority:** label `Coordinator`, session
`58a78927-385c-4b1d-8fa0-94db20255d6f`

## Start

1. Run `[ -d node_modules ] || pnpm install`.
2. Invoke `coordinated-build` and read the approved spec by the sections needed for the current
   task.
3. Ground the current flow with codebase-memory MCP before editing.
4. Produce a compact implementation plan and send it to `UX Coordinator` for approval. Do not write
   feature code before that approval.
5. Build with focused tests, then use `coordinated-wrap-up` to push and open the PR. Do not merge.

## Approved scope

- Make effective YOLO apply to the Claude-native interactive permission bridge through the existing
  resolver.
- Fail closed: resolver missing/error/non-literal-`true` uses normal confirmation and never
  auto-grants.
- Keep every authentication, authorization, RLS, allowlist, input-validation, provider-capability,
  and hard-policy boundary.
- Make approval cards compact and truthful; do not add per-card `Always approve`.
- Add the smallest dependency-free shared behavior for true menus; do not convert disclosure panels.

## Path locks

This lane owns:

- `packages/ai/src/gateway/gateway.ts`
- `packages/chat/src/mcp-transport.ts`
- `tests/integration/chat-mcp-transport.test.ts` and focused gateway/native-permission tests
- `apps/web/src/chat/action-request-card.tsx`
- shared true-menu helper and inventoried menu call sites outside `chat-drawer.tsx`

Temporarily do not edit these #984-owned paths until `UX Coordinator` releases them:

- `apps/web/src/chat/chat-drawer.tsx`
- `apps/web/src/api/client.ts`
- `apps/web/src/styles/kit-chat.css`
- chat session manager, persistence, and live routes

Work backend/native-permission, action-card markup, and non-drawer menus first. If the approved plan
needs the drawer or shared chat CSS, identify the exact hunk and wait for an explicit lock release.
The #979 fence is released, but its merged deterministic wait must remain intact.

The other Coordinator's job-search persistence fix owns infra Compose/module-data-volume paths; do
not touch Instance-modules UI or module install/run behavior.

## Non-negotiable checks

- Test literal `true`, false, missing resolver, resolver rejection/error, master-off, account revoke,
  unauthorized action, destructive action, and externally visible action paths.
- Native auto-grants say "allowed", not "executed", unless final execution is actually observed.
- YOLO never grants a provider/tool capability and never adds bypass CLI flags.
- With YOLO off or resolution failed, the normal confirmation remains visible and functional.
- True menus close on outside interaction, Escape, and single-shot selection with focus return;
  disclosures retain normal behavior.

## Run-specific bans

- Work only in this worktree/branch; stage explicit paths only. Never `git add -A` or run repo-wide
  formatting.
- Never edit `docs/coordination/`, the project board, milestones, or merge state.
- Never edit applied migrations or weaken authentication, authorization, RLS, secret handling,
  provider capability, or audit invariants.
- No secrets or private content in docs, logs, tests, jobs, or prompts.
