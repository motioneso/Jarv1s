# Intelligent job search packaged module — MVP design

**Status:** Draft — requires Ben approval before any build task is planned or spawned

**Date:** 2026-07-10

**Owner:** Ben

**GitHub:** #913, dependent on #860

**Grounding:** grounded on `eafa22dd` (`origin/main` at authoring time)

---

## Purpose

Ship Intelligent Job Search as an optional external package, `jarv1s.job-search`, built against
the external `@jarv1s/module-sdk` ABI. It is never added to `BUILT_IN_MODULES`, never compiled into
the default image, and contributes behavior only through declared external-module contracts.

The first-week outcome from #913 remains the acceptance target: a new user approves a truthful
master resume and durable search profile, enables at least one compliant monitor, receives fresh,
deduplicated opportunities with understandable evidence and uncertainty, and judges at least five
active results worth reviewing within seven days when the available market supports that result.

This document refreshes the approved 2026-07-09 design against the external runtime that actually
exists at `eafa22dd`. It deliberately changes one earlier assumption: the bounded MVP uses
`module_kv` and `module_credentials`, not module-owned relational tables. The scale ceiling and the
decision needed from Ben are explicit in the companion open-decisions document.

## Scope

### MVP

1. Conversational onboarding launched from the module surface.
2. Resume critique and a user-approved optimized master resume.
3. A durable, editable candidate/search profile.
4. Manual and scheduled stateful monitoring of reviewed, compliant public sources.
5. Freshness checks, deterministic deduplication, and evidence-backed ranking.
6. A dedicated external-module UI at the host-owned `/m/jarv1s.job-search/*` route.

### Non-goals

- No application submission, form filling, employer contact, outreach, or authenticated scraping.
- No access-control bypass, bot evasion, cookie/session reuse, or recurring generic-site crawler.
- No known-prohibited source enabled by default; experimental opt-in is a separately specified
  follow-up.
- No full application CRM, interview pipeline, networking tracker, or job-specific resume set.
- No fabricated resume claims, inferred credentials, invented metrics, or silent profile changes.
- No PDF/DOCX parser or server PDF renderer in MVP.
- No provider/model selection by the package.
- No job-search tables, routes, schedulers, source names, or ranking logic special-cased into core.
- No Today widget or Briefings dependency in MVP; the dedicated surface and assistant tools satisfy
  #913. Those integrations can follow after the external host contribution contract supports them.

## Runtime baseline at `eafa22dd`

- #917 is merged: external packages are discovered and enabled fail-closed.
- #918 is merged: external web assets, AES-256-GCM module credentials, and owner-scoped
  `module_kv` exist. External web contract v1 loads one `Root` component under
  `/m/<module-id>/*`.
- `module_kv` accepts namespaced user/instance JSON objects, caps each value at 65,536 bytes, and
  cascades user rows on account deletion. User rows are owner-only under forced RLS.
- `module_credentials` stores declared API keys encrypted; list/read surfaces expose metadata only.
- The structured-AI parent seam from #915/PR #923 is merged, but the child `ctx.ai` bridge remains
  part of #919.
- #919 is not merged: the child worker, `ctx.kv`/`ctx.auth`, external assistant handlers, and
  `AssistantToolGateway` dispatch are unavailable until it lands.
- The queue/schedule and host-pinned-fetch portions of the draft #915 design are not present,
  despite #915 being closed by the structured-AI PR. Monitoring requires those remaining generic
  capabilities to be approved and tracked in new task issues or by reopening/splitting #915.
- #914's module-owned relational data plane is in flight, but is not required by the bounded KV MVP
  described here.

## Package contract

The installed package contains only reviewed, prebuilt artifacts:

```text
jarv1s.job-search/
  package.json
  jarvis.module.json
  dist/worker.js
  dist/web/index.js
```

The JSON manifest targets the final external ABI, not the executable built-in
`JarvisModuleManifest` shape. It declares:

| Contract        | Contribution                                                              |
| --------------- | ------------------------------------------------------------------------- |
| Identity        | `jarv1s.job-search`, user-toggleable, compatible runtime range            |
| Web             | contract-v1 entrypoint whose `Root` owns the module surface               |
| Storage         | user namespaces listed below; no instance data needed for MVP             |
| Credentials     | only API keys required by a source Ben chooses for MVP                    |
| Permissions     | read, manage profile/resume, manage monitors, decide on opportunities     |
| Assistant tools | namespaced read/write handlers listed below                               |
| Worker          | monitor queue, schedule, handlers, metadata schemas, reviewed fetch hosts |

The package receives no root Kysely handle, `DataContextDb`, `VaultContext`, ambient credentials,
root filesystem, or foreign-module imports. Parent RPCs bind the actor and module id.

## Persistence on `module_kv` and `module_credentials`

### Why this mapping

The generic storage plane already supplies the required owner-only RLS, actor binding, account
deletion, export integration, namespace isolation, and package disable/purge behavior. Using it
keeps all job-search persistence outside core without making #913 wait for custom-table support.

KV is acceptable only as a deliberately bounded MVP store. Every logical record is a separate key;
the design never stores an ever-growing user database in one JSON blob. Per-value and retention
ceilings must be enforced before write. If Ben chooses unbounded history, richer queries, or resume
files beyond the accepted cap, #914 becomes a hard prerequisite instead.

### Declared user namespaces

| Namespace                         | Key shape                         | Value and rule                                                                      |
| --------------------------------- | --------------------------------- | ----------------------------------------------------------------------------------- |
| `jarv1s.job-search.onboarding`    | `state`                           | Current step, completion flags, approved revision ids; no resume text               |
| `jarv1s.job-search.profile`       | `active`, `revision/<id>`         | Versioned profile JSON, provenance, approval state; active key points to a revision |
| `jarv1s.job-search.resume`        | `active`, `revision/<id>`         | Normalized text/Markdown, parent id, evidence map, status; immutable after approval |
| `jarv1s.job-search.monitors`      | `monitor/<id>`, `cursor/<id>`     | Adapter-safe configuration, enabled state, due time, last successful cursor/check   |
| `jarv1s.job-search.opportunities` | `job/<identity-hash>`             | One normalized posting snapshot, state, freshness, latest evaluation, content hash  |
| `jarv1s.job-search.runs`          | `run/<id>`, `monitor/<id>/latest` | Safe counts, timestamps, status/error code, idempotency marker; no private bodies   |
| `jarv1s.job-search.feed`          | `active`                          | Bounded ordered list of opportunity ids and compact card metadata for fast reads    |

All scopes are `user`. Keys contain generated identifiers or hashes, never raw URLs, titles,
company names, or user prose. JSON values carry `schemaVersion` so the package can upgrade its own
records without a core migration.

The feed index is derived and rebuildable from opportunity keys. A failed index update cannot lose
the underlying posting. Upserts are idempotent: the canonical identity key and evaluation tuple
produce the same record on retry. No cross-key transaction is assumed.

### Candidate profile

The profile captures, at minimum:

- target and adjacent titles;
- industries and seniority;
- demonstrated/developing skills;
- compensation currency/minimum/target;
- locations and remote/hybrid/onsite preference;
- employment type, sponsorship constraints, must-haves, and dealbreakers;
- preferred/excluded companies and freeform career narrative.

Empty preference arrays mean “no preference.” AI-proposed values are marked `inferred`; only an
explicit user confirmation makes a revision active. Every approved revision remains inspectable.

### Resume revisions and truth guard

Resume intake is plain text/Markdown under the selected KV ceiling. Each immutable revision stores
its parent, normalized content, critique summary, and evidence links for material changes. The
active pointer changes only after the user sees a diff and approves it.

- Rewording may clarify an existing claim.
- A new employer, role, date, skill, credential, metric, or outcome requires an earlier quoted
  source or explicit user confirmation.
- Unsupported proposals become questions, never resume content.
- Monitoring cannot edit the resume or profile.
- `module_credentials` is never used for resume/profile content; it is secrets-only.

### Credentials

Most compliant public ATS feeds need no credential. If Ben selects a keyed provider, the manifest
declares a module-prefixed `api-key` credential with the minimum correct scope. The worker reads it
only via `ctx.auth`. Plaintext never reaches KV, browser responses, AI prompts, logs, exports, or job
payloads. Missing/revoked credentials degrade only that monitor and produce a typed safe error.

## Conversational onboarding

The module `Root` shows durable progress and a single “Continue with Jarv1s” action. The generic
host starter action opens the existing Jarv1s assistant with stable module-authored context; the
package does not embed a second chat engine.

The assistant drives resumable checkpoints through module tools:

1. Intake and confirm resume source text.
2. Critique clarity, structure, evidence, and ATS readability.
3. Review a truth-guarded proposed revision and approve or revise it.
4. Build and confirm the search profile.
5. Select compliant sources, schedule preferences, ranking budget, and exclusions.
6. Review the exact stored configuration and enable monitoring.

Monitoring stays off until an approved profile, approved resume, and enabled monitor exist. Broader
Jarv1s context may suggest questions, but it never silently becomes canonical job-search data.

## Source discovery and compliance

The module reuses the governed capabilities described by:

- `2026-06-18-web-research-capability.md`;
- `2026-06-22-web-search.md`;
- `2026-06-23-brave-search-key-admin-ui.md`.

During onboarding, the assistant may use existing `web.search`/`web.read` to suggest companies,
career pages, or supported boards. Search results remain untrusted evidence. The user approves each
recurring monitor, and recurring work does not become a general web crawler.

Every shipped adapter records a stable id, reviewed public hosts, policy/terms reference and review
date, courtesy interval, configuration schema, normalization logic, and external-job-id semantics.
Only `allowed` adapters ship enabled. `unknown` and `prohibited` adapters fail closed. Configuration
accepts recognized board/company identifiers, not arbitrary hosts.

Fetches use the parent `ctx.fetch` capability: HTTPS, exact declared hosts, revalidated redirects,
resolved-IP SSRF protection, response/time caps, and rate courtesy. Job text is untrusted external
data and is stripped of active markup before storage or AI use. No cookies or login credentials are
provided.

The exact MVP adapter set is an open product decision. Public ATS feeds and direct employer career
pages are the permitted source classes; authenticated boards and prohibited sources are not.

## Scheduled, stateful monitoring

The external worker declares one module-prefixed monitor queue with manual-run enabled and one
platform-reconciled user schedule. If the generic runtime supports only manifest-static cron, the
smallest compatible shape is a periodic due-check: the handler reads the user's configured local
due time and last-run date from KV, performs no network work when not due, and guarantees at most
one scheduled discovery run per local day. Ben must approve the onboarding/cadence choice.

The job payload is metadata only:

```json
{
  "actorUserId": "<bound by host>",
  "moduleId": "jarv1s.job-search",
  "jobKind": "monitor",
  "manifestHash": "<bound by host>",
  "params": { "monitorId": "<uuid>" }
}
```

Resume text, profile content, job descriptions, prompts, source responses, and credentials never
enter pg-boss. The handler loads them through actor-scoped RPCs after delivery.

Run flow:

1. Validate module/user enablement and read monitor state.
2. Return the prior run for the same idempotency occurrence if already complete.
3. Fetch and normalize through the declared adapter.
4. Upsert by source external id; otherwise by normalized canonical URL hash.
5. Update `lastSeenAt`, source cursor, content hash, and safe run counts.
6. Mark stale only from authoritative absence or an explicit liveness result; fetch failure never
   marks known jobs stale.
7. Apply deterministic eligibility rules.
8. Evaluate only the bounded new/changed survivors selected by the approved ranking decision.
9. Rebuild the bounded feed index and finish the run record.

A source failure is isolated to its monitor, retains prior data, and exposes a safe degraded state.
AI failure leaves eligible jobs visible with evaluation `pending`; a later run resumes oldest first.

## Freshness, deduplication, ranking, and uncertainty

### Freshness and identity

- Primary identity: `(adapterId, externalJobId)`.
- Fallback identity: normalized canonical public URL.
- Similar title/company strings never merge distinct roles in MVP.
- Description hash detects material changes and versions the evaluation input.
- Track published time when supplied, first/last seen, last successful liveness check, and status
  `active | uncertain | stale`.
- Missing dates and fields stay unknown; the package never invents them.

### Evidence contract

Regardless of the ranking strategy Ben selects, every surfaced recommendation includes:

- fit band or deterministic priority class, not an unexplained precision percentage;
- supporting requirements paired with quoted candidate evidence;
- gaps classified as blocker, gap, or unknown;
- preference matches/conflicts;
- freshness and posting-confidence state;
- overall confidence plus a short explanation of what remains uncertain;
- the profile, resume, and description hashes/revisions used.

Hard exclusions run before AI. External job text is framed as untrusted data, capped, and cannot
invoke tools or change module state. Structured AI uses `ctx.ai`, requests a capability/tier only,
validates against a fixed schema, and never names a provider/model. Old evaluations remain visible
but are marked outdated when their inputs no longer match.

## UI surface

External web contract v1 supplies one module `Root`. It owns all routes beneath
`/m/jarv1s.job-search/*` and uses the host React instance. It calls only generic platform routes and
declared assistant tools; external manifests do not add bespoke core REST routes.

The surface provides:

- onboarding state and “Continue with Jarv1s”;
- profile/resume approval status;
- monitor configuration, last success/error, next due time, and “Run now”;
- `new`, `saved`, `passed`, and `stale` opportunity views;
- compact ranked cards with evidence, gaps, confidence, and freshness;
- a bounded detail view for the stored posting snapshot and evaluation provenance;
- authored empty/loading/degraded states using existing design tokens and primitives.

Read views use compact tool results and never return every description. Write actions invoke
confirm-gated assistant tools or the generic authenticated run-now queue route. The module renders
external text as text, never raw HTML.

## Permissions and assistant tools

| Permission                          | Actions                                                               |
| ----------------------------------- | --------------------------------------------------------------------- |
| `jarv1s.job-search.read`            | Read onboarding state, active profile/resume metadata, monitors, jobs |
| `jarv1s.job-search.manage-profile`  | Draft/approve profile and resume revisions                            |
| `jarv1s.job-search.manage-monitors` | Create/update/disable monitors and request run-now                    |
| `jarv1s.job-search.decide`          | Mark an opportunity saved or passed                                   |

Minimum tools:

- `jarv1s.job-search.onboarding.get-state` — read;
- `jarv1s.job-search.profile.get` — read;
- `jarv1s.job-search.profile.save-draft` and `.approve` — write/confirm;
- `jarv1s.job-search.resume.get` — read;
- `jarv1s.job-search.resume.save-draft` and `.approve` — write/confirm;
- `jarv1s.job-search.monitor.list` and `.get` — read;
- `jarv1s.job-search.monitor.save` — write/confirm;
- `jarv1s.job-search.opportunities.list` and `.get` — read;
- `jarv1s.job-search.opportunity.decide` — write/confirm.

All handlers dispatch through `AssistantToolGateway` with the declared risk, confirmation, schema
projection, output caps, and audit behavior. Tool names and permission ids are module-prefixed.

## Privacy and lifecycle

- Every KV row is user-scoped and owner-only under forced RLS; admins configure the package but do
  not read user resumes, profiles, monitors, or jobs.
- Account export includes user KV content and credential metadata only; secret material is excluded.
- Account deletion cascades user KV and credentials.
- Disable unschedules work and hides tools/UI while preserving data.
- Explicit uninstall purge removes package-owned KV/credentials after confirmation and audit.
- No job-search state is written to a built-in module, shared memory, or core table.

## Verification intent

- Contract: invalid/disabled/hash-drifted package contributes no web root, handlers, queue, schedule,
  credential access, or KV access.
- Storage: user A and an admin cannot read user B's records; values over caps fail; delete/export and
  disable/purge semantics work.
- Truth: unsupported resume claims cannot enter an approved revision; approval diff is explicit.
- Sources: fixtures prove normalization and host policy; undeclared/private/redirected hosts fail.
- Monitoring: run twice against identical source data and get one opportunity/evaluation; changed
  content produces an updated evaluation; transient failure retains prior jobs.
- Jobs: payload snapshots prove metadata-only content; scheduled work runs without a browser/chat;
  duplicate/manual delivery is idempotent.
- Ranking: every recommendation carries evidence, gaps, freshness, and uncertainty; missing facts
  remain unknown.
- UI: new-user onboarding through approval, monitor creation, run-now, results, saved/passed state,
  disabled-module disappearance, and re-enable restoration.
- Provider independence: structured evaluation succeeds through at least two configured adapter
  shapes and contains no provider/model identifier in package code or RPC output.
- First week: five distinct active opportunities marked `saved`, or a truthful explanation of
  insufficient compliant supply with healthy monitor evidence.

## Approval gate

No implementation plan, migration, task branch, or build lane may start from this draft. Ben must
approve this design and settle the companion open decisions first. Each implementation slice then
requires its own GitHub `task` issue.
