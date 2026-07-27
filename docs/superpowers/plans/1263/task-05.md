**Dependency:** Task 4 must already be committed.

## Task 5 — Classify Commitments

**Files**

- Modify `packages/commitments/src/manifest.ts`
- Modify `tests/unit/self-operation-manifests.test.ts`

**Exact classification**

- `granted_at_install`: `commitments.accept`, `commitments.reject`, `commitments.snooze`.
- Add `executionPolicy:"auto"` to all three.
- Add `always_confirm` to `commitment_review.allowedTiers`.
- Add `"classifies all 3 Commitments write tools as granted_at_install"`.

**Verify**

`pnpm vitest run tests/unit/self-operation-manifests.test.ts tests/integration/commitments.test.ts`

**Commit**

`feat(commitments): classify assistant writes for install grants`
