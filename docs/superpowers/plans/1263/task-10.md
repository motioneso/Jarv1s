**Dependency:** Task 9 must already be committed.

**Coordinator ruling:** The approved per-tool News classification wins over exclusion rule 7; all five News writes are `granted_at_install`.

## Task 10 — Classify News

**Files**

- Modify `packages/news/src/manifest.ts`
- Modify `tests/unit/self-operation-manifests.test.ts`
- Modify `tests/integration/news-chat-tools.test.ts`

**Exact classification**

- Add family `news_personalization`, default `ask_each_time`, allowed tiers
  `ask_each_time`, `trusted_auto`, `always_confirm`.
- `granted_at_install` plus that family and `executionPolicy:"auto"`:
  `news.confirmSource`, `news.removeSource`, `news.addTopic`, `news.removeTopic`,
  `news.addExclusion`.
- This exact per-tool classification from approved Spec 2 wins over rule 7's older
  `"news source preview/refresh"` example. Do not centrally exclude any of these five tools.
- Remove stale comments saying these tools can never be auto-approved.
- Add `"classifies all 5 News personalization writes as granted_at_install"`.

**Verify**

`pnpm vitest run tests/unit/self-operation-manifests.test.ts tests/integration/news-chat-tools.test.ts`

**Commit**

`feat(news): classify personalization writes for install grants`
