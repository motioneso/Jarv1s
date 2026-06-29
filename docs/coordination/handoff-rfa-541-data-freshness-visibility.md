# Build Handoff — rfa-541-data-freshness-visibility

**Spec (approved):** docs/superpowers/specs/2026-06-28-data-freshness-visibility.md
**GitHub issue:** #541
**Risk tier:** `routine` (UI + metadata enrichment; no new tables, no RLS changes, no auth surface)
**Worktree:** ~/Jarv1s/.claude/worktrees/rfa-541-data-freshness-visibility **Branch:** rfa-541-data-freshness-visibility (off origin/main @ 6835a9d0)
**Build skill path (absolute):** ~/Jarv1s/.claude/skills/coordinated-build/SKILL.md
**Coordinator label:** `Coordinator` (UNIQUE — escalate via `herdr-pane-message`; before messaging, verify `herdr pane list` shows EXACTLY ONE pane with this label. Never guess or reuse a `…-N` pane-id — they reflow when any pane opens/closes; re-resolve the live pane by label from `herdr pane list` each time.)
**Coordinator session id:** `5e1a6b62-a480-4b5c-9706-e476cfe77044` (immutable authority — label is routing, number is ephemeral)
**Relay threshold:** countable events — ~80–100k tokens OR a compaction summary in your own context (then relay immediately).

## Start

1. **Resolve your skills.** Confirm you can invoke `coordinated-build` by name; if not, open the
   absolute **Build skill path** above and follow it directly.
2. `pnpm install` — but **only if `node_modules` is missing** (`[ -d node_modules ] || pnpm install`).
3. Read the spec above IN FULL.
4. **Verify the spec against the actual branch BEFORE planning.** Check:
   `packages/briefings/src/compose.ts`, `packages/shared/src/briefings-api.ts`,
   `packages/shared/src/chat-api.ts` — confirm no freshness/staleness fields exist yet.
   If already shipped, escalate.
5. Invoke the **`coordinated-build`** skill and follow it.

## Your compact (non-negotiable)

- **CI gate:** run `pnpm format:check && pnpm lint && pnpm typecheck` + relevant vitest files.
- Work **only** in this worktree/branch. Commit green per task; explicit `git add` paths only.
- Plan approval from coordinator before code. Escalate blockers/forks/done.
- **Never touch** the project board, milestones, or merge.
- **Self-monitor context** — relay at ~80–100k tokens or on compaction summary.
- Honor CLAUDE.md Hard Invariants. No secrets in payloads/logs/prompts.
- **Caveman mode** for coordinator escalations.

## Collision notes (from the coordinator)

- **Migration number:** No migration expected per spec (no new tables). If a migration IS needed,
  use placeholder `XXXX` and escalate for a slot.
- **Parallel in-flight: #538, #539, #540.** You share `packages/shared/src/chat-api.ts` and
  `packages/chat/src/live/types.ts` with **#539 (rfa-539-source-backed-provenance)**. That branch
  adds provenance fields; you add freshness/staleness fields. These are DIFFERENT additions — use
  disjoint field names (e.g. `sourceFreshness` or `freshnessWarning`, NOT `provenance` or
  `sources`). The second branch to merge will need a clean rebase. Limit to packages/briefings/,
  packages/shared/src/briefings-api.ts, packages/shared/src/chat-api.ts,
  packages/chat/src/live/types.ts, packages/connectors/src/repository.ts (read-only).
- **Routine invariants:**
  - Freshness data is **derived from existing connector sync timestamps** — never by querying
    connector internal tables directly from packages/briefings or packages/chat.
  - `ChatMessageDto` and `BriefingsDto` changes must be additive (optional fields).
  - No new authentication or authorization surface.
  - No private content in freshness fields — only timestamps, source labels, and staleness flags.
- **docs/coordination/ is coordinator-only.** Do not commit to that directory.
- **Stage only your own files.** Never `git add -A`.
