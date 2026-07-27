**Dependency:** Task 11 must already be committed.

**Coordinator ruling:** Exclusion rule 7 governs new self-operation/configuration operations and does not retroactively remove the shipped Calendar domain tools.

## Task 12 — Classify Calendar

**Files**

- Modify `packages/calendar/src/manifest.ts`
- Modify `tests/unit/self-operation-manifests.test.ts`
- Modify `tests/integration/calendar-delete.test.ts`

**Exact classification**

- Add `always_confirm` to `calendar_writeback.allowedTiers`.
- Add `trusted_auto` to `calendar_management.allowedTiers`; retain `always_confirm`.
- `calendar.proposeFocusBlock`: `granted_at_install`, retaining write/auto/writeback family.
- `calendar.deleteEvent`: `granted_at_install`, retaining the management family but adding
  `executionPolicy:"auto"`; change risk to write.
- Update descriptions/comments which say deletion always asks.
- Add `"classifies both Calendar writes as granted_at_install"`.

**Verify**

`pnpm vitest run tests/unit/self-operation-manifests.test.ts tests/integration/calendar-delete.test.ts`

**Commit**

`feat(calendar): classify calendar writes for install grants`
