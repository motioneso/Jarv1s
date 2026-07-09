# Build Handoff — 858-sports-hardening

**Spec (approved):** NONE — **spec-exempt as tracked-debt** (Ben's call 2026-07-09; recorded in
`docs/coordination/2026-07-09-next-wave.md`). Build directly from the **issue #858 body** (small
bug-fix/hardening follow-up from #857's review — not a new feature/module). Read the issue with
`gh issue view 858` and treat its body as the requirements document.
**GitHub issue:** #858
**Risk tier:** `routine` (see `coordinate` Risk tiering.)
**Worktree:** ~/Jarv1s/.claude/worktrees/858-sports-hardening **Branch:** `build/858-sports-hardening` (off origin/main at `14d28cbc`, post-#855)
**Build skill path (absolute):** ~/Jarv1s/.claude/worktrees/858-sports-hardening/.claude/skills/coordinated-build/SKILL.md (follow this
exact file if `coordinated-build` does not resolve by name in your spawn env)
**Coordinator label:** `Coordinator` — escalate via `herdr-pane-message`; before messaging,
verify `herdr pane list` shows EXACTLY ONE pane with this label, resolved fresh each time (never
a cached `…-N` pane number — they reflow).
**Coordinator session id:** `ebeadec3-21a7-46d3-8b12-81fab81e4d0e` (immutable authority; label is only routing).
**Relay trigger:** the context-meter 70% warning, or a compaction summary in your own context →
message the coordinator, then use the `relay` skill immediately.

## Start

1. `[ -d node_modules ] || pnpm install` (worktrees share the pnpm store; relay successors skip).
2. Read issue #858 IN FULL (`gh issue view 858`) — it is the spec for this lane.
3. Invoke **`coordinated-build`** and follow it end-to-end: verify the issue's asks against your
   actual branch → plan → coordinator approval (do NOT write code before it) → TDD build →
   **`coordinated-wrap-up`** (PR + report). Escalation rules, gate commands, and caveman-mode
   comms are all defined there — this doc does not restate them.

## Run-specific bans (non-negotiable)

- Work ONLY in this worktree/branch; `git add` by explicit path — never `git add -A` or repo-wide
  `pnpm format`.
- Never touch `docs/coordination/` (coordinator-only), the project board, milestones, or merge.
- No secrets in any doc, payload, log, or prompt.

## Collision notes (from the coordinator)

- **#855 landed FIRST and restructured your target code** (PR #902, squash `14d28cbc` — your
  branch base already includes it). `packages/sports/src/sports-service.ts`'s `getOverview()`
  merge/dedup region was rewritten and split into `followed-card.ts` + `followed-groups.ts`.
  **Before planning, audit what #855 already subsumes** — it already dedups pooled `stories` by
  URL. Do NOT re-introduce id-keying or double-fix the service layer (Opus manifest-review
  condition 2). Expected remaining scope: **#858a = web-layer `key={}` fixes only** +
  **#858b = fetch timeout**.
- **#858b caution (flag for QA):** an `AbortController` deadline touches the shared datasets
  fetch path used by ALL connectors — pick a sane default that does not break long-running
  sources, and say in your plan what deadline you chose and why.
- No migrations expected in this lane; if you find you need one, STOP and escalate to the
  coordinator first (migration numbers are assigned by landing order).
