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

Every row labeled `JS-*` becomes a future GitHub issue with label `task`. Approval of these specs is
necessary but does not itself authorize any branch or build agent.

## Runtime prerequisites

| Runtime item                                                                          | State at `eafa22dd`                                        | Hard for MVP?              | Why / required action                                                                                                                                                                                                                                    |
| ------------------------------------------------------------------------------------- | ---------------------------------------------------------- | -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #917 external discovery + fail-closed activation                                      | Merged                                                     | Yes, satisfied             | Package must remain outside `BUILT_IN_MODULES` and inactive until enabled.                                                                                                                                                                               |
| #918 external web, credentials, KV                                                    | Merged                                                     | Yes, satisfied             | Supplies the dedicated `Root`, owner-scoped KV, encrypted credentials, export/delete substrate.                                                                                                                                                          |
| #919 child worker, `ctx.kv`/`ctx.auth`, external tools through `AssistantToolGateway` | In flight                                                  | Yes                        | No package handler can access storage or execute tools before this lands. It must also expose the already-merged structured-AI seam as `ctx.ai`.                                                                                                         |
| #915 structured-AI parent seam                                                        | Merged as PR #923; issue closed                            | Yes, parent half satisfied | Provider-agnostic schema-validated execution exists; #919 must finish the child RPC, caps, and cancellation path.                                                                                                                                        |
| #915 external queues/schedules/run-now                                                | Draft spec exists; not approved or merged; issue is closed | Yes, unsatisfied           | Scheduled stateful monitoring and “Run now” cannot be built without it. Approve the design, then create a replacement task issue or reopen/split #915.                                                                                                   |
| #915 host-pinned `ctx.fetch`                                                          | Draft spec exists; not approved or merged; issue is closed | Yes, unsatisfied           | Recurring adapters need enforced hosts, redirect/IP checks, time/size caps. Approve the design, then create a replacement task issue or reopen/split #915.                                                                                               |
| #916 assistant starter prompt                                                         | Issue open, no approved spec at baseline                   | Conditionally hard         | The starter-action half is required for the intended one-click conversational onboarding from the module. Split it from Briefings and specify only the generic host action. If Ben accepts “open Chat and type this prompt,” it is not technically hard. |
| #916 Briefings dispatch                                                               | Issue open, no approved spec at baseline                   | No                         | Briefings is not in #913's six-part MVP. Defer until discovery proves useful.                                                                                                                                                                            |
| #914 external relational data plane                                                   | In flight                                                  | No for bounded KV MVP      | `module_kv` can hold capped per-record state. #914 becomes hard if Ben chooses unbounded history, larger resume artifacts, relational querying, or CRM scope. Do not block the bounded MVP on it.                                                        |

### Tracking correction required

#915 is closed even though PR #923 implemented only its structured-AI slice. Before job-search build
planning, the queue/schedule/run-now and pinned-fetch design must be approved, then the work must
have active task issues that retain the
`2026-07-09-external-worker-capabilities-design.md` acceptance criteria. A closed issue must not be
treated as evidence those runtime contracts exist.

## Strict dependency order

```text
#917 (done) ─┐
#918 (done) ─┼─> #919 ───────────────┐
PR #923 ─────┘                       ├─> JS-01 ─> JS-02 ─┬─> JS-03 ─┐
#915 queues/schedules/run-now ───────┤                  │          ├─> JS-07 ─> JS-08 ─> JS-09
#915 pinned fetch ───────────────────┘                  ├─> JS-04 ─> JS-05 ─┘
#916 starter action (if required) ──────────────────────┘
                                                        JS-06 depends on JS-02 + JS-03
```

The runtime prerequisites may proceed in parallel under #860. Job-search tasks remain sequential at
their declared dependency boundaries; the diagram does not authorize parallel build lanes.

## Future task issues

### JS-01 — Package contract and fail-closed fixture

**Depends on:** final #919 external manifest/worker ABI, merged #917/#918.

**Delivers:** independently buildable `jarv1s.job-search` package skeleton, JSON manifest, web/worker
entrypoints, declared namespaces/permissions, compatibility gates, and packaging test proving it is
absent from the core image and `BUILT_IN_MODULES`.

**Verification:** install/enable/disable/hash-drift contract fixture; no product behavior or data yet.

### JS-02 — Owner-scoped KV domain and retention contract

**Depends on:** JS-01 and #919 `ctx.kv`.

**Delivers:** schemas and repositories over declared user KV namespaces for onboarding, profile,
resume, monitor, opportunity, run, and derived feed records; per-value caps; idempotent keys; bounded
retention; export/delete/disable/purge coverage. No core table or migration.

**Verification:** schema-version upgrades, cap rejection, derived-index rebuild, owner/admin
isolation, lifecycle tests.

**Decision gate:** Ben must settle resume format/cap and opportunity retention before this issue is
filed RFA. Choosing relational/unbounded storage replaces this task with a #914-dependent design.

### JS-03 — Profile, resume truth guard, and conversational tools

**Depends on:** JS-02, #919 gateway dispatch, #919 `ctx.ai`, and the starter host action if Ben
requires one-click module-to-assistant onboarding.

**Delivers:** resumable onboarding state; profile revisions; resume critique/draft/approval tools;
evidence mapping; diff approval; unsupported-claim rejection.

**Verification:** new user completes the chosen onboarding depth; no inferred fact becomes approved
without confirmation; provider/model remains router-owned.

### JS-04 — Compliant source adapter foundation

**Depends on:** JS-01 and external `ctx.fetch`.

**Delivers:** adapter contract inside the package, exact host declarations, compliance metadata,
configuration validation, untrusted-content sanitation, courtesy controls, fixtures for the
Ben-approved initial sources. Reuses governed `web.search`/`web.read` for onboarding discovery only.

**Verification:** undeclared/private/redirected hosts fail; supported fixtures normalize; prohibited
or unknown adapters stay disabled.

**Decision gate:** Ben must select the initial source set before this task is RFA.

### JS-05 — Scheduled monitor execution and run-now

**Depends on:** JS-02, JS-04, external queue/schedule reconciliation, and generic run-now.

**Delivers:** metadata-only queue declaration; due-check/cadence behavior; monitor cursor/run state;
idempotent normalization/upsert; failure isolation; no catch-up storm.

**Verification:** two identical runs do not duplicate; browser/chat may be closed; manual double-click
dedupes; transient source failure retains known jobs; payload contains metadata only.

### JS-06 — Dedicated module surface and onboarding handoff

**Depends on:** JS-02, JS-03, merged #918 web root, and starter action if selected.

**Delivers:** `/m/jarv1s.job-search/*` authored UI for onboarding status, profile/resume approval,
monitor health/config, loading/empty/degraded states. Reads/writes only through declared tools and
generic platform routes.

**Verification:** shared React host, tokenized UI, module disable removes surface, no bespoke core
route, external text rendered safely.

### JS-07 — Freshness, deduplication, and bounded evaluation

**Depends on:** JS-03 and JS-05.

**Delivers:** source-id/canonical-URL identity, liveness/freshness state, deterministic exclusions,
the Ben-approved ranking implementation, evidence/gap/uncertainty schema, bounded retryable AI
evaluation, and derived feed rebuild.

**Verification:** similar jobs remain distinct; changed descriptions re-evaluate; missing facts stay
unknown; prompt injection cannot call tools or mutate state; excess candidates remain pending.

**Decision gate:** ranking strategy/budget must be approved before this task is RFA.

### JS-08 — Opportunity feed, decisions, and assistant read tools

**Depends on:** JS-06 and JS-07.

**Delivers:** new/saved/passed/stale views, compact evidence-backed cards, bounded detail, monitor
health, saved/passed feedback, compact list/get/decide assistant tools.

**Verification:** UI/tool results agree, large descriptions are detail-only, writes confirm/audit,
user decisions survive disable/re-enable.

### JS-09 — Epic acceptance and one-week validation harness

**Depends on:** JS-08 and every hard runtime prerequisite.

**Delivers:** end-to-end fixture/live-source acceptance, packaging/lifecycle security checks,
run-twice dedup check, provider-independence check, and a seven-day success report template.

**Verification:** execute #913's verification intent exactly; record five active saved roles or a
truthful insufficient-supply result with healthy source evidence.

## What is needed to unblock

1. Ben settles the companion open decisions and approves these specs.
2. #919 lands with `ctx.kv`, `ctx.auth`, external gateway dispatch, and the `ctx.ai` bridge.
3. Active task issues implement the still-missing #915 queue/schedule/run-now and pinned-fetch
   slices.
4. Ben decides whether the #916 starter action is required; if yes, split/spec that small generic
   host action without making Briefings a blocker.
5. File JS-01 through JS-09 as `task` issues with the dependencies above. Only then may planning or
   build lanes begin.
