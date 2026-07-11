# Personalized news sources and topics — design spec

**Date:** 2026-07-11  
**Status:** Approved through `/brief` and `/grill-me` on 2026-07-11  
**Depends on:** News V1 (#897, shipped by PR #898)  
**Follow-up:** Credentialed publisher sources (#950)

## Problem

News V1 is limited to a curated source catalog and eight canonical topics. That is a useful
default, but it cannot become a strong personal reading desk: users cannot follow publications
outside the catalog or describe narrower interests such as mechanical watches, AI development, or
consumer 3D printing.

The News module should compile a current, finite reading list from each user's preferred sources
and topics without circumventing publisher controls, inventing stories, or turning Jarv1s into an
article archive.

## Outcomes

- Users can manage preferred sources, excluded publishers, and freeform topics in Settings →
  Modules → News and through confirmed Jarv1s chat actions.
- Today and News use the same personalized compilation and update after preference changes or when
  the last compilation becomes stale.
- Preferred publishers receive a ranking boost, but are not included merely to satisfy a quota.
- Topic discovery may introduce other publishers, except domains the user explicitly excluded.
- The configured LLM validates sources/topics and selects and ranks real candidates. It never
  writes headlines, summaries, or stories.
- Public-page scraping remains shallow and compliant: article metadata only, no paywall,
  authentication, CAPTCHA, or browser circumvention.

## Non-goals

- "More like this" / "less like this" article feedback; specify separately.
- Publisher-specific credentials, authenticated feeds, or publisher API keys; tracked by #950.
- Full article-body retrieval, republishing, generated summaries, translation, bookmarks,
  read-state, history, or a news archive.
- Headless-browser or JavaScript-rendered scraping, CAPTCHA handling, paywall bypassing, or access
  control circumvention.
- Manual source/topic weights, semantic event clustering, infinite scroll, or a general-purpose
  recommendation engine.
- A universal legal or moderation policy. Jarv1s applies deterministic access controls and the
  active provider's policy decision, but does not claim to adjudicate every publisher's terms.

## User model

### Source states

A publisher domain has one effective state per user:

- **Preferred:** Jarv1s actively retrieves its recent headlines and boosts qualifying stories.
- **Neutral:** the publisher may appear through topic discovery.
- **Excluded:** the canonical domain and its subdomains never appear in News or Today.

Exclusion is domain-based. A separately published or syndicated copy on another publisher's domain
may still appear; ownership and syndication inference are out of scope.

News V1 semantics remain intact:

- Turning an enabled curated source off excludes it everywhere.
- A non-default curated source the user never enabled is neutral.
- Deleting a custom preferred source returns its domain to neutral; it does not create an
  exclusion.
- Excluding a source is a separate Settings/chat action.

Limits per user:

- 10 custom preferred sources
- 10 freeform topics
- 100 excluded domains

### Topics

Canonical V1 topics remain as quick broad choices backed by known publisher feeds. A freeform topic
adds:

- a required short display label, such as `Watches`; and
- optional natural-language guidance, such as `Mechanical watches and watchmaking; exclude
smartwatches`.

Sources and topics are independent. Preferred sources contribute recent qualifying headlines
regardless of topic. Freeform topics discover relevant stories across the public web, including
neutral publishers. Excluded publishers remain a hard filter.

Topics and sources may use any language supported by the configured LLM and web-search provider.
Publisher headlines remain in their original language; this feature does not translate them.

## Prerequisites and availability

Custom-source and freeform-topic creation require an active provider/model supporting Jarv1s's
structured `json` capability. The provider is selected through the normal capability router; News
must not name or hardcode a provider or model.

Publication-name resolution and web-wide topic discovery additionally require the existing
instance web-search service. Direct homepage/feed URLs can be validated without web search.

When a prerequisite is missing:

- Curated News V1, canonical topics, curated-source toggles, and exclusions continue working.
- Custom-source and freeform-topic creation controls remain visible but disabled with a direct
  setup link and explanation.
- Chat explains the missing prerequisite and does not create an unvalidated pending preference.
- Jarv1s never asks an LLM to invent current URLs or stories from model memory.

## Source addition and editing

Settings and chat call the same News-owned preview and commit APIs.

Accepted input:

- publication name;
- publication homepage URL;
- direct RSS/Atom URL; or
- an individual article URL, which resolves to its canonical publisher rather than becoming a
  recurring article-page source.

Resolution order:

1. Parse a supplied URL or use configured web search to resolve a publication name.
2. Resolve and validate the canonical HTTPS publisher domain through the existing safe dynamic URL
   checks.
3. Prefer a declared RSS/Atom feed or official public feed endpoint.
4. Fall back to shallow public listing-page scraping.
5. Collect the publication description and a bounded sample of recent headlines.
6. Ask the configured LLM for a structured, affirmative provider-policy decision.
7. Return a preview: publication label, canonical domain, retrieval method, and sample result
   count.
8. Commit only after explicit confirmation.

If multiple publishers plausibly match a name, return up to three verified candidates and require a
choice. Never let the LLM silently choose.

There is one custom preferred source per canonical publisher domain. Adding another URL for the
same domain offers to replace the existing source. Edit runs the full add-and-verify flow, then
atomically replaces the old configuration only after confirmation. Failure or cancellation leaves
the old source unchanged.

Provider refusal, uncertainty, or failure is default-deny. There is no user override in this
version. Freeform topic instructions use the same validation rule.

## Retrieval boundaries

Public retrieval must reuse the safe dynamic web-reading path rather than weakening the dataset
manifest's static host allowlist.

Required controls:

- HTTPS only, with DNS/private-address validation before every request and redirect hop.
- A normal identifying Jarv1s user agent, bounded timeouts, response-size caps, redirect caps, and
  per-domain rate limiting.
- Honor `robots.txt`; stop on disallow, login, paywall, CAPTCHA, access challenge, or other explicit
  denial.
- No browser automation, JavaScript execution, session-cookie replay, credential use, or proxy
  evasion.
- Treat all fetched text as untrusted data. It cannot add instructions, invoke tools, or alter the
  ranking schema.

Scraping extracts only what article cards need:

- publisher and canonical domain;
- headline and canonical article URL;
- publication time when available;
- source-provided excerpt when available; and
- metadata-declared image URL when available.

Jarv1s does not retrieve or store article bodies. Article-page reads, when needed, are limited to
metadata such as canonical URL, publication time, and Open Graph image. If metadata access is
blocked, use available search/feed metadata or omit the field.

## Discovery, policy, and compilation

### Candidate collection

On a refresh, News collects bounded candidates from:

- the existing curated source/topic feeds;
- each custom preferred source's verified feed or listing page; and
- configured web search for each freeform topic.

Only stories from the previous 48 hours are preferred. A sparse source/topic may expand to seven
days, but every card shows its actual publication time and nothing older than seven days survives.

Every newly encountered topic-discovery publisher passes the same provider-policy validation before
its first story appears. Cache the verdict by canonical domain and provider/model identity for a
bounded period; invalidate it on provider change or material source change.

### Deterministic filters

Apply these before the LLM:

1. validated retrieval and publisher-policy status;
2. excluded-domain filter;
3. safe canonical URL and metadata validation;
4. seven-day hard age limit;
5. exact/canonical URL deduplication; and
6. near-identical normalized-headline deduplication, keeping the preferred or original publisher.

Do not perform semantic event clustering. Distinct reporting or analysis of the same event may
remain.

### LLM contract

The LLM receives bounded public candidate metadata, topic guidance, opaque candidate IDs, and a
strict structured-output schema. It returns only eligible IDs with ranking/relevance fields. The
server rejects unknown IDs and invalid output.

Ranking order:

1. deterministic eligibility filters;
2. LLM relevance and newsworthiness;
3. preferred-source boost;
4. recency; and
5. deterministic stable tie-breaker.

Image availability affects layout, not editorial ranking. When AI compilation fails, keep the last
successful snapshot; do not silently publish unranked new candidates or clear the feed.

## Feed size and presentation

- Today shows the top 4 stories.
- News keeps at most 40 distinct current stories across its hero, ranked sections, and source
  groups.
- News shows a source group for every preferred publisher that produced qualifying recent items.
  Preferred sources receive no top-story quota.
- Story cards show small publisher and matched-topic labels. A card may show at most a small number
  of topic labels; it does not receive generated "why this appeared" prose.
- Empty sources/topics do not create filler stories. Settings may show `No recent stories found`
  after a completed refresh.

The personalized results extend the existing News overview shape and query key. Today and News must
not maintain independent compilations.

## Images

Arbitrary publisher image hosts must not be added to the browser CSP. Add a News-owned same-origin
image route backed by the stored compilation:

- The authenticated request identifies an article in the requesting owner's current snapshot.
- The server reads the original metadata image URL from that snapshot and fetches it through the
  safe dynamic URL path.
- Accept bounded JPEG, PNG, WebP, or GIF responses only; reject SVG, HTML, invalid content types,
  oversized payloads, private-host redirects, and access challenges.
- Return `nosniff` and private browser-cache headers. A small bounded in-memory cache may avoid
  repeated upstream fetches; persistent image binaries are unnecessary.
- Hero and feature cards use available images first. Other cards load images lazily where the
  existing layout supports them.

Cached image bytes are transient and are not user data, export content, or an archive.

## Refresh and persistence

Persist only each user's latest successful compiled snapshot in owner-only storage. It contains
public card metadata and ranking results, never article bodies, prompts, credentials, or provider
secrets.

Refresh rules:

- Saving source/topic changes queues a refresh.
- Opening Today or News with a snapshot older than 30 minutes serves the snapshot immediately and
  queues one refresh.
- Opening either surface within 30 minutes performs no search, scrape, or LLM call.
- No fixed background schedule and no always-visible force-refresh control in this version.
- A Retry action appears after failure.
- Only one refresh may run per user at a time; duplicate triggers coalesce.
- Replace the prior snapshot atomically after a fully successful compilation.

Deleting or excluding a source removes its stories from the visible snapshot immediately, before
the replacement compilation finishes. Other additions and edits keep the last-good snapshot until
replacement results arrive.

Keep no snapshot history. Superseded snapshots are deleted, and no story older than seven days is
retained.

## Provider changes and source health

Changing the active provider/model queues background revalidation of every custom source and
freeform topic. Jobs carry metadata only: actor/resource IDs, job kind, and idempotency key. Workers
re-enter `DataContext` before reading owner data; source URLs, topic text, headlines, prompts, and
credentials never enter pg-boss payloads.

Previously valid sources that break or fail revalidation remain in Settings with an actionable
status such as `Unavailable` or `No longer approved`. Jarv1s stops fetching them and offers
Retry/Edit/Delete; it never silently deletes them or serves them beyond normal snapshot expiry.

After a provider-change revalidation batch, emit at most one summary notification when user action
is required, for example `2 news sources need attention`, linked to News settings. Do not notify per
source or for transient refresh failures.

News must use the Notifications module's declared public API/event; it must not import notification
internals or query notification tables.

## Storage and RLS

Add new migrations under `packages/news/sql/`; never edit the applied News V1 migration. The exact
schema may follow repository conventions at build time, but it must represent these explicit
resources without a heterogeneous catch-all JSON preference table:

- custom preferred sources and validation/health status;
- freeform topics and validation status;
- excluded canonical domains; and
- one latest compilation snapshot per owner.

All resources are owner-only. Apply ENABLE + FORCE RLS and standard owner policies; repositories
accept `DataContextDb` only. Include preferences in account export and cascade deletion. Omit derived
snapshots and image caches from export, while deleting them with the account.

## Public boundaries

News owns its preferences, validation, source resolution, compilation, snapshot, and image routes.
Other modules interact only through declared public APIs/events.

Required integrations:

- AI capability router: structured `json` selection and provider identity/version for
  revalidation.
- Web Research: configured web search plus safe dynamic URL reads, injected through a narrow public
  dependency at the composition root.
- Workers: refresh and revalidation jobs with metadata-only payloads.
- Notifications: one actionable revalidation summary.
- Chat: News-declared assistant tools/actions using the existing preview and confirmation system.

Chat write actions require confirmation and cover add/edit/delete preferred source, exclude/unexclude
publisher, and add/edit/delete freeform topic. Chat does not own or duplicate News preference state.

## API shape

Use browser-safe shared contracts and real Fastify response schemas. Exact route names may align
with the shipped News API during implementation, but the surface needs these operations:

- Read personalization availability and prerequisite status.
- List custom preferred sources, freeform topics, exclusions, and source health.
- Preview source add/edit resolution without mutation.
- Confirm source add/edit after preview.
- Delete a custom preferred source.
- Add/remove an excluded canonical domain.
- Create/edit/delete a freeform topic.
- Read compilation status and the current overview.
- Serve an authenticated same-origin article image.

Preview responses must use short-lived opaque confirmation IDs or validated server-side state; do
not trust a client to resubmit an LLM-invented resolved URL as authoritative.

## Implementation slices

Each slice should be independently reviewable and keep module ownership intact. Do not split a
security boundary across PRs in a way that temporarily exposes an unsafe route.

### Slice 1 — Preference and domain model

- Add owner-only custom-source, freeform-topic, exclusion, and latest-snapshot persistence.
- Add shared contracts, repository methods, limits, Settings management UI, and data lifecycle.
- Preserve curated V1 behavior and expose prerequisite/health states.
- No dynamic fetch or chat actions yet; source preview may remain unavailable until Slice 2.

### Slice 2 — Safe discovery and compilation

- Reuse/extend Web Research's safe dynamic reader with robots, rate, redirect, timeout, and size
  enforcement.
- Add publication-name/URL resolution, feed discovery, shallow listing metadata extraction, and
  provider-policy validation.
- Add topic web discovery, deterministic filters, structured LLM ranking, 30-minute freshness, and
  atomic last-good snapshots.
- Wire refresh-on-change/open with single-flight/coalescing and metadata-only jobs.

### Slice 3 — Same-origin imagery and page integration

- Add the authenticated safe image route and bounded cache.
- Integrate personalized stories into the existing `/news` broadsheet and Today widget.
- Preserve CSP, curated image behavior, source/topic labels, loading, degraded, and empty states.
- Verify immediate removal for deleted/excluded sources.

### Slice 4 — Chat actions, revalidation, and notifications

- Declare News assistant tools/actions and reuse the existing preview/confirmation cards.
- Add provider-change background revalidation and actionable source statuses.
- Emit one notification summary through the Notifications public boundary.
- Complete user-facing error states and end-to-end flows across Settings, chat, Today, and News.

## Verification

### Automated

- Repository/RLS integration tests prove owner isolation for every new table and snapshot.
- Route tests use `app.inject` so response-schema stripping is exercised.
- Safe-fetch tests cover private IPs, DNS rebinding/redirect hops, robots disallow, oversized
  responses, timeouts, access challenges, non-HTTPS URLs, and rate limits.
- Source-resolution tests cover names, homepages, feeds, article URLs, ambiguous candidates,
  duplicates, atomic edits, and provider default-deny.
- Compilation tests cover domain exclusion, 48-hour preference/seven-day maximum, deterministic
  dedupe, structured-ID validation, preferred-source boost without quotas, and last-good fallback.
- Refresh tests prove 30-minute caching, single-flight/coalescing, immediate exclusion removal, and
  no fixed schedule.
- Image tests cover owner authorization, same-origin URLs, content-type/size enforcement, private
  redirects, SVG/HTML rejection, and cache headers.
- Provider-change tests prove metadata-only job payloads, revalidation statuses, and one summary
  notification.
- Browser tests cover disabled prerequisites, Settings preview/confirmation, chat confirmation,
  source/topic labels, images, Today's top 4, and News's 40-story cap.
- Full `pnpm verify:foundation` and full integration suite pass.

### Manual acceptance

1. Configure AI and web search; add a publication by name in News settings, choose from ambiguous
   candidates if needed, inspect the verified preview, and confirm it.
2. Add a homepage/feed URL and an article URL; confirm the article URL resolves to its publisher.
3. Add `Watches` with optional guidance and retain at least one canonical topic.
4. Confirm News and Today initially show the last-good snapshot, then update with real ranked
   stories, publisher/topic labels, and safe images.
5. Confirm a neutral publisher may appear through the topic, then exclude its domain and verify its
   stories disappear immediately from both surfaces.
6. Delete a custom preferred source and verify it becomes neutral rather than excluded.
7. Change AI provider/model and verify background revalidation produces at most one actionable
   notification and rejected sources stop contributing.
8. Disable AI or web search and verify curated V1 remains usable while unsupported personalization
   controls explain the missing prerequisite.
9. Try a private URL, robots-disallowed site, access challenge, provider-rejected source, and
   unsupported image; verify each fails closed without clearing the last-good feed.

## Operational observability

Measure refresh duration, cache hit/miss, candidate/result counts, per-stage fetch/search/LLM
timing, image proxy outcomes, and categorized failures. Never log source URLs, topic text,
headlines, excerpts, credentials, prompts, or private user content.

Use these measurements to revisit the 10-source/10-topic limits, 30-minute freshness, and 40-story
cap. Do not add schedules, weights, pagination, or more infrastructure without evidence that the
initial limits fail.
