# News Slice 4 — Chat Actions, Revalidation & Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> **In this repo the execution skills are disabled — drive the plan yourself, task by task (coordinated-build step 2).**

**Goal:** Complete Slice 4 of epic #954 (issue #975): confirm-gated chat tools for source/topic/exclusion management, provider-change revalidation of curated sources/topics, one owner-private summary notification, retry affordance, and wired Settings flows.

**Architecture:** Extend existing News machinery only. New `news.revalidate` pg-boss queue + worker reusing `decideSourcePolicy`/`validateTopic`; drift detection piggybacks on the refresh worker; per-owner daily cron via the briefings `boss.schedule` reconcile pattern. Six assistant tools declared in the News manifest with late-bound deps (`configureNewsChatTools`, precedent: `configureNewsBriefingService`); writes carry NO `actionFamilyId` so the gateway always confirm-gates. One summary notification through `NotificationsRepository` (public boundary), transition-count deduped.

**Tech Stack:** Fastify, Kysely (`DataContextDb` only), pg-boss, Vitest integration tests in `tests/integration/`, React (jds-\* primitives).

## Escalations pending coordinator approval (do not build past Task 1 without answers)

1. **D2 — migration required.** Worker needs `UPDATE (validation_status, validation_fingerprint, validated_at, updated_at)` on `news_custom_sources` AND `news_custom_topics` (+ NEW worker UPDATE policy on topics — none exists). Handoff bans unspec'd migrations; spec revalidation semantics require this one. Proposed file `packages/news/sql/0161_news_revalidation.sql` — **coordinator assigns the number** (0161 assumed below; rename everywhere if different).
2. **D4 — notification scope.** Spec proper = ONE summary notification when user action required. Handoff also mentioned "new matching items appear" — NOT in spec. Building to spec (summary only).
3. **Settings scope finding.** Add source/topic buttons have been disabled scaffolds since S2 ("write APIs arrive in Slice 2… Add buttons ALWAYS disabled"). Spec S4 bullet 4 + manual acceptance 1–2, 6 require full Settings flows → Task 9 wires add/delete/Retry. Confirm this is in-scope.
4. **Chat-tool scope choice.** Spec lists add/edit/delete + unexclude; shipping 6 tools (preview/confirm/remove source, add/remove topic, add exclusion). Edit variants + removeExclusion stay REST/Settings-only.

## Global Constraints

- Security tier: owner-only RLS with **positive controls** (cross-owner AND admin read → 0 rows/42501, each paired with owner-positive control). RLS applies to admins.
- No secrets, article bodies, prompts, or owner free-text in logs, pg-boss payloads, AI prompts, exports, or notifications. New logs: counts + ids only.
- Metadata-only job payloads; `{actorUserId, kind, idempotencyKey}` are all already in `ALLOWED_PAYLOAD_KEYS` (`packages/jobs/src/pg-boss.ts:76`) — add NO new keys. `boss.schedule` bypasses sendJob's guard → call `assertMetadataOnlyPayload` manually (briefings precedent).
- Provider-agnostic: only `ai.fingerprint(scopedDb)` and capability booleans cross the News seam.
- Every new response field declared in `packages/shared/src/news-api.ts` (fast-json-stringify strips undeclared); test via `app.inject`.
- `DataContextDb` only; never edit applied migrations; module SQL in `packages/news/sql/`.
- Commits: explicit-path `git add`, trailer `Co-Authored-By: Claude <noreply@anthropic.com>`. Pre-push: `pnpm format:check && pnpm lint && pnpm typecheck` + rebase on origin/main.
- Generous why-comments citing issue #975 / spec decisions in all new code.

---

### Task 1: Migration — worker revalidation grants

**Files:**

- Create: `packages/news/sql/0161_news_revalidation.sql` (number pending coordinator)
- Modify: `packages/news/src/manifest.ts` (migrations array `[0151, 0159, 0160]` → append)
- Test: `tests/integration/foundation-schema-catalog.test.ts:275` (FULL migration list `toEqual` — append row)

- [ ] **Step 1: failing test** — append to the expected list after the 0160 row:

```ts
{ version: "0161", name: "0161_news_revalidation.sql" }
```

Run: `pnpm test:integration -- foundation-schema-catalog` → FAIL (list mismatch).

- [ ] **Step 2: write migration** `packages/news/sql/0161_news_revalidation.sql`:

```sql
-- Slice 4 (#975): the revalidation worker re-runs policy checks when the owner's
-- configured AI provider/model changes, so it must persist validation outcomes.
-- Column-scoped grants only; RLS policies keep every write owner-scoped
-- (worker sets app.current_actor_user_id from the job's actorUserId).

GRANT UPDATE (validation_status, validation_fingerprint, validated_at, updated_at)
  ON app.news_custom_sources TO jarvis_worker_runtime;

-- Topics were SELECT-only for the worker in 0160; revalidation now writes them too.
GRANT UPDATE (validation_status, validation_fingerprint, validated_at, updated_at)
  ON app.news_custom_topics TO jarvis_worker_runtime;
DROP POLICY IF EXISTS news_custom_topics_worker_update ON app.news_custom_topics;
CREATE POLICY news_custom_topics_worker_update ON app.news_custom_topics
  FOR UPDATE TO jarvis_worker_runtime
  USING (owner_user_id = app.current_actor_user_id())
  WITH CHECK (owner_user_id = app.current_actor_user_id());
```

(No new sources worker UPDATE policy — `news_custom_sources_worker_update` already exists in 0160; only the column grant widens.)

- [ ] **Step 3: manifest** — in `packages/news/src/manifest.ts` migrations array append `"0161_news_revalidation.sql"` entry matching the existing three entries' shape exactly.
- [ ] **Step 4:** `pnpm test:integration -- foundation-schema-catalog` → PASS.
- [ ] **Step 5: commit** `feat(news): grant worker revalidation writes (#975)` — add the 3 files by explicit path.

### Task 2: Repository validation-state methods + RLS tests

**Files:**

- Modify: `packages/news/src/personalization-repository.ts`
- Test: `tests/integration/news-personalization-repository.test.ts` (append describe block; reuse the file's existing harness setup/owner fixtures verbatim — it is directly above in the same file)

**Interfaces (Produces):**

```ts
export interface NewsSourceValidationState {
  id: string; label: string; canonicalDomain: string;
  homepageUrl: string; feedUrl: string | null;
  retrievalMethod: "feed" | "scrape";
  validationStatus: "approved" | "needs_revalidation" | "rejected";
  validationFingerprint: string | null;
  healthStatus: "available" | "unavailable";
}
export interface NewsTopicValidationState {
  id: string; label: string; guidance: string | null;
  validationStatus: "approved" | "needs_revalidation" | "rejected";
  validationFingerprint: string | null;
}
listSourceValidationStates(scopedDb: DataContextDb): Promise<NewsSourceValidationState[]>
listTopicValidationStates(scopedDb: DataContextDb): Promise<NewsTopicValidationState[]>
updateSourceValidation(scopedDb, sourceId: string, input: { validationStatus: ...; validationFingerprint: string | null }): Promise<void>
updateTopicValidation(scopedDb, topicId: string, input: same): Promise<void>
```

- [ ] **Step 1: failing tests** (assertion bodies; wrap in the file's existing two-owner fixture):
  - owner lists own source/topic validation states incl. `validationFingerprint` (positive control),
  - `updateSourceValidation` under **worker** data context (pattern: how `news-refresh-jobs.test.ts` obtains the worker context) sets status+fingerprint and bumps `validated_at`/`updated_at`,
  - same for `updateTopicValidation`,
  - cross-owner `updateSourceValidation` under worker context targeting other owner's id → 0 rows affected, state unchanged (paired with owner-positive),
  - admin actor read of another owner's states → 0 rows (paired with owner-positive).
- [ ] **Step 2:** run → FAIL (methods undefined).
- [ ] **Step 3: implement** — follow `updateSourceHealth` (:206) style; updates set `validated_at: now, updated_at: now`; lists select only the columns in the interfaces (still never leak fingerprint into route DTOs).
- [ ] **Step 4:** run → PASS. **Step 5: commit** `feat(news): repository validation-state reads and writes (#975)`.

### Task 3: Revalidation core

**Files:**

- Create: `packages/news/src/revalidation.ts`
- Test: `tests/integration/news-revalidation.test.ts` (new; stub ports pattern from `news-refresh-jobs.test.ts`)

**Interfaces (Produces):**

```ts
export interface NewsRevalidationDeps {
  fetch: NewsSafeFetchPort;
  ai: NewsAiPort;
  repository: Pick<
    NewsPersonalizationRepository,
    | "listSourceValidationStates"
    | "listTopicValidationStates"
    | "updateSourceValidation"
    | "updateTopicValidation"
    | "updateSourceHealth"
    | "readPolicyVerdict"
    | "upsertPolicyVerdict"
  >;
  logger: ModuleLogger;
}
export interface NewsRevalidationOutcome {
  sourcesChecked: number;
  topicsChecked: number;
  sourcesNeedingAttention: number;
  topicsNeedingAttention: number;
  transitionedToAttention: boolean; // drives the ONE notification
}
export async function revalidateOwnerNews(
  scopedDb: DataContextDb,
  deps: NewsRevalidationDeps
): Promise<NewsRevalidationOutcome>;
```

**Behavior (implement exactly):**

1. `const fingerprint = await deps.ai.fingerprint(scopedDb)`; if `null` → log `{ event: "news_revalidation_skipped", reason: "no_model" }` and return zeros (no state change — retried by cron).
2. Sources: skip when `validationStatus === "approved" && validationFingerprint === fingerprint` (idempotency). Otherwise:
   - reachability: `deps.fetch(feedUrl ?? homepageUrl)`; `!ok` → `updateSourceHealth(scopedDb, id, "unavailable")` + `updateSourceValidation(..., { validationStatus: "needs_revalidation", validationFingerprint })` (action required);
   - ok → headlines via `sampleFeedHeadlines(result.body, 10)` for `retrievalMethod === "feed"`, `extractListingHeadlines(result.body, 10)` for `"scrape"` (both exported from `./discovery/feed-discovery.js`);
   - `decideSourcePolicy(scopedDb, { ai: deps.ai, repo: deps.repository }, { canonicalDomain, description: label, sampleHeadlines })`:
     - `approved` → `updateSourceValidation(..., { validationStatus: "approved", validationFingerprint: policy.fingerprint })` + `updateSourceHealth(..., "available")`;
     - `rejected` → `updateSourceValidation(..., { validationStatus: "rejected", validationFingerprint: policy.fingerprint })`;
     - `unavailable` → leave fingerprint unchanged, set `needs_revalidation` (retry later).
3. Topics: same skip rule; `validateTopic(scopedDb, { ai: deps.ai }, { label, guidance })` mapped identically via `updateTopicValidation`.
4. "Needing attention" = post-run `validationStatus !== "approved"` OR (source) `healthStatus === "unavailable"`. `transitionedToAttention` = true iff an item that was NOT needing attention before this run now is (per-item prior-state comparison — this is the dedupe: run-twice → no transition → no duplicate notification).
5. Logs metadata-only: `{ event: "news_revalidation_run", sourcesChecked, topicsChecked, sourcesNeedingAttention, topicsNeedingAttention }` — never domains/labels/bodies.

- [ ] **Step 1: failing tests** with stub `fetch`/`ai` ports (stub `ai.fingerprint` returns `"fp2"`, `decideSourcePolicy` verdicts driven by stub `ai`):
  - all approved + fingerprint matches → zero updates (spy repository), outcome all zeros;
  - fingerprint drift + fetch ok + policy approved → status approved w/ new fingerprint, health available, `transitionedToAttention === false`;
  - drift + fetch fails → health unavailable + needs_revalidation, `transitionedToAttention === true`;
  - drift + policy rejected → rejected, attention true;
  - second run same inputs → `transitionedToAttention === false` (idempotent);
  - `fingerprint === null` → no repository writes.
- [ ] **Steps 2–4:** FAIL → implement → PASS. **Step 5: commit** `feat(news): provider-change revalidation core (#975)`.

### Task 4: Queue, worker, drift hook, notification

**Files:**

- Modify: `packages/news/src/jobs.ts`, `packages/module-registry/src/index.ts` (~:1360–1410 News registerWorkers), `packages/news/src/index.ts` (exports)
- Test: extend `tests/integration/news-revalidation.test.ts`

**Interfaces (Produces):**

```ts
export const NEWS_REVALIDATE_QUEUE = "news.revalidate";
export interface NewsRevalidatePayload extends ActorScopedJobPayload {
  kind: "revalidate";
  idempotencyKey: string;
}
export async function enqueueNewsRevalidation(boss: PgBoss, actorUserId: string): Promise<void>;
// registerNewsJobWorkers deps gains: notificationsRepository?: NotificationsRepository (type-only import, briefings precedent packages/briefings/src/jobs.ts:160-190)
```

- [ ] **Step 1: failing tests:**
  - `enqueueNewsRevalidation` payload passes `assertMetadataOnlyPayload`; `idempotencyKey = \`news-revalidate:${actorUserId}\``; `{ singletonKey: actorUserId }`;
  - worker run with drifted fixture → statuses updated AND exactly one notification row (via `NotificationsRepository.listVisible` under owner context) with `title: "News sources need attention"`, `metadata: { kind: "news_revalidation", sourceCount, topicCount }` — **counts only, no labels/domains**;
  - run worker twice → still exactly one notification (transition dedupe);
  - notification create throwing → run still succeeds (try/catch, log `news_notification_failed` with `error.name` + message slice ≤200, briefings precedent);
  - refresh worker drift hook: after refresh run with stored fingerprints ≠ current `ai.fingerprint` → a `news.revalidate` job enqueued for that owner (assert via boss fetch or spy); matching fingerprints → none.
- [ ] **Step 2–3:** implement:
  - queue definition appended to `NEWS_QUEUE_DEFINITIONS` (same policy exclusive / retryLimit 0 / deleteAfterSeconds 60 / retentionSeconds 60);
  - worker via `registerDataContextWorker`, `assertMetadataOnlyPayload(job.data)`, builds repository, calls `revalidateOwnerNews`, then when `outcome.transitionedToAttention`: `notificationsRepository?.create(scopedDb, { moduleId: "news", title: "News sources need attention", body: "Open News settings to retry or remove them.", metadata: { kind: "news_revalidation", sourceCount: outcome.sourcesNeedingAttention, topicCount: outcome.topicsNeedingAttention }, urgency: "normal" })` in try/catch;
  - drift hook at end of the refresh handler loop: `const fp = await ai.fingerprint(scopedDb); if (fp) { const drifted = [...sources, ...topics].some((s) => s.validationFingerprint !== fp); if (drifted) await enqueueNewsRevalidation(boss, actorUserId); }`;
  - module-registry: construct/pass `notificationsRepository` into `registerNewsJobWorkers` (a `NotificationsRepository` instance already exists near :1223 for other workers — reuse pattern).
- [ ] **Step 4:** PASS. **Step 5: commit** `feat(news): revalidation queue, worker, drift detection, summary notification (#975)`.

### Task 5: Per-owner revalidation schedule

**Files:**

- Create: `packages/news/src/schedule.ts` (pattern: `packages/briefings/src/schedule.ts`)
- Modify: `packages/news/src/personalization-routes.ts` (`triggerNewsRefresh` + GET personalization self-heal)
- Test: extend `tests/integration/news-revalidation.test.ts`

**Interfaces (Produces):**

```ts
export const NEWS_REVALIDATE_CRON = "43 4 * * *"; // daily, off-minute per fleet convention
export async function reconcileNewsRevalidationSchedule(
  boss: PgBoss,
  scopedDb: DataContextDb,
  repository: Pick<NewsPersonalizationRepository, "countCustomSources" | "countCustomTopics">,
  actorUserId: string,
  logger?: ModuleLogger
): Promise<void>;
```

- [ ] **Step 1: failing tests:** creating first source schedules `pgboss.schedule` row keyed `news-revalidate:${actorUserId}` on `news.revalidate` (query the `pgboss.schedule` table as the briefings schedule test does); deleting the last source+topic unschedules; payload in the schedule row is metadata-only; best-effort (boss.schedule throwing does not fail the route).
- [ ] **Step 2–3:** implement — count sources+topics; `> 0` → `assertMetadataOnlyPayload(payload)` then `boss.schedule(NEWS_REVALIDATE_QUEUE, NEWS_REVALIDATE_CRON, payload, { tz: "UTC", key })`; `=== 0` → `boss.unschedule(NEWS_REVALIDATE_QUEUE, key)`. Call from `triggerNewsRefresh` (every personalization write already funnels through it — add boss/logger already in scope) and best-effort from GET `/api/news/personalization` (self-heal, try/catch).
- [ ] **Step 4:** PASS. **Step 5: commit** `feat(news): per-owner daily revalidation schedule (#975)`.

### Task 6: Retry route `POST /api/news/revalidation`

**Files:**

- Modify: `packages/shared/src/news-api.ts`, `packages/news/src/personalization-routes.ts`, `packages/news/src/manifest.ts` (routes list)
- Test: extend `tests/integration/news-personalization-routes.test.ts`

**Interfaces (Produces):**

```ts
// shared/news-api.ts — keep interface & schema in exact lockstep (file's own rule)
export interface TriggerNewsRevalidationResponse {
  queued: boolean;
}
export const triggerNewsRevalidationSchema = {
  /* mirror triggerNewsRefreshSchema (~:761) shape, single boolean property, additionalProperties: false */
};
```

- [ ] **Step 1: failing tests (app.inject):** 401 unauthenticated; authenticated → 202 `{ queued: true }` and a `news.revalidate` job enqueued; response field survives serialization (schema-strip check).
- [ ] **Step 2–3:** route mirrors the refresh POST route structure (resolveAccessContext → `enqueueNewsRevalidation` → `reply.code(202)`); manifest route entry added.
- [ ] **Step 4:** PASS. **Step 5: commit** `feat(news): manual revalidation retry endpoint (#975)`.

### Task 7: Chat tools — shared preview store + previewSource/confirmSource

**Files:**

- Create: `packages/news/src/chat-tools.ts`
- Modify: `packages/news/src/personalization-routes.ts` (accept injected `previews`, extract confirm logic), `packages/news/src/routes.ts` (create shared store, call `configureNewsChatTools`), `packages/news/src/manifest.ts` (assistantTools), `packages/news/src/index.ts`
- Test: `tests/integration/news-chat-tools.test.ts` (gateway pattern: `tests/integration/ai-tools.test.ts`)

**Interfaces (Produces):**

```ts
export function configureNewsChatTools(deps: {
  previews: ReturnType<typeof createPreviewStore>;
  discovery: { fetch: NewsSafeFetchPort; search: NewsWebSearchPort; ai: NewsAiPort };
  availability: { hasJsonModel(db): Promise<boolean>; hasWebSearch(db): Promise<boolean> };
  boss: PgBoss;
  repository: NewsPersonalizationRepository;
}): void;
// PersonalizationRouteDependencies gains: previews?: PreviewStore (default createPreviewStore() for back-compat)
// Extract from confirm route handler into exported helper (same file or discovery/confirm-source.ts):
export async function confirmSourceFromPreview(
  scopedDb,
  deps,
  actorUserId,
  input: { confirmationId: string; candidateId?: string }
): Promise<
  | { ok: true; source: NewsCustomSourceDto }
  | { ok: false; reason: "expired" | "ambiguous" | "duplicate" | "limit" }
>;
```

Manifest entries (both `permissionId: "news.prefs"`, **no `actionFamilyId`** — write risk with no family is never promoted, gateway always confirms; precedent `packages/email/src/manifest.ts:218`):

- `news.previewSource` — `risk: "read"`, `externalContent: true`, input `{ source: string }`; execute: availability gates (no json model / no web search → tool error strings), `resolveSourceInput`, `previews.put`, returns `{ confirmationId, candidates: [{ candidateId, label, domain }], duplicateOfSourceId? }` (candidate labels are source-supplied → gateway renders as literal text, `externalContent` flag set).
- `news.confirmSource` — `risk: "write"`, input `{ confirmationId: string, candidateId?: string, label: string, domain: string }`; `summarize` renders the confirmation card from input label/domain ONLY for display; execute calls `confirmSourceFromPreview` and **cross-checks** that the stored candidate's `label`/`canonicalDomain` match the resubmitted display fields — mismatch → error (never trusts client/LLM URLs; the stored `VerifiedSourceCandidate` is the only thing written). On success also `triggerNewsRefresh`.

- [ ] **Step 1: failing gateway tests** (harness from `ai-tools.test.ts`):
  - previewSource runs without confirmation (read risk) and returns candidates;
  - confirmSource without confirmation → pending action request created, NOT executed;
  - confirm the pending request → source row exists, audit row `approval_mode = "confirmed"`, `outcome = "success"`;
  - confirmSource with tampered `domain` (≠ stored candidate) → error result, no source created;
  - cross-owner: owner B replaying owner A's `confirmationId` → `expired` error, no row (previews.take is owner-checked);
  - fingerprint of behavior: no provider/model string anywhere in tool output.
- [ ] **Step 2–3:** implement `chat-tools.ts` with module-level deps + throw-if-unconfigured (briefing-tool.ts precedent); `routes.ts` creates ONE `createPreviewStore()`, passes to `registerNewsPersonalizationRoutes` and `configureNewsChatTools` (routes.ts already holds discovery/availability/boss/repository).
- [ ] **Step 4:** PASS. **Step 5: commit** `feat(news): assistant preview/confirm source tools (#975)`.

### Task 8: Chat tools — removeSource, addTopic, removeTopic, addExclusion

**Files:**

- Modify: `packages/news/src/chat-tools.ts`, `packages/news/src/manifest.ts`
- Test: extend `tests/integration/news-chat-tools.test.ts`

All four: `risk: "write"`, no `actionFamilyId`, `permissionId: "news.prefs"`, `summarize` = human card text ("Remove news source ‘X’?"), execute via existing repository/route helpers only:

- `news.removeSource` `{ sourceId }` → find in `listCustomSources` (friendly not-found error) → `deleteCustomSource` → `triggerNewsRefresh` with `pruneSnapshotDomain` afterBump (mirror the DELETE route).
- `news.addTopic` `{ label, guidance? }` → `cleanTopic` normalization, `hasWebSearch` gate, `validateTopic` (unavailable/rejected → friendly errors), `createCustomTopic`, refresh. Limit/duplicate errors map to friendly strings (`NewsPersonalizationLimitError`, `NewsDuplicateSourceError`).
- `news.removeTopic` `{ topicId }` → `deleteCustomTopic` + refresh.
- `news.addExclusion` `{ domain }` → normalize via `normalizePublisherDomain`, `createExclusion`, refresh.

- [ ] **Step 1: failing tests:** each tool confirm-gates (pending request, no write before confirm; after confirm → row + audit `approval_mode=confirmed`); limit-cap breach → friendly error, no row; removeSource on other owner's id → not-found, no cross-owner effect (positive control: own id works).
- [ ] **Steps 2–4:** implement → PASS. **Step 5: commit** `feat(news): assistant topic/exclusion/removal tools (#975)`.

### Task 9: Settings UI — add/delete/Retry flows + client helpers

**Files:**

- Modify: `packages/news/src/web/news-client.ts`, `packages/news/src/settings/index.tsx` (510 lines — if the add-source flow pushes near the 1000-line gate, split it to `packages/news/src/settings/add-source.tsx`), `packages/news/src/web/query-keys.ts` (only if a new key is needed — personalization key exists)

**Client helpers (mirror existing helpers' fetch style exactly):** `previewNewsSource({source})`, `confirmNewsSource({confirmationId, candidateId?})`, `deleteNewsCustomSource(id)`, `createNewsTopic({label, guidance?})`, `deleteNewsTopic(id)`, `triggerNewsRevalidation()`.

**UI (authored jds-\* patterns only; no new raw colors — tokens.css rule):**

- Enable Add source: input → preview mutation → candidate list (radio when >1) → confirm mutation → invalidate personalization query. 409 duplicate / 400 limit / 503 unavailable render existing authored error states; candidate labels/domains render as plain text.
- Add topic form (label + optional guidance) with same error mapping (422 rejected → policy message).
- Remove buttons on each custom source/topic row → delete mutations.
- Retry button shown when any source/topic has `validationStatus !== "approved"` or `healthStatus === "unavailable"` → `triggerNewsRevalidation` → transient "queued" state.
- [ ] **Step 1:** write flows; **Step 2:** `pnpm --filter @jarv1s/news typecheck && pnpm lint` + `pnpm check:file-size`; **Step 3:** if an e2e news settings spec exists under `apps/web` e2e (mocked REST), extend it for add-source happy path + Retry; if none exists, note that in the PR body rather than inventing a harness.
- [ ] **Step 4: commit** `feat(news): settings add/remove/retry flows (#975)`.

### Task 10: Full gate + exit-criteria sweep

- [ ] `pnpm verify:foundation` (full local gate) + full `pnpm test:integration` (foundation.test.ts/catalog assert the FULL migration list — Task 1 covered it, confirm here).
- [ ] Sweep new code: no labels/domains/bodies in logs (`grep -n "logger" packages/news/src/revalidation.ts packages/news/src/schedule.ts packages/news/src/chat-tools.ts`), notification metadata ≤4096B counts-only, payload keys unchanged.
- [ ] Pre-push trio + `git fetch origin main && git rebase origin/main`.
- [ ] `coordinated-wrap-up`: PR states sentinel/privacy-test approach (positive-control RLS tests, transition-dedupe notification test, confirm-gate audit assertions, metadata-only payload asserts) so each council lens can re-run it. Do NOT merge.

## Self-review vs spec Exit Criteria

- Chat tools reuse preview/confirmation cards, confirm-gated, audit `approval_mode=confirmed` → Tasks 7–8. ✔
- Provider-change revalidation, idempotent, actionable statuses, availability surface reflects outcome → Tasks 2–5 (+ candidates.ts already filters non-approved/unavailable — no change needed there). ✔
- One summary notification via Notifications public boundary, no private content, owner-private → Task 4. ✔
- Error states + E2E flows across Settings/chat/Today/News → Tasks 6, 9 (Today/News pages already consume `validationStatus`/`healthStatus` badges from S2/S3 — verified on branch). ✔
- Type consistency check: `NewsRevalidationOutcome` fields used in Task 4 notification match Task 3 definition; `confirmSourceFromPreview` consumed in Task 7 only. ✔
