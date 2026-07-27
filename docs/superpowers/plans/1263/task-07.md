**Dependency:** Task 6 must already be committed.

**Coordinator ruling:** The four planned `confirm_always` tools are `memory.forget`, `people.merge`, `people.splitIdentity`, and `notes.delete`; all retain destructive risk. `notes.delete` remains pending Ben's confirmation.

## Task 7 — Classify Notes

**Files**

- Modify `packages/notes/src/manifest.ts`
- Modify `tests/unit/self-operation-manifests.test.ts`
- Modify `tests/integration/notes-write-tools.test.ts`

**Exact classification**

- `granted_at_install`: `notes.create`, `notes.edit`.
- Add `always_confirm` to `note_changes.allowedTiers`.
- `notes.delete`: keep `risk:"destructive"` and declare `confirm_always`; do not add auto execution
  or reclassify it as write. This is the planned fourth declaration pending Ben's confirmation.
- Preserve `notes.create.requiresConfirmation` for the `overwrite:true` call shape; this is an
  existing per-call policy and YOLO continues to bypass it.
- Add `"classifies Notes create and edit as granted_at_install"`,
  `"keeps notes.delete destructive with pending confirm_always"`, and
  `"keeps overwrite confirmation conditional while ordinary note writes are auto-capable"`.

**Verify**

`pnpm vitest run tests/unit/self-operation-manifests.test.ts tests/integration/notes-write-tools.test.ts`

**Commit**

`feat(notes): classify assistant writes for install grants`
