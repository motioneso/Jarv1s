# #1109 runtime-context — relay checkpoint 8

Branch/worktree: `build/1109-runtime-context` @ `/home/ben/Jarv1s/.claude/worktrees/build-1109-runtime-context`.

Plan: `docs/superpowers/plans/2026-07-16-1109-runtime-context-plan.md` (7 tasks, all done as of this
checkpoint). Read by SECTION only if you need Task 7's original literal text — it's already adapted,
see relay-7.

## Done — all 7 tasks committed, Task 7 (final) landed this session

Committed this session, in order:
- `4c496348` fix(chat): split memory serializers out of routes.ts for file-size gate
- `4b53208c` fix(module-sdk): move JarvisError to a node-clean leaf, same as #1110's AI_MODEL_CAPABILITIES fix
- `914c8350` test(context): prove pull-based awareness in real UAT — **this is Task 7's deliverable**

`tests/uat/specs/runtime-context.uat.spec.ts` ran for real against a live UAT stack:
`pnpm test:uat -- runtime-context` → 2 passed, 2 `test.fixme` (cite #1121), 0 failed.

## Two pre-existing (not #1109-caused) gate blockers found + fixed this session

1. `check:file-size`: `packages/chat/src/routes.ts` was 1014 lines (an earlier Task 4 commit,
   `e5d57c6e`, slipped past the gate). Fixed by extracting six pure serializers into the new
   `packages/chat/src/memory-serializers.ts`. Re-verified 960 lines, `check:file-size` green.
2. `test:unit` → `module-web-browser-safety.test.ts` (#799): the `news` module's `./web` bundle
   transitively reached `module-sdk`'s barrel `index.ts` (via `@jarv1s/shared` re-exporting
   `JarvisError`/`JarvisErrorClass`, added by an #1110-lane commit already on this branch), which
   unconditionally re-exports `rate-limit-key.js` (`node:crypto`) — a real browser-bundle-safety
   violation, not a test bug. Fixed using the **exact same pattern** #1110 already established for
   `AI_MODEL_CAPABILITIES`: split the types into a new node-clean leaf
   `packages/module-sdk/src/error-types.ts`, exported it as package subpath `./error-types`, and
   re-pointed `packages/shared/src/{index,chat-api,news-api}.ts` at the subpath instead of the
   barrel. Verified via `git stash` that both failures reproduced identically *before* my changes
   (confirms pre-existing branch debt, not something Task 7's own new files caused) and are gone
   after.

Both fixes: `pnpm typecheck` clean, `pnpm lint` clean, `pnpm exec prettier --check` clean on all
touched files, and the specific previously-failing tests now green
(`pnpm vitest run tests/unit/module-web-browser-safety.test.ts` → 3 passed).

Full `pnpm test:unit` (all 427 files) reran green after both fixes: 3470 passed, 2 skipped, 0
failed.

## UNRESOLVED — blocks the full `pnpm verify:foundation` exit-gate run

`pnpm test:uat-seed` (`vitest run tests/uat/seed`) fails 2 tests in `guard.test.ts`:

```
allows an empty database
allows only the known UAT seed rows for re-seeding
```

Both fail with `Error: [uat-seed] refusing: target DB already has real/bootstrap users` thrown by
`assertTargetIsEphemeral` (`tests/uat/seed/guard.ts:20-31`), which queries `app.users` on whatever DB
`createMigrationOwnerDb()` connects to (the real shared dev Postgres, **not** the isolated
per-run UAT Docker stack `test:uat` itself uses — that ran clean, see above). This means the shared
dev DB currently has a non-UAT user row in `app.users`.

**This looks environmental, not code-caused** — matches memory
`uat-seed-shared-db-no-reset` (durable rows leak between files on the one shared non-reset DB) and
`Fleet Operations` (each agent should have its own `JARVIS_PGDATABASE`; this worktree has no
`.env`/env var setting one, so it's likely hitting the same DB another session/agent has touched).
**Did not get to root-cause or fix this before the relay trigger** — did not check `psql` for which
user row is present, did not check whether another session is concurrently seeded against the same
DB right now.

### Next steps (in order)

1. `psql` (or a quick script) against the connected dev DB's `app.users` to see which row isn't in
   `UAT_ADMIN_ID`/`UAT_SECOND_OWNER_ID` (`tests/uat/seed/admin.ts`) — is it a real bootstrap owner
   from manual dev use, or a leaked UAT-adjacent row from another agent's run?
2. Check `herdr pane list` for another concurrent session that might be mid-test against the same
   DB before touching/cleaning anything.
3. If it's genuinely a shared-DB pollution issue (not a #1109 defect): this may need per-agent
   `JARVIS_PGDATABASE` isolation for this worktree (see memory `Fleet Operations`) rather than a
   code fix — confirm with the coordinator before deciding, since cleaning the shared dev DB
   affects other sessions.
4. Once `test:uat-seed` is green, run `pnpm test:integration` (the last un-run step of
   `verify:foundation`) and then the full `pnpm verify:foundation` end-to-end once more to get a
   clean final exit-gate run before invoking `coordinated-wrap-up`.
5. This is the **last task in the plan** — once the full gate is green, do NOT invent a Task 8.
   Go straight to `coordinated-wrap-up` (push, open PR, report to coordinator with evidence).

## Coordinator

Re-resolve fresh via `herdr pane list` before messaging — do not trust any label/session id from
this or earlier checkpoint docs.

## Process reminders

- TDD per task: red → green → format/lint → commit, `git add` explicit paths only (never `-A`).
- Relay again on context-meter 70% warning or compaction-summary sighting.
- Never merge/board/close, never touch `docs/coordination/`.
- `node_modules` already present in this worktree — skip `pnpm install`.
