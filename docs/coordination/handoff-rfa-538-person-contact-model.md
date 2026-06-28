# Build Handoff — rfa-538-person-contact-model

**Spec (approved):** docs/superpowers/specs/2026-06-27-unified-person-contact-model.md
**GitHub issue:** #538
**Risk tier:** `security` (new module with RLS on person data, cross-module identity matching, shared module-sdk surface)
**Worktree:** ~/Jarv1s/.claude/worktrees/rfa-538-person-contact-model **Branch:** rfa-538-person-contact-model (off origin/main @ 6835a9d0)
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
   `packages/module-sdk/src/index.ts`, `packages/shared/src/email-api.ts` — confirm the person
   provider registry extension point does NOT already exist.
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

## Collision notes (from the coordinator)

- **Migration number: do NOT assume.** Use placeholder `XXXX` filename during development. Your
  expected slot is **0127** (assuming #538 is the next migration after 0126). The coordinator
  confirms before you push.
- **Parallel in-flight: #539 (rfa-539-source-backed-provenance), #540 (rfa-540-safe-automation-audit-log), #541 (rfa-541-data-freshness-visibility)**. All launched simultaneously but have disjoint primary surfaces. You own `packages/people/` (new). Do NOT touch packages/chat/, packages/ai/src/gateway/, or packages/briefings/.
- **Dependencies satisfied:** #534 (action tiers), #535 (long-running goals), #537 (commitment extraction) all merged. Verify by grepping `packages/module-sdk/src/index.ts` for `PersonProvider` — should NOT exist (gap confirmed).
- **Security invariants (mandatory):**
  - `app.people` and related tables MUST have ENABLE RLS + FORCE RLS; owner-scoped via `app.current_actor_user_id()`.
  - No cross-user person record visibility without explicit share.
  - Person identity matching runs under DataContextDb (owner-scoped). No cross-user queries.
  - Provider registry: providers may only query their own module's tables.
  - No private content (names, emails, phone numbers) in pg-boss payloads, logs, or AI prompts beyond metadata IDs.
  - Export and delete handlers required for people/identity data (RLS protects at DB; export/delete must be explicit).
- **docs/coordination/ is coordinator-only.** Do not commit to that directory.
- **Stage only your own files.** Never `git add -A` — scope `git add` to your changed paths only.
