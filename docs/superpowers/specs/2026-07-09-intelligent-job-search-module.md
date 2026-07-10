# Intelligent job search module — design spec

**Status:** Approved — Ben approval after Fable 5 review, 2026-07-09
**Date:** 2026-07-09  
**Owner:** Ben  
**GitHub:** #913  
**Depends on:** #860 pluggable modules; reuses the approved #818 external-module safety model  
**Grounded on:** `origin/main` @ `90cc89d7a0510e078469104785fcba73c0d5d7c2`

---

## Context

Job discovery is fragmented across general boards, niche boards, company career pages, recruiter
messages, and multiple applicant-tracking systems. The user's problem is not a missing spreadsheet;
it is the effort required to search a vast, noisy landscape and identify the few roles genuinely
worth pursuing.

The approved feature brief established this first-week outcome:

- Jarv1s and the user complete conversational onboarding.
- The user leaves onboarding with an approved, truthful, optimized master resume and a durable job
  search profile.
- Scheduled background monitoring begins without requiring an always-open browser or chat session.
- Within one week, Jarv1s has surfaced at least five active opportunities the user considers worth
  reviewing.

The first user is Ben, but there must be no Ben-specific product logic. Titles, industries, skills,
location, compensation, work arrangement, company preferences, and exclusions are per-user data.

### Research basis

The market converges on a few useful patterns:

- [Career-Ops](https://github.com/santifer/career-ops) treats job search as a selective operating
  system: structured fit evaluation, posting-liveness checks, resume adaptation, company research,
  outreach, and interview preparation. Its useful principle is to filter for the few roles worth the
  effort, not maximize application volume.
- [Huntr](https://huntr.co/product/job-tracker),
  [Teal](https://www.tealhq.com/tools/job-tracker), and
  [Simplify](https://simplify.jobs/copilot) demonstrate that low-friction capture, retained job
  descriptions, document versions, activity history, and clear next state are table stakes.
- [HiringCafe](https://hiring.cafe/) demonstrates the value of deep filters over an undifferentiated
  feed.
- Huntr's [2025 report](https://huntr.co/research/2025-annual-job-search-trends-report), based on its
  own platform telemetry and self-reported stages, found tailored resumes converted about 1.6 times
  better than untailored submissions and focused sources outperformed several mass boards. These are
  directional product signals, not promises of a universal interview rate.

This spec uses those lessons while keeping Jarv1s's differentiator: private, self-hosted user
context; provider-agnostic AI; durable background work; and one assistant surface connected to the
rest of the user's day.

### Current platform constraint

As grounded above:

- `JarvisModuleManifest` already declares navigation, settings, jobs, assistant tools, external
  sources, proactive monitors, and data lifecycle.
- Built-in modules are still statically registered through `BUILT_IN_MODULES` and compiled into the
  core image.
- The approved #818 design introduces fail-closed external packages, runtime web bundles,
  child-process handlers, credentials, and a small KV store, but its implementation is not present
  on `origin/main`.
- #818 explicitly limits KV to preferences and cache metadata; large artifacts and relational data
  are out of scope.
- #860 is the source of truth for independently downloadable modules. It identifies per-module
  migration ledgers, privileged install, dynamic server loading, runtime web loading, signing, and
  capability review as prerequisites.
- The current proactive schedule builder enumerates `getBuiltInModuleManifests()`, so it cannot run
  a monitor contributed only by an external package.

Job search requires relational opportunities, evaluations, monitor history, and resume revisions.
It must therefore wait for #860's module-owned persistence and runtime scheduling seams. It must not
store an ever-growing job database in one KV value or add job-search tables to a core module.

## Goals

1. Guide a user through conversational job-search onboarding with Jarv1s.
2. Produce an explicit, editable, versioned search profile and an approved master resume.
3. Let the user configure recurring monitors over supported public job sources.
4. Automatically ingest, freshness-check, deduplicate, filter, and rank opportunities.
5. Explain every recommendation with source evidence, gaps, uncertainty, and posting freshness.
6. Surface new matches in a dedicated module UI, Jarv1s chat, Today, and selectable briefing tools.
7. Ship as an independently installed, user-toggleable module package outside the default image.
8. Keep all user data owner-only, exportable, deletable, provider-agnostic, and truthful.

## Non-goals — MVP

- Autonomous application submission, form filling, recruiter outreach, or employer messaging.
- Optimizing for the maximum number of applications.
- A full application CRM, interview pipeline, negotiation suite, or networking tracker.
- Job-specific resume generation; MVP optimizes one master resume and records role-fit guidance.
- Fabricating experience, skills, metrics, credentials, or resume claims.
- A mysterious AI-only match percentage with no supporting evidence.
- Logged-in scraping, access-control bypasses, anti-bot evasion, or LinkedIn automation.
- A generic arbitrary-site crawler. MVP sources are explicit adapters plus manual role capture.
- Autonomous discovery of every company or board worth monitoring. During onboarding, Jarv1s may
  use an already-configured web-search capability to suggest companies, but the user approves each
  supported board before it becomes a recurring source.
- The experimental opt-in for sources known to prohibit automation. It remains follow-up scope.
- PDF/DOCX parsing or server-side PDF rendering. MVP accepts plain text/Markdown and uses the
  browser's print-to-PDF path.
- Cross-user sharing of profiles, resumes, monitors, opportunities, or evaluations.
- An always-running LLM session or a new workflow engine.
- Implementing or special-casing the #860 package runtime inside this feature.

## Resolved decisions

| #   | Decision           | Choice                                                                                                                                            | Why                                                                                                       |
| --- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| 1   | Distribution       | External package `jarv1s.job-search`; never in `BUILT_IN_MODULES` or the default image                                                            | This is a hard product requirement and the first meaningful consumer of #860.                             |
| 2   | Activation         | Fail closed at operator install/enable, then user-toggleable                                                                                      | Matches #818/#860 and private-by-default behavior.                                                        |
| 3   | Build gate         | No implementation plan until #860 provides runtime server/web loading, module-owned persistence, scheduled jobs, and capability enforcement       | Pretending today's built-in SDK can satisfy the package requirement would produce the wrong architecture. |
| 4   | Persistent agents  | Scheduled, stateful monitor jobs; no immortal agent process                                                                                       | Durable behavior comes from stored state and idempotent runs, not a costly open model session.            |
| 5   | Scheduling         | Manual run plus one user-configured daily schedule in an IANA timezone                                                                            | Smallest cadence that proves persistent discovery; more cadences come later.                              |
| 6   | Initial sources    | Public Greenhouse, Lever, and Ashby board adapters; manual URL/JD capture                                                                         | Covers many direct-employer career pages with stable public endpoints while avoiding a generic scraper.   |
| 7   | Source expansion   | Add adapters inside the module package, not core; source policy is reviewed per adapter                                                           | New sources should not require a Jarv1s image rebuild or weaken platform fetch controls.                  |
| 8   | Onboarding surface | Jarv1s assistant drives onboarding through declared module tools; module UI shows progress and launches the assistant                             | Reuses the assistant that already knows the user instead of building a second chat product.               |
| 9   | User context       | Explicit approved profile/resume is canonical; broader Jarv1s context may suggest changes but never silently mutates them                         | “Knows me” must stay legible and reversible.                                                              |
| 10  | Resume format      | Versioned Markdown/plain text with a printable web view                                                                                           | No parser or PDF-generation dependency is required for the MVP.                                           |
| 11  | Resume truth       | Every material rewrite maps to existing text or an explicit user confirmation                                                                     | Optimization may improve wording, never invent evidence.                                                  |
| 12  | Ranking            | Deterministic eligibility/filtering first; bounded AI evaluation only for new candidates that survive; expose fit bands and evidence              | Saves cost and avoids false precision while retaining useful reasoning.                                   |
| 13  | AI                 | External module requests Jarv1s capabilities such as structured reasoning; it never names a provider/model                                        | Preserves BYO-provider and local-model options.                                                           |
| 14  | Persistence        | Module-owned relational records installed through #860; KV only for small cache/config metadata                                                   | Opportunities and evaluation history are relational and unbounded over time.                              |
| 15  | Privacy            | Every product row is owner-only with RLS and an `ON DELETE CASCADE` chain to the user                                                             | Admin configuration power never grants access to job-search data.                                         |
| 16  | Job state          | `new`, `saved`, `passed`, or `stale`; application stages are deferred                                                                             | These four states support discovery feedback without smuggling in a full CRM.                             |
| 17  | Deduplication      | Source external ID first, canonical URL second; no fuzzy title/company merge in MVP                                                               | Prevents duplicate postings without incorrectly merging distinct roles.                                   |
| 18  | Daily integration  | Today widget plus compact read-only assistant/briefing tools                                                                                      | Connects the module to daily Jarv1s use without importing Tasks, Briefings, or Chat internals.            |
| 19  | Cost control       | Network discovery is cheap; AI evaluates a bounded batch of new/changed candidates and resumes later                                              | No surprise runaway model bill after a large feed update.                                                 |
| 20  | Success signal     | A user's `saved` decision counts as “worth reviewing”; five distinct active saved opportunities within seven days satisfies the first-week target | Observable and controlled by the user, unlike an eventual employer response.                              |

## Architecture

### 1. Package and platform prerequisites

The module is built only against the downloadable-module ABI delivered by #860. The package release
contains prebuilt worker and web assets plus a JSON-compatible manifest. It is not a workspace
dependency of the core image.

The #860 platform must provide these generic capabilities before this module can enter planning:

1. Runtime discovery and fail-closed activation of a signed/reviewed module package.
2. Runtime web contribution loading with the shared React/module-web contract.
3. Privileged, per-module migrations with a module-specific migration ledger.
4. Actor-scoped access to only the module's declared tables; no root Kysely handle and no foreign
   module tables.
5. External-module queue/worker registration and recurring pg-boss schedule reconciliation.
6. A provider-agnostic AI capability RPC for structured output, with user attribution and usage
   controls.
7. A host-pinned outbound fetch capability or equivalent enforced source-host policy.
8. A generic web-host action that can open Jarv1s assistant with a module-authored starter prompt.
9. Data lifecycle hooks for export, account deletion, disable, uninstall, and explicit purge.
10. Runtime assistant-tool dispatch available to every authorized internal tool consumer, including
    Chat's assistant gateway and Briefings composition. External JSON manifests reference handler
    ids rather than embedding executable functions, so consumers invoke the generic dispatch
    contract instead of calling `manifest.assistantTools[].execute` directly.

These are platform features, not job-search exceptions. If #860 chooses different names or wire
formats, this module maps to the final generic contracts without changing the product behavior in
this spec.

Conceptual manifest contributions:

- module id: `jarv1s.job-search`;
- lifecycle: user-toggleable, disabled until installed/enabled;
- navigation: `/job-search`;
- settings: source monitors, cadence/timezone, ranking budget;
- permissions: view, manage profile, manage monitors, manage opportunity decisions;
- jobs: one monitor queue with metadata-only payloads;
- assistant tools: onboarding/profile, resume, monitor, and opportunity tools;
- web: module route, Today widget, and settings contribution;
- data lifecycle: owner export and cascade deletion for every product table.

### 2. User experience

#### First open

An installed user with no ready profile sees one authored empty state:

> Build your search with Jarv1s  
> Tell Jarv1s where you want to go, refine your resume, and let scheduled monitors find roles worth
> your attention.

The primary action opens Jarv1s assistant with a stable starter prompt. The module does not embed or
fork Chat.

#### Conversational onboarding

The assistant completes five resumable steps:

1. **Resume intake** — paste plain text/Markdown or have Jarv1s propose relevant, user-approved
   facts from its existing context.
2. **Resume critique** — identify clarity, evidence, structure, and ATS-readability issues; propose a
   revised master resume.
3. **Search brief** — confirm target roles, seniority, industries, skills, compensation, location,
   work arrangement, company preferences, must-haves, and dealbreakers.
4. **Sources** — add supported ATS board URLs/company watchlists and choose the daily local run time.
   If Jarv1s already has web search configured, it may suggest candidate companies/board URLs from
   the approved profile; every recurring source still requires user approval and adapter validation.
5. **Review and start** — show the exact profile, resume revision, monitors, AI budget, and source
   policy; the user explicitly approves the profile/resume and enables monitoring.

Each step writes through a namespaced module tool. Profile/resume writes are confirm-gated. Progress
is durable, so leaving Chat or restarting Jarv1s does not restart onboarding.

Monitoring stays disabled until the profile has status `ready`, at least one resume revision is
approved, and at least one source monitor exists.

#### Module overview

The primary view contains:

- onboarding/search-health status;
- last successful run and next scheduled run;
- tabs or filters for `new`, `saved`, `passed`, and `stale`;
- a ranked list of active opportunities;
- a quiet degraded/source-error notice with retry;
- a “Run now” action guarded against duplicate concurrent runs.

Each opportunity card shows title, company, location/work arrangement, source, posted/first-seen
date, freshness, fit band, top supporting reasons, top gap, and confidence. The detail view preserves
the original description snapshot and the evidence used in the evaluation.

The Today widget stays compact: count of new matches, monitor health, and at most the top three new
opportunities. It performs no live source fetch.

### 3. Canonical user profile

One versioned profile contains:

```ts
interface JobSearchProfileV1 {
  version: 1;
  targetTitles: string[];
  adjacentTitles: string[];
  seniority: { minimum?: string; preferred?: string; maximum?: string };
  includeIndustries: string[];
  excludeIndustries: string[];
  skills: { demonstrated: string[]; developing: string[]; avoid: string[] };
  employmentTypes: string[];
  locations: string[];
  workArrangements: Array<"remote" | "hybrid" | "onsite">;
  compensation?: { currency: string; minimum?: number; target?: number };
  sponsorship?: string;
  companyPreferences: {
    sizes: string[];
    stages: string[];
    includeCompanies: string[];
    excludeCompanies: string[];
  };
  mustHaves: string[];
  dealbreakers: string[];
  narrative: string;
}
```

Empty arrays mean “no preference,” not “match nothing.” The UI makes that distinction explicit.
Every change creates a revision with provenance `volunteered`, `inferred`, or `confirmed` and the
actor can inspect or restore earlier revisions.

AI may propose inferred values, but only an explicit confirmation makes them part of the active
profile.

### 4. Resume model

The module stores immutable resume revisions:

- original text snapshot;
- normalized Markdown;
- revision number and timestamps;
- status `draft` or `approved`;
- parent revision;
- structured evidence links for material changes;
- the profile revision used for critique.

The active master resume is the latest approved revision. A printable HTML view uses the authored
design system and browser-native print/save-to-PDF. No server PDF renderer is introduced.

Truthfulness rules are hard requirements:

- Rewording may clarify an existing claim.
- A new skill, credential, employer, title, date, metric, or outcome requires a verbatim source in an
  earlier resume or explicit user confirmation.
- Unsupported proposals render as questions, never accepted resume text.
- The user sees a diff before approval.
- No background monitor may edit the resume or profile.

### 5. Logical data model

Physical migration packaging is owned by #860. The module requires these logical owner-only tables
or equivalent module-scoped relational records:

| Record                       | Purpose                                                              | Important constraints                                                                    |
| ---------------------------- | -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `job_search_profiles`        | Versioned search profile and onboarding state                        | One active revision per owner; provenance visible and reversible.                        |
| `job_search_resume_versions` | Original/normalized/revised master resume Markdown                   | Immutable revisions; only explicit approval changes the active revision.                 |
| `job_search_monitors`        | Source adapter, safe configuration, cadence, timezone, enabled state | Source config is adapter-validated; schedule key is stable per monitor.                  |
| `job_search_opportunities`   | Canonical posting snapshot and structured fields                     | Unique source external ID when present; canonical URL fallback; description size capped. |
| `job_search_evaluations`     | Evidence-backed fit result                                           | Unique by opportunity description hash + profile revision + resume revision.             |
| `job_search_monitor_runs`    | Run status and counts                                                | Metadata/error codes only; no copied resume or job-description bodies in logs.           |

All records carry `owner_user_id` and timestamps. Child rows cascade from the owning user. Every
table has `ENABLE ROW LEVEL SECURITY` and `FORCE ROW LEVEL SECURITY`; runtime reads/writes include an
explicit owner predicate in addition to RLS.

There is no sharing declaration in MVP. Export includes profiles, resume Markdown, monitors,
opportunity snapshots, evaluations, and non-secret run history. Account deletion removes all rows.
Disable preserves data; uninstall purge is a separate explicit operator action.

### 6. Source adapter model

Every source adapter declares:

- stable source id and display name;
- exact supported public hosts;
- terms/policy review URL and review date;
- status `allowed`, `unknown`, or `prohibited`;
- minimum courtesy interval;
- configuration schema;
- fetch and normalization handler;
- stable external job id semantics.

MVP ships only reviewed `allowed` adapters:

1. Greenhouse public job-board API.
2. Lever public postings API.
3. Ashby public job-board API.

An adapter is configured by a board/company identifier or a recognized board URL; user input never
becomes an arbitrary fetch target. Redirects are revalidated against declared hosts. Fetches are
HTTPS-only, host-pinned, size/time bounded, rate-limited, and use a descriptive user agent. Source
responses are treated as untrusted data.

Manual capture accepts a public URL plus fetched text when the supported adapter can resolve it, or
pasted JD text when it cannot. Manual capture does not create a recurring generic scraper.

If a source's policy changes to prohibited, the adapter is disabled by a module release/policy kill
switch and existing snapshots remain readable. A future experimental source mode requires its own
spec, explicit per-source opt-in, prominent warning, and no authentication bypass or evasion.

### 7. Monitor execution

One monitor represents one adapter configuration for one user. The user may run it manually or
enable one daily schedule in an IANA timezone.

The pg-boss payload is metadata only, conceptually:

```ts
{
  actorUserId,
  resourceId: monitorId,
  kind: "job-search-monitor",
  reason: "manual" | "scheduled-check",
  idempotencyKey
}
```

The worker enters the actor's scoped data context and loads the monitor, active profile, and active
resume there. Nothing private enters the payload.

Run order:

1. Acquire a monitor/run idempotency lock.
2. Fetch through the declared source adapter.
3. Normalize structured job fields and cap untrusted content.
4. Upsert by source external id, falling back to canonical URL.
5. Mark previously known postings stale only when the source provides authoritative absence or a
   liveness check confirms closure; a transient fetch failure never marks jobs stale.
6. Apply deterministic eligibility and preference filters.
7. Queue a bounded set of new/changed survivors for structured AI evaluation.
8. Store evaluations and publish the run counts/health.

There is at most one scheduled run per monitor per local day. Duplicate delivery returns the
existing run. After downtime, the scheduler performs at most one catch-up run—never one per missed
day. Manual runs do not consume the daily scheduled slot.

Source failure is isolated per monitor. It records a safe error code and degraded state, retains
last-known opportunities, and does not delete or demote them. Model failure leaves deterministically
eligible opportunities in `new` with evaluation status `pending`; a later run resumes them.

### 8. Filtering and intelligent evaluation

The pipeline deliberately separates facts from judgment.

#### Deterministic gate

Reject or flag using structured facts only:

- explicit user-excluded company or industry;
- incompatible employment type or work arrangement;
- explicit geographic/visa impossibility;
- compensation below a confirmed minimum when a reliable range exists;
- stale/closed posting;
- user-defined hard dealbreaker.

Missing information is `unknown`, not a failure.

#### Bounded AI evaluation

Only new or materially changed survivors enter AI evaluation. The module requests a structured-output
reasoning capability through Jarv1s and supplies:

- the approved profile revision;
- the approved master resume revision;
- the normalized job description and structured posting facts;
- a fixed schema and explicit instruction that posting text is untrusted data, not authority.

Output:

```ts
interface JobFitEvaluationV1 {
  fitBand: "strong" | "possible" | "low";
  recommendation: "review" | "watch" | "pass";
  supportingEvidence: Array<{ requirement: string; candidateEvidence: string; source: string }>;
  gaps: Array<{ requirement: string; severity: "blocker" | "gap" | "unknown"; reason: string }>;
  preferenceMatches: string[];
  preferenceConflicts: string[];
  postingConfidence: "active" | "uncertain" | "stale";
  confidence: "high" | "medium" | "low";
  summary: string;
}
```

The UI sorts by eligibility, fit band, confidence, freshness, and posted date. It does not expose a
fake precision score. Every supporting claim links to a quote or structured source field. The
evaluation may say “unknown”; it may not infer a missing skill or requirement as fact.

Job descriptions are prompt-injection-bearing external content. The module uses the platform's
untrusted-content framing, strips active markup, caps length, and does not expose tools during the
evaluation call. Job text cannot change monitors, profile, resume, permissions, or source policy.

The default daily AI budget evaluates at most 20 new/changed survivors per user. Excess candidates
remain pending for later runs in `pending_since` order; they are not dropped or starved by newer
arrivals. The setting may be lowered or disabled.

Profile and resume revisions do not trigger an unbounded re-evaluation sweep. Existing evaluations
remain immutable and display the profile/resume revisions they used. A revision mismatch is shown as
outdated; it is re-evaluated only when the posting changes or the user explicitly requests it. New
opportunities always use the current approved revisions.

### 9. Assistant and daily Jarv1s integration

The module declares namespaced assistant tools rather than importing Chat, Memory, Briefings,
Tasks, People, Email, or Calendar internals.

Minimum tools:

- `jarv1s.job-search.onboarding.get-state` — read;
- `jarv1s.job-search.profile.get` — read;
- `jarv1s.job-search.profile.save-draft` — write/confirm;
- `jarv1s.job-search.resume.get` — read;
- `jarv1s.job-search.resume.save-draft` — write/confirm;
- `jarv1s.job-search.resume.approve` — write/confirm;
- `jarv1s.job-search.monitor.list` — read;
- `jarv1s.job-search.monitor.save` — write/confirm;
- `jarv1s.job-search.monitor.run` — write/confirm;
- `jarv1s.job-search.opportunities.list` — read;
- `jarv1s.job-search.opportunity.decide` — write/confirm.

Read results are compact and metadata-conscious; listing tools never return every stored job
description. Detail retrieval is explicit and bounded.

The Today widget reads stored results only. After #860 provides the generic runtime dispatch
prerequisite in §1, Briefings can select and invoke the compact read-only opportunity tool without
requiring an executable function embedded in the external JSON manifest. Neither integration starts
source fetches or AI evaluation during page render/briefing composition.

Broader integrations—creating Tasks, parsing recruiter Email, linking People, or preparing Calendar
interviews—belong to the deferred application-management slice and must use declared public APIs or
events.

### 10. Feedback and first-week success

The user can mark an opportunity `saved` or `passed` and optionally choose a reason. This owner-private
feedback supplies the first-week success measure and remains available for later analytics. Using it
to change future ranking is deferred; it never trains a shared model or leaves the instance.

First-week success is measured from the time monitoring is enabled:

- onboarding has one ready profile and one approved resume;
- at least one monitor completes successfully;
- at least five distinct, still-active opportunities are marked `saved` within seven days;
- the user can inspect why each was recommended;
- no scheduled run missed because a browser/chat session was closed.

If fewer than five suitable opportunities exist, the module remains truthful. It reports source
coverage, filters, and monitor health rather than padding the feed with low-quality matches. “No
credible matches yet” is a valid result, not a system failure.

## Security, privacy, and failure boundaries

- Job-search data is sensitive owner-only data. Admins may install, enable, disable, and purge the
  package but cannot read a user's profile, resume, opportunities, or evaluations.
- AI calls use only the user's configured capability route. The onboarding review discloses that
  approved resume/profile and candidate job text may be sent to that configured provider.
- No credential, resume text, profile text, job description, prompt, or AI response enters pg-boss
  payloads or operational logs.
- External source content is data, never authority. It cannot invoke tools or modify state.
- The module receives no raw root DB, foreign-module tables, root filesystem, or ambient secrets.
- Source adapters receive only declared network capability and no login session/cookies.
- Uninstall/disable never silently deletes data. Purge is explicit and audited.
- Every response schema declares all emitted fields; external content is rendered as React text,
  never `dangerouslySetInnerHTML`.
- Resume/profile writes and opportunity decisions follow normal assistant action confirmation and
  audit policy.

## Verification strategy

### Module package and lifecycle

- Package installs against a compatible Jarv1s runtime without modifying the core image.
- Absent, disabled, incompatible, validation-failed, or hash/signature-drifted packages contribute
  no routes, UI, schedules, tools, or workers.
- User disable hides the route/tools/widget and unschedules that user's monitors without deleting
  their data.
- Re-enable restores data and reconciles schedules.

### Unit/contract

- Profile schema and revision provenance.
- Resume truth guard and approval transitions.
- Greenhouse, Lever, and Ashby fixture normalization.
- URL/host validation, redirect rejection, response caps, and sanitizer.
- Dedup by external id and canonical URL; distinct roles with similar titles never merge.
- Deterministic hard filters and unknown-value behavior.
- Structured evaluation schema, sorting, and evidence requirements.
- Daily-period idempotency and no catch-up storm.
- Metadata-only payload assertion.

### Integration

- Fresh user completes onboarding, approves resume/profile, creates a monitor, and enables it.
- Two identical monitor runs create one opportunity per posting and one evaluation per unchanged
  profile/resume/description tuple.
- Changed posting content creates a new evaluation; unchanged content does not.
- Source failure preserves last-known data and reports degraded health.
- AI failure leaves candidates pending and retryable.
- User A cannot read, mutate, export, schedule, or receive Today results for user B.
- Instance admin cannot read user-owned job-search data.
- Account export/delete covers every declared table; disable preserves data; purge removes it.
- Assistant write tools enter the normal confirmation/audit gateway.
- Chat and Briefings invoke an external module's read tool through the same authorized runtime
  dispatch contract; neither depends on a manifest-embedded execute function.
- A profile/resume revision leaves prior evaluations visible but outdated, does not enqueue a mass
  sweep, and an explicit re-evaluation uses the current approved revisions.

### Manual acceptance

1. Install the module package into a running Jarv1s instance; confirm the default image is unchanged.
2. Enable it as operator and user.
3. Open `/job-search`, launch Jarv1s onboarding, paste a real resume, and approve the revised master
   resume and search profile.
4. Add at least one supported company board and a daily local schedule.
5. Run now; confirm active jobs populate with evidence-backed fit bands and original snapshots.
6. Run again; confirm no duplicates and no unnecessary re-evaluations.
7. Close the browser, allow a scheduled run to execute, and confirm Today reports new results.
8. Over seven days, verify either five active roles are saved or the module truthfully explains why
   source coverage produced fewer credible matches.

## Exit criteria

- [ ] #860 prerequisites listed in §1 exist as generic, documented SDK/runtime contracts.
- [ ] The module is distributed independently and is absent from `BUILT_IN_MODULES` and the default
      Jarv1s image.
- [ ] Conversational onboarding produces one approved profile and master resume.
- [ ] Greenhouse, Lever, Ashby, and manual capture work with live-verified fixtures/examples.
- [ ] Manual and daily scheduled monitors are durable, idempotent, metadata-only, and owner-scoped.
- [ ] Opportunities are freshness-checked, deduplicated, deterministically filtered, and evaluated
      through provider-agnostic structured AI.
- [ ] Every recommendation exposes supporting evidence, gaps, uncertainty, and posting confidence.
- [ ] Resume changes cannot introduce unsupported claims and require explicit approval.
- [ ] Module UI, Today widget, and namespaced assistant tools disappear when disabled and return when
      re-enabled.
- [ ] RLS, no-admin-bypass, export/delete, disable/purge, and prompt-injection tests pass.
- [ ] Core `pnpm verify:foundation` and `pnpm audit:release-hardening` remain green for any required
      #860 integration changes; the independently packaged module's own full gate is green.
- [ ] The manual one-week acceptance either records five saved active roles or a truthful low-supply
      explanation with healthy monitors.

## Hard invariants honored

- **No admin private-data bypass:** installation/configuration never grants access to user data.
- **Private by default:** all product records are owner-only; no sharing in MVP.
- **DataContextDb only:** module persistence is actor-scoped through #860's declared storage seam;
  there is no root DB handle.
- **AccessContext shape:** remains `{ actorUserId, requestId }`.
- **Secrets never escape:** none enter frontend responses, prompts, logs, jobs, exports, or KV.
- **Metadata-only jobs:** scheduled payloads carry actor/resource ids and small command metadata only.
- **Provider-agnostic AI:** the module requests capabilities, never a provider or model.
- **Spec before build:** this file must be approved before planning.
- **Module isolation:** all cross-product collaboration uses manifest tools/contributions or public
  APIs; no foreign imports or tables.
- **Never edit applied migrations:** #860's module migration ledger applies new package migrations
  only.
- **Documentation paths:** any future operational instructions use `~/Jarv1s`, never a local absolute
  username path.

## Deferred follow-on slices

1. Application CRM: applied/interview/offer stages, next action, contacts, and document variants.
2. Job-specific resume/cover-letter tailoring with the same truth/evidence gate.
3. Email/calendar/people/task integration through declared public APIs/events.
4. Company research, contact discovery, interview story bank, and negotiation preparation.
5. Additional reviewed source adapters and a separately specified experimental source mode.
6. Response-rate/source analytics after the application CRM provides meaningful outcomes.
