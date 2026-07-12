# Build Handoff — 2026-07-08-herdr-install-and-attach-hint

**Spec (approved):** docs/superpowers/specs/2026-07-08-herdr-install-and-attach-hint.md
**GitHub issue:** #866
**Risk tier:** `routine` merge gate, but **upgraded QA rigor** — Opus 4.8's manifest review
(2026-07-09) flagged this spec as a privilege-boundary decision (no web-triggered install/exec,
config-power-only) plus a supply-chain surface (pinned-checksum binary fetch). Your PR still
auto-merges after green QA (not gated on Ben sign-off), but the QA agent will run
`/security-review` in addition to `/code-review` — build to that bar: no install/exec HTTP route,
no `curl|sh`, per-arch checksums pinned and verified. If your implementation needs a route or
endpoint the spec doesn't call for, STOP and escalate — do not build around the spec's explicit
"no web API install route" non-goal.
**Worktree:** /home/ben/Jarv1s/.claude/worktrees/866-herdr-install **Branch:** `build/866-herdr-install` (off `origin/main` @ `33270eef`)
**Build skill path (absolute):** /home/ben/Jarv1s/.claude/skills/coordinated-build/SKILL.md (follow this
exact file if `coordinated-build` does not resolve by name in your spawn env)
**Coordinator label:** `Coordinator` — escalate via `herdr-pane-message`; before messaging,
verify `herdr pane list` shows EXACTLY ONE pane with this label, resolved fresh each time (never
a cached `…-N` pane number — they reflow).
**Coordinator session id:** `dd8b3920-6924-4eaf-b2bf-4120f187c7a3` (immutable authority; label is only routing).
**Relay trigger:** the context-meter 70% warning, or a compaction summary in your own context →
message the coordinator, then use the `relay` skill immediately.

## Start

1. `[ -d node_modules ] || pnpm install` (worktrees share the pnpm store; relay successors skip).
2. Read the spec above IN FULL.
3. Invoke **`coordinated-build`** and follow it end-to-end: verify the spec against your actual
   branch → plan → coordinator approval (do NOT write code before it) → TDD build →
   **`coordinated-wrap-up`** (PR + report). Escalation rules, gate commands, and caveman-mode
   comms are all defined there — this doc does not restate them.

## Run-specific bans (non-negotiable)

- Work ONLY in this worktree/branch; `git add` by explicit path — never `git add -A` or repo-wide
  `pnpm format`.
- Never touch `docs/coordination/` (coordinator-only), the project board, milestones, or merge.
- No secrets in any doc, payload, log, or prompt.

## Collision notes (from the coordinator)

- **No collision.** #866 is fully isolated per Opus's grounded collision map: your files
  (`packages/settings/*`, `packages/ai/src/adapters/multiplexer-resolve.ts`,
  `packages/module-registry/src/chat-multiplexer.ts`, `infra/docker-compose.prod.yml`) don't
  overlap with the sports work (#855/#858) happening in sibling worktrees this wave. Parallel-safe
  — build and PR whenever ready, no need to wait on the others.
- **Script/command consistency condition (Opus review):** if the UI surfaces a copy/paste command
  like `docker compose exec jarv1s /app/scripts/install-herdr.sh`, that script MUST ship in this
  same PR (with pinned per-arch SHA-256 checksums) — do not render a command pointing at a path
  that doesn't exist yet.
