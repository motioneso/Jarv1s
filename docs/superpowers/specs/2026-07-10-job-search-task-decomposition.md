# Intelligent job search — task decomposition and dependency map

**Status:** Draft — issue plan only; no build lanes authorized

**Date:** 2026-07-10

**GitHub:** #913 and #860

**Grounding:** grounded on `eafa22dd`

---

## Outcome

The MVP can start only after the external runtime can execute actor-scoped handlers, read/write KV,
run scheduled jobs, perform host-pinned fetches, and call structured AI. The package itself should
then be built as small task-issue-sized slices in the strict order below.

Every `JS-*` slice is filed as a `task` + `needs-spec` child of #913. Filing preserves dependency
tracking but does not authorize any branch or build agent before Ben's final approval.

## Runtime prerequisites

| Runtime item                                                                          | State at `eafa22dd`                                                                    | Hard for MVP?              | Why / required action                                                                                                                             |
| ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| #917 external discovery + fail-closed activation                                      | Merged                                                                                 | Yes, satisfied             | Package must remain outside `BUILT_IN_MODULES` and inactive until enabled.                                                                        |
| #918 external web, credentials, KV                                                    | Merged                                                                                 | Yes, satisfied             | Supplies the dedicated `Root`, owner-scoped KV, encrypted credentials, export/delete substrate.                                                   |
| #919 child worker, `ctx.kv`/`ctx.auth`, external tools through `AssistantToolGateway` | In flight                                                                              | Yes                        | No package handler can access storage or execute tools before this lands. It must also expose the already-merged structured-AI seam as `ctx.ai`.  |
| #915 structured-AI parent seam                                                        | Merged as PR #923; issue closed                                                        | Yes, parent half satisfied | Provider-agnostic schema-validated execution exists; #919 must finish the child RPC, caps, and cancellation path.                                 |
| #915 external queues/schedules/run-now                                                | Design rev 2 approved at `6019f94f`; implementation unmerged; issue prematurely closed | Yes, unsatisfied           | Scheduled stateful monitoring and “Run now” cannot be built without it. File a replacement task issue retaining the approved design.              |
| #915 host-pinned `ctx.fetch`                                                          | Design rev 2 approved at `6019f94f`; implementation unmerged; issue prematurely closed | Yes, unsatisfied           | Recurring adapters need enforced hosts, redirect/IP checks, time/size caps. File a replacement task issue retaining the approved design.          |
| #916 assistant starter prompt                                                         | Narrow generic spec added with this review                                             | Yes, unsatisfied           | One-click conversational onboarding is required. Narrow #916 to the host starter action only; Briefings remains deferred.                         |
| #916 Briefings dispatch                                                               | Issue open, no approved spec at baseline                                               | No                         | Briefings is not in #913's six-part MVP. Defer until discovery proves useful.                                                                     |
| #914 external relational data plane                                                   | In flight                                                                              | No for bounded KV MVP      | The settled caps fit per-record `module_kv`. #914 is reserved for future unbounded history, larger artifacts, relational reporting, or CRM scope. |

### Tracking correction required

#915 is closed even though PR #923 implemented only its structured-AI slice. Ben approved worker
capabilities design revision 2 on 2026-07-09 at `6019f94f`, but the queue/schedule/run-now and
pinned-fetch implementations remain unmerged. Before job-search build planning, both must have
replacement task issues retaining the approved acceptance criteria. A closed issue must not be
treated as evidence those runtime contracts exist.

## Strict dependency order

```text
#917 (done) ─┐
#918 (done) ─┼─> #919 ───────────────┐
PR #923 ─────┘                       ├─> JS-01 ─> JS-02 ─┬─> JS-03 ─┐
#915 queues/schedules/run-now ───────┤                  │          ├─> JS-07 ─> JS-08 ─> JS-09
#915 pinned fetch ───────────────────┘                  ├─> JS-04 ─> JS-05 ─┘
#916 starter action ────────────────────────────────────┘
                                                        JS-06 depends on JS-02 + JS-03
```

The runtime prerequisites may proceed in parallel under #860. Job-search tasks remain sequential at
their declared dependency boundaries; the diagram does not authorize parallel build lanes.

## Filed task issues

### JS-01 (#930) — Package contract and fail-closed fixture

**Task spec:** `2026-07-10-job-search-js-01-package-contract.md`

**Depends on:** final #919 external manifest/worker ABI, merged #917/#918.

**Delivers:** independently buildable `jarv1s.job-search` package skeleton, JSON manifest, web/worker
entrypoints under `external-modules/job-search/`, declared namespaces/permissions, compatibility
gates, and packaging test proving it is outside the core workspace, default image, and
`BUILT_IN_MODULES`.

**Verification:** install/enable/disable/hash-drift contract fixture; no product behavior or data yet.

### JS-02 (#931) — Owner-scoped KV domain and retention contract

**Task spec:** `2026-07-10-job-search-js-02-kv-domain.md`

**Depends on:** JS-01 and #919 `ctx.kv`.

**Delivers:** schemas and repositories over declared user KV namespaces for onboarding, profile,
resume, monitor, opportunity, run, and derived feed records; per-value caps; idempotent keys; bounded
retention; export/delete/disable/purge coverage. No core table or migration.

**Verification:** schema-version upgrades, cap rejection, derived-index rebuild, owner/admin
isolation, lifecycle tests.

The fixed contract is 48 KB normalized Markdown per revision plus capped original `revision/0`, a
500-opportunity retention target with protected active/saved overflow, 16 KB descriptions, 30-day
passed/stale eviction, 60-day tombstones, and 50/14-day run retention.

### JS-03 (#932) — Profile, resume truth guard, and conversational tools

**Task spec:** `2026-07-10-job-search-js-03-onboarding-truth-guard.md`

**Depends on:** JS-02, #919 gateway dispatch, #919 `ctx.ai`, and the required #916 starter action.

**Delivers:** resumable onboarding state; profile revisions; resume critique/draft/approval tools;
evidence mapping; diff approval; unsupported-claim rejection.

**Verification:** new user completes all six checkpoints; no inferred fact becomes approved
without confirmation; provider/model remains router-owned.

### JS-04 (#933) — Compliant source adapter foundation

**Task spec:** `2026-07-10-job-search-js-04-source-adapters.md`

**Depends on:** JS-01 and external `ctx.fetch`.

**Delivers:** adapter contract inside the package, exact host declarations, compliance metadata,
configuration validation, untrusted-content sanitation, courtesy controls, and Greenhouse, Lever,
Ashby, manual-URL, and pasted-description fixtures. Reuses governed `web.search`/`web.read` for
onboarding discovery only.

**Verification:** undeclared/private/redirected hosts fail; supported fixtures normalize; prohibited
or unknown adapters stay disabled.

### JS-05 (#934) — Scheduled monitor execution and run-now

**Task spec:** `2026-07-10-job-search-js-05-monitoring.md`

**Depends on:** JS-02, JS-04, external queue/schedule reconciliation, and generic run-now.

**Delivers:** metadata-only queue declaration; one hourly manifest-static due-check reading
local due time/last-run date from KV; monitor cursor/run state; idempotent normalization/upsert;
failure isolation; at most one local-day run and no catch-up storm.

**Verification:** two identical runs do not duplicate; browser/chat may be closed; manual double-click
dedupes; transient source failure retains known jobs; payload contains metadata only.

### JS-06 (#935) — Dedicated module surface and onboarding handoff

**Task spec:** `2026-07-10-job-search-js-06-module-surface.md`

**Depends on:** JS-02, JS-03, merged #918 web root, and required #916 starter action.

**Delivers:** `/m/jarv1s.job-search/*` authored UI for onboarding status, profile/resume approval,
monitor health/config, loading/empty/degraded states. Reads/writes only through declared tools and
generic platform routes.

**Verification:** shared React host, tokenized UI, module disable removes surface, no bespoke core
route, external text rendered safely.

### JS-07 (#936) — Freshness, deduplication, and bounded evaluation

**Task spec:** `2026-07-10-job-search-js-07-ranking.md`

**Depends on:** JS-03 and JS-05.

**Delivers:** source-id/canonical-URL identity, liveness/freshness state, deterministic exclusions,
deterministic gate plus AI fit bands, evidence/gap/uncertainty schema, 25 evaluations per user/day
oldest-first through the `interactive` JSON-capability tier, and derived feed rebuild.

**Verification:** similar jobs remain distinct; changed descriptions re-evaluate; missing facts stay
unknown; prompt injection cannot call tools or mutate state; excess candidates remain pending.

### JS-08 (#937) — Opportunity feed, decisions, and assistant read tools

**Task spec:** `2026-07-10-job-search-js-08-opportunity-feed.md`

**Depends on:** JS-06 and JS-07.

**Delivers:** new/saved/passed/stale views, compact evidence-backed cards, bounded detail, monitor
health, saved/passed feedback, compact list/get/decide assistant tools.

**Verification:** UI/tool results agree, large descriptions are detail-only, writes confirm/audit,
user decisions survive disable/re-enable.

### JS-09 (#938) — Epic acceptance and one-week validation harness

**Task spec:** `2026-07-10-job-search-js-09-acceptance.md`

**Depends on:** JS-08 and every hard runtime prerequisite.

**Delivers:** end-to-end fixture/live-source acceptance, packaging/lifecycle security checks,
run-twice dedup check, provider-independence check, and a post-merge seven-day success report while
#913 remains open for findings and corrective changes.

**Verification:** execute #913's verification intent exactly; record five active saved roles or a
truthful insufficient-supply result with healthy source evidence.

## What is needed to unblock

1. Ben gives final sign-off on the Fable-approved-with-changes draft specs.
2. #919 lands with `ctx.kv`, `ctx.auth`, external gateway dispatch, and the `ctx.ai` bridge.
3. Active task issues implement the still-missing #915 queue/schedule/run-now and pinned-fetch
   slices.
4. #916 is narrowed to the required small generic host starter action; Briefings remains deferred.
5. JS-01 through JS-09 exist as `task` issues with the dependencies above, but remain gated from
   build until final spec approval.
