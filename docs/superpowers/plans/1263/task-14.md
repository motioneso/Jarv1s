**Dependency:** Task 13 must already be committed.

## Task 14 — Persist install grants without clobbering user policy

**Files**

- Modify `packages/ai/src/repository.ts`
- Modify `packages/ai/src/gateway/self-operation.ts`
- Add `tests/integration/action-policy-install-grants.test.ts`

**Symbols**

- `AiRepository.insertActionPolicyIfAbsent`
- `grantSelfOperationForModule`

**Changes**

1. `insertActionPolicyIfAbsent(scopedDb, moduleId, familyId, tier)` writes the existing
   `app.preferences` key with `ON CONFLICT (owner_user_id,key) DO NOTHING` and returns whether it
   inserted. It never calls or emulates `setActionPolicy`.
2. `grantSelfOperationForModule` derives the unique family ids referenced by
   `granted_at_install` tools and inserts `trusted_auto` only for those families. It does not grant
   confirm-only or unrelated families.
3. Keep the write actor-scoped through `DataContextDb`; add no root-DB path.

**Tests — exact names**

- `"stores trusted_auto under the existing action-policy preference key"`
- `"does not clobber an existing always_confirm user choice"`
- `"is idempotent across reinstall and reconcile"`
- `"grants only families referenced by granted_at_install tools"`

**Verify**

`pnpm vitest run tests/integration/action-policy-install-grants.test.ts`

**Commit**

`feat(ai): persist install grants without clobbering overrides`
