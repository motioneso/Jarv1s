# Build Handoff — rfa-557-calendar-delete

**Spec (approved):** docs/superpowers/specs/2026-06-28-calendar-delete-tool.md
**GitHub issue:** #557
**Risk tier:** `security` (write/destructive external action — always-confirm, connector credentials, RLS)
**Worktree:** ~/Jarv1s/.claude/worktrees/rfa-557-calendar-delete **Branch:** rfa-557-calendar-delete (off origin/main @ d9b798c5)
**Build skill path (absolute):** ~/Jarv1s/.claude/skills/coordinated-build/SKILL.md
**Coordinator label:** `Coordinator` (UNIQUE — escalate via `herdr-pane-message`; before messaging, verify `herdr pane list` shows EXACTLY ONE pane with this label. Never guess or reuse a `…-N` pane-id — they reflow when any pane opens/closes; re-resolve the live pane by label from `herdr pane list` each time.)
**Coordinator session id:** `5e1a6b62-a480-4b5c-9706-e476cfe77044` (immutable authority — label is routing, number is ephemeral)
**Relay threshold:** countable events — ~80–100k tokens OR a compaction summary in your own context (then relay immediately).

## Start

1. **Resolve your skills.** Confirm you can invoke `coordinated-build` by name; if not, open the
   absolute **Build skill path** above and follow it directly.
2. `pnpm install` — but **only if `node_modules` is missing** (`[ -d node_modules ] || pnpm install`).
3. Read the spec above IN FULL.
4. **Verify the spec against the actual branch BEFORE planning.** Specs go stale — related work
   lands between spec-authoring and your build. For each spec item, grep/read the cited files on
   YOUR branch and confirm the gap/state it describes is still real. Specifically check:
   `packages/calendar/src/tools.ts`, `packages/calendar/src/manifest.ts`,
   `packages/calendar/src/calendar-write-service.ts` — confirm `calendar.deleteEvent` does NOT
   already exist, and that the `calendar_management` action family is not yet locked.
   If any item's premise has already shipped, escalate to the coordinator.
5. Invoke the **`coordinated-build`** skill and follow it: write the plan → escalate it to the
   coordinator for approval → on approval, build TDD/green → run the pre-push trio
   (`pnpm format:check && pnpm lint && pnpm typecheck`) + fresh rebase before every push → close out
   with **`coordinated-wrap-up`** (PR + report to the coordinator).

## Your compact (non-negotiable)

- **CI gate:** run `pnpm format:check && pnpm lint && pnpm typecheck` + the relevant vitest files
  locally and record exit codes in your wrap-up report; CI also runs on the PR via `gh pr checks`.
- Work **only** in this worktree/branch. Commit green per task; `git add` only that task's files
  (`Co-Authored-By: Claude`).
- Plan approval comes from the **coordinator**, not a human gate. Do not write code before it.
- **Escalate to coordinator label `Coordinator`** the moment you hit: a blocker, a plan ready for
  approval, a design fork outside this spec, a review request, or done.
- **Never touch** the project board, milestones, or merge — those are the coordinator's.
- **Self-monitor your context on countable events**, not a felt %. At ~80–100k tokens, or the
  moment you see a compaction summary in your own context: message the coordinator, then use the
  **`relay`** skill — write a continuation handoff, `herdr-handoff` your successor, and let the
  coordinator reap you.
- Honor every CLAUDE.md Hard Invariant. No secrets in any doc, payload, log, or prompt.
- **Caveman mode** for all status/escalations to the coordinator (terse, no filler, full technical
  accuracy — saves tokens). Commit messages, PR bodies, and code stay normal/conventional.

## Security invariants — MANDATORY (belt-and-suspenders for this tier)

- `calendar.deleteEvent` MUST declare `risk: "write"` and must NOT declare `executionPolicy: "auto"`.
- The `calendar_management` action family MUST be locked to `allowedTiers: ["always_confirm"]` — no
  code path may bypass the confirmation prompt.
- All data access MUST use `DataContextDb` (owner-scoped). No cross-user event access.
- Connector credentials (Google OAuth token) come from the vault-backed connector secret ONLY.
  They must never appear in API responses, logs, job payloads, or AI prompts.
- The Google event ID must be resolved from our internal event record (fetched under DataContextDb)
  — never accepted directly from the AI prompt as untrusted input.
- After Google deletion, the local cache row is best-effort removed (failure is non-fatal, logged
  only at debug — not exposed to the user).
- Migration (if any): add ONLY the RLS policy / action family lock. Never edit applied migrations.

## Collision notes (from the coordinator)

- **Migration number: do NOT assume.** Use placeholder `XXXX` filename during development. Your
  expected slot is **0126** (assuming #537 commits its 0125 first). The coordinator confirms before
  you push. If #537 hasn't merged yet at your push time, escalate to confirm ordering.
- **Parallel in-flight: #537 (rfa-537-commitment-extraction)** — that branch owns the new
  `packages/commitments/` package. You own `packages/calendar/` only. No shared files between
  the two — no collision expected, but do not touch commitments package.
- **Depends on #534 (action permission tiers)** — verify `always_confirm` tier and
  `ModuleAssistantToolManifest` risk fields exist on `origin/main @ d9b798c5` before building.
  If missing, escalate immediately.
- **docs/coordination/ is coordinator-only.** Do not commit to that directory.
- **Stage only your own files.** Never `git add -A` — scope `git add` to your changed paths only.
