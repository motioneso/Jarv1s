**Dependency:** Task 7 (`63a38cdd`) must already be committed. This task corrects it.

**Ben's ruling, 2026-07-26 (binding, supersedes the pending note in task-07.md):** "notes.delete can
be an approve once, don't need to baby proof." `notes.delete` is **`granted_at_install`**, not
`confirm_always`.

**Consequence — this is a real runtime behaviour change, not a declaration-only one.**
`packages/ai/src/gateway/policy.ts:37` returns `confirm` for **any** tool with `risk: "destructive"`,
regardless of tier. So "approve once" is unreachable while the tool stays destructive. Making Ben's
ruling true in the running system requires the downgrade below. Do not declare
`granted_at_install` while leaving `risk: "destructive"` — that combination silently keeps prompting
forever and is exactly the trap Task 2's assertion exists to catch.

**The `confirm_always` count drops from four to three:** `memory.forget`, `people.merge`,
`people.splitIdentity`. `notes.delete` is no longer one of them. Task 16 and Task 17 have been
updated to three; if you find a stale "four" anywhere, fix it.

## Task 7a — Apply Ben's notes.delete ruling

**Files**

- Modify `packages/notes/src/manifest.ts`
- Modify `tests/unit/self-operation-manifests.test.ts`
- Modify `tests/integration/notes-write-tools.test.ts`

**Exact classification**

- `notes.delete`: change `risk: "destructive"` → `risk: "write"`; add
  `actionFamilyId: "note_changes"`; add `executionPolicy: "auto"`; change `selfOperationGrant`
  from `"confirm_always"` to `"granted_at_install"`.
- `note_changes.allowedTiers` already includes `always_confirm` (Task 7) — leave it. That is what
  lets a user demand a prompt back for note deletion if they ever want one.
- `notes.create` and `notes.edit` are unchanged.

**Tests — invert the assertions Task 7 added, do not delete them**

- The existing `"keeps notes.delete destructive with pending confirm_always"` assertions in both
  test files now assert the wrong thing. Replace them with assertions that `notes.delete` is
  `risk: "write"`, `executionPolicy: "auto"`, `actionFamilyId: "note_changes"`, and
  `selfOperationGrant: "granted_at_install"`.
- Rename those test cases so the name matches what they check; a test named for the old ruling that
  asserts the new one is worse than no test.
- Keep asserting that `note_changes.allowedTiers` contains `always_confirm`.

**Do NOT add a trash/soft-delete/restore path in this task.** `notesDeleteExecute`
(`packages/notes/src/write-tools.ts:232`) is a bare `unlink`. That is a known, accepted property of
this ruling and it is recorded for the PR body — it is not yours to fix here, and adding it would
expand #1263's scope. If you think it must be fixed, message the Coordinator.

**Verify**

`pnpm vitest run tests/unit/self-operation-manifests.test.ts tests/integration/notes-write-tools.test.ts`

**Commit**

`feat(notes): grant note deletion at install per ruling`

## Stop conditions (apply to every task)

- A proposed fifth `confirm_always` tool: stop that package task and message the Coordinator. (The
  set is now three: `memory.forget`, `people.merge`, `people.splitIdentity`.)
- Any implementation that widens `defaultTier`, adds a migration, creates a parallel command
  registry, moves ordinary policy ahead of YOLO, clobbers an existing stored tier, or expands
  #1263 into the external ABI owned by #1267: stop.
- Stage and commit only the exact files in each task. Never use `git add -A` or run repo-wide format
  rewrites.
