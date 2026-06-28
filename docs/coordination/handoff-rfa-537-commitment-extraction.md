# Build Handoff — rfa-537-commitment-extraction

**Spec (approved):** docs/superpowers/specs/2026-06-27-automatic-commitment-extraction.md
**GitHub issue:** #537
**Risk tier:** `security` (AI-processed source content, job payload constraints, #534 action tiers, RLS on new module, cross-module source reads)
**Worktree:** ~/Jarv1s/.claude/worktrees/rfa-537-commitment-extraction **Branch:** rfa-537-commitment-extraction (off origin/main @ d9b798c5)
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
   YOUR branch and confirm the gap/state it describes is still real. If any item's premise has
   already shipped or drifted, **escalate to the coordinator** with the drift + your re-scoped
   plan before proceeding. Don't silently absorb stale premises into your plan.
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

## Collision notes (from the coordinator)

- **Migration number: do NOT assume.** Use placeholder `XXXX` filename during development. Your
  expected slot is **0125**. The coordinator confirms before you push. Check `origin/main` at rebase
  time to confirm 0125 is still free.
- **Parallel in-flight: #557 (rfa-557-calendar-delete)** — that branch owns `packages/calendar/`
  only. Your new `packages/commitments/` is isolated from it. No shared migration files — use
  separate SQL files.
- **Dependencies on merged PRs** (#527–#536 per spec header) — all landed on `origin/main` as of
  `d9b798c5`. Verify by grepping the cited seams: `packages/jobs/src/pg-boss.ts` (metadata-only
  payload guard), `ModuleAssistantToolManifest` (tool risk/executionPolicy), `packages/tasks/`
  (Task write pattern), action permission tiers (`#534`). If any cited seam is missing, escalate.
- **AI safety invariants (mandatory)**:
  - Extraction jobs carry metadata only in pg-boss payload (sourceId, actorUserId, kind, idempotency
    key). Source text is loaded from DB under DataContextDb at run time — never stored in the payload.
  - Bounded evidence snippets in the `commitment_candidates` table must be capped and sanitized
    before storage (spec §7 — injection risk: LLM-processed content stored alongside private data).
  - Commitment candidates are owner-scoped via RLS on the new `app.commitment_candidates` table.
    No cross-user visibility without explicit share.
  - Any tool that routes an accepted candidate to task/goal/calendar/email executes through #534
    action permission tiers — never as a side effect.
- **docs/coordination/ is coordinator-only.** Do not commit to that directory.
- **Stage only your own files.** Never `git add -A` — scope `git add` to your changed paths only.
