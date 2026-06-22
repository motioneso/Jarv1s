# Build Handoff — feat-250-quiet-hours

**Spec (approved):** docs/superpowers/specs/2026-06-22-quiet-hours-notification-deferral.md
**GitHub issue:** #250
**Risk tier:** `sensitive` (new per-user RLS owner-only settings + notification delivery logic; no auth/crypto/secret boundary → not `security`)
**Worktree:** /home/ben/Jarv1s/.claude/worktrees/feat-250-quiet-hours **Branch:** feat-250-quiet-hours (off origin/main `201c692`)
**Build skill path (absolute):** /home/ben/Jarv1s/.claude/skills/coordinated-build/SKILL.md (use this exact path if `coordinated-build` does not resolve by name in your spawn env)
**Coordinator label:** `Coordinator` (UNIQUE — escalate via `herdr-pane-message`; before messaging, verify `herdr pane list` shows EXACTLY ONE pane with this label. Never guess or reuse a `…-N` pane-id — they reflow; re-resolve by label each time.)
**Coordinator session id:** `26b3c985-26c5-418f-bb2d-ceb338e318eb` (immutable authority — label is routing, the `…-N` number is ephemeral. Confirm this session id is still live before relying on the coordinator.)
**Relay threshold:** observable, not felt — `herdr pane read "$HERDR_PANE_ID" --source visible --lines 5` on your OWN pane and relay when its context/usage indicator shows ~⅔–¾ consumed, OR after plan-approval + ~5–8 committed tasks, OR immediately on a compaction summary in your own context.

## Start

1. **Resolve your skills.** Confirm you can invoke `coordinated-build` by name; if not, open the absolute **Build skill path** above and follow it directly.
2. `pnpm install` — but **only if `node_modules` is missing** (`[ -d node_modules ] || pnpm install`). Worktrees share the pnpm store.
3. Read the spec above IN FULL.
4. Invoke the **`coordinated-build`** skill and follow it: write the plan → escalate it to the coordinator for approval → on approval, build TDD/green → run the pre-push trio (`pnpm format:check && pnpm lint && pnpm typecheck`) + fresh rebase before every push → close out with **`coordinated-wrap-up`** (PR + report to the coordinator).

## Your compact (non-negotiable)

- Work **only** in this worktree/branch. Commit green per task; `git add` only that task's files (`Co-Authored-By: Claude Sonnet 4.6` — match your real model).
- Plan approval comes from the **coordinator**, not a human gate. Do not write code before it.
- **Escalate to coordinator label `Coordinator`** the moment you hit: a blocker, a plan ready for approval, a design fork outside this spec, a review request, or done.
- **Never touch** the project board, milestones, or merge — those are the coordinator's.
- **Self-monitor your context by reading your OWN pane**, not a felt %. Relay (via the `relay` skill) before you degrade.
- Honor every CLAUDE.md Hard Invariant. No secrets in any doc, payload, log, or prompt.
- **Caveman mode** for all status/escalations to the coordinator. Commit messages, PR bodies, and code stay normal/conventional.

## Build Brief (coordinator-distilled — grounded on `201c692`)

Head start, not a verdict — verify load-bearing claims against the tree; if the brief contradicts the tree, the tree wins, flag it to the coordinator.

- **Reuse (don't rebuild):**
  - **Settings GET/PUT belongs in `packages/settings/`** — it already holds per-user setting routes (`preferences-port.ts`, `locale-routes.ts`, `persona-routes.ts`, `onboarding-routes.ts`). Add a `quiet-hours-routes.ts` following the existing route+port shape; do NOT invent a new module.
  - **Notification urgency + deferral lives in `packages/notifications/`** — extend the notification-creation path there (find the create DTO / repository; CreateNotificationDto may live in `packages/shared`). Add `urgency: 'urgent' | 'normal' | 'low'` (default `normal`); only `normal`/`low` are deferrable.
  - Canonical route shape `packages/tasks/src/routes.ts`; canonical data-context `packages/db/src/data-context.ts`. Repositories accept only `DataContextDb`.
- **Landmines:**
  - **Spec's "Migration 0098" is STALE.** Current max migration on `main` is **0104**. Use **0105** for your first migration (and **0106** if you genuinely need a second — spec reserved two; prefer one if a single jsonb column/table suffices). **Never reuse 0098.**
  - **`tests/integration/foundation.test.ts` asserts the FULL migration list with `toEqual`.** Add a row for EVERY migration you create, in order, or it breaks latently (a focused module test won't catch it). Run the full `pnpm test:integration` before declaring green.
  - **No `user_preferences` table exists** — the spec's "ALTER TABLE user_preferences ADD COLUMN" path is not available. Create a minimal owner-only `user_quiet_hours` table (`user_id PK FK, settings jsonb, updated_at`) OR add to the settings module's existing per-user store if one fits — your call (escalate `[DESIGN-FORK]` only if a constraint forces a non-obvious shape).
  - **Use an isolated DB.** Set a per-agent `JARVIS_PGDATABASE` (e.g. `jarvis_build_250`) before `pnpm db:migrate`/tests — concurrent suites on the shared instance can crash it. `pnpm db:up` if Postgres isn't running.
- **Security focus (this slice):**
  - New quiet-hours settings table/column is **owner-only RLS** (private-by-default Hard Invariant). FORCE RLS, owner-only policy keyed on `actorUserId`. No cross-user read.
  - If deferred notifications use a pg-boss job to release at quiet-hours end, **metadata-only payload** (actor/resource IDs + kind only — never notification body/content).
- **Decided — do not re-litigate:** Settings live in `packages/settings/`; urgency/deferral in `packages/notifications/`. `urgent` always fires; `normal`/`low` defer during active quiet hours and release at window end. These are spec-locked.
- **Open for you to decide:** Exact storage shape (dedicated `user_quiet_hours` table vs. extending an existing settings store) and the deferral-release mechanism (delivery-tick query vs. pg-boss scheduled job) — pick the smallest fit; escalate `[DESIGN-FORK]` only if you hit a real constraint.
- **Collision notes:** SERIAL wave — you are the only active build; no concurrent migration contention. Your migration lands at 0105+. Don't assume a number beyond what's stated here; if you need more than 0105/0106, message the coordinator.
