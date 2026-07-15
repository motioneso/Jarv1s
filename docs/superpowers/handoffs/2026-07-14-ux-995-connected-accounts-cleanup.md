# Build Handoff — UX #995 Connected Accounts Cleanup

**Spec (approved):** `docs/superpowers/specs/2026-07-14-connected-accounts-cleanup.md`  
**GitHub issue:** #995  
**Risk tier:** `security` — the existing UI accepts connector credentials; this PR requires
adversarial Opus QA, durable PR evidence, and Ben's explicit merge sign-off.  
**Worktree:** `~/Jarv1s/.claude/worktrees/ux-995-connected-accounts-cleanup`  
**Branch:** `ux/995-connected-accounts-cleanup` off `origin/main` at `2c841e54`  
**Build skill:** `~/Jarv1s/.claude/skills/coordinated-build/SKILL.md`  
**Coordinator label:** `UX Coordinator` — resolve fresh by exact label plus immutable session before
every message; never use a cached pane number. The separate label `Coordinator` is a different fleet
and is out of scope.  
**Coordinator session id:** `019f6226-78b2-7c31-9a84-f01d3c85eb0c`  
**Relay trigger:** context-meter 70% warning or any compaction summary → message `UX Coordinator`,
then invoke `relay` immediately.

## Start

1. `[ -d node_modules ] || pnpm install`.
2. Read the approved spec by section for the current task; do not load unrelated specs.
3. Invoke `coordinated-build`: verify scope against the actual branch, write a minimal TDD plan, and
   send only the plan pointer to `UX Coordinator` for approval. Do not edit product code before plan
   approval.
4. After approval, build with TDD and finish through `coordinated-wrap-up` (push, PR, concise evidence).

## Run-specific bans

- Work only in this worktree/branch. Stage explicit paths; never `git add -A` or run repo-wide format.
- Never touch `docs/coordination/`, the project board, milestones, issue state, or merge controls.
- Never expose connector passwords, tokens, raw provider errors, or other secrets in output, logs,
  screenshots, tests, payloads, exports, prompts, or docs.
- Do not add a connector framework, provider backend, OAuth flow, credential shape, migration, or API
  contract. If existing APIs cannot satisfy the approved UI, stop and escalate before widening scope.

## Collision and simplification notes

- #995 is serialized before #993. Do not touch #993's host/account/diagnostics/operator settings scope.
- The parked `UX 991 Build Luna` lane is separate; avoid unrelated assistant-priority settings files.
- Reuse the existing generic IMAP APIs/presets and shared `getConnectorAccountHealth` classifier.
  Fix shared behavior once; do not duplicate onboarding's provider definitions or secret handling.
- Delete the dead Apple/`Other (OAuth)` behavior. Keep legitimate tracked `Coming soon` commitments.
- Existing settings primitives and design tokens only; no dependency, abstraction, or redesign.
