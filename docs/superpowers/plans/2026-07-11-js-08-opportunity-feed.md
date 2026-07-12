# JS-08 Opportunity Feed Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:test-driven-development, driven
> inline task-by-task (execution skills are disabled in this repo). Steps use checkbox syntax.

**Goal:** Expose the stored ranked feed (JS-07) through bounded assistant read tools + module UI
views, and add a confirm-gated `opportunity.decide` write (saved | passed) with owner-private
bounded reason.

**Architecture:** Three worker tool handlers over the existing `ctx.kv` domain (no migration, no
new repo). A new `src/domain/decisions.ts` composes `setOpportunity`-style status update +
`rebuildFeed` (lives outside `opportunities.ts` to avoid an import cycle with `feed.ts`). Web =
list cards + detail screen invoking the read tools via `useToolQuery`; NO web write path — decides
happen only through the assistant confirm flow (REST invoke of a write tool 403s by design,
verified `packages/ai/src/routes.ts:576-686`).

**Tech stack:** module worker handlers (`wrap.ts` envelope, `validate.ts` readers), module KV
domain, module web runtime (h/JSX, `useToolQuery`, authored `states.tsx`), vitest.

**Grounded on:** branch `feat/js-08-opportunity-feed` @ `c23a93b8` (JS-01..JS-07 merged).

## Global constraints (spec + handoff, verbatim where pinned)

- SECURITY tier: cross-owner denial tests WITH positive controls; bounded assistant context; no
  secrets; external text renders as text (JSX auto-escape, no `dangerouslySetInnerHTML`).
- Zero migration. Everything in `module_kv` via the domain. If a migration seems needed → STOP,
  escalate `[DESIGN-FORK]`.
- Error messages name keys/constraints only — never submitted values or record content
  (`InputError` / `JobSearchKvError` discipline).
- `KV_VALUE_MAX_BYTES` 65,535; `DESCRIPTION_MAX_BYTES` 16,384; `EVALUATION_MAX_BYTES` 24,576.
- REST invoke output path (`packages/ai/src/routes.ts:668-669`):
  `sanitizeAssistantToolResult(manifestTool.outputSchema, result)` allow-lists ONLY
  manifest-declared output keys (recursive), then `boundedAssistantToolResultData` degrades the
  whole response to `{text}` if `renderToolResult` exceeds 16,000 chars. Therefore: (a) every
  emitted field MUST appear in the tool's manifest `outputSchema`; (b) responses must stay under a
  serialized byte budget so structured data reaches the web UI.
- `invocation.result` REST schema is an open object (`nullableJsonObjectSchema`,
  `additionalProperties: true`) — no fast-json-stringify strip at the shared-schema layer; no
  `packages/shared` change needed. Verify via `app.inject` anyway (Task 7).
- Manifest validator passes `outputSchema` through (`packages/module-registry/src/external/tool-manifests.ts:41`).
- Never touch `docs/coordination/`; `git add` explicit paths only; conventional commits with
  `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

## Response contracts (single source for Tasks 2–5, 7–9)

New limits (add to `src/domain/limits.ts` in Task 1, values flagged to Coordinator):

```ts
export const DECISION_REASON_MAX_BYTES = 500;
// Detail/list responses must render (REST path) under 16,000 chars — budget with margin.
export const RESPONSE_BUDGET_BYTES = 14_000;
export const LIST_LIMIT_DEFAULT = 10;
export const LIST_LIMIT_MAX = 15;
export const LIST_TEXT_MAX_BYTES = 160; // title/evidence/gap caps in list cards
export const DETAIL_EVIDENCE_MAX_ITEMS = 6;
export const DETAIL_TEXT_MAX_BYTES = 240; // per evidence/gap/blocker/unknown/pref string
export const DETAIL_SUMMARY_MAX_BYTES = 800;
```

**`opportunities.list`** input `{ view?: "new"|"saved"|"passed"|"stale", limit?: int, offset?: int }`
(view default `"new"`; saved view ALSO matches status `active` — both protected user states).
Response:

```ts
{ status: "ok", view, total, limit, offset, opportunities: OpportunityCard[] }
// OpportunityCard — feed-index order preserved; NEVER includes description:
{
  identityHash, status, title, company,          // title ≤160B, company ≤120B (truncateUtf8)
  location?, workMode?, source /* adapterId */,
  publishedAt?, firstSeenAt, freshness,          // freshnessOf(job)
  eligibility?, fitBand?, confidence?,           // decoded from FeedEntry e/b/c via inverted
                                                 // FEED_GATE_CODES/FEED_BAND_CODES/FEED_CONFIDENCE_CODES
  evaluationPending,                             // = entry.b === undefined
  topEvidence?, topGap?                          // eval.evidence[0].evidence / eval.gaps[0], ≤160B,
                                                 // only when entry.b present (current eval)
}
```

**`opportunities.get`** input `{ identityHash }`. Response `{ status:"ok", opportunity: {...} }`:

```ts
{
  identityHash, status, statusAt, decisionReason?, firstSeenAt, lastSeenAt,
  freshness, lastLivenessAt?,
  posting: { title, company, location?, url?, workMode?, employmentType?, compensation?,
             publishedAt?, description, descriptionTruncated /* stored flag */,
             descriptionClipped /* response-level clip flag */ },
  evaluation?: {                                  // present only when an evaluation record exists
    fitBand, recommendation, postingConfidence, overallConfidence,
    summary /* ≤800B */, evidence /* ≤6 × {requirement,evidence,source} each ≤240B */,
    blockers, gaps, unknowns, preferenceMatches, preferenceConflicts /* each ≤6 × ≤240B */,
    outdated,                                     // isOutdated(record, current) — needs active
                                                  // profile+resume; missing either ⇒ outdated: true
    inputs: { opportunityContentHash, profileRevisionId, resumeRevisionId },
    createdAt
  }
}
```

Byte-budget rule (deterministic, testable): build the response with the description EMPTY, measure
`Buffer.byteLength(JSON.stringify(response))`, give the description
`min(storedLength, RESPONSE_BUDGET_BYTES − measured)` bytes via `truncateUtf8`;
`descriptionClipped = clipped`. Worst-case test fixture (16 KB description + maxed evaluation)
must assert total serialized ≤ `RESPONSE_BUDGET_BYTES`.

**`opportunity.decide`** input `{ identityHash, decision: "saved"|"passed", reason?: string ≤500B }`.
Response `{ status:"ok", identityHash, decision, statusAt }` — reason is stored, never echoed.
Unknown hash → `missing_record` envelope. Handler = `decideOpportunity` (Task 1) which updates
status/statusAt/decisionReason and calls `rebuildFeed`.

**outputSchema note (all three tools):** `wrap.ts` error envelopes (`{status,code,message}`) and
question responses flow through the same sanitize allow-list — every outputSchema MUST declare
`status`, `code`, `message`, `question` as optional strings with `required: ["status"]` only, or
error/question info is silently stripped.

## Flags for Coordinator at plan approval (do not decide alone)

1. **decide `reason`** (spec open question): bounded optional free text, 500-byte cap, stored
   owner-private on the job record (`decisionReason?`, additive-optional, schemaVersion stays 1),
   never in errors/logs, never echoed in tool responses. Recommend: accept.
2. **"Monitor health summary" tool** (spec Tools list): REUSE existing `monitor.list`/`monitor.get`
   (already expose cursor health timestamps) — no new tool. Recommend: accept.
3. **No web write path**: REST-initiated writes can never execute (no confirmation waiter — verified
   `gateway.ts:281-299` fail-closed). UI shows decision state + "decide via assistant" affordance
   copy; decides happen in assistant chat (confirm + audit). Matches spec's "canonical state comes
   from the confirmed tool result". Recommend: accept.
4. **`saved` view includes status `active`** records (both are protected user-committed states;
   UI has 4 buckets, status enum has 5). Recommend: accept.
5. **Response byte budgets** (`RESPONSE_BUDGET_BYTES` 14,000; list limit max 15; field caps above)
   — required because `EVALUATION_MAX_BYTES` (24,576) + description (16,384) exceed the 16,000-char
   REST render cap, which would degrade the web UI's structured responses to `{text}`. Detail
   description clips to fit with an explicit flag; UI links `posting.url` for the full source.
6. **Declared `outputSchema`** on all three tools (allow-list defense; registry already passes it
   through). Includes the error/question envelope keys per the note above.

---

### Task 1: Domain — `decisions.ts` (`decideOpportunity`) + `decisionReason` field

**Files:**

- Create: `external-modules/job-search/src/domain/decisions.ts`
- Modify: `external-modules/job-search/src/domain/opportunities.ts` (add
  `decisionReason?: string` to `OpportunityRecord`, doc-commented additive-optional)
- Modify: `external-modules/job-search/src/domain/limits.ts` (constants block above)
- Modify: `external-modules/job-search/src/domain/index.ts` (barrel exports)
- Test: `tests/unit/external-module-job-search-kv-decisions.test.ts` (new; `createMemoryKv`
  harness like `kv-retention` test)

**Interfaces (produces):**

```ts
export type OpportunityDecision = "saved" | "passed";
export const OPPORTUNITY_DECISIONS: readonly OpportunityDecision[];
/** Update status/statusAt (+ set or REMOVE decisionReason), then rebuildFeed. Returns updated record. */
export async function decideOpportunity(
  kv: JobSearchKv,
  identityHash: string,
  decision: OpportunityDecision,
  reason: string | undefined,
  now: Date
): Promise<OpportunityRecord>;
```

Guards: `assertHash`; missing record → `JobSearchKvError("missing_record", ...)`; reason over
`DECISION_REASON_MAX_BYTES` → `JobSearchKvError("invalid_record", "decisionReason exceeds 500 bytes of UTF-8")`
(defense-in-depth under the handler's `readString maxBytes`); reason `undefined` deletes any stored
`decisionReason` (a fresh decision without reason clears the old one).

- [ ] Failing tests: saved sets status+statusAt+reason and rebuilds feed (assert `readFeed` entry
      `s` changed); passed w/o reason clears prior reason; missing hash throws `missing_record`;
      oversized reason throws + writes nothing; decision survives content-refresh upsert (upsert
      preserves status fields — positive re-assertion with the new field).
- [ ] `pnpm vitest run tests/unit/external-module-job-search-kv-decisions.test.ts` → FAIL
- [ ] Implement; re-run → PASS
- [ ] Commit: `feat(job-search): decideOpportunity domain — status + bounded owner-private reason + feed rebuild`

### Task 2: Worker — `opportunities.list` handler (+ `readInt` reader)

**Files:**

- Modify: `external-modules/job-search/src/worker/validate.ts` (add `readInt(input, key, {min, max})`
  — overloaded like `readBool`; rejects non-integer/NaN; message names key+constraint only)
- Create: `external-modules/job-search/src/worker/handlers/opportunities.ts`
- Test: `tests/unit/external-module-job-search-handlers-opportunities.test.ts` (harness =
  `handlers-monitor.test.ts`: `createMemoryKv`, `portsAt`, seed via domain writers)

**Interfaces (produces):** `listOpportunitiesHandler(ports: WorkerPorts): ToolHandler` per the
list contract above. Flow: validate input (`readEnum` view, `readInt` limit/offset) →
`readFeedOrRebuild(kv, ports.now())` → filter entries by view (saved ⇒ `s ∈ {saved, active}`) →
slice `[offset, offset+limit)` → per entry `getOpportunity` (skip nulls — index self-heals later) +
`getEvaluation` ONLY when `entry.b` present → compose capped card. Decode maps built by inverting
`FEED_GATE_CODES`/`FEED_BAND_CODES`/`FEED_CONFIDENCE_CODES` (import from `domain/feed.js`).

- [ ] Failing tests: default view/new + limit 10; view filter incl. saved-includes-active;
      pagination (`total` = view count, offset slice, limit clamp → `InputError` above
      `LIST_LIMIT_MAX`); no description anywhere in response (deep scan of JSON string);
      pending eval ⇒ `evaluationPending: true`, no band/evidence; caps applied (long
      title/evidence truncated); worst-case 15 maxed cards ≤ `RESPONSE_BUDGET_BYTES`;
      unknown input key ignored at handler level (manifest schema rejects earlier).
- [ ] Run → FAIL; implement; run → PASS
- [ ] Commit: `feat(job-search): opportunities.list — bounded feed cards over the JS-07 index`

### Task 3: Worker — `opportunities.get` handler (bounded detail)

**Files:** same handler file + test file as Task 2.

**Interfaces (produces):** `getOpportunityHandler(ports): ToolHandler` per the detail contract,
including the deterministic description byte-budget rule. `evaluation.outdated` computed via
`getActiveProfile`/`getActiveResume` + `isOutdated`; either pointer missing ⇒ `outdated: true`.

- [ ] Failing tests: full shape for a seeded job+eval (revisions/inputs surfaced); missing hash →
      `missing_record` envelope via `wrap`; no evaluation ⇒ `evaluation` absent; outdated=true when
      profile revision moved AND when no active resume; worst-case fixture (16 KB description,
      maxed eval) ⇒ serialized ≤ `RESPONSE_BUDGET_BYTES`, `descriptionClipped: true`, evidence
      trimmed to 6×240B; small record ⇒ `descriptionClipped: false`, description intact.
- [ ] Run → FAIL; implement; run → PASS
- [ ] Commit: `feat(job-search): opportunities.get — bounded detail with evaluation + revisions`

### Task 4: Worker — `opportunity.decide` handler

**Files:** same handler + test files.

**Interfaces (produces):** `decideOpportunityHandler(ports): ToolHandler` — `readString
identityHash` + `assertHash`, `readEnum decision OPPORTUNITY_DECISIONS`, `readString reason
{maxBytes: DECISION_REASON_MAX_BYTES}` → `decideOpportunity` → `{status:"ok", identityHash,
decision, statusAt}`.

- [ ] Failing tests: saved decision persists + feed rebuilt (read feed, entry `s === "saved"`);
      response never contains the reason string; oversized reason → `invalid_input` envelope
      naming key+cap only (assert message does NOT contain the submitted value); unknown hash →
      `missing_record`; invalid decision value → `invalid_input` listing allowed values.
- [ ] Run → FAIL; implement; run → PASS
- [ ] Commit: `feat(job-search): opportunity.decide handler — confirm-gated decision write`

### Task 5: Registry wiring + manifest schemas

**Files:**

- Modify: `external-modules/job-search/src/worker/registry.ts` (3 stubs → real factories; update
  header comment)
- Modify: `external-modules/job-search/jarvis.module.json` — the 3 tools get strict `inputSchema`
  (`additionalProperties: false`, properties per contracts; decide `required:
["identityHash","decision"]`, decision `enum`) AND full `outputSchema` (every response field
  above, nested items schemas, plus optional `status/code/message/question` strings,
  `required: ["status"]`).
- Modify: `tests/unit/external-module-job-search-manifest.test.ts` — move the 3 names from `STUBS`
  to `IMPLEMENTED`, delete the stub-placeholder test, add: decide input pins (enum + required +
  reason maxLength if expressed), and an outputSchema-declares-envelope-keys assertion for all 3.
- Check/modify registry-pinning tests: `grep -l "notImplemented" tests/unit/` (onboarding/capture/
  monitor handler tests pin `HANDLERS`) — update pins to the real factories.

- [ ] Update tests first → FAIL; wire registry + manifest; run
      `pnpm vitest run tests/unit/external-module-job-search-manifest.test.ts tests/unit/external-module-job-search-handlers-onboarding.test.ts` (+ any other pinning file) → PASS
- [ ] `pnpm vitest run tests/unit` (module bundle test rebuilds artifact) → PASS
- [ ] Commit: `feat(job-search): register JS-08 tools with strict input/output schemas`

### Task 6: Integration — KV isolation extension (SECURITY headline)

**Files:** Modify `tests/integration/external-module-job-search-kv-isolation.test.ts` (extend the
existing real-RPC harness; it already builds per-actor `WorkerPorts` over
`createExternalModuleRpcHandler`).

- [ ] New tests (follow the file's seeded-userA pattern): (a) userA seeds job + eval +
      `rebuildFeed`; positive control: userA's `readFeed` has the entry, `opportunities.get`
      handler over userA ports returns it; (b) userB `readFeed` → `null`, `listOpportunities` → 0,
      `getOpportunity(hashOfA)` → null, decide handler on A's hash → `missing_record` (KV scoping
      denies by construction); (c) admin actor: same denials; (d) userB decide attempt leaves
      userA's record status unchanged (re-read as A).
- [ ] `pnpm exec tsx scripts/test-integration.ts tests/integration/external-module-job-search-kv-isolation.test.ts` → PASS
- [ ] Commit: `test(job-search): cross-owner denial + positive controls for feed reads and decisions`

### Task 7: Integration — REST invoke surface (`app.inject`)

**Files:** Modify `tests/integration/js06-module-surface.test.ts` (same booted-server harness;
extends the JS-06 data-plane block) — or a sibling `js08-` file if the JS-06 file is near the
1000-line cap.

- [ ] New tests: seed member's KV via a worker-side write path already proven in the harness (or
      direct domain writes with the member's owner id, mirroring the isolation harness), then:
      (a) `opportunities.list` over REST → 200, `invocation.result.opportunities[0]` carries
      title/fitBand/freshness/topEvidence — proves outputSchema allow-list keeps every declared
      field AND fast-json-stringify passes them (the trap test, via `app.inject` NOT the service);
      (b) `opportunities.get` → posting + evaluation fields survive; description present, bounded;
      (c) `opportunity.decide` over REST → 403 `confirmation_required`, and a follow-up list shows
      the status UNCHANGED (write never executed — confirm-gate proof);
      (d) disable module → list invoke 404 (fail-closed), re-enable → data still there
      (decide/disable/re-enable survival).
- [ ] Run that file via `pnpm exec tsx scripts/test-integration.ts ...` → PASS
- [ ] Commit: `test(job-search): REST invoke surface — declared fields survive, decide stays confirm-gated`

### Task 8: Web — opportunities list screen

**Files:**

- Rewrite: `external-modules/job-search/src/web/screens/opportunities.tsx` — keep
  `BUCKETS`/`bucketFromPath` + nav; add `useToolQuery("job-search.opportunities.list", { view:
bucket })` behind `outcomeGate` (loading/disabled/blocked/error via authored states); cards as a
  `jsm-stack` list: title (ModuleLink → `/opportunities/${bucket}/${identityHash}`), company ·
  location · workMode, mono eyebrow = source + published/first-seen (`whenLabel`), badges for
  freshness/fitBand/confidence or "evaluation pending", topEvidence/topGap lines. Empty view uses
  `EmptyState` with copy distinguishing "no credible matches yet" (feed has entries elsewhere /
  monitors exist) from generic emptiness; degraded fetch → `ErrorState`.
- Test: extend `tests/unit/job-search-web-screens.test.tsx`: renders cards from a stubbed list
  outcome; bucket filter drives tool input; **#960-style test:** a title/evidence of
  `&lt;img src=x onerror=alert(1)&gt;` and `<script>` renders as LITERAL TEXT (assert the rendered
  HTML contains the escaped sequence and no `<script`); keyboard: bucket nav links + card links
  are anchors (focusable), `aria-current` preserved.
- [ ] Tests first → FAIL; implement; `pnpm vitest run tests/unit/job-search-web-screens.test.tsx tests/unit/job-search-web-core.test.tsx` → PASS
- [ ] Commit: `feat(job-search): opportunity feed cards in the module web UI`

### Task 9: Web — opportunity detail screen

**Files:**

- Create: `external-modules/job-search/src/web/screens/opportunity-detail.tsx` — path
  `/opportunities/<bucket>/<hash>` (extend `bucketFromPath` file with `hashFromPath` reading
  segment 3; `OpportunitiesScreen` renders detail when present). `useToolQuery("job-search.opportunities.get",
{ identityHash })` + `outcomeGate`. Sections: posting header (title/company/meta, external link
  to `posting.url`), description as pre-wrap TEXT with explicit truncation notices for BOTH
  `descriptionTruncated` (stored) and `descriptionClipped` (response), evaluation block (band/
  recommendation/confidences/summary/evidence table/gaps/unknowns/blockers/preferences, outdated
  banner, revisions used in a mono footnote), decision state (status/statusAt/decisionReason) +
  copy: decisions are made in the assistant ("Ask the assistant to save or pass this
  opportunity") — NO write button. Back link to the bucket. Serif heading / mono eyebrow / jds-\*
  classes only; no new raw colors.
- Test: same web-screens test file — detail renders sections from stubbed outcome; entity-encoded
  description stays literal; missing-hash error outcome → `ErrorState`; back link + heading
  structure (h2 landmark) for a11y.
- [ ] Tests first → FAIL; implement; run web tests → PASS
- [ ] Commit: `feat(job-search): opportunity detail view — bounded description, evaluation, decision state`

### Task 10: Gate + wrap-up

- [ ] `pnpm verify:foundation` (full local gate; record exit code)
- [ ] Pre-push trio + `git fetch origin main && git rebase origin/main`
- [ ] Invoke `coordinated-wrap-up` (PR `Closes #937`, user-facing summary in release-note
      language, report to Coordinator)

## Self-review notes

- Spec coverage: Views ✔ (T2/T8 cards, T3/T9 detail, buckets/stable URLs pre-exist), Tools ✔
  (T2–T5; monitor-health = reuse, flag 2), decisions bind actor/audit/rebuild/protection ✔ (T1,
  T4; audit+confirm are host machinery, proven in T7c), UI behavior ✔ (T8/T9; optimistic updates
  = none, presentation only), Verification bullets → T2/T3 (bounded schemas), T3 (description
  detail-only, explicit truncation), T7 (confirm/audit/survival), T6 (cross-owner), retention
  protection (T1 test reuses JS-02 invariants; saved never evicted already pinned in
  `kv-retention` tests), a11y/external-text (T8/T9).
- Type consistency: `OpportunityDecision`/`decideOpportunity` defined T1, consumed T4;
  card/detail contracts defined once above, consumed T2/T3/T5 (outputSchema)/T8/T9.
- No placeholder steps remain; handler internals follow the `monitor.ts` pattern cited per task.
