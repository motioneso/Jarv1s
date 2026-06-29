# Build Handoff — rfa-531-proactive-monitoring

**Spec (approved):** docs/superpowers/specs/2026-06-27-restrained-proactive-monitoring.md
**GitHub issue:** #531
**Risk tier:** `security`
**Worktree:** ~/Jarv1s/.claude/worktrees/rfa-531-proactive-monitoring **Branch:** rfa-531-proactive-monitoring (stacked on rfa-527-usefulness-feedback @ 1c36c6e3)
**PR base:** Set PR base to `rfa-527-usefulness-feedback` until #527 merges; rebase onto `origin/main` before final push once #527 lands.
**Build skill path (absolute):** ~/Jarv1s/.claude/skills/coordinated-build/SKILL.md
**Coordinator label:** `Coordinator` (UNIQUE — escalate via `herdr-pane-message`; before messaging, verify `herdr pane list` shows EXACTLY ONE pane with this label. Re-resolve by label each time — never reuse a pane_id.)
**Coordinator session id:** `6502bd00-7c52-4e73-9ed5-d95a42f54dd8` (immutable authority.)
**Relay threshold:** countable events — ~80–100k tokens OR a compaction summary in your own context (relay immediately on compaction).

## Start

1. **Resolve your skills.** Confirm you can invoke `coordinated-build` by name; if not, open the absolute Build skill path above and follow it directly.
2. `[ -d node_modules ] || pnpm install` — skip if node_modules exists (worktrees share pnpm store).
3. Read the spec above IN FULL.
4. **Verify the spec against the actual branch BEFORE planning.** This branch contains #527 (usefulness-feedback-signals) which you depend on — confirm the module and its APIs are present. Also verify #526 (unified-priority-model, merged to main) seams are available. Escalate any drift to the coordinator before proceeding.
5. Invoke the **`coordinated-build`** skill and follow it: write the plan → escalate to coordinator for approval → on approval, build TDD/green → run pre-push trio + fresh rebase before every push → close out with **`coordinated-wrap-up`**.

## Your compact (non-negotiable)

- **CI gate:** run `pnpm format:check && pnpm lint && pnpm typecheck` + relevant vitest files locally; record exit codes in wrap-up report. Use `JARVIS_PGDATABASE=jarvis_build_rfa_531_proactive` for integration tests.
- Work **only** in this worktree/branch. Commit green per task; `git add` only that task's files. Co-Authored-By: Claude.
- Plan approval comes from the **coordinator**, not a human. Do not write code before approval.
- **Escalate to coordinator** the moment you hit: a blocker, plan ready for approval, design fork outside this spec, done. Security tier = prefix escalations with `[SECURITY]`.
- **Never touch** the project board, milestones, merges, or `docs/coordination/`.
- **Self-monitor your context** on countable events. At ~80–100k tokens or on compaction summary: use the `relay` skill.
- Honor every CLAUDE.md Hard Invariant. No secrets in any doc, payload, log, or prompt.
- **Caveman mode** for all status/escalations to the coordinator.

## Security requirements (tier = security)

- This PR gets cross-model (Opus) adversarial QA before merge. Build to that bar.
- All proactive monitoring checks must be owner-scoped via `DataContextDb` — no cross-user data access.
- `app.preferences` writes: reject unknown fields; validate all scheduler params server-side (interval floor, max checks, hard limits).
- pg-boss job payloads: actor/resource IDs and schedule config only — no content, no prompts, no secrets.
- Monitoring triggers must never surface private content in notifications or logs.
- Rate-limit: a hard cap on monitoring frequency per user (not just a preference default) must be enforced server-side.

## Collision notes (from the coordinator)

- **#527 (usefulness-feedback) is your immediate predecessor** — its code is on this branch. Do not modify the `usefulness_feedback` table, its routes, or its module APIs. You consume its outputs (usefulness signals) but do not alter them.
- **#525 (cross-tool-reasoning) is building in parallel** — touches cross-source module manifests/read providers. If you need to register a new read provider or module manifest entry, coordinate via the coordinator; do not blindly add to the manifest registry at the same time as #525.
- **#533 (memory-dashboard) is building in parallel** — touches memory package APIs. Do not modify memory_records schema or MemoryRepository APIs.
- **#534 (action-permission-tiers) merged** — use its `buildActionPolicy` and canonical permission tier APIs; do not add a parallel permission mechanism.
- **Migration slot:** If this spec requires a schema migration, do NOT assume a migration number. Escalate to the coordinator before writing the SQL file. Claimed slots: 0120 (#527, unmerged), 0121 (#532, merged). Next is 0122 but assignment is coordinator-controlled by merge order.
- **`app.preferences` and settings routes:** #526 (priority-model) and #534 (action-tiers) already landed in the settings router. Extend the existing pattern; do not re-architect the settings route structure.
- No `git add -A`; stage only your own changed paths.
