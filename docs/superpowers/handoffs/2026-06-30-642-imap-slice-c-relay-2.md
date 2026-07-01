# Relay handoff #2 — #642 imap-slice-c

**Issue:** #642. **Spec:** `docs/superpowers/specs/2026-06-30-proton-mail-connector-spike-output.md` §7a
**Risk tier:** security. **Worktree/branch:** this worktree, `coord/642-imap-slice-c` (continue in
place — do not create a new worktree).
**Coordinator label:** `Coordinator` (confirm via `herdr pane list` before messaging — exactly
one pane should hold that label; resolve pane_id fresh each time, never reuse a cached one).

## State: plan APPROVED by Coordinator. Task 1 of 11 done and committed (cd2384a8).

Plan: `docs/superpowers/plans/2026-06-30-imap-slice-c.md` — read IN FULL, it is the source of
truth for all 11 tasks (exact files, exact code, exact test commands). Do not re-derive it.

## What's done

- Task 1 (`upsertImapAccount` persists real `default_scopes`): implemented, test green, committed
  as `cd2384a8`.

## What's next

- Resume at **Task 2** (recognize IMAP `email.read` scope in `feature-grants.ts`) through
  **Task 11**, in order, via `superpowers:test-driven-development`, driven yourself (execution
  skills disabled in this repo).
- **Test invocation gotcha found this segment:** `pnpm --filter @jarv1s/connectors exec vitest run
../../tests/...` (as written in the plan) does NOT work — no test files found. Use the root
  vitest config instead: `pnpm vitest run tests/integration/connectors-imap.test.ts -t "<name>"`
  (or `tests/unit/...` for unit tests). Root `vitest.config.ts` has all the `@jarv1s/*` aliases.
- **Migration number caveat (Task 3):** re-run
  `find . -path "*/sql/*.sql" | grep -oE '[0-9]{4}_' | sort -n | tail -3` immediately before
  creating `packages/email/sql/0132_email_imap_insert.sql` — max was `0131` as of last check, may
  have moved.
- Commit each task's own files only (no `git add -A`).

## Process reminders

- Coordinator already approved the plan — do NOT re-escalate for plan approval, just build.
- Escalate to Coordinator only for genuine blockers/forks — not routine progress.
- Self-monitor context; relay again at ~80–100k tokens or immediately on a compaction summary.
- Pre-push trio (`pnpm format:check && pnpm lint && pnpm typecheck` + rebase on `origin/main`)
  before every push; close out via `coordinated-wrap-up` (PR + report only — never merge/board).
- Do not touch `docs/coordination/` (coordinator-only).
