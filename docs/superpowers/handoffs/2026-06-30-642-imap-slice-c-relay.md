# Relay handoff — #642 imap-slice-c

**Issue:** #642 (Generic IMAP connector Slice C — IMAP read + scheduled refresh →
`app.email_messages`, wire Google onto same scheduler; Part of #270)
**Spec:** `docs/superpowers/specs/2026-06-30-proton-mail-connector-spike-output.md` §7a
**Risk tier:** security
**Worktree/branch:** this worktree, `coord/642-imap-slice-c` (continue in place — do not
create a new worktree)
**Coordinator label:** `Coordinator` (confirm via `herdr pane list` before messaging — exactly
one pane should hold that label)

## State: plan written, NOT yet coordinator-approved. Zero code written.

Premise verification vs. actual branch state is done (Slice A/B already merged to main;
confirmed exact current code for every file the plan touches). No spec drift found requiring
escalation beyond what's already flagged in the plan's own "Escalation note" section.

## Read this first

`docs/superpowers/plans/2026-06-30-imap-slice-c.md` — full self-reviewed implementation plan,
11 TDD tasks + Self-Review + Escalation note. Read it IN FULL before doing anything else. Do
not restate or re-derive it — it's complete (exact file paths, exact code, exact test
commands, no placeholders).

## What to do next (coordinated-build, step 1 → step 2)

1. **Message the Coordinator first**, per `coordinated-build`: "plan ready for imap-slice-c:
   `docs/superpowers/plans/2026-06-30-imap-slice-c.md`. Approve, or flag a fork." Then **STOP
   and wait** for approval. Do not write code before approval.
2. Once approved, drive the plan via `superpowers:test-driven-development`, task by task,
   yourself (execution skills `executing-plans`/`subagent-driven-development` are disabled in
   this repo). Commit green per task, staging only that task's own files.
3. **Migration number caveat:** the plan's Task 3 migration is provisionally `0132`
   (`packages/email/sql/0132_email_imap_insert.sql`). Global max as of this handoff is `0131`
   (`packages/connectors/sql/0131_connector_imap_definitions.sql`) — **re-run**
   `find . -path "*/sql/*.sql" | grep -oE '[0-9]{4}_' | sort -n | tail -3` **immediately before
   creating that file** in case another agent landed a migration since.
4. Self-monitor context per `coordinated-build` step 3 — relay again at ~80–100k tokens or on
   seeing a compaction summary (no special override this time; that override was specific to
   the prior segment's compaction event only).
5. Pre-push trio + rebase before every push; close out via `coordinated-wrap-up` (PR + report
   only — never merge/board/milestone).

## Known blockers folded into the plan (not separate issues)

Slice B shipped two bugs that block IMAP data from ever becoming visible even after Slice C's
fetch/cache works: `ConnectorsRepository.upsertImapAccount` always persisted `scopes: []`
(Task 1 fixes), and `feature-grants.ts` never recognized the `email.read` scope (Task 2
fixes). Both are in the plan as hard-blocking tasks, not deferred follow-ups.
