**Dependency:** Task 7 must already be committed.

**Coordinator ruling:** The four planned `confirm_always` tools are `memory.forget`, `people.merge`, `people.splitIdentity`, and `notes.delete`; all retain destructive risk. `notes.delete` remains pending Ben's confirmation.

## Task 8 — Classify People with the binding destructive ruling

**Files**

- Modify `packages/people/src/manifest.ts`
- Modify `packages/people/src/tools.ts`
- Modify `packages/people/src/__tests__/tools.test.ts`
- Modify `tests/unit/self-operation-manifests.test.ts`

**Exact classification**

- Add family `people_review`, default `ask_each_time`, allowed tiers
  `ask_each_time`, `trusted_auto`, `always_confirm`.
- `granted_at_install` plus `executionPolicy:"auto"`:
  `people.acceptMatch`, `people.rejectMatch`.
- `confirm_always`, retaining destructive risk and confirm execution policy:
  `people.merge`, `people.splitIdentity`.
- Add `"declares merge and splitIdentity confirm_always because split is not a merge reverse"` to
  `packages/people/src/__tests__/tools.test.ts`; assert the exact four-tool map.
- Add `"classifies People with exactly two binding confirm_always declarations"` to the central
  manifest test.

Do not add a round-trip implementation or pretend `splitIdentity` restores merged state; the
verified repository/service behavior is the reason for the declaration.

**Verify**

`pnpm vitest run packages/people/src/__tests__/tools.test.ts tests/unit/self-operation-manifests.test.ts`

**Commit**

`feat(people): preserve destructive confirmations by declaration`
