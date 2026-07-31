# Job Search Module — Design Spec

**Status:** Approved
**Date:** 2026-07-26 · **Approved:** 2026-07-27
**Module id:** `job-search` · **Display name:** Job Search
**Delivery:** external module (`external-modules/job-search/`), not in the core Docker image

> Naming note: "Compass" was the title of the source requirements doc only. The product name is
> **Job Search**. Do not use "Compass" in code, UI, or docs.

> Approval note: approved to build. Two of the §13 questions are still open and do **not** block
> Phase 0–4 — briefing detail levels and whether a dismissed posting can resurface. The third,
> dynamic fetch-host grants, is **deferred out of v1**, so "add your own job portal" does not ship;
> the built-in portal list is fixed at package time.

---

## 1. Problem

The user is job hunting. The market's own tools optimize for the employer: they rank by keyword
overlap, they hide why anything surfaced, and they reduce a career decision to one number. The
result is a candidate doing high-volume, low-information work — reading hundreds of postings to
find the four that matter, and losing track of what they actually wanted somewhere around posting
sixty.

Jarvis already knows the user: their notes, their goals, their commitments, their calendar. That
context is the asset no job board has. This module spends it on two questions a board cannot ask.

## 2. The two axes (load-bearing)

Every posting is scored on two independent axes, 0–100, **never blended into one number**:

| Axis     | Question                                                |
| -------- | ------------------------------------------------------- |
| **Fit**  | Can you do this job, and would they plausibly want you? |
| **Want** | Would you still want this job a year in?                |

The gap between them is the product. A posting at Fit 92 / Want 41 is a trap; Fit 74 / Want 94 is
a conversation worth having. Collapsing them hides exactly the information the user came for.

**Constraint:** no screen, API response, export, or briefing line may present a combined,
weighted, or averaged score. The two numbers always travel together and always travel labelled.

## 3. Locked rulings

These came out of the design interview and are decisions, not descriptions. Changing one is a
spec revision, not an implementation detail.

1. **Crawler in v1.** Real portals, real postings. Not a manual-entry tracker.
2. **No paywalled or login-walled sources.** If a portal demands an account before it will show
   postings, the crawler **hard stops** for that portal and disables it with a stated cause. It
   never signs in, never uses stored user credentials against a job board. Working around
   anti-bot measures on _public_ pages is authorized by the owner for their self-hosted instance;
   scraping behind a paywall is not.
3. **Résumé is first-class**, one per search profile. Same underlying document may be tweaked per
   profile; the profile owns its version.
4. **Real open conversation.** The job-search thread is a full-capability assistant session with
   the complete tool set — not a constrained wizard. The user is never told "you can't do that
   here." It differs from the main thread only by seed prompt and scope.
5. **Multiple search profiles.** A person can run "Software Engineer" and "Forward-Deployed AI
   Engineer" as separate searches with separate criteria, sources, résumés, and threads.
6. **Render from records, never from model prose.** Every element on every screen is built from a
   stored field. The model's job is to produce records; the UI's job is to display them. No screen
   region is "whatever the model wrote."
7. **Structured failure causes.** No bare "job search failed." Every failure carries: which portal,
   what kind of failure (`rate_limited | login_required | parse_failed | network`), what was
   retrieved before it stopped, when it last worked, and what happens next. Jarvis must know why,
   and be able to say why.
8. **The recall case is protected.** Postings _outside_ the user's stated frame are surfaced
   deliberately and flagged as such. Aggressive filtering to the stated criteria would defeat the
   product — the user's stated frame is an input, not a fence.
9. **Module owns everything.** No core changes except where core is genuinely missing a capability
   other modules would also want. See §10 — three such changes are required and each is justified
   there.

## 4. Non-goals (v1)

- **No autonomous application submission.** Per-item human approval, always (source doc FR-5.5).
- **No employer-side product**, ever (NFR-8).
- **No dossiers on private individuals.** Public professional record only (NFR-9).
- No headless browser. Plain `fetch` against JSON/HTML endpoints.
- No interview scheduling, no offer negotiation, no salary-data product.
- No recruiter CRM.

The preference model this builds is **the user's**: fully exportable, fully deletable, never sold,
never shared with an employer (NFR-7).

## 5. Architecture

An external module following `external-modules/finance/` exactly — the same manifest, the same
worker/web/domain split, the same build (`scripts/build-external-module.ts`). External and core
modules behave identically; the only difference is that this one is not baked into the image.

```
external-modules/job-search/
  jarvis.module.json          manifest: tools, queues, schedules, storage, tables, fetchHosts
  sql/                        module-owned migrations (never infra/postgres/migrations/)
  src/
    domain/                   pure logic, no SDK imports, unit-testable in isolation
      records.ts              Profile / Posting / Match / PortalState / FailureCause types
      criteria.ts             conversation output -> structured search criteria
      excludes.ts             hard-exclude filter (stage 1)
      triage.ts               embedding similarity triage (stage 2)
      score.ts                Fit/Want prompt construction + result validation (stage 3)
      dedupe.ts               cross-portal posting identity
      store-port.ts           storage interface the handlers are written against
      store-sql.ts            ctx.db implementation of store-port
    adapters/                 one file per source, all behind a common Portal interface
      types.ts                Portal, CrawlResult, CrawlFailure
      indeed.ts               Indeed GraphQL
      linkedin.ts             LinkedIn guest endpoints
      freehire.ts             freehire.me (~50 ATS boards, no key)
    worker/
      index.ts                defineModuleWorker registration
      ports.ts                per-invocation dependency set (finance ports.ts pattern)
      validate.ts             input validation; MUST strip actorUserId (see §11)
      handlers/               one file per tool/queue handler
    web/
      index.ts                module web entrypoint
      root.tsx                onboarding-vs-board branch
      screens/                onboarding.tsx, board.tsx, profile-settings.tsx
```

### Storage

Module-owned Postgres tables (declared in manifest `database.ownedTables`, reached through
`ctx.db`'s bounded SQL — no core repository):

| Table                     | Holds                                                            |
| ------------------------- | ---------------------------------------------------------------- |
| `app.job_search_profiles` | one row per search profile: name, state, criteria JSON, schedule |
| `app.job_search_postings` | crawled postings, deduped, with source + first-seen              |
| `app.job_search_matches`  | per-profile scoring: fit, want, both reasons, flags, state       |
| `app.job_search_portals`  | per-profile portal enablement + last state + failure cause       |
| `app.job_search_resumes`  | one résumé per profile: version, content ref, updated            |

All FORCE RLS, owner-only. No share grants in v1 — a job search is private by construction.

Vector column for triage lives on `app.job_search_postings` (pgvector, 768 dims, matching the
instance embedder from M-A1).

### Crawl → surface pipeline

```
schedule (cron, per user)
  → crawl        each enabled portal, plain fetch, structured failure on any stop
  → dedupe       same posting across portals collapses to one record
  → exclude      hard excludes only (location, comp floor, explicit no-list)
  → triage       embedding similarity, cheap, cuts ~400 postings to the plausible set
  → score        model reads the survivors, emits Fit + Want + a reason for each
  → surface      in-app notification + nav badge + briefing contribution
```

**The triage score never reaches the screen.** It is a cost-control device, not a judgement. Only
Fit and Want — which a model actually reasoned about — are ever shown.

**Recall protection at the triage stage:** the triage cut keeps a reserved slice for postings that
score _below_ the criteria threshold but _above_ it against the user's broader profile context
(goals, notes, past conversation). Those are what surface flagged "outside your stated frame." A
triage that only keeps close matches to the stated criteria is a spec violation.

## 6. Surfacing

Three channels, all fed from the same records:

1. **In-app notification** when a crawl completes with new scored matches.
2. **Nav badge** on the Job Search entry — count of unseen new matches.
3. **Briefing contribution** — user-configurable detail level (headline count only / top matches /
   full read). New postings especially.

## 7. UI

Settled by prototype (`apps/web/src/job-search-prototype/`, variant `?v=flow`). Direction is
approved; **visual style is not locked** and will get its own design pass.

- **Onboarding** (profile has no criteria yet): a full chat interface, full width. No table, no
  rail — there is nothing to show yet, so nothing is shown. A progress readout derived from the
  profile record ("What you do / What you want / Where / Compensation / Sources") so the interview
  has a visible end.
- **Steady state** (profile has criteria): a dense board. Left nav of searches + source health,
  sortable table with **Fit and Want as separate sortable columns**, an inspector showing the two
  axes and the model's reasoning for each, and actions (Discuss / Open posting / Dismiss).
- **Chat after onboarding** is the **existing core header chat control** — the module does not add
  its own chat button. Opening it inside a profile gives that profile's thread.

Empty, degraded, and pending states are first-class and specified: an unscored posting renders as
`—` in both score columns with a "Not read yet" flag and an inspector explaining the queue backed
up and it has not been dropped; a degraded portal renders its structured cause in full.

## 8. Chat and thread scoping

One chat implementation, two renderings, N threads.

- Each search profile owns **one thread**, seeded with a job-search prompt, carrying the **full
  tool set**.
- The thread renders inside the module and inside the core chat drawer. **Same stream, two
  surfaces** — like calling your mother from your phone or your laptop.
- **Strict separation:** a job-search thread must never appear in the main drawer transcript, and
  the main thread must never appear inside the module. The drawer is a chat _surface_; which
  transcript it shows depends on where it was opened.
- **Discuss** on a match opens the thread with that posting already present **as a rendered record
  card**, not as pasted prose.

## 9. Résumé

One résumé per profile. Stored with a version and an updated timestamp. The module can propose a
tailored rewrite for a specific posting; the user approves it before it is stored. No résumé is
ever transmitted to a job board by the module — v1 does not submit applications.

## 10. Core changes required (three)

Each is a capability core is genuinely missing and other modules would want — the standard Ben set
for touching core. Each needs its own task issue.

### 10.1 Dynamic per-user fetch-host grants

**Blocker.** `packages/host-fetch/src/policy.ts` `assertValidFetchHosts` requires literal lowercase
hostnames validated at manifest load. A module cannot fetch a host the user names at runtime, so
"add your own job portal" is impossible under today's contract.

Required: a consent-gated, per-user host grant that layers on top of the manifest allowlist. The
module requests a host; the user approves it once; the grant is recorded and revocable. Per Ben's
permission philosophy this is correctly a runtime prompt — it is genuinely out-of-the-ordinary and
user-initiated, not something the module must do to function.

**Fallback if this is cut:** v1 ships the three declared sources only, and freehire.me still
covers ~50 ATS boards under one host. User-nominated portals move to a later milestone. This is a
real scope reduction and needs Ben's call, not the implementer's.

### 10.2 `ctx.embed` on the module worker contract

`ModuleWorkerContext` (`packages/module-sdk/src/worker.ts`) exposes `input/auth/fetch/kv/ai/db/
attachments`. There is no embedding port, so a module cannot use the instance embedder. Triage
needs it. Add `ctx.embed` + host RPC, provider-agnostic like `ctx.ai`.

### 10.3 Generic module→briefing contribution seam

Core modules contribute to briefings by registering an assistant tool the composer calls
(`packages/sports/src/briefing-tool.ts`, `packages/news/src/briefing-tool.ts`), and both files
note the platform "has no briefing-only flag today" — so those tools are also mechanically visible
to the chat tool registry, which is a wart. An external module needs a declared manifest seam for
briefing contribution. This is the one core change already approved in the design interview.

## 11. Security and privacy

Inherits every CLAUDE.md hard invariant. The ones this module can plausibly violate:

- **No secrets escape.** No credential, token, or hash reaches a frontend response, a log, a
  pg-boss payload, a user export, or an AI prompt.
- **Metadata-only job payloads.** Queue payloads carry actor id, resource ids, job kind,
  idempotency key, and small command params. Never posting bodies, prompts, or résumé content.
- **`actorUserId` envelope trap.** The host spreads `actorUserId` onto every external tool input.
  Strict unknown-key validators MUST strip it at the worker boundary or every call fails with
  `unknown key: actorUserId`.
- **RLS.** All five tables FORCE RLS, owner-only, including for admins. Admin power is
  configuration power only.
- **AI prompts carry the minimum.** Scoring prompts carry posting text plus the user's criteria
  and relevant profile context — never credentials, never other users' data.
- **Provider-agnostic.** No hardcoded provider or model anywhere. Capability requests only.

## 12. Testing

- **Unit** — domain layer in isolation: excludes, dedupe, triage cut (including the reserved
  recall slice), score-result validation, failure-cause construction. No SDK, no network.
- **Integration** — worker handlers against a real DB with RLS on: owner isolation, payload
  shape, `actorUserId` stripping, structured failure persistence.
- **E2E (required, not optional)** — Playwright against a real dev instance, per Ben's standing
  rule that every UI/UX feature ships with one. Minimum path: create a profile → onboarding chat
  produces criteria → crawl fixture → board renders with both axes → open a degraded portal cause
  → discuss a match and confirm the thread is scoped and does not leak into the main drawer.

Unit tests scripted for correctness; the e2e is what proves it actually works through the UI.

## 13. Open questions for Ben

1. **§10.1** — build the dynamic host-grant core capability in this milestone, or ship v1 with the
   three declared sources and defer user-nominated portals? This is the one decision that changes
   the milestone's size materially.
2. Briefing detail levels — what are the actual choices offered to the user?
3. Dismissed postings — permanently hidden, or resurface if the criteria change later?
