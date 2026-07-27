**Dependency:** Task 8 must already be committed.

**Coordinator ruling:** The four planned `confirm_always` tools are `memory.forget`, `people.merge`, `people.splitIdentity`, and `notes.delete`; all retain destructive risk. `notes.delete` remains pending Ben's confirmation.

## Task 9 — Classify Memory

**Files**

- Modify `packages/memory/src/manifest.ts`
- Modify `tests/unit/self-operation-manifests.test.ts`
- Modify `tests/integration/memory-graph-tools.test.ts`

**Exact classification**

- Add family `memory_management`, default `ask_each_time`, allowed tiers
  `ask_each_time`, `trusted_auto`, `always_confirm`.
- `memory.remember`: `granted_at_install`, `risk:"write"`,
  `actionFamilyId:"memory_management"`, `executionPolicy:"auto"`.
- `memory.forget`: `confirm_always`, retaining destructive risk; this preserves the existing
  destructive floor.
- Add `"classifies remember as granted and forget as binding confirm_always"`.

**Verify**

`pnpm vitest run tests/unit/self-operation-manifests.test.ts tests/integration/memory-graph-tools.test.ts`

**Commit**

`feat(memory): declare assistant self-operation grants`
