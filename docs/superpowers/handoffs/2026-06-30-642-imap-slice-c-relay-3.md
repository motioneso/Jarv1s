# Relay handoff #3 — #642 imap-slice-c

**Issue:** #642. **Spec:** `docs/superpowers/specs/2026-06-30-proton-mail-connector-spike-output.md` §7a
**Risk tier:** security. **Worktree/branch:** this worktree, `coord/642-imap-slice-c` (continue in
place — do not create a new worktree).
**Coordinator label:** `Coordinator` (confirm via `herdr pane list` before messaging — exactly
one pane should hold that label; resolve pane_id fresh each time, never reuse a cached one).

## State: plan APPROVED by Coordinator. Tasks 1-4 of 11 done and committed.

Plan: `docs/superpowers/plans/2026-06-30-imap-slice-c.md` — read IN FULL, it is the source of
truth for all 11 tasks (exact files, exact code, exact test commands). Do not re-derive it.

## What's done

- Task 1 (`upsertImapAccount` persists real `default_scopes`): `cd2384a8`.
- Task 2 (recognize IMAP `email.read` scope in `feature-grants.ts`): `7e91a17b`.
- Task 3 (RLS migration `0132_email_imap_insert.sql`, widen `email_messages_insert` policy for
  `provider_type='imap'` + `email.read` scope): `ac1e025d`. Also updated
  `tests/integration/foundation.test.ts`'s full migration-list `toEqual` assertion with the new
  `0132` row — **do this again for every future migration task, or foundation.test.ts breaks
  latently** (confirmed trap, see CLAUDE.md Test Traps memory).
- Task 4 (`imap-message-key.ts` encode/decode `folder:uidValidity:uid`): `79669c6e`.

## What's next

- Resume at **Task 5** (widen `EmailReadProvider` to a generic credential type) through
  **Task 11**, in order, via `superpowers:test-driven-development`, driven yourself (execution
  skills disabled in this repo).
- **Test invocation:** use root vitest, not `pnpm --filter`: `pnpm vitest run
tests/integration/connectors-imap.test.ts -t "<name>"` (or `tests/unit/...`). Root
  `vitest.config.ts` has all the `@jarv1s/*` aliases.
- **`tests/integration/connectors-imap.test.ts` actual pattern** (differs slightly from the
  plan's inline snippets): no shared `accessContext` variable — each call passes
  `{ actorUserId: ids.userA, requestId: "req:<unique>" }` inline to `dataContext.withDataContext`.
  Follow that convention, not the plan's literal snippet, when adding Task 7's test.
- **Migration numbers:** re-run `find . -path "*/sql/*.sql" | grep -oE '[0-9]{4}_' | sort -n |
tail -3` immediately before creating any new migration file — 0132 is now applied/committed,
  next would be 0133 if another task needs one (none of tasks 5-11 currently do, per the plan).
- **Task 7 note:** the plan's `imap-sync-jobs.ts` code block contains an intentional
  placeholder artifact (dead-code `getActiveGoogleAccountSecret` probe block) that must be
  deleted and replaced with a real `getActiveImapAccountSecret` repository method — see the
  plan's "Note for the builder" right after Task 7 Step 4. Don't copy that block verbatim.
- Commit each task's own files only (no `git add -A`).

## Process reminders

- Coordinator already approved the plan — do NOT re-escalate for plan approval, just build.
- Escalate to Coordinator only for genuine blockers/forks — not routine progress.
- Self-monitor context; relay again at ~80–100k tokens or immediately on a compaction summary.
- Pre-push trio (`pnpm format:check && pnpm lint && pnpm typecheck` + rebase on `origin/main`)
  before every push; close out via `coordinated-wrap-up` (PR + report only — never merge/board).
- Do not touch `docs/coordination/` (coordinator-only).
