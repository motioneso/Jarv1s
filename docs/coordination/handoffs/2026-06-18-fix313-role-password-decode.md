# Fix Handoff — #313 role-password percent-encoding (security tier)

**Run:** 2026-06-18-deploy-readiness. **Coordinator label:** `Coordinator` (escalate to it).
**Worktree:** `.claude/worktrees/deploy-117-role-passwords` (you are already in it).
**Branch:** `deploy-117-role-passwords` → PR #313. **Spec:** `docs/superpowers/specs/2026-06-18-otnr-p1-bootstrap-role-passwords.md`.
**Skill:** invoke `coordinated-build` — but this is a **scoped fix re-open**, not a fresh build. Plan
approval still comes from the Coordinator before you make the change.

## Why you're here

Security QA returned **RED** with one blocking finding (PR #313 comment
`#issuecomment-4747228352`):

> **BLOCKING:** `packages/db/src/role-bootstrap.ts:51` — `new URL(...).password` returns
> percent-encoded text, but `pg` decodes connection-string passwords. Escaped production secrets get
> `ALTER ROLE p%40...` while runtime connects with `p@...`, breaking role auth/rotation.
>
> exit-criteria not met — production role credentials with URL-reserved chars are not derived as
> runtime will use them.
> not-tested: URL-encoded DB passwords; post-migrate runtime-role connect with escaped production secrets.

## The fix (verify before you commit to it)

`new URL(url).password` yields the **percent-encoded** component. `pg` (and `pg-connection-string`)
**decode** the password from a connection string before connecting. So the bootstrap must derive the
password the same way the runtime will use it. Make the derivation consistent — `decodeURIComponent`
on the URL password component, OR parse via the same `pg-connection-string` the runtime uses. Confirm
which decoder `pg` actually applies and match it exactly (don't guess — read how the runtime pool
builds its config). Apply the same treatment to **every** role password source, not just one.

## Required: TDD

1. Write a **failing** test first that proves the bug: a role URL whose password contains
   URL-reserved chars (e.g. `p@ss:w%40rd/x`) must produce an `ALTER ROLE` plan using the **decoded**
   password that matches what `pg` connects with. Cover the empty-password and dev-default-rejection
   paths still pass.
2. Make it green with the minimal decode fix.
3. Keep error messages naming the role only — **never** the password (existing invariant).

## Gate + close-out (CI-unavailable mode)

CI reports no checks → run the **full local CI-equivalent** yourself and capture **real exit codes**
(write to a file + `$?`, never piped to `tail`/`grep`):

```
JARVIS_PGDATABASE=jarvis_fix313 pnpm verify:foundation ; echo "VF_EXIT=$?"
pnpm audit:release-hardening ; echo "AUDIT_EXIT=$?"
```

Use an **isolated** `JARVIS_PGDATABASE` (e.g. `jarvis_fix313`) — shared `jarv1s` DB contention caused
false timeouts in this run. Then follow `coordinated-wrap-up`: push the branch, ensure PR #313 is
updated, and report to the Coordinator with VF_EXIT/AUDIT_EXIT + the new head SHA. Do **not** merge,
touch the board/milestones, or edit `docs/coordination/` (coordinator-only).

## Bans (hard)

- No `git add -A` / `git add .` — stage only your own changed paths (shared tree, other sessions live).
- No `pnpm format` repo-wide — format only files you changed.
- No `git checkout`/`stash`/`reset` of the shared tree, no edits under `docs/coordination/`.
- Escalate blockers to the `Coordinator` label via `herdr pane run`; tag `[SECURITY]` if security-relevant.
