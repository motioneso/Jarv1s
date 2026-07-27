**Dependency:** Task 5 must already be committed.

## Task 6 — Classify Goals

**Files**

- Modify `packages/goals/src/manifest.ts`
- Modify `tests/unit/self-operation-manifests.test.ts`

**Exact classification**

- `granted_at_install`: `goals.create`, `goals.update`, `goals.addEvidence`.
- Add `executionPolicy:"auto"` to all three.
- Add `always_confirm` to `goals_management.allowedTiers`.
- Add `"classifies all 3 Goals write tools as granted_at_install"`.

**Verify**

`pnpm vitest run tests/unit/self-operation-manifests.test.ts`

**Commit**

`feat(goals): classify assistant writes for install grants`
