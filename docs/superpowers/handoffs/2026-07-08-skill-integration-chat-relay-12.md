# Relay 12 — skill-integration-chat (#760)

**Spec:** `docs/superpowers/specs/2026-07-05-skill-integration-chat.md`
**Plan:** `docs/superpowers/plans/2026-07-06-skill-integration-chat-plan.md` (approved, current).
**Branch/worktree:** `760-skill-integration-chat`, this worktree.
**Coordinator:** label `Coordinator` — re-resolve via `herdr pane list` before messaging, don't
trust any pane id written in a doc (they reflow).
**Tier:** `security` — Opus adversarial QA + Ben merge sign-off required before merge.
**Predecessor:** `Build-760j` (this relay), session started from relay-11's handoff.

## Status: Task 5 DONE, Task 6 DONE + committed. Task 7 in progress — one item left before wrap-up.

Coordinator already confirmed (relay-10): build Task 5+6 this pass, then Task 7. No re-escalation
needed for that scope.

**HEAD is `209e14d4`.** Commits this session:
- `209e14d4` — `tests/integration/skill-gateway-boundary.test.ts` (NEW, 223 lines): three
  integration tests proving skill-sourced turns get NO special server-side path —
  1. confirm-gated write via `composeTurnText`-composed text blocks on `action_requests` exactly
     like plain text, only executes after `resolveActionRequest(..., "confirmed")`.
  2. YOLO-mode destructive call auto-runs, audit row has `approval_mode: "yolo"` — no separate
     skill-triggered audit label exists.
  3. `renderPersona` + a fake `PersonaFs` prove a full skill-sourced gateway turn causes zero
     `mkdir`/`writeFile` calls beyond the initial render, and re-rendering is byte-identical
     (prompt-cache discipline).
  All three passed both in isolation and in a full suite run this session.

**Verified green (Task 5, from relay-11, still valid):** full `pnpm typecheck` (root + web), full
`pnpm vitest run tests/unit/` (287 files / 1970 passed / 2 skipped), `check:file-size`, `lint`,
`format:check`.

## Task 7 — acceptance sweep (mostly done, one gate re-run outstanding)

**Confirmed this session (code-read, not assumed):**
- No watched-directory / auto-import skill-loading code exists anywhere — invocation is 100%
  client-side `composeTurnText`, per spec's pinned design. Grep swept, clean.
- Migration `0149_chat_skills.sql` is present and asserted in `tests/integration/foundation.test.ts`
  via the full-migration-list `toEqual` (with a `#760 Task 1` comment tag).
- Module isolation: skill-aware server code confined to `packages/chat/src/skills/*`; gateway
  (`packages/ai/src/gateway/gateway.ts`) and persona (`packages/chat/src/live/persona.ts`) have
  zero "skill" awareness — `callTool(token, toolName, rawInput)` has no origin/skill param, proven
  by test file above.
- `evening-mode.tsx` file-map correction (from relay-10/11): **no edit needed** —
  `apps/web/src/today/today-page.tsx`'s `eveningInterviewMutation.onSuccess` calls
  `chatControls.openChat()`, which opens the same shared `Composer` (mounted once in
  `apps/web/src/shell/app-shell.tsx`) that already has Task 5's skill autocomplete wired in. This
  satisfies spec acceptance criterion 5 with zero additional code. **State this explicitly in the
  PR description** — don't add a no-op edit there.

**NOT yet done — do this first, next session:**
1. **pg-boss metadata-only grep check** (plan's Self-Review checklist, last unchecked item):
   confirm no part of the skills feature enqueues a pg-boss job carrying skill body/content.
   Expected trivially true (no skills code touches `packages/*/jobs` or pg-boss at all) but must be
   grep-verified, not assumed: `grep -rn "boss\|pgBoss\|send(" packages/chat/src/skills/` and
   confirm zero job-enqueue calls reference skill body/frontmatter content.
2. **Re-run `pnpm verify:foundation` in ISOLATION with a correctly captured real exit code.**
   The last full run this session (background task, HEAD `209e14d4`) passed lint / format /
   file-size / design-tokens / no-ambient-dates / package-deps / typecheck / `test:unit` (287
   files, 1970 passed, 2 skipped) cleanly, then `db:migrate` applied 3 pending migrations
   including `0149_chat_skills.sql` cleanly, then **`pnpm test:integration` failed**: 120/122
   files passed (1401/1406 tests, 2 skipped), but `tests/integration/notes-write-tools.test.ts`
   (2 tests) and `tests/integration/notification-digest.test.ts` (1 test) failed with
   `"tuple concurrently updated"` errors thrown from `runSqlFiles`
   (`packages/db/src/migrations/sql-runner.ts:126`) during `resetFoundationDatabase`
   (`tests/integration/test-database.ts`).
   - This error signature matches the known **Multi-agent PG contention** trap (see project
     memory `multi-agent-pg-contention.md`): concurrent `test:integration` runs across sessions
     sharing one dev Postgres can corrupt each other's schema-reset transactions. Neither failing
     file touches anything in the #760 skills feature (`notes-write-tools`, `notification-digest`
     are unrelated modules), and an earlier full run in this same session (plus the isolated run
     of just the new file) both showed 100% green — only the *second* full-suite run (as part of
     `verify:foundation`) showed these two failures. Strongly suggests transient contention with
     another concurrent session on the shared dev Postgres, not a #760 regression.
   - **This was NOT re-confirmed by an isolated re-run before this relay.** Do not trust it as
     green. Do not trust it as a real regression either — **re-run `pnpm test:integration` alone,
     with no other agent's build likely running concurrently** (check `herdr pane list` for other
     active build panes first, or just re-run and see if it's stable), and capture the **real** exit
     code correctly:
     ```bash
     pnpm verify:foundation; echo "EXIT:$?"
     ```
     **Do NOT pipe through `tee` and read `$?` after** — that captures `tee`'s exit code (always
     0), not the pipeline's. If you need a log file, use:
     ```bash
     pnpm verify:foundation > /tmp/vf.log 2>&1; echo "EXIT:$?"; cat /tmp/vf.log
     ```
     or `set -o pipefail` before a `tee` pipeline. If the re-run is clean, Task 7 gate is
     satisfied. If the same two files fail again identically, escalate to the coordinator before
     assuming it's still just contention — two consecutive identical failures would weaken that
     theory.

## Close out (after the above two items are done and gate is genuinely green)

Invoke **`coordinated-wrap-up`**: clean tree (only the pre-existing `.claude/context-meter.log`
diff should be present, which is not code — leave it, don't commit it), pre-push trio
(`format:check && lint && typecheck` + fetch/rebase `origin/main` — **not yet done any session on
this branch, do it before pushing**), open PR, report PR + verified evidence to the Coordinator.
Flag `security` tier for Opus adversarial QA + Ben merge sign-off — **do not merge yourself**.
Mention the `evening-mode.tsx` no-op correction explicitly in the PR description (per relay-11's
instruction, still binding).

## Reminders (still binding)

- Never `git add -A`; explicit paths only (shared tree).
- Never touch `docs/coordination/`.
- Pre-push trio before every push — not yet run this branch.
- Relay again immediately on the next context-meter 70% warning or a seen compaction summary.
- Identify Herdr panes by **label + `agent_session.value`**, never a bare `w…-N` pane id from a
  doc — pane numbers reflow. Re-resolve via `herdr pane list` at read time.
