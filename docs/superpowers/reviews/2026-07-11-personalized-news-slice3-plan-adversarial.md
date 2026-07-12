# Personalized News Slice 3 — Adversarial Plan Review

- Plan: `docs/superpowers/plans/2026-07-11-personalized-news-slice3.md` (commit `97c28748`)
- Grounded on `d136138e` = `origin/main@c23a93b8` + 2 local doc commits; `pnpm audit:preflight` exit 0
- Evidence: merged Slice 2 news module, web-research reader, shared contracts, manifest and
  module-registry wiring, existing unit/integration tests
- Verdict: **APPROVE WITH REQUIRED CHANGES** — 1 blocking finding
- Confidence: 85%

## Required change (blocking)

1. **Pin the image LRU cache key to the validated upstream image URL (or a strong hash of it),
   never the article ID.** Task 3 leaves the key unspecified, and snapshot article IDs come from
   `stableIdForUrl` (`packages/news/src/source/rss-source.ts:37`), a 32-bit FNV-1a hash documented
   as "never a security boundary" — ID collisions across snapshots would let cached bytes for one
   URL satisfy an authorized request for a different one. Minimum correction: state the URL-based
   cache key in Task 3, add a collision unit test, and define route behavior when one snapshot
   contains two articles with colliding IDs.

## Area assessments

1. Owner isolation/authz: sound — per-request snapshot re-authorization plus RLS/DataContextDb; only the cache-key finding blocks.
2. Single SSRF path: sound — `readCapped` already byte-buffers (`reader.ts:39-62`); byte mode is a clean split with no second loop.
3. Media validation/bounds: sound — MIME plus magic bytes, truncated = reject, 2 MiB / 32-entry / 16 MiB caps, nosniff, no CSP expansion.
4. Response shape: sound — `rankedStories` carries all ≤40 in stored rank order; `sourceGroups` stays preferred-only via the snapshot `preferred` flag.
5. Shared snapshot semantics: sound — one composition feeds News/Today/briefing; `readLatestSnapshot` does not filter `expires_at`, so the mandated expiry check must live in composition and route (plan requires it with tests).
6. Deletion visibility: verified — exclusion and source delete bump the generation before pruning (`personalization-routes.ts:309-318,442-449`), so stale in-flight publishes fail the CAS.
7. Enrichment/policy fix: verified — ranking already consumes 1,000 sanitized guidance chars (`rank.ts:88`) while validation capped 300 (`policy-validation.ts:96`); the 300→1,000 fix closes the gap; enrichment is ≤50 bounded metadata reads through the existing safe port.
8. Contracts/leakage/isolation: sound — optional fields declared in `additionalProperties:false` schemas; original image URLs server-only; port injected at the composition root; job payloads and logs stay metadata-only.
9. Scope: clean — matches spec Slice 3; Slice 4 items excluded; no migration, no dependency.
10. Simplification: lean — only the spec-sanctioned LRU is new; pre-existing vacuous `approvedDomains` (`compile.ts:100`) is a future cleanup, not this slice.

## Non-blocking notes

- `Cache-Control: private, max-age=300` leaves a short shared-browser cross-session window; consider `no-store` if that threat matters.
- Pass `maxBytes` explicitly to the byte port (reader default is 500 KB) and drop or document the unused `"challenge"` failure reason.

Implementation may begin once the cache-key correction is pinned in the plan or task instructions.
