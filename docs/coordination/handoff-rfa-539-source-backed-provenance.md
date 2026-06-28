# Build Handoff — rfa-539-source-backed-provenance

**Spec (approved):** docs/superpowers/specs/2026-06-28-source-backed-answers-provenance.md
**GitHub issue:** #539
**Risk tier:** `sensitive` (ChatMessageDto contract change, cross-module read at chat runtime, provenance metadata in responses)
**Worktree:** ~/Jarv1s/.claude/worktrees/rfa-539-source-backed-provenance **Branch:** rfa-539-source-backed-provenance (off origin/main @ 6835a9d0)
**Build skill path (absolute):** ~/Jarv1s/.claude/skills/coordinated-build/SKILL.md
**Coordinator label:** `Coordinator` (UNIQUE — escalate via `herdr-pane-message`; before messaging, verify `herdr pane list` shows EXACTLY ONE pane with this label. Never guess or reuse a `…-N` pane-id — they reflow when any pane opens/closes; re-resolve the live pane by label from `herdr pane list` each time.)
**Coordinator session id:** `5e1a6b62-a480-4b5c-9706-e476cfe77044` (immutable authority — label is routing, number is ephemeral)
**Relay threshold:** countable events — ~80–100k tokens OR a compaction summary in your own context (then relay immediately).

## Start

1. **Resolve your skills.** Confirm you can invoke `coordinated-build` by name; if not, open the
   absolute **Build skill path** above and follow it directly.
2. `pnpm install` — but **only if `node_modules` is missing** (`[ -d node_modules ] || pnpm install`).
3. Read the spec above IN FULL.
4. **Verify the spec against the actual branch BEFORE planning.** Specs go stale. Check:
   `packages/chat/src/live/chat-session-manager.ts`, `packages/chat/src/live/recall-seed.ts`,
   `packages/shared/src/chat-api.ts` — confirm `ChatMessageDto` does NOT already have a
   provenance/sources field. If already shipped, escalate.
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

- **Migration number:** Provenance is metadata-only (no new tables per spec). If a migration IS
  needed, use placeholder `XXXX` and escalate to coordinator for a slot. Expected: no migration.
- **Parallel in-flight: #538, #540, #541.** You share `packages/shared/src/chat-api.ts` with **#541
  (rfa-541-data-freshness-visibility)**. That branch adds freshness fields; you add provenance
  fields. These are DIFFERENT additions — use disjoint field names. Do NOT touch
  packages/people/, packages/ai/src/gateway/, or packages/briefings/. Limit to
  packages/chat/src/live/ and packages/shared/src/chat-api.ts.
- **Sensitive invariants (mandatory):**
  - Provenance items are **metadata only** (source kind, timestamp, item ID, display label). Never
    include raw source text, titles, or any private content in the provenance payload.
  - Provenance is **derived before and independent of the AI prompt** — the AI model never selects
    or filters provenance items.
  - `ChatMessageDto` change must be additive (optional field) — do not break existing clients.
  - No cross-module internal imports: packages/chat must not import from packages/memory internals
    or packages/notes internals — only through public APIs.
- **docs/coordination/ is coordinator-only.** Do not commit to that directory.
- **Stage only your own files.** Never `git add -A`.
