# JS-07 Plan — freshness, deduplication, and AI fit bands (#936)

**Grounded on:** branch `feat/js-07-plan` @ `4e5075e2` (root `9d4589d1` = JS-05 merged; JS-03 + JS-05
prerequisites verified live in this tree). Task spec: `2026-07-10-job-search-js-07-ranking.md`.
Design: `2026-07-10-job-search-module-design.md`. Zero migration: **confirmed** — all state is
owner-scoped `module_kv` via `ctx.kv`; RLS on `module_kv` (migration 0154) already provides
cross-owner denial.

**Tier: SECURITY.** Coordinator ruling 2026-07-11 (Council/Opus): Step 0 activates the worker AI
capability boundary (#915 D6 queue-path `ctx.ai`), so the whole slice runs at security tier —
security-tier QA required before merge. Step 0 is FOLDED INTO JS-07 (not split to a precursor);
JS-07 is its only consumer and #915 already satisfies the spec gate.

## Premise grounding (what was verified by opening files)

| Spec premise                                               | Verdict                                      | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ---------------------------------------------------------- | -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| JS-02 KV domain + retention exists                         | **HOLDS**                                    | `domain/keys.ts`, `records.ts`, `retention.ts` — 7-step pass, tombstone-first eviction, 500 cap, feed rebuild                                                                                                                                                                                                                                                                                                                           |
| Dedup identity `(adapterId, externalJobId)` + URL fallback | **HOLDS, already built**                     | `keys.ts` `opportunityIdentity` (`id\0`/`url\0` prefixes prevent cross-path collisions); `upsertOpportunity` idempotent on `(identityHash, contentHash)`                                                                                                                                                                                                                                                                                |
| Evaluation identity tuple                                  | **HOLDS, already built**                     | `keys.ts` `evaluationIdentity(opportunityContentHash, profileRevisionId, resumeRevisionId)` — defined in JS-02, unused so far                                                                                                                                                                                                                                                                                                           |
| JS-03 truth guard + approved revisions                     | **HOLDS**                                    | `getActiveProfile`/`getActiveResume`; onboarding state carries `approvedProfileRevisionId`/`approvedResumeRevisionId`; `PROFILE_FIELD_KEYS` already includes every deterministic-gate fact (compensation, employmentTypes, needsSponsorship, dealbreakers, excludedCompanies, locations, remotePreference, industries)                                                                                                                  |
| JS-05 monitor runs + run outputs                           | **HOLDS**                                    | `worker/handlers/run.ts` — counts-only run records; stale-marking explicitly deferred to JS-07 (comment at `run.ts:13-15`)                                                                                                                                                                                                                                                                                                              |
| `ctx.ai` surface exists                                    | **HOLDS on API path, MISSING on queue path** | SDK `worker.ts` + host `worker-rpc-host.ts` implement D6 (8-call/invocation cap, secret-composition guard, provider-agnostic envelope, `tierHint: "interactive"` supported). But `apps/worker/src/worker.ts:263` builds the RPC handler **without** the `ai` dep → `ai.generateStructured` fails closed in queue jobs. #915 spec D6 explicitly requires `ctx.ai` in queue invocations — the wiring is approved but unbuilt. See Step 0. |
| Structured job facts available for the gate                | **PARTIAL**                                  | Adapters emit `publishedAt`/`workMode`/`employmentType`/`compensation`/`locations[]` (`adapters/types.ts`), but `postingToOpportunity` (`run.ts:69`) and `OpportunityRecord.posting` **drop them**. JS-07 must carry them through (Step 1).                                                                                                                                                                                             |
| Freshness state `active\|uncertain\|stale`                 | **NET-NEW**                                  | `OpportunityStatus` mixes lifecycle + freshness (`"stale"` is a status). No `publishedAt`, no liveness timestamp, no board linkage on the record.                                                                                                                                                                                                                                                                                       |
| Zero migration                                             | **HOLDS**                                    | Everything below is `module_kv` records in already-declared namespaces. No manifest storage change either — evaluation lives in `job-search.opportunities` (design doc line 129 pins "freshness/evaluation" to that namespace).                                                                                                                                                                                                         |

## Hard constraints discovered (bake into implementation)

1. **`records.ts` hard-pins `schemaVersion === 1` on read AND write.** A version bump would make
   every existing reader throw `invalid_schema_version`. All record changes MUST be additive
   optional fields on schemaVersion 1. Old records lacking new fields read as
   "unknown/uncertain" — that matches the spec's missing-data-is-unknown rule.
2. **`AI_CALLS_PER_INVOCATION_CAP = 8`** (host-side, repair attempts included). The 25/day budget
   can NEVER be spent in one `monitor.run` invocation. The evaluation loop must cap per-invocation
   work at min(remaining daily budget, ~6 — headroom for repairs) and rely on later sweeps/run-nows
   to drain the backlog oldest-first. Do not raise the platform cap.
3. **No board linkage on `OpportunityRecord`** (`run.ts` comment): two monitors on one adapter watch
   different boards, so absence-from-fetch is only meaningful per board. Add additive `sourceKey`
   (= 32-hex hash of `adapterId\0board`) at upsert; records without it stay `uncertain` until
   re-seen. Fetch failure never touches freshness (JS-05 already records failure without mutating
   opportunities — keep that).
4. **KV value cap 65,535 bytes** and description alone can be 16 KB — do NOT embed evaluations in
   the job record. Store them as a sibling key family in the same namespace (see key ABI below)
   with their own byte cap.
5. **No REST surface changes.** JS-07 is domain + worker-handler code; tool envelopes flow through
   the generic module-invoke path. The `packages/shared/*-api.ts` response-schema trap does not
   bite this slice (re-check at review if any response field is added to a core route — none
   planned).

## Key ABI additions (NS.opportunities unless noted)

| Key                             | Record                             | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------- | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `eval/<identityHash>`           | `EvaluationRecord`                 | schemaVersion 1; carries `evaluationId` (from existing `evaluationIdentity`), fit band, recommendation, evidence pairs, blockers/gaps/unknowns, preference matches/conflicts, posting+overall confidence, summary, exact input hashes, `createdAt`, `outdated: boolean`. Byte-capped (`EVALUATION_MAX_BYTES`, propose 24_576). Old evaluations immutable — an input change writes a NEW record over the same key only after marking semantics: latest wins, `outdated` computed on read by comparing stored hashes to current inputs (no rewrite storm). |
| `evalBudget/<YYYY-MM-DD>`       | `{ schemaVersion: 1, date, used }` | Daily cap ledger. Date string satisfies `assertId`. Stale ledger keys pruned in retention Step 5b.                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| (existing) `job/<identityHash>` | additive fields                    | `publishedAt?`, `workMode?`, `employmentType?`, `compensation?`, `sourceKey?`, `freshness?: "active"\|"uncertain"\|"stale"`, `lastLivenessAt?`                                                                                                                                                                                                                                                                                                                                                                                                           |

Feed index entries (`NS.feed`) gain additive rank inputs (`isFeedEntry` only checks `h`/`r`/`s`
presence, so additive fields are compatible): `f?` (freshness), `b?` (fit band), `c?` (confidence),
`p?` (postedAt/firstSeen rank key), `e?` (eligibility). `r` stays populated for old readers.

## Steps (TDD-ordered — each step: tests first, then code)

**Step 0 — platform: wire `ctx.ai` into the queue path. SECURITY-TIER, ISOLATED COMMIT.**
Ruled into JS-07 by Coordinator 2026-07-11 (fold, not precursor). Add
`apps/worker/src/external-module-ai-bridge.ts` mirroring `apps/api/src/external-module-ai-bridge.ts`
and pass `ai:` into `createExternalModuleRpcHandler` at `worker.ts:263` (`apps/worker` already
depends on `@jarv1s/ai`). Land as its own commit before any module code so it reviews and reverts
independently.

_Step 0 traps (from ruling — violations are blockers):_

- Run the ai callback under the **actor DataContext**: the host invokes it inside
  `withDataContext` passing `scopedDb` — the worker bridge must be shaped
  `(scopedDb, request) => generateStructured(scopedDb, …)` exactly like the api's
  `(db, req) => ai(db, module.id, req)`. NEVER hand it the root `workerDb`.
- **Reuse the cipher already constructed in `worker.ts`** and build ONE `AiRepository` from it —
  no second env-keyed cipher.
- Never thread provider secrets through the job payload; credentials resolve worker-side via the
  cipher + `AiRepository` on the actor-scoped DB.
- Drop `usage`/`model`/`provider` from the result before it crosses to the module (mirror the api
  bridge; the host envelope-rebuild is defense in depth, not the only guard).
- JS-07's daily budget (25) and per-invocation eval cap (6) live ABOVE the host
  `AI_CALLS_PER_INVOCATION_CAP = 8` — do NOT raise the platform cap to fit.
- Fail-closed parity: ONLY this module-rpc handler construction gains the `ai` dep; every other
  path stays without it.

_Step 0 acceptance tests (invariants to PROVE, not assume):_

1. **Secrets never escape:** `ExternalModuleJobPayload` carries NO provider credentials
   (`assertModuleJobPayload` unchanged — metadata-only payload invariant intact); the
   module-visible result contains no `usage`/`model`/`provider` fields.
2. **Provider-agnostic:** module requests capability + `tierHint` only;
   `resolveModelForCapability` picks the model; grep-style test asserts no provider or model
   string appears in the module's prompt or output.
3. **Composition guard fires ON THE QUEUE PATH:** a credential resolved via `ctx.auth` during the
   invocation, then placed in a `ctx.ai` request, yields the typed
   `forbidden_secret_in_ai_input` error — proven end-to-end on a queue invocation, not only in
   host unit tests.
4. **Fail-closed:** `resolveModelForCapability` → null means `ctx.ai` returns a typed error, JS-07
   survivors stay `evalPending`, and the run does not throw.
5. **Per-invocation cap (8)** enforced on queue invocations (9th call → `usage_limited`).

**Step 1 — carry structured posting facts through ingestion.** Extend `OpportunityInput.posting` +
`OpportunityRecord.posting` (additive optional: `publishedAt`, `workMode`, `employmentType`,
`compensation`) and add top-level `sourceKey`; update `postingToOpportunity` to map them and to
compute `sourceKey` from `(adapterId, boardConfig.board)` (thread `board` through the call — it is
in scope in `runMonitorDiscovery`). Content hash already covers the full posting object, so a fact
change re-triggers evaluation for free. Tests: mapping, hash stability for unchanged postings,
old records read fine.

**Step 2 — freshness domain (`domain/freshness.ts`).** Pure transition function + a
`markFreshnessAfterRun(kv, { sourceKey, seenIdentityHashes, now })` pass called ONLY after a
successful fetch: seen → `freshness: "active"`, `lastLivenessAt: now`; same-`sourceKey` records not
seen → `stale` (and `status: "stale"` only when status is `new`/`passed` — never clobber
`saved`/`active` user decisions); records with no `sourceKey` → `uncertain`. Fetch failure path
untouched. Tests: transitions, cross-monitor non-contamination (two boards, one adapter),
failure-never-stales, saved-status preservation.

**Step 3 — deterministic gate (`domain/gate.ts`).** Pure function
`applyGate(profileFields, record) → { verdict: "eligible" | "excluded" | "flagged", reasons[] }`
using only explicit structured facts: excludedCompanies/industries match, employmentTypes/workMode
incompatibility, confirmed geo/sponsorship impossibility, compensation below confirmed minimum,
dealbreakers, authoritative closure (stale freshness). Profile field VALUES are untyped
(`Record<string, unknown>`) — parse defensively; anything missing/unparseable = unknown, never a
rejection. Tests: every gate, every unknown case, empty-profile passes all.

**Step 4 — evaluation records + daily budget (`domain/evaluations.ts`).** Repo for
`eval/<hash>` + `evalBudget/<date>`: `getEvaluation`, `saveEvaluation` (byte-capped),
`isOutdated(record, currentHashes)`, `takeBudget(kv, date, n, cap=25)`. Local-day date computed via
existing `localDateAndTime(now, tz)`; **timezone = `DEFAULT_TIMEZONE` (UTC) for the user-level
ledger** (see Open decisions). Retention: prune `evalBudget/*` older than 7 days and delete
`eval/<h>` when its job is evicted (extend `evictOpportunity`); add to `retention.ts` tests.

**Step 5 — AI fit-band evaluator (`worker/evaluate.ts`).** Fixed JSON schema (module constant)
matching the spec output list; prompt assembles approved profile fields + active resume text +
bounded normalized job facts/description with the job text explicitly framed as untrusted data;
requests `tierHint: "interactive"`. No provider/model names anywhere in module code or output
(host already strips them). Selection: deterministic-gate survivors that are new or materially
changed (contentHash ≠ evaluated hash, or revision ids changed) with no current evaluation, sorted
oldest-pending-first (firstSeenAt, hash tie-break); per invocation process
`min(remainingDailyBudget, PER_INVOCATION_EVAL_MAX = 6)`. `ports.ai === null` or any error result →
survivors stay visible with evaluation pending (no throw, counts-only reporting). Tests: cap
accounting (exact 25, day rollover, backlog order), schema-validation failure leaves pending,
injection fixture (job text containing tool-call/instruction prose) produces no state change beyond
a normal evaluation record and no tool invocation (worker has no tools during eval by
construction — assert the prompt path calls only `generateStructured`), provider-agnostic assertion
(grep-style test: no provider identity in module output).

**Step 6 — ordering + feed (`domain/feed.ts`).** Extend `rebuildFeed` to read evaluations and emit
the spec sort: eligibility → fit band (strong > possible > low > pending) → confidence → freshness
→ postedAt/firstSeenAt. Pending survivors sort below completed strong/possible but stay present.
Additive entry fields; old index still readable. Tests: full ordering matrix, corrupt-index rebuild
still works.

**Step 7 — wire into `runMonitorDiscovery`.** After ingestion + before retention: freshness pass
(Step 2, using this run's seen set); after retention: gate + evaluate (Steps 3–5) then the feed
rebuild already inside `runRetentionPass` picks up results (reorder so evaluation precedes the
rebuild, or rebuild once more — build agent measures which is cheaper; feed rebuild is cheap).
Extend run `counts` (counts only: `evaluated`, `evalPending`, `gateExcluded`, `staleMarked`).
Tests: run-twice-identical produces one evaluation; changed content re-evaluates; AI failure leaves
prior state.

**Step 8 — integration + security tests.** In the existing module integration suite: cross-owner
denial (actor B cannot read A's `eval/*` / `evalBudget/*` — module_kv RLS), queue-path ctx.ai
end-to-end (Step 0), full pipeline fixture run (ingest → gate → evaluate → feed order), and the
JS-09-bound run-twice dedup check at module level.

## Files touched (complete list)

- `apps/worker/src/worker.ts`, new `apps/worker/src/external-module-ai-bridge.ts` (or shared hoist) — Step 0
- `external-modules/job-search/src/domain/`: `keys.ts` (eval/evalBudget builders), `opportunities.ts` (additive fields), `freshness.ts` (new), `gate.ts` (new), `evaluations.ts` (new), `feed.ts`, `retention.ts`, `limits.ts` (EVALUATION_MAX_BYTES, EVAL_DAILY_CAP=25, PER_INVOCATION_EVAL_MAX), `index.ts`
- `external-modules/job-search/src/worker/`: `handlers/run.ts`, `evaluate.ts` (new)
- Tests mirroring each of the above (module unit + integration suites)
- NO migration, NO manifest storage change, NO `packages/shared` API change, NO web code

## Open decisions (flagged to Coordinator; defaults chosen so build can proceed)

1. **RULED 2026-07-11 (Council/Opus): FOLD.** Step 0 (queue-path ctx.ai wiring) is included in
   JS-07 as an isolated commit — not split to a precursor. #915 D6 satisfies the spec gate; JS-07
   is the only consumer. Consequence: the whole slice is SECURITY tier (see header) with the Step 0
   traps and acceptance tests above as blockers.
2. Daily-cap timezone: spec says "per user per local day" but no user-level timezone exists.
   Default: UTC ledger date (deterministic, testable). Alternative (monitor timezone) makes the cap
   ledger ambiguous across monitors. Low stakes — cap is a cost bound, not UX.
3. Evaluation stored as sibling `eval/<h>` key rather than inside the job record (design doc line
   129 wording says the job key holds "freshness/evaluation"). Deviation is size-driven (constraint
   4 above); same namespace, same retention ownership. Treated as plan-level refinement, not a fork.
