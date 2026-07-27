**Dependency:** Task 12 must already be committed.

## Task 13 — Classify Web Research

**Files**

- Modify `packages/web-research/src/manifest.ts`
- Modify `tests/unit/self-operation-manifests.test.ts`
- Modify `tests/unit/web-research.test.ts`

**Exact classification**

- Add family `web_research_requests`, default `ask_each_time`, allowed tiers
  `ask_each_time`, `trusted_auto`, `always_confirm`.
- `web.read`: `granted_at_install`, `risk:"write"`, the new family, and
  `executionPolicy:"auto"`.
- Add `"classifies web.read as granted_at_install"`.

**Verify**

`pnpm vitest run tests/unit/self-operation-manifests.test.ts tests/unit/web-research.test.ts`

**Commit**

`feat(web-research): classify page reads for install grants`
