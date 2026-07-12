# Personalized News — Slice 3 Implementation Plan

> **For the coordinated build agent:** REQUIRED SUB-SKILLS: use `coordinated-build` and
> test-driven development. Execute tasks in order, stage only explicit files, and stop for the
> Coordinator at every approval/QA/merge gate.

**Goal:** Serve the latest owner-private personalized compilation through the existing News and
Today surfaces, proxy snapshot images through one authenticated same-origin route, and preserve the
shipped broadsheet states without widening CSP or creating a second retrieval boundary.

**Architecture:** Keep `app.news_compilation_snapshots` as the single feed shared by News, Today,
and briefing reads. Adapt its validated module-private article payload into the existing
`NewsOverviewResponse`; use the curated V1 composer only when no usable personalized snapshot
exists. Add one `rankedStories` response field so neutral topic-discovery stories beyond the hero
remain visible without pretending they are preferred-source groups. Original publisher image URLs
remain server-only. The browser receives `/api/news/images/:articleId`; that authenticated route
finds the article only in the active actor's unexpired snapshot, then uses a byte-returning variant
of Web Research's existing resolve-and-pin safe fetch path. A tiny in-process LRU stores only
validated public image bytes.

**Grounded on:** `origin/main@c23a93b8890a` (2026-07-11), including merged Slice 2
`aa7216a67562` (PR #967). Re-ground on merged `origin/main` immediately before implementation.

**Governing spec:**
`docs/superpowers/specs/2026-07-11-personalized-news-sources-topics.md` (Implementation slices →
Slice 3).

**Tracking:** Part of epic #954. The Coordinator creates/assigns the Slice 3 task issue before the
build branch opens; the build agent does not move the board, close issues, or merge.

**Risk tier:** `security` — authenticated binary proxy, dynamic publisher hosts, SSRF/redirect
handling, and owner-private snapshot authorization. Fable 5 performs the adversarial **plan**
review. Merge still requires durable, unanimous GREEN from the named Opus + independent Codex +
Gemini council and green CI; Gemini-family CLI calls use `agy`, never legacy `gemini`. Any dissent
or unavailable named provider holds this News merge for Ben while unrelated fleet work continues.

## Locked scope

Slice 3 includes:

- an authenticated same-origin image route authorized solely by the actor's current, unexpired
  snapshot;
- bounded binary retrieval through the same Web Research URL validation, DNS pinning, redirect,
  robots, rate, timeout, and size controls used by Slice 2;
- strict JPEG/PNG/WebP/GIF header plus magic-byte validation, private cache headers, `nosniff`, and
  a bounded in-memory LRU;
- personalized snapshot composition into `/api/news/overview`, including all ranked stories,
  preferred-source groups, matched-topic labels, and stale-on-open refresh triggering;
- the same overview/query key for `/news` and Today, with Today capped at the specified top four;
- immediate visible removal already performed by Slice 2's atomic snapshot pruning, proven through
  the actual overview and image routes;
- best-effort metadata-only topic-result enrichment through the existing safe fetch port so an
  available Open Graph image can reach a large story; and
- the Slice 2 QA carry-forward: validate all 1,000 accepted topic-guidance characters instead of
  only the first 300.

Slice 3 deliberately excludes:

- Settings add/edit forms, chat tools/actions, provider-change revalidation, notifications, and
  final Retry/actionable-status copy (Slice 4);
- publisher credentials, authenticated feeds, browser automation, JavaScript execution, body
  retrieval/storage, generated summaries, image persistence, or CSP host additions;
- a new table, migration, queue, schedule, cache service, CDN, image-transform library, or image
  resizing; and
- editorial re-ranking by image availability. Images affect layout only.

## Global constraints

- **No migration.** Slice 3 uses the Slice 1/2 tables unchanged. Do not edit 0151, 0159, or 0160.
- **One safe-fetch implementation.** Refactor `fetchWebResource` internally so text and byte
  readers share the exact request/redirect/robots/rate/resolve-and-pin loop. Never copy that loop
  into News and never call raw `fetch` from News.
- News imports no Web Research internals. A narrow `NewsImageFetchPort` is injected at the
  module-registry composition root; only public types/bytes cross the seam.
- Image authorization happens before every cache lookup. A warm cache must never turn an article
  ID into a cross-owner oracle.
- The route accepts only an opaque article ID. It never accepts a client-supplied upstream URL.
- Reject missing/expired snapshots, missing articles/images, truncated responses, unsupported or
  mismatched media types, SVG/HTML, upstream failures, and private/redirect-denied URLs. Never
  return upstream bodies in errors.
- Allowed media: `image/jpeg`, `image/png`, `image/webp`, `image/gif`; max image 2 MiB; cache max 32
  entries and 16 MiB total. Use native `Uint8Array`/`Buffer`/`Map`; add no dependency.
- Return `Cache-Control: private, max-age=300` and `X-Content-Type-Options: nosniff`. Do not add
  arbitrary publisher domains to `MODULE_IMAGE_CSP_HOSTS`, nginx CSP, or the News manifest's
  curated `imageHosts`.
- Snapshot article ranking remains authoritative. No image-first sorting, quota, filler, generated
  title, generated summary, or unranked fallback.
- `NewsOverviewResponse` remains browser-safe. It may expose same-origin image paths and public card
  metadata only; original personalized image URLs and snapshot payloads remain server-only.
- News/Today share `newsQueryKeys.overview`; no second client query, compilation, or cache.
- Opening News or Today with no snapshot or one older than 30 minutes serves the last good usable
  result immediately and requests the existing coalesced refresh. A snapshot past `expiresAt` is
  not served and its image route is closed.
- External text is untrusted and capped. Topic article reads extract metadata only; no article body
  enters snapshots, prompts, logs, jobs, responses, or account export.
- Never log URLs, article IDs, topics, headlines, excerpts, image bytes, content bodies, prompts,
  or actor-private values. Observability stays counts/timing/categories only.
- Response schemas use `additionalProperties:false`; declare every emitted field. Keep files under
  1,000 lines, use authored `nw-*`/`jds-*` patterns and design tokens, and add no raw CSS color.
- Release notes say personalized compilations and safe images now appear in News/Today. Do not claim
  chat/revalidation/notification or credentialed-source support.

## Exact contract changes

Extend `NewsHeadline` with optional `topicLabels?: readonly string[]` so existing V1 fixtures remain
source-compatible while personalized cards can render up to three matched labels. Update its image
comment to allow either a curated allow-listed HTTPS URL or an authenticated same-origin path.

Extend `NewsOverviewResponse` with optional `rankedStories?: readonly NewsHeadline[]` and declare
both optional fields in Fastify schemas. Personalized responses always emit `rankedStories` with at
most 40 unique snapshot articles in stored rank order; V1 fallback may omit it. `topStories` remains
the leading six for the existing hero layout. `/news` uses `rankedStories` for its ranked body and
falls back to interleaved V1 source groups when absent. `sourceGroups` contains only preferred
publishers that produced qualifying stories. Today reads the same `topStories` and renders four.

Add this injected port:

```ts
export type NewsImageFetchPort = (
  url: string,
  maxBytes: number
) => Promise<
  | {
      readonly ok: true;
      readonly contentType: string | null;
      readonly body: Uint8Array;
      readonly truncated: boolean;
    }
  | {
      readonly ok: false;
      readonly reason:
        | "blocked"
        | "robots"
        | "rate_limited"
        | "http_error"
        | "timeout"
        | "network"
        | "not_https";
    }
>;
```

The composition root implements it with public `fetchWebResourceBytes(url, { requireHttps: true,
robots, rateLimiter, maxBytes })`; News never sees DNS addresses, resolver internals, or upstream
URLs beyond the snapshot-owned input.

## File structure

```text
packages/web-research/src/reader.ts            MOD shared text/byte capped reader
packages/news/src/discovery/ports.ts            MOD image-fetch port
packages/news/src/discovery/policy-validation.ts MOD full guidance validation
packages/news/src/compilation/candidates.ts     MOD topic metadata image enrichment
packages/news/src/image-route.ts                NEW auth, validation, cache, response
packages/news/src/news-service.ts               MOD snapshot → overview composition
packages/news/src/routes.ts                     MOD overview refresh + image registration
packages/news/src/manifest.ts                   MOD image route declaration
packages/news/src/web/news-page.tsx             MOD ranked personalized pool/topic filters
packages/news/src/web/news-mosaic.tsx           MOD bounded matched-topic label presentation
packages/news/src/web/today-widget.tsx          MOD top-four shared overview
packages/shared/src/news-api.ts                 MOD optional overview fields/schemas
packages/module-registry/src/index.ts           MOD byte-port wiring only
tests/unit/web-research.test.ts                  MOD byte-path security regression
tests/unit/news-policy-validation.test.ts       MOD 1,000-char policy proof
tests/unit/news-candidates.test.ts               MOD safe metadata image enrichment
tests/unit/news-image-route.test.ts              NEW media/cache/auth behavior
tests/unit/news-service.test.ts                  MOD snapshot composition/fallback
tests/unit/news-routes.test.ts                   MOD stale-open refresh/schema behavior
tests/unit/news-page.test.tsx                    NEW personalized ranked-page render
tests/unit/news-today-widget.test.tsx            NEW shared-query top-four render
tests/integration/news-image-route.test.ts       NEW owner/RLS route proof
```

---

### Task 1: Close the topic-policy gap and enrich topic imagery

**Files:**

- Modify: `packages/news/src/discovery/policy-validation.ts`
- Modify: `packages/news/src/compilation/candidates.ts`
- Modify: `tests/unit/news-policy-validation.test.ts`
- Modify: `tests/unit/news-candidates.test.ts`

- [ ] Add a failing policy test with distinct sentinel text after character 300 and before 1,000;
      assert the full accepted guidance reaches the labeled `UNTRUSTED DATA` block. Assert text
      beyond 1,000 remains capped.
- [ ] Change only the topic guidance sanitation cap from 300 to the API/storage cap of 1,000. Keep
      the provider decision default-deny and schema unchanged.
- [ ] Add failing candidate tests for a topic-search result whose safe article metadata contains
      `article:published_time`, `og:description`, and `og:image`: one safe metadata read enriches
      the candidate; the body itself is absent from the returned candidate. Prove excluded domains
      make zero article fetches, cross-publisher redirects are dropped, and a failed/disallowed
      metadata read keeps otherwise trustworthy search metadata with `imageUrl:null`.
- [ ] Reuse the existing `articleMetadata` parser. For each already-bounded, policy-approved topic
      result, perform at most one safe article metadata read; accept it only when the final domain
      is the same canonical publisher (including its subdomains), not excluded, and HTTPS. Use
      metadata publication time only as a fallback, excerpt only when search has none, and image
      only when HTTPS. Do not store/read body text beyond this parse.
- [ ] Run the two focused Vitest files (`news-policy-validation.test.ts` and
      `news-candidates.test.ts`) plus `pnpm --filter @jarv1s/news typecheck`.
- [ ] Commit only Task 1 files: `fix(news): validate full topic guidance and retain safe story art`

### Task 2: Add a byte mode to the canonical safe reader

**Files:**

- Modify: `packages/web-research/src/reader.ts`
- Modify: `tests/unit/web-research.test.ts`

- [ ] Add failing tests for `fetchWebResourceBytes`: exact binary bytes survive, maxBytes sets
      `truncated:true`, HTTPS-only/robots/rate-limit/timeout errors match the text API, and a
      redirect hop resolving private is blocked before the transport sees it.
- [ ] Refactor only the capped response-reader/result construction. Keep one URL parse,
      resolve-and-pin, redirect, robots, rate, timeout, and transport loop shared by text and byte
      exports. Existing `fetchWebResource` behavior and return type must remain unchanged.
- [ ] Export `fetchWebResourceBytes` from the existing public package barrel via `reader.ts`; return
      a `Uint8Array`, never a base64/string conversion.
- [ ] Re-run the entire existing `tests/unit/web-research.test.ts` file and Web Research typecheck.
- [ ] Commit only Task 2 files: `feat(web-research): expose bounded bytes through safe fetch`

### Task 3: Add the owner-authorized same-origin image route

**Files:**

- Create: `packages/news/src/image-route.ts`
- Modify: `packages/news/src/discovery/ports.ts`
- Modify: `packages/news/src/routes.ts`
- Modify: `packages/news/src/manifest.ts`
- Modify: `packages/module-registry/src/index.ts`
- Create: `tests/unit/news-image-route.test.ts`
- Create: `tests/integration/news-image-route.test.ts`

Route: `GET /api/news/images/:articleId`, permission `news.view`. The route has no JSON response
schema; its params schema accepts a non-empty bounded opaque ID only.

- [ ] Unit-test unauthenticated 401; no snapshot/expired snapshot/unknown ID/null image 404; and
      upstream failure/truncation/unsupported media 502 without upstream body or URL disclosure.
- [ ] Unit-test matching JPEG/PNG/WebP/GIF MIME + magic bytes succeed; SVG, HTML, MIME-signature
      mismatch, and a response over 2 MiB fail closed. Assert exact `content-type`,
      `cache-control: private, max-age=300`, and `x-content-type-options: nosniff`.
- [ ] Unit-test cache behavior: repeat authorized request fetches upstream once; 33rd entry evicts
      the oldest; total cached bytes never exceed 16 MiB. Authorization/read-current-snapshot runs
      before lookup on every request.
- [ ] Integration-test with real owner-only snapshot rows: owner A can load A's current article;
      owner B gets 404 for A's ID even after A warmed the cache; an admin actor gets no bypass;
      replacing/pruning A's snapshot immediately closes the old ID. Keep the fake byte port local
      so the test performs no network request.
- [ ] Implement native magic-byte detection and a route-local bounded `Map` LRU. Cache only after
      authorization, safe fetch success, non-truncation, allowed normalized MIME, and signature
      match. Re-authorize on every hit. Do not cache failures.
- [ ] Wire `NewsImageFetchPort` at the composition root using the same module-wide News robots gate
      and host rate limiter as Slice 2. Add no News dependency on Web Research and no CSP/image-host
      manifest expansion.
- [ ] Run both focused route tests, module-registry tests, package dependency check, and relevant
      typechecks.
- [ ] Commit only Task 3 files: `feat(news): proxy snapshot images through an owner-safe route`

### Task 4: Make the personalized snapshot the shared overview

**Files:**

- Modify: `packages/shared/src/news-api.ts`
- Modify: `packages/news/src/news-service.ts`
- Modify: `packages/news/src/routes.ts`
- Modify: `packages/news/src/personalization-routes.ts` only to share the existing 30-minute
  freshness constant/helper instead of duplicating it
- Modify: `tests/unit/news-service.test.ts`
- Modify: `tests/unit/news-routes.test.ts`

- [ ] Add failing pure/service tests for a validated snapshot: stored rank order survives;
      `rankedStories` contains all ≤40 distinct articles; top six are `topStories`; article image
      URLs become same-origin paths; original image URLs never appear in the response; matched
      topics are capped at three; preferred articles group by canonical publisher; neutral topic
      publishers remain in `rankedStories` but not `sourceGroups`; and image presence never changes
      order.
- [ ] Prove an empty successful snapshot remains an empty personalized result (no filler/V1
      substitution), a stale-but-unexpired snapshot is served, an expired or structurally invalid
      snapshot is not served, and no snapshot uses the unchanged curated V1 composer.
- [ ] Build `enabledSources` from effective curated prefs plus approved/available custom preferred
      sources after domain exclusions, so a valid empty snapshot says “Nothing on the wire,” not
      “Choose your sources.”
- [ ] Read snapshot, custom sources, exclusions, prefs, and refresh state under the same
      `DataContextDb`. Call `assertSnapshotPayload` before adapting. A corrupt payload fails closed
      to V1 and requests replacement without logging payload content.
- [ ] Add route tests proving `/api/news/overview` with a 31-minute-old or absent snapshot bumps the
      persisted generation and calls the existing coalesced enqueue path, while a 5-minute snapshot
      does neither. Response returns immediately from stale last-good data. Keep
      `/api/news/personalization` on the same shared freshness helper.
- [ ] Prove exclusion/source deletion pruning is visible through the next overview response and
      cannot be resurrected by an older in-flight generation (retain Slice 2 CAS tests; add only the
      route-facing assertion missing today).
- [ ] Make `getTopHeadlinesForToday(scopedDb)` consume the same snapshot-aware composition, with V1
      fallback only when no usable snapshot exists.
- [ ] Run focused service/routes/refresh tests and shared/news typechecks.
- [ ] Commit only Task 4 files: `feat(news): serve one personalized overview across surfaces`

### Task 5: Integrate the ranked feed into News and Today

**Files:**

- Modify: `packages/news/src/web/news-page.tsx`
- Modify: `packages/news/src/web/news-mosaic.tsx`
- Modify: `packages/news/src/web/today-widget.tsx`
- Modify: `packages/news/src/web/styles/news-1.css` or `news-2.css` only if existing small-label
  styles cannot carry multiple labels
- Create: `tests/unit/news-page.test.tsx`
- Create: `tests/unit/news-today-widget.test.tsx`
- Modify: `tests/unit/news-mosaic.test.ts`

- [ ] Preload `newsQueryKeys.overview` in the existing React Query server-render test pattern.
      Prove `/news` renders neutral ranked stories beyond the hero, preferred source groups in the
      rail, same-origin image paths, publisher plus up to three matched-topic labels, and no raw
      original image host.
- [ ] Generalize the local topic filter to `string | null` (`null` = All) so custom labels and a
      user topic literally named `All` cannot collide with a sentinel. Match against
      `topicLabels`, with the old `topicKey/topicLabel` fallback for V1. Display canonical labels
      from the known map and custom labels verbatim.
- [ ] Use `data.rankedStories` as the personalized mosaic pool and the existing interleaved groups
      only as V1 fallback. Exclude hero IDs once; do not re-rank or prefer images in React.
- [ ] Render matched labels in the existing small kicker/tag voice; add CSS only if necessary.
      Preserve loading skeleton, authored empty state, degraded status, keyboard focus, reduced
      motion, lazy image loading, and external-link `rel` behavior.
- [ ] Change Today's story cap from five to four and test exactly one lead plus three briefs. Prove
      News and Today both use `newsQueryKeys.overview` and no new query key/client endpoint exists.
- [ ] Run focused render/planner tests, `pnpm check:design-tokens`, web/news typechecks, and file
      size check.
- [ ] Commit only Task 5 files: `feat(news): show personalized stories and safe art in News and Today`

### Task 6: Full verification and security handoff

- [ ] Rebase the implementation branch on fresh `origin/main`; confirm no migration was added or
      modified and no other open migration-bearing PR collision was introduced.
- [ ] Run `pnpm format:check && pnpm lint && pnpm typecheck` before push.
- [ ] Run `pnpm verify:foundation` and `pnpm audit:release-hardening`; record exact exit codes and
      test counts in the PR.
- [ ] Security sweep: no raw `fetch(` in News; no News import of AI/Web Research internals; no
      `BYPASSRLS`; no arbitrary CSP/image-host additions; no original personalized image URL in API
      DTOs; no source URLs/topics/headlines/bytes in logs/jobs; no binary persistence; all route
      cache hits re-authorize current snapshot ownership.
- [ ] Requirement map every Slice 3 spec bullet and automated verification row to a focused test.
      Mark only Slice 4 chat/revalidation/notifications/final error flows deferred.
- [ ] Push/open the PR through `coordinated-wrap-up`, then stop. Coordinator owns independent QA,
      named-provider verdicts, CI, merge, issue/epic bookkeeping, and worktree cleanup.

## Exit criteria

- A personalized snapshot is the single ranked feed used by `/news`, Today, and briefing reads;
  curated V1 remains usable when no personalized snapshot can be served.
- `/news` can display all ≤40 ranked stories, including neutral topic-discovery publishers, while
  preferred publisher groups remain truthful.
- Today renders the same feed's top four, not an independent compilation or query.
- Personalized image URLs never reach the browser. Authorized same-origin image requests are
  owner-scoped to an unexpired current snapshot and fail closed on every unsupported/upstream case.
- Dynamic image retrieval reuses Web Research's resolve-and-pin safe path per redirect with HTTPS,
  robots, rate, timeout, and size controls; no CSP host expansion exists.
- Only JPEG/PNG/WebP/GIF with matching signatures are served, with `nosniff` and private cache
  headers; cache bytes are bounded, transient, and re-authorized on every hit.
- Deleted/excluded source stories and images disappear immediately from both surfaces.
- Topic guidance characters 1–1,000 all pass through provider-policy validation; topic-result art
  is captured only through bounded metadata reads.
- Loading, degraded, empty, source label, topic label, and curated-image behavior are preserved.
- No migration, dependency, archive/history, body storage, credential use, browser automation,
  ranking-by-image, or Slice 4 functionality is introduced.
- Focused tests, `pnpm verify:foundation`, release-hardening audit, CI, and the unanimous named
  Opus + independent Codex + Gemini council are GREEN with durable PR verdicts.

## Plan-time adversarial checklist

- **Cross-owner cached-byte attack:** route re-reads current owner snapshot before cache access;
  warmed cache never grants possession.
- **Client URL injection:** route accepts article ID only; upstream URL comes from validated stored
  payload.
- **DNS rebinding/private redirect:** byte path shares Slice 2's resolve-and-pin loop at every hop.
- **Content-type spoofing:** MIME allowlist and native magic-byte match are both required; SVG/HTML
  never served.
- **Oversize/partial image:** `truncated` is rejection, not a partial successful response.
- **Expired archive:** expired snapshot neither composes cards nor authorizes images.
- **Neutral-story disappearance:** `rankedStories` carries the whole snapshot independently of
  truthful preferred-only source groups.
- **Image editorial bias:** stored rank order is copied; layout may use art, ordering may not.
- **Refresh fork:** one shared 30-minute helper drives personalization and overview opens; existing
  generation/CAS coalescing remains the sole concurrency model.
- **Policy substring bypass:** validation cap equals accepted/storage/ranking cap (1,000).
- **Scope drift:** no Settings/chat/revalidation/notifications work, no new cache service, no
  migration, and no dependency.
