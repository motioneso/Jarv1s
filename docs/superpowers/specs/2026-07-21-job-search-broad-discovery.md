# Job Search — Broad Discovery Design Spec

- **Status:** Draft for approval (spec only; no implementation)
- **Date:** 2026-07-21
- **Branch:** `spec/job-search-broad-discovery`
- **Module:** `job-search` (external/pluggable, epic #860; `~/Jarv1s/external-modules/job-search`)
- **Supersedes nothing.** Extends the approved master design
  `docs/superpowers/specs/2026-07-09-intelligent-job-search-module.md` and the KV design
  `docs/superpowers/specs/2026-07-10-job-search-module-design.md`.
- **Grounded on:** worktree at branch `spec/job-search-broad-discovery`, tip commit `591a117f`
  (`docs: hand off broad job discovery spec`). This is a design document; no audit is claimed.

---

## 1. Problem and user outcome

### 1.1 The gap

Today every job source in the module is a **single-company board reader**. The Greenhouse, Lever,
and Ashby adapters each take one `board_token` / `site` and read that one employer's public ATS
feed (`~/Jarv1s/external-modules/job-search/src/adapters/greenhouse.ts` builds
`https://boards-api.greenhouse.io/v1/boards/${board}/jobs`; `MonitorConfig.query` holds exactly one
board; `runMonitorDiscovery` fetches that one board). The onboarding source step is literally
titled **"Watch these N boards"** and requires the user to type a board token or careers-page URL
per company (`~/Jarv1s/external-modules/job-search/src/web/screens/onboarding/controls.tsx`,
`SourcesControl`).

Users reasonably read "job boards" as **broad discovery** — "find me roles across companies that fit
my profile" — not "paste the ATS slug for each employer you already know." A user who cannot name a
single company's ATS token currently cannot complete onboarding with any working source. This is a
**product gap**, not an onboarding-copy problem.

### 1.2 Desired outcome

A user finishes onboarding **without knowing any company URL** and still receives useful, ranked
matches. Two clearly separated source concepts exist:

1. **Broad discovery** (new, default) — searches across roles, companies, and locations using the
   approved search profile. This is the primary onboarding path.
2. **Company watchlist** (existing, optional) — monitors specific Greenhouse / Lever / Ashby career
   pages by token or URL.

The source step explains the distinction in plain language. Broad discovery is on by default and
pre-filled from the profile the user just approved; company watches are an optional add-on.

---

## 2. Terminology and domain model

| Term                                   | Meaning                                                                                                                                                                                                                       |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Source**                             | Anything that produces `NormalizedPosting`s for the shared pipeline. Two kinds now exist.                                                                                                                                     |
| **Company watch** (a.k.a. board watch) | Existing per-company ATS board monitor: one `board_token`/`site` per config. Absence from a fetch is authoritative closure. Keyless.                                                                                          |
| **Broad discovery source**             | New source kind: queries a cross-employer aggregator API with a **profile-derived search query**, returns many postings across companies. Keyless or credentialed per the §4.3 fork. Absence from a fetch is **not** closure. |
| **Search query**                       | The provider request derived at run time from the user's **active profile** (target titles + locations, coarse work-mode). Never a stored snapshot — re-derived each run so profile approval changes flow through.            |
| **Monitor**                            | The persisted config that schedules a source. Both kinds are `MonitorConfig` records; a new discriminator (`query.kind` is `"board"` or `"broad"`) distinguishes them.                                                        |
| **Opportunity**                        | A normalized posting stored owner-only in `module_kv`, identity-hashed, ranked through the deterministic gate + budgeted AI evaluation, surfaced in the feed. Unchanged by this spec.                                         |

**Design stance:** broad discovery is a **new source kind alongside** company watches, not a
replacement. Everything downstream of "produce `NormalizedPosting`s" — upsert, identity, gate, AI
evaluation, feed, retention — is **reused unchanged**. The new surface area is confined to (a) a
cross-employer search source (keyless or credentialed per the §4.3 fork), (b) a query derived from the
profile, (c) two behavioral carve-outs
(freshness and evaluation budgeting), and (d) the onboarding/settings UX.

---

## 3. Current-state constraints (what the pipeline already guarantees)

These are load-bearing invariants the broad source must honor, verified in code:

1. **Adapter contract is board-shaped.** `SourceAdapter` is
   `validateConfig(query) → BoardConfig{board} → buildUrl(BoardConfig) → one URL → normalize(payload)`
   (`src/adapters/types.ts`). It has no notion of pagination, credentials, or a query built from user
   data. Broad discovery does not fit this shape and must not be forced into it (doing so would
   corrupt the clean board contract).
2. **Fail-closed compliance registry.** Only adapters whose `compliance.status === "allowed"` and
   `!killSwitched` register (`src/adapters/registry.ts`). Any new source needs reviewed compliance
   metadata (`policyUrl`, `reviewedAt`, `reviewedBy`, `status`) or it does not ship.
3. **Host-pinned fetch is the real SSRF boundary.** Adapter `fetchHosts` must be a subset of
   `jarvis.module.json` `fetchHosts`, and all network I/O goes through the single `fetchBoard` safe
   reader (compliance gate → courtesy gate → host re-assert → host-pinned `ctx.fetch` → fixed error
   messages). There is exactly one fetcher; a broad source must route through the same enforcement.
4. **Opportunity identity is `adapterId`-scoped on the id path.** `opportunityIdentity` =
   `sha256("id\0" + adapterId + "\0" + externalId)`, or `sha256("url\0" + canonicalUrl)` when there
   is no `externalId` (`src/domain/keys.ts:24`). Two different adapters that surface the same real job
   via the id path produce **different** identity hashes.
5. **Absence ⇒ stale is `sourceKey`-scoped.** `sourceKey = sha256(adapterId + "\0" + board)`;
   `markFreshnessAfterRun` marks records not seen in a successful fetch as stale, scoped to the board
   actually fetched (`src/worker/handlers/run.ts`, `src/domain/keys.ts:52`). This logic assumes a
   **complete** enumeration of a stable set (one board's full job list).
6. **AI evaluation is budgeted.** Deterministic gate first (`src/domain/gate.ts`), then bounded
   provider-agnostic structured-AI fit bands, capped at ≤25 new/changed evaluations per user per
   local day (JS-07). Retention caps opportunities per user (500) with description/tombstone limits.
7. **Metadata-only everywhere.** Run records and job payloads carry ids, counts, and error **codes**
   only — never external text (titles, descriptions, URLs, transport errors). Monitor sweep runs on
   one hourly cron as a **due-check**, at most one discovery run per monitor per local day.
8. **Keyless today.** No job source currently needs a credential. The **selected** broad source
   (Path B′ freehire.dev) and the scrape fallback (Path B) stay keyless; only the **Path A (Adzuna)**
   fork would introduce this module's **first credentialed source** — a genuinely new capability,
   handled per §7. The design keeps that machinery on the Path A branch so a keyless choice adds none.

---

## 4. Options considered and recommendation

### 4.1 Scraping is permitted (product-owner decision, 2026-07-21)

The handoff instructed "do not assume LinkedIn or Indeed scraping is acceptable." **The product owner
has since stated that scraping is acceptable for job search** (2026-07-21). This section is revised
accordingly: scraping is now a **permitted, first-class option**, evaluated alongside licensed APIs
below. It is _not_ automatically the winner — the reliability, maintenance, and terms-of-service
tradeoffs still apply and still shape the recommendation.

**Why scraping is meaningfully more viable for _this_ product than for a centralized SaaS.** Jarv1s is
**self-hosted, typically one user per instance**. A broad search runs at low volume — one profile's
queries, once per local day, from the user's own instance and IP. That traffic looks like a single job
seeker using a search box, not a centralized crawler farming a site. This materially lowers the
anti-bot / rate-limit exposure that makes scraping impractical for a multi-tenant service, and it
**sidesteps API licensing, attribution, and per-key rate budgets entirely** — which happens to dissolve
the biggest open risk of the API path (Adzuna licensing for redistribution, §4.4). It does **not** fix
two real costs: (a) **markup brittleness** — scrapers break when a target changes its HTML and need
ongoing maintenance; (b) **ToS posture** — most large boards forbid automated access in their terms,
and the product owner is accepting that posture as an operator decision.

**Scope guardrails still hold.** Even with scraping permitted, the master spec's hard non-goals remain:
no _logged-in_ / credentialed scraping of a user's personal LinkedIn/Indeed account, no CAPTCHA/anti-bot
**evasion** infrastructure (rotating proxy pools, headless-browser fingerprint spoofing), and no generic
"crawl any URL the user pastes" engine. Permitted scraping means **reading public, unauthenticated
search-results and posting pages** at courteous low volume, ideally via **structured signals**
(`schema.org/JobPosting` JSON-LD, which many boards and employer pages emit and which is far more stable
than scraping rendered DOM). The safe-reader / host-pinned-fetch / compliance-registry machinery in §3
still governs every request.

**API-only providers, confirmed against primary docs** (relevant because a _published_ API is still
lower-maintenance than scraping when one exists):

- **Indeed** Publisher/Job-Search API carries a deprecation banner — _"This API is deprecated and not
  available for new integrations"_ — and current Indeed APIs are employer-side only. So Indeed is
  reachable **only** by scraping its public search pages, not by API. Source:
  `developer.indeed.com/docs/publisher-jobs/job-search`.
- **LinkedIn** has **no public jobs-search API**; jobs APIs are partner-only, posting-oriented, and
  _"not accepting new partnerships."_ LinkedIn is also the **most aggressively anti-bot and
  auth-walled** target, with a documented history of litigating scrapers — the highest-maintenance,
  highest-risk scrape target of the set. Source:
  `learn.microsoft.com/en-us/linkedin/talent/job-postings/api/overview`.

### 4.2 Candidate sources — APIs (primary-doc verified) and scrape targets

| Provider                               | Access                                                                                       | Coverage                                                                                                                                           | Filters                                                                              | Provenance                                                                                                                                            | Rate limit                                  | Verdict                                                                                                                     |
| -------------------------------------- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| **freehire.dev** (`strelov1/freehire`) | **keyless public REST** for read (search/job/company); free key only for per-user save/apply | **aggregates many company ATS boards** (Greenhouse, Lever, Ashby, iCIMS, Workday-likes); **tech-focused**, ~3M jobs; US present but not quantified | keyword, location, remote, stack/seniority tags                                      | **canonical employer boards** (ingests ATS directly); deduped upstream                                                                                | public API; MIT, self-hostable (Go service) | **SELECTED (Path B′)**: keyless, canonical, ATS-sourced, MIT, self-hostable; accepted caveat = tech-focused coverage        |
| **Adzuna**                             | Self-serve `app_id`+`app_key`; commercial use past a **14-day trial** may need a licence     | **Aggregator, 16 countries** incl. full US                                                                                                         | keywords, title, location+radius, salary min/max, contract type, category, date sort | company name, salary min/max, category, posted date, geo; **`redirect_url` is a tracking redirect, not employer canonical**; description is a snippet | 25/min, 2,500/mo default (raisable)         | **Recommended API fallback (Path A)**                                                                                       |
| **USAJOBS**                            | Free API key + registered email                                                              | **US federal only**                                                                                                                                | keyword, title, location+radius, salary bands, series                                | **canonical** `PositionURI` + `ApplyURI`, org, salary                                                                                                 | generous                                    | Optional federal supplement; **"no derivative works / registered-company-only"** clause is a redistribution flag → deferred |
| The Muse                               | Optional key                                                                                 | curated multi-country, US-heavy                                                                                                                    | **no keyword/salary filter**                                                         | canonical `landing_page`                                                                                                                              | 3,600/hr keyed                              | Too narrow (no keyword search)                                                                                              |
| Remotive                               | No auth                                                                                      | **remote-only**, 24h lag                                                                                                                           | search, category                                                                     | canonical `url`                                                                                                                                       | ~2/min                                      | Remote-only + delayed                                                                                                       |
| Findwork.dev                           | Free, login-walled docs                                                                      | **tech only**                                                                                                                                      | search, location, remote                                                             | `url`                                                                                                                                                 | ~60/min (unverified)                        | Tech-only; terms behind login                                                                                               |
| Arbeitnow                              | No auth                                                                                      | **DE/EU-centric**                                                                                                                                  | none (feed)                                                                          | `url`                                                                                                                                                 | undocumented                                | No query filters; wrong region                                                                                              |
| Jooble                                 | **Approval-gated** key                                                                       | ~70 countries                                                                                                                                      | keyword, location                                                                    | undocumented                                                                                                                                          | undocumented                                | Terms/fields unverifiable pre-approval                                                                                      |
| Careerjet                              | **Publisher/affiliate-gated**                                                                | ~90 countries                                                                                                                                      | keyword, location, salary                                                            | `url` + salary                                                                                                                                        | undocumented                                | Affiliate model; passes end-user IP/UA                                                                                      |
| Greenhouse / Lever                     | Public per-board                                                                             | one employer per request                                                                                                                           | none across companies                                                                | canonical                                                                                                                                             | —                                           | **Confirmed no cross-company search endpoint** — cannot serve broad discovery                                               |
| **Scrape — structured (JSON-LD)**      | none; parse `schema.org/JobPosting` from public search/posting pages                         | depends on target; potentially very high                                                                                                           | as good as the page exposes                                                          | **canonical** (JSON-LD carries `url`, `hiringOrganization`, `baseSalary`, `datePosted`)                                                               | self-throttle                               | **Now permitted; strong candidate** — most stable scrape signal, no license/attribution                                     |
| **Scrape — Indeed public search**      | none; parse public results pages                                                             | **very high (US-broad)**                                                                                                                           | keyword, location, salary, date via URL params                                       | company/title/snippet; canonical needs a second fetch; Cloudflare-fronted                                                                             | self-throttle                               | Permitted; high coverage but **Cloudflare + brittle DOM**, ToS forbids automated access                                     |
| **Scrape — LinkedIn public search**    | none                                                                                         | very high                                                                                                                                          | keyword, location                                                                    | brittle; heavy anti-bot                                                                                                                               | self-throttle                               | Permitted but **worst maintenance/legal posture** — do not lead with this                                                   |

Greenhouse and Lever were explicitly re-verified: both are strictly per-employer
(`board_token` / `site` in the path), and Lever's docs state outright that the postings API _does not_
offer full-text search over open jobs. They remain the right tool for **company watches** and the
wrong tool for **broad discovery**. Sources: `developers.greenhouse.io/job-board.html`,
`github.com/lever/postings-api`.

### 4.3 Recommendation

The MVP choice is a **fork between three viable single-source paths**. All feed the identical
downstream pipeline (§2), so the choice is contained to how one source is fetched and normalized — it
does not ripple into identity, gate, evaluation, or feed.

- **Path B′ — Keyless aggregator (freehire.dev) — SELECTED (product-owner decision, 2026-07-21).**
  `strelov1/freehire` is an open-source (MIT) aggregator that ingests **many company ATS boards
  directly** — Greenhouse, Lever, Ashby, iCIMS, Workday-likes — deduplicates upstream, and exposes a
  **keyless public REST API** for read; a free key is needed only for opt-in per-user save/apply, which
  we do not use. Read endpoints (primary-doc verified, `github.com/strelov1/freehire`, base
  `https://freehire.dev`): `GET /api/v1/jobs/search` (keyword/location/remote/tag filters + pagination),
  `GET /api/v1/jobs/:slug`, `GET /api/v1/companies`, `GET /api/v1/companies/:slug`, `GET /health` — all
  **no-auth**. Only `POST/PATCH/DELETE` write endpoints (`/view`, `/apply`, `/save`, `/track`,
  `/me/*`) require a key, and this design uses none of them. **Pro:** no license/attribution
  obligation, no per-key rate budget for search, **canonical employer URLs** (it reads the same public
  ATS boards we already trust), upstream dedup, and it is **self-hostable** (run the Go service with
  its own `DATABASE_URL`/`JWT_SECRET`/`SOURCES_FILE`; our module simply points its base URL at the
  self-hosted host) — an operator can run the aggregator in-house and keep the entire data path
  private, an exceptional fit for our self-hosted, privacy-by-default model. It is also the most
  **on-brand** option: it extends the exact public-ATS posture of the existing company-watch adapters
  to broad discovery, with **no scraping we author**. **Con (accepted):** coverage is
  **tech/IT-focused** (weak for non-technical roles) and it is a **young project** — a third-party
  availability dependency, mitigated by the self-host escape hatch. The exact search query params and
  per-job JSON field names are not in the README and must be read from the service's handler code
  during build — an **implementation detail, not a feasibility risk**.

- **Path B — Structured public scrape.** Read public, unauthenticated pages at courteous low volume,
  preferring `schema.org/JobPosting` JSON-LD; a lighter concrete variant is **LinkedIn's public,
  unauthenticated `jobs-guest` endpoints** (used by the `ai-job-search` prior art, §4.5) rather than
  full DOM scraping. **Pro:** no license, canonical/near-canonical URLs, fits the self-hosted
  low-volume model (§4.1); **broad coverage beyond tech** if the target is a general board. **Con:**
  markup/endpoint brittleness and ongoing maintenance; ToS forbids automated access on most large
  boards (LinkedIn explicitly — keep volume low, personal-use posture); the specific target's
  stability is **unverified here** and needs a short feasibility spike.

- **Path A — Licensed API (Adzuna).** True cross-employer aggregator, self-serve, full filter fidelity,
  structured provenance, **16 countries incl. broad non-tech US coverage**. **Pro:** lowest engineering
  maintenance — a documented, stable contract; the **best general (non-tech) coverage** of the three.
  **Con:** licensing friction for a self-hosted, redistributable app (§4.4), mandatory "Jobs by Adzuna"
  attribution, per-key rate budget.

**Decision: Path B′ (freehire.dev) is the MVP broad source** (product owner, 2026-07-21 — no spike
required). Rationale: freehire.dev uniquely combines keyless access, canonical ATS provenance, upstream
dedup, and a self-host escape hatch — it removes both the licensing unknown (Adzuna) and the
brittleness/maintenance unknown (raw scraping) in one move, and it matches the module's existing
public-ATS compliance posture almost exactly. **Adzuna (Path A)** is retained in this spec only as the
documented fallback if broad **non-tech** coverage later proves necessary; **structured scrape (Path
B)** as a no-dependency fallback. Neither is built for the MVP.

The accepted tradeoff is coverage (freehire is tech-heavy — see §12 Q1 for the non-tech follow-up).
The rest of this spec stays **source-agnostic** where it is cheap to: it uses Adzuna as the worked
example for a _credentialed_ API source and calls out where the selected keyless source differs
(credentials, identity, provenance, freshness), so the fallback paths remain documented without
blocking the freehire build.

**One dependable source, not a framework** (holds for either path). We implement the chosen source
concretely behind a **thin internal `JobDiscoveryProvider` seam** (one implementation) so the source is
swappable in code without a user-facing adapter-authoring framework — honoring the "don't hardcode a
vendor" spirit while staying well short of a speculative marketplace.

**Deferred (either path):** USAJOBS federal supplement, additional/second providers, multi-provider
selection UI, per-user provider keys, and second-fetch canonical resolution where the source URL is a
redirect (see §9, §10).

### 4.4 Adzuna licensing note (applies only if Path A is chosen)

Retained for the API branch: for a self-hosted, redistributable app, Adzuna's _"explicit use of the
requesting company"_ framing, the mandatory **"Jobs by Adzuna"** attribution label, and
_delete-all-data-on-termination_ clause must be cleared before GA (§12, Q1). Sources:
`developer.adzuna.com/overview`, `developer.adzuna.com/docs/search`,
`developer.adzuna.com/docs/terms_of_service`. **If Path B is chosen, this risk does not apply.**

### 4.5 Prior art — `MadsLorentzen/ai-job-search`

The open-source `github.com/MadsLorentzen/ai-job-search` project is a useful reference for the
keyless/scrape branches and validates several decisions in this spec:

- **Thin per-portal adapters, not a framework.** It ships small portal-specific CLI tools
  (`linkedin-search`, `freehire-search`, and Danish-portal readers) rather than a generic crawl-any-URL
  engine — the same "one dependable source, not a speculative adapter framework" posture the handoff
  asks for (§9).
- **`freehire-search`** reads freehire.dev's keyless public REST API — independent confirmation that
  Path B′ is usable without credentials.
- **`linkedin-search`** reads LinkedIn's public, unauthenticated **`jobs-guest`** endpoints (the light
  variant noted under Path B) rather than authenticated DOM scraping, and the project explicitly
  **declines auth-walled portals** — the same fail-closed compliance posture as our adapter registry
  (§3, §7). It carries a **personal-use / low-volume ToS caveat**, consistent with §4.1's guardrails.
- **Rank-by-fit across multiple dimensions with a dealbreaker veto** mirrors our deterministic gate +
  bounded AI-eval design (§3) and reinforces treating all fetched text as **untrusted input** (§7).

It is prior art for _approach_, not a dependency: no code is adopted, and its Danish-portal readers and
personal-use framing are out of scope. What we take from it is the shape — thin adapters, keyless-first,
decline anything auth-walled.

---

## 5. End-to-end UX and state transitions

### 5.1 Onboarding source step (redesign of `sources_schedule`)

The checkpoint id `sources_schedule` and the six-checkpoint flow
(`resume_intake → resume_critique → resume_approval → profile → sources_schedule → review_enable`)
are **unchanged** — no onboarding-state migration. Only the content of the source step changes.

The step now leads with broad discovery, pre-filled from the just-approved profile:

```
┌─ Where should I look? ───────────────────────────────────────┐
│ ● Search across companies            [ on ]   (default)      │
│   Roles matching “Staff Product Designer”, “Design Lead”     │
│   in “Remote (US)”, “New York”. I’ll refine as we go.        │
│                                                              │
│ ▸ Also watch specific company pages   (optional)             │
│   Greenhouse / Lever / Ashby — paste a token or careers URL. │
│   [ + add a company ]                                        │
│                                                              │
│ Daily run:  ( 06:00 ) ( ●07:00 ) ( 08:00 )                   │
│                              [ Start my search ]             │
└──────────────────────────────────────────────────────────────┘
```

- **Broad discovery is on by default**, its summary line rendered from the approved profile's
  `targetTitles` + `locations`. The user can toggle it off, but the primary CTA ("Start my search")
  completes onboarding with **broad alone** — no company URL required.
- **Company watches are collapsed and optional** — the existing `SourcesControl` per-adapter inputs,
  demoted under an "Also watch specific company pages" disclosure.
- The confirm-gated write path is unchanged: the assistant calls `monitor.save` per confirmed source
  through the existing `AssistantToolGateway`. Broad discovery saves one monitor with
  `query.kind:"broad"`; each company watch saves a `query.kind:"board"` monitor as today.

### 5.2 State transitions and empty/loading/error states

| State                                        | Trigger                                      | UX                                                                                                                                                                                                                                                                   |
| -------------------------------------------- | -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Broad provider not configured (instance)** | operator has not set a provider key          | Broad toggle shows an inline note: _"Broad search turns on once your instance admin adds a job-search provider key."_ Onboarding **still completes**; the broad monitor is saved but marked `awaiting_provider`; company watches (if any) run normally. No dead end. |
| **Configured, no run yet**                   | onboarding finished, first daily run pending | Feed empty state: _"Your first search runs at 07:00. I’ll have matches waiting."_ (authored empty-state pattern, not a spinner-forever).                                                                                                                             |
| **Running**                                  | worker executing the daily run               | Existing feed loading pattern; no per-provider spinner.                                                                                                                                                                                                              |
| **Results**                                  | run produced ranked opportunities            | Existing feed views (new/saved/passed/stale). Broad results carry a **source provenance chip** and the required **"Jobs by Adzuna"** attribution (see §6.4, §7.5).                                                                                                   |
| **Zero results**                             | run succeeded, query matched nothing         | Not an error. _"No new matches today for these titles. Want to broaden the search or add a company to watch?"_                                                                                                                                                       |
| **Provider error**                           | auth/rate-limit/transport failure            | Feed unchanged (no stale marking); a quiet status line: _"Broad search didn’t run this cycle; I’ll retry."_ Never surfaces external error text.                                                                                                                      |

### 5.3 Post-onboarding management

In the module's sources/monitors screen (existing surface, extended):

- **Broad discovery:** one row per user for v1 (§12, Q7). Actions: **pause/resume** (toggles
  `enabled`), **edit** (re-derives from the current profile automatically; an explicit "refresh from
  profile" is a no-op since the query is always live), **run now** (existing run-now singleton, no
  slot consumption). Removing it deletes the broad monitor.
- **Company watches:** unchanged add/remove/pause per board.
- Broad and watch rows are **visually and semantically distinct** (different eyebrow label + provenance
  copy) so "broad search" and "company watch" never blur.

---

## 6. Data / API contracts and source provenance

> **Fork note.** §6.2–§6.4 are written as the **Path A (Adzuna API)** worked example. §6.6 states how
> the **keyless paths — Path B′ (freehire.dev) and Path B (structured scrape)** — differ: no
> credential, canonical employer URL (not a tracking redirect), and url-path identity. Path B′
> additionally returns **upstream-deduped, ATS-sourced** records. The seam (§6.1) and volume controls
> (§6.5) are identical across all paths.

### 6.1 Internal provider seam (new)

A sibling to `SourceAdapter`, kept deliberately minimal (one implementation). The `attribution` field
is populated only for sources that require it (Adzuna); a scrape source leaves it absent:

```ts
// src/adapters/discovery-types.ts  (sketch — not implemented in this spec)
export interface DiscoveryQuery {
  readonly titles: readonly string[]; // from profile.targetTitles
  readonly locations: readonly string[]; // from profile.locations
  readonly remote?: boolean; // coarse; derived from remotePreference
  readonly country: string; // ISO-2, operator/profile default "us"
  readonly maxResults: number; // hard cap per run (see §6.5)
}

export interface JobDiscoveryProvider {
  readonly id: string; // "adzuna"
  readonly displayName: string; // "Adzuna"
  readonly fetchHosts: readonly string[]; // ["api.adzuna.com"] ⊆ manifest fetchHosts
  readonly compliance: AdapterCompliance; // status must be "allowed" or it does not register
  readonly attribution: {
    // rendered by the feed (see §6.4)
    readonly label: string; // "Jobs by Adzuna"
    readonly href: string; // local Adzuna domain
  };
  // Builds the request(s) from a query; credentials injected by the safe reader,
  // never by the provider itself. Returns normalized postings + fetch evidence.
  buildRequests(query: DiscoveryQuery): readonly DiscoveryRequest[];
  normalize(payload: unknown): NormalizeResult; // → NormalizedPosting[] (same type as boards)
}
```

Both source kinds emit the **same `NormalizedPosting`** (`src/adapters/types.ts`), so upsert, gate,
evaluation, feed, and retention consume them identically. The registry gains a second fail-closed list
for discovery providers, gated on the same compliance metadata.

### 6.2 Adzuna request mapping

- **Endpoint:** `GET https://api.adzuna.com/v1/api/jobs/{country}/search/{page}`
- **Credentials:** `app_id` + `app_key` as query params, **injected by the safe reader** from the
  encrypted instance credential (§7). The provider code never sees raw secrets in a form it can log.
- **Query params from `DiscoveryQuery`:** `what` (titles, OR-joined or per-title requests),
  `where` (location), `results_per_page` (capped), `max_days_old` (e.g. 7, to bound freshness churn),
  `sort_by=date` for new-first, `content-type=application/json`.
- **Deliberately NOT sent externally:** salary floor, dealbreakers, excluded companies, employment
  type. These are applied **locally by the existing deterministic gate** after fetch. This minimizes
  the profile data that leaves the instance to coarse facets (titles + location only) — see §7.4.

### 6.3 Adzuna → `NormalizedPosting` normalization

| `NormalizedPosting` field | Adzuna source                                                 | Notes                                                                                                                      |
| ------------------------- | ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `externalId`              | `results[].id`                                                | Adzuna's stable job id.                                                                                                    |
| `canonicalUrl`            | `results[].redirect_url`                                      | **Adzuna redirect, not employer canonical** — recorded honestly as the provider URL; the feed labels it as an Adzuna link. |
| `title`                   | `results[].title`                                             | Sanitized/capped like board adapters.                                                                                      |
| `company`                 | `results[].company.display_name`                              |                                                                                                                            |
| `locations`               | `results[].location.display_name` / `area[]`                  |                                                                                                                            |
| `workMode`                | derived from `location`/`category` heuristics                 | Best-effort; absent ⇒ unknown, never defaulted.                                                                            |
| `compensation`            | `results[].salary_min`/`salary_max` (+ `salary_is_predicted`) | Predicted salary flagged; gate treats predicted values conservatively.                                                     |
| `publishedAt`             | `results[].created`                                           | ISO date.                                                                                                                  |
| `description`             | `results[].description`                                       | **Snippet only** — `descriptionTruncated=true`; AI evaluation must not assume full JD text.                                |

### 6.4 Source provenance

Every opportunity already implies its source via `adapterId`. Broad results:

- carry `adapterId = "adzuna"`, distinguishing them from `greenhouse`/`lever`/`ashby`;
- render a **provenance chip** ("via Adzuna") plus the mandated **"Jobs by Adzuna"** attribution label
  in list and detail views (design placement is §12, Q6);
- present `canonicalUrl` honestly as an Adzuna redirect link (we do not claim it is the employer's
  canonical apply URL; resolving to the true canonical is deferred — §10).

### 6.5 Volume controls (new, load-bearing)

A broad query can return far more than a single board. Two existing caps become binding and one new
cap is introduced:

1. **Per-run fetch cap:** at most `maxResults` postings per broad run (recommend **≤50**), via
   `results_per_page` + a small bounded page count. Keeps ingestion inside the 500-opportunity
   retention ceiling and avoids exhausting the Adzuna rate budget.
2. **Existing AI-eval budget (≤25/user/local-day) is unchanged.** Broad results compete for the same
   budget; the deterministic gate + Adzuna's own date/relevance ordering pre-select which survivors
   reach AI evaluation. Overflow is evaluated on subsequent days (existing behavior), never dropped
   silently — the run record's counts expose `evalPending`.
3. **Query precision is the primary lever.** A tight profile-derived query (specific titles +
   locations) is what keeps junk out; this is stated as an explicit design principle, not a filter to
   add later.

### 6.6 Keyless paths (B′ freehire.dev / B structured scrape) — how they differ

If the fork (§4.3, §12 Q1) resolves to either keyless path, only the source's fetch/normalize internals
change; everything downstream is identical. The differences:

- **Credentials: none.** A keyless read needs no API key, so all of §7.1–§7.2 (credential ownership,
  encrypted store, "awaiting_provider" state) **do not apply**. The "not configured" onboarding branch
  in §5.2 collapses — broad discovery is available out of the box with no operator setup. This is a
  material UX simplification in both keyless paths' favor. (Path B′ needs a free key **only** for opt-in
  per-user save/apply, which this design does not use.)
- **Fetch:** still through the single host-pinned safe reader (§3). `fetchHosts` lists the source
  host(s) — `freehire.dev` (or the operator's self-hosted freehire host) for Path B′, or the scrape
  target's host(s) for Path B — instead of `api.adzuna.com`. Requests are courteous, low-volume (one
  run/day), and send a plain, honest user agent — **no anti-bot evasion** (scope guardrail, §4.1).
- **Parsing:** Path B′ consumes freehire's structured JSON directly (already normalized and
  ATS-sourced). Path B prefers `schema.org/JobPosting` JSON-LD embedded in the page over rendered-DOM
  scraping; JSON-LD is a published contract far more stable than markup. A normalization failure for a
  given posting drops that posting (counts-only), never the run.
- **Provenance is better:** both yield the **employer canonical URL** (Path B′ ingests the ATS boards
  directly; Path B reads JSON-LD `url` / `hiringOrganization`), not a tracking redirect. So
  `canonicalUrl` is genuinely canonical, and no third-party attribution label is required.
- **Identity uses the url-path:** with a real canonical URL and no stable provider id, keyless results
  take `sha256("url\0" + canonicalUrl)` (§3, `keys.ts:24`). Unlike the id-path this is **not
  adapterId-scoped**, so two keyless-sourced records (or a keyless result and a manual URL capture) for
  the same posting **converge automatically** — a modest dedup improvement over the API path. Path B′
  additionally arrives **deduped upstream**. Cross-source convergence with ATS _board_ watches (which
  use the id-path) still does not happen; that remains the accepted, documented duplication of §10.1.
- **Freshness:** identical carve-out — keyless results are a ranked/paginated window, so
  `absenceImpliesClosure` is `false` (§8). No change.

---

## 7. Security, privacy, and permission decisions

> **Fork note.** §7.1–§7.2 (credential ownership and secret handling) apply to **Path A only**. The
> **keyless paths (B′ freehire.dev and B structured scrape) have no credential**, so those subsections
> are moot for them; §7.3–§7.6 (metadata-only payloads, outbound data minimization, permissions, RLS)
> apply to **all paths**.

### 7.1 Credential ownership — instance-scoped operator config

Adzuna requires `app_id` + `app_key`. **Recommendation: a single instance-level credential owned by
the instance operator**, modeled exactly like AI-provider keys, **not** per-user and **not** in
`module_kv`.

- Stored in the platform's existing **AES-256-GCM encrypted credential store** (the same mechanism as
  connector/AI secrets; `module_credentials` semantics), surfaced to the worker as a **capability port**
  and never as raw bytes the module can log.
- The frontend and assistant only ever see a **metadata surface**: `{ configured: boolean,
lastRunStatus?: code }`. Never the key.
- Rationale: Adzuna's license framing is company/operator-oriented, its rate budget is per-key, and a
  self-hosted instance already trusts its operator with AI keys. Per-user BYO keys are a plausible
  alternative with different rate/license tradeoffs — recorded as an open question (§12, Q2), not built.

### 7.2 Secrets never escape (hard invariant, restated for this feature)

The Adzuna key must never reach: frontend responses, logs, pg-boss job payloads, user exports, or AI
prompts. Injection happens inside the single safe reader; error messages name the constraint/code only
(same scrubbed-by-construction contract as `JobSearchFetchError`). Broad-run records stay counts-only.

### 7.3 Job payloads stay metadata-only

A broad monitor's run payload is `{ monitorId }` (plus the standard actor/jobKind/idempotency
envelope) — identical to board monitors. The profile-derived query is built **inside** the run from
the active profile in the user's own KV scope; it is never serialized into a pg-boss payload.

### 7.4 Outbound data minimization (privacy)

Broad discovery inherently sends **search terms derived from the user's profile to a third party**
(Adzuna). To bound this:

- **Only coarse facets leave the instance:** target titles and location (and a coarse remote flag).
- **Salary floor, dealbreakers, excluded companies, and employment type are applied locally** by the
  deterministic gate — they are never sent to Adzuna. This is both a privacy decision and a filter-
  fidelity decision (the gate is stricter and lossless-to-us).
- Resume text, name, contact details, and the full profile are **never** sent. This disclosure is
  surfaced in onboarding copy ("I search public listings via Adzuna using your target titles and
  locations"). Whether even title+location egress is acceptable, and whether salary should ever be
  sent for better server-side filtering, are recorded as open questions (§12, Q4).

### 7.5 Permission model

Installing the module accepts its ordinary tool permissions; **broad discovery adds no destructive
action** and therefore adds **no new permission prompt** for the end user. The only new privileged
action is the **operator** setting the provider key, which is an ordinary settings write (not
destructive, operator-scoped). The mandated attribution label is a display obligation, not a
permission.

### 7.6 RLS / privacy classification

- **Opportunities, monitors, runs, feed:** owner-only, forced RLS in `module_kv` — **unchanged**.
  Broad results are ordinary owner-private opportunities.
- **Instance provider credential:** operator/instance configuration, encrypted at rest, not user data
  and not in any user's KV. No `BYPASSRLS`; no admin private-data bypass; RLS applies to all actors.
- Classification summary: broad-discovery opportunities = **owner-only** (same as all job-search data).
  The credential = **instance secret** (operator-config plane), never owner data.

---

## 8. Failure modes and recovery

| Failure                     | Detection                                  | Behavior                                                                                                               | Recovery                                                                                                                           |
| --------------------------- | ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Provider not configured     | credential port reports `configured:false` | Broad run records error code `broad_source_unconfigured`; **no stale marking**; onboarding degrades gracefully (§5.2). | Auto-runs once operator adds the key; next daily tick picks it up.                                                                 |
| Invalid/expired key         | Adzuna 401/403                             | Run record `auth_failed` (code only); no slot consumed; no stale marking.                                              | Operator fixes key; retries next tick.                                                                                             |
| Rate limited                | Adzuna 429                                 | Run record `rate_limited`; no slot consumed; backoff.                                                                  | Retries next tick; operator can request a higher Adzuna limit. Shared-key exhaustion across many users is the main risk (§12, Q2). |
| Transport/malformed payload | fetch/normalize error                      | Existing `fetch_failed` / `malformed_payload` codes; known jobs untouched; **not** marked stale.                       | Retries next tick.                                                                                                                 |
| Zero results                | successful empty fetch                     | Not an error; empty-state UX; no stale marking.                                                                        | User broadens query or adds a watch.                                                                                               |
| License lapse (operator)    | out of module runtime scope                | Documented operator responsibility; module keeps functioning on the key it has.                                        | Operator/legal action (§12, Q1).                                                                                                   |

**Freshness carve-out (critical).** Broad-discovery results are **exempt from absence-⇒-stale
marking**. A job dropping out of a relevance/date-ranked, paginated search window is **not** evidence
the posting closed. Concretely: a per-source flag `absenceImpliesClosure` is `true` for board
adapters and `false` for the broad provider; `markFreshnessAfterRun` skips stale-marking for
`false` sources. Broad opportunities age out purely by the **existing time-based retention/eviction**
(30-day) rather than by absence. An explicit liveness re-check for broad results is deferred (§10).

---

## 9. MVP scope and non-goals

### 9.1 MVP (this milestone)

- **One broad source — freehire.dev (Path B′, selected §4.3)**, behind a thin internal
  `JobDiscoveryProvider` seam. (Documented, unbuilt fallbacks: **Path A Adzuna** for broad non-tech
  coverage, **Path B structured scrape** for no-dependency.)
- **Credential handling per path:** the **keyless paths (B′ and B) need none** (public read, no
  operator setup); **Path A** uses an **instance-scoped, encrypted operator credential**, metadata-only
  surfaces, secrets never escape.
- **Profile-derived query at run time** (titles + locations + coarse remote; salary/dealbreakers/etc.
  applied by the local gate).
- **Reuse** the monitor scheduler, deterministic gate, budgeted AI evaluation, feed, and retention.
- **Two behavioral carve-outs:** broad results exempt from absence-⇒-stale; per-run fetch cap (≤50).
- **Onboarding redesign:** broad on by default, pre-filled from profile, company watches optional; a
  user with no company URL completes onboarding and gets matches.
- **Source provenance** rendered in the feed — canonical employer link on Path B, or the required
  **"Jobs by Adzuna"** attribution on Path A.
- **Coexistence with existing ATS watches** unchanged; both kinds flow through one pipeline.

### 9.2 Non-goals (explicitly deferred)

- A generic multi-provider **adapter/authoring framework** or provider marketplace.
- **USAJOBS** federal source and any second/parallel broad source (run one, not both).
- **Per-user** provider keys / BYO-key UX (Path A only).
- **Logged-in / credentialed scraping** of a user's personal LinkedIn/Indeed account; **anti-bot
  evasion** infrastructure (rotating proxies, headless-browser fingerprint spoofing); a generic
  "crawl any pasted URL" engine. Scraping is permitted only as **courteous, low-volume, public,
  unauthenticated** reads (§4.1).
- **Cross-source deduplication / fuzzy merge.** The master spec forbids fuzzy title/company merge; a
  broad-found job and a watched-board job for the same role may appear as two records. For MVP this is
  an **accepted, documented, rare duplication** (see §11). We do **not** fuzzy-merge. (Path B's url-path
  identity does converge scrape-vs-scrape and scrape-vs-manual-capture automatically — §6.6.)
- **Second-fetch canonical resolution** on Path A (resolving Adzuna `redirect_url` to the employer
  canonical) — extra fetch per posting against the rate budget. Not needed on Path B (canonical is in
  the JSON-LD).
- **Liveness re-check** for broad results beyond time-based retention.
- Multiple saved broad searches per user (v1 = one).
- Sending salary or other sensitive facets to the source.

---

## 10. Coexistence, identity, and migration/compatibility

### 10.1 Identity and the cross-source duplicate

Broad results take the id path: `sha256("id\0adzuna\0" + adzunaId)`. A watched Greenhouse job takes
`sha256("id\0greenhouse\0" + ghId)`. These never collide, so the **same real job discovered by both a
broad search and a company watch appears as two opportunities.** For MVP:

- **Within** the broad source, dedup is exact and correct (`(adzuna, adzunaId)`).
- **Across** sources, we accept the rare duplicate and **surface it honestly** (each carries its own
  provenance chip). We do **not** attempt a fuzzy `(company, title, location)` merge — that would
  violate the master spec's no-fuzzy-merge decision and risk merging genuinely distinct roles.
- A future option (deferred, §12 Q3): resolve Adzuna `redirect_url` to the employer canonical and use
  the url-path identity to converge exact matches. Rate-cost and reliability make this post-MVP.

### 10.2 Freshness coexistence

Covered in §8: board sources keep authoritative absence-⇒-stale; the broad source opts out via
`absenceImpliesClosure:false`. No change to board behavior.

### 10.3 Ranking / gate / evaluation coexistence

Unchanged pipeline. The gate already filters on `excludedCompanies`, `compensation`,
`remotePreference`, `dealbreakers`, and `locations`+onsite (`src/domain/gate.ts`), so the facets we
deliberately omit from the outbound Adzuna query are still enforced locally. Note: the gate does **not**
filter on `targetTitles` — titles are a **query** lever (precision at fetch), consistent with today.

### 10.4 Migration and compatibility

- **Additive manifest changes:** add `api.adzuna.com` to `fetchHosts`; register the `adzuna` provider;
  add the `query.kind` discriminator (default `"board"` for existing records → **no data migration**;
  pre-existing monitors read as board watches).
- **No applied-SQL migration authored by the module** for the KV plane (`module_kv` is generic).
- **Dependency on the platform credential/instance-config plane** (the AI-key mechanism) — this spec
  assumes it exists and is reused; if a new credential namespace is required, that is a platform change
  tracked outside this module and called out as a build prerequisite.
- **Onboarding state:** checkpoint ids unchanged → users mid-onboarding are unaffected.
- **Schema versions:** `MonitorConfig`, `OpportunityRecord`, etc. stay `schemaVersion: 1` with
  additive-optional fields (records.ts hard-pins the version; a bump would brick existing readers).

### 10.5 Accessibility

- The broad on/off control is a labeled switch with `aria-pressed`/checkbox semantics, keyboard
  operable, reusing authored `jds-*` / `ChipToggle` primitives.
- The company-watch disclosure is a proper expandable region (`aria-expanded`), keyboard reachable.
- Error/empty states use `role="alert"` where appropriate (matching existing `jsm-control-error`).
- The attribution label carries accessible link text ("Jobs by Adzuna"); provenance chips have text,
  not color-only, distinction.
- No new color tokens outside `apps/web/src/styles/tokens.css`; serif-heading / mono-eyebrow / sans-body
  system preserved.

### 10.6 Observability

- Broad run records extend the existing counts-only surface: `fetched`, `ingested`, `suppressed`,
  `gateExcluded`, `evaluated`, `evalPending`, plus a coarse status code (`ok` /
  `broad_source_unconfigured` / `auth_failed` / `rate_limited` / `fetch_failed`). **No external text.**
- Module settings show an operator-facing **metadata** indicator: provider `configured` + last broad
  run status code. No key material, no posting content.

---

## 11. Acceptance criteria and real-UAT test plan

### 11.1 Acceptance criteria

> **Fork note.** AC3/AC7 are **Path A (credentialed API)** specific; on the **keyless paths (B′
> freehire.dev / B scrape)** there is no key, so AC3 is trivially satisfied and AC7's "no key
> configured" state does not exist (replace with: broad discovery works out of the box). AC2 asserts a
> provenance chip either way and the "Jobs by Adzuna" label only on Path A. All other criteria are
> path-agnostic.

1. A **fresh user who provides no company URL** completes onboarding with broad discovery on by
   default and, after the first run, sees **real ranked matches** in the feed.
2. Broad results are **clearly distinguished** from company-watch results (provenance chip), and carry
   the source's required attribution — **"Jobs by Adzuna"** on Path A, or a canonical employer link on
   Path B.
3. _(Path A)_ The **provider key never appears** in any frontend response, log line, pg-boss payload,
   export, or AI prompt (verified by inspection + a negative test on run records/responses).
4. Broad results are **never marked stale by absence**; company-watch stale behavior is unchanged.
5. The **outbound query contains only titles + location (+ coarse remote)** — no salary, dealbreakers,
   excluded companies, or employment type (verified by capturing the built request).
6. **Volume caps hold:** ≤50 postings ingested per broad run; AI evaluation stays ≤25/user/local-day;
   retention ceiling respected.
7. **Graceful degradation:** _(Path A)_ with no key configured, onboarding still completes and the UI
   explains broad search turns on once the operator adds a key — **no dead end**. _(Keyless paths B′/B)_
   broad discovery is available with no operator setup; a source-fetch failure degrades to the quiet
   retry state (§8) without blocking onboarding.
8. Existing company-watch onboarding and runs are **unregressed**.
9. Local gate (`pnpm verify:foundation` — lint/format/typecheck/file-size/tests) passes; no file
   exceeds the 1000-line gate; design-system guardrails preserved.

### 11.2 Verification matrix

| #   | Requirement                               | Verification                                                                                                                                                                                | Type                              |
| --- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| AC1 | No-URL onboarding → real matches          | Live dev module, fresh user, fresh assistant session, hitting the **real chosen source** (live freehire.dev on Path B′, real Adzuna dev key on Path A, or the live scrape target on Path B) | **Real e2e (mocks insufficient)** |
| AC2 | Provenance + attribution rendered         | e2e assertion on feed list/detail                                                                                                                                                           | e2e                               |
| AC3 | Secrets never escape                      | Inspect run records/responses/logs/payload builders; negative test                                                                                                                          | Unit + inspection                 |
| AC4 | Broad exempt from stale; boards unchanged | Unit test on `markFreshnessAfterRun` with `absenceImpliesClosure`                                                                                                                           | Unit                              |
| AC5 | Outbound query minimization               | Capture built Adzuna request in a unit test; assert omitted fields                                                                                                                          | Unit                              |
| AC6 | Volume caps                               | Unit test on per-run cap; eval-budget accounting                                                                                                                                            | Unit                              |
| AC7 | Graceful degradation                      | _(Path A)_ e2e with unset key: onboarding completes, notice shown. _(Keyless B′/B)_ e2e with source-fetch failure: quiet retry, onboarding unblocked                                        | e2e                               |
| AC8 | No regression on company watches          | Existing JS-04/05/07 suites green                                                                                                                                                           | Unit/integration                  |
| AC9 | Gate + design guardrails                  | `pnpm verify:foundation`; file-size gate; token check                                                                                                                                       | CI gate                           |

### 11.3 Real-UAT plan (mocks are not sufficient)

Per the module's exit-criteria rule (#999/#1000 e2e-on-real-dev-instance) and the recovery slice's
**early dev HITL gate** mandate, the primary journey is validated on the **built, live dev module**
before human UAT:

1. Stand up the **selected source** against the dev instance: point the provider's base URL at live
   `https://freehire.dev` (or the operator's self-hosted freehire host) — no credential. No mock source
   stands in. (Fallback paths, not built for MVP: _Path A_ would provision a real Adzuna
   `app_id`/`app_key`; _Path B_ would point at a live scrape target.)
2. From **fresh user data** and a **fresh assistant session**, run onboarding end to end: upload a real
   resume, approve the critique and profile, reach the source step, leave broad **on**, add **no**
   company URL, finish.
3. Trigger the broad run (scheduled or run-now) and confirm the feed shows **real opportunities from the
   live source** ranked through the gate + AI evaluation, with provenance (+ attribution on Path A).
4. Exercise save/pass decisions and confirm persistence.
5. Confirm the degradation path (AC7) — _(Path A)_ key unset; _(Path B)_ forced source-fetch failure.
6. Record the evidence artifact (run id, counts, screenshots) as with prior slices.

A recorded-but-**live** response is acceptable only as a supplementary fixture for unit tests; the
acceptance run itself must hit the real source.

---

## 12. Open questions (unresolved product/policy choices)

1. **RESOLVED (2026-07-21): freehire.dev is the MVP broad source.** The product owner selected Path B′
   (`strelov1/freehire`) and waived the feasibility spike. Adzuna (Path A) and structured scrape (Path
   B) remain documented fallbacks, not built. The residual, non-blocking follow-ups are: **(a)
   non-tech coverage** — freehire is tech-focused, so if the audience broadens, revisit Path A as a
   supplement; **(b) self-host vs public** — decide whether the operator runs freehire in-house (fully
   private data path) or the module calls public `freehire.dev` for the MVP (recommendation: public for
   MVP, self-host documented as an option); **(c) wire contract** — the exact `/api/v1/jobs/search`
   query params and per-job JSON field names must be read from the freehire handler code during build
   (implementation detail).
2. **(Fallback, Path A only) Adzuna licensing for self-hosted redistribution.** Not on the MVP path;
   retained only if a future non-tech supplement revives Adzuna. Does a per-instance operator key
   satisfy the "requesting company" framing, or is a negotiated agreement needed? Plus attribution
   placement (Q7).
3. **(Fallback, Path A only) Credential ownership: instance-operator single key vs per-user BYO key.**
   Not on the MVP path (freehire is keyless). Retained for the Adzuna fallback only.
4. **Cross-source duplicate tolerance.** Accept rare duplicates with honest provenance (recommended,
   MVP) vs invest in canonical-URL resolution to converge exact matches. Note Path B already converges
   scrape-vs-scrape via url-path identity (§6.6); the residual is broad-vs-ATS-board only.
5. **Outbound data minimization vs filter fidelity.** Is title+location egress to the source acceptable?
   Should the salary floor be sent for better server-side filtering (recommended: no — keep it local)?
6. **USAJOBS federal supplement.** In or out for v1? Its "no derivative works / registered-company-only"
   clause is a redistribution flag. **Recommendation:** out for v1.
7. **(Path A only) Attribution vs the authored design system.** Where does the required "Jobs by Adzuna"
   label (min ~116×23px, hyperlinked) live without violating the serif/mono/sans system and the
   raw-color-tokens-only guardrail? Does not arise on Path B.
8. **One broad search vs multiple saved searches** per user for v1. **Recommendation:** one.
9. **Country scope for v1.** Default `us` only, or expand geographic reach from the start?
   **Recommendation:** `us` default, others deferred.

---

## Appendix A — Primary sources cited

- freehire.dev (**selected** broad source): `freehire.dev`, `github.com/strelov1/freehire` (MIT;
  keyless public read — `GET /api/v1/jobs/search`, `/api/v1/jobs/:slug`, `/api/v1/companies[/:slug]`,
  `/health`; write endpoints `/view`,`/apply`,`/save`,`/track`,`/me/*` need a key and are unused;
  self-hostable Go service configured via `DATABASE_URL`/`JWT_SECRET`/`SOURCES_FILE`)
- Prior art (approach reference, not a dependency): `github.com/MadsLorentzen/ai-job-search`
- Adzuna: `developer.adzuna.com/overview`, `developer.adzuna.com/docs/search`,
  `developer.adzuna.com/docs/terms_of_service`, `developer.adzuna.com/activedocs`
- USAJOBS: `developer.usajobs.gov/api-reference/get-api-search`,
  `developer.usajobs.gov/general/authentication`
- Greenhouse: `developers.greenhouse.io/job-board.html`
- Lever: `github.com/lever/postings-api`
- The Muse: `themuse.com/developers/api/v2`
- Remotive: `github.com/remotive-com/remote-jobs-api` (→ `remotive.com/api/remote-jobs`)
- Arbeitnow: `arbeitnow.com/api/job-board-api`
- Jooble: `jooble.org/api/about`
- Careerjet: `careerjet.com/partners/api` (→ `search.api.careerjet.net/v4/query`)
- Findwork: `findwork.dev/developers` (authoritative docs login-gated; facts flagged where secondary)
- Indeed (deprecation): `developer.indeed.com/docs/publisher-jobs/job-search`
- LinkedIn (partner-only, not accepting new partnerships):
  `learn.microsoft.com/en-us/linkedin/talent/job-postings/api/overview`

## Appendix B — Code anchors (current state, tip `591a117f`)

- Board adapter contract: `~/Jarv1s/external-modules/job-search/src/adapters/types.ts`
- Fail-closed registry: `~/Jarv1s/external-modules/job-search/src/adapters/registry.ts`
- Greenhouse per-board reader: `~/Jarv1s/external-modules/job-search/src/adapters/greenhouse.ts`
- Safe reader (single fetcher): `~/Jarv1s/external-modules/job-search/src/adapters/fetch-board.ts`
- Monitor run core + sweep: `~/Jarv1s/external-modules/job-search/src/worker/handlers/run.ts`
- Identity / sourceKey: `~/Jarv1s/external-modules/job-search/src/domain/keys.ts`
- Opportunity upsert/identity: `~/Jarv1s/external-modules/job-search/src/domain/opportunities.ts`
- Deterministic gate: `~/Jarv1s/external-modules/job-search/src/domain/gate.ts`
- Monitor config repo: `~/Jarv1s/external-modules/job-search/src/domain/monitors.ts`
- Onboarding flow engine: `~/Jarv1s/external-modules/job-search/src/worker/handlers/flow.ts`
- Onboarding source control: `~/Jarv1s/external-modules/job-search/src/web/screens/onboarding/controls.tsx`
- Manifest: `~/Jarv1s/external-modules/job-search/jarvis.module.json`
  </content>
  </invoke>
