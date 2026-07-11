# Relay — News Slice 1 build (continuation, hop 2)

**You are the successor build agent. Model MUST be Fable (`claude-fable-5`) — Ben's directive;
if you relay again, spawn Fable.**

## Pointers (read by section, never in full)

- Spec: `docs/superpowers/specs/2026-07-11-personalized-news-sources-topics.md`
- Plan (Coordinator-approved): `docs/superpowers/plans/2026-07-11-personalized-news-slice1.md` —
  Tasks 1–6 in order, TDD. Task 2 spec = plan lines ~183–216; read the section for the current
  task only.
- Original spawn handoff (bans/routing/risk tier): `docs/coordination/2026-07-11-news-slice1-build-handoff.md`
  (READ ONLY — never commit/touch `docs/coordination/`).
- Branch: `feat/news-slice1` in THIS worktree
  (`~/Jarv1s/.claude/worktrees/coord-2026-06-30-rfa-fleet/.claude/worktrees/news-slice1-build`).

## State

- Plan APPROVED — do NOT re-request approval. Coordinator label `Coordinator`, session
  `58a78927-385c-4b1d-8fa0-94db20255d6f` (authority; resolve pane fresh by label, verify exactly
  one).
- Task issue **#953**, epic **#954** — PR says "Part of #954", references #953.
- Migration **0159 landed on this branch** (commit `cf06ec28`); re-check landing order vs open
  PRs before opening OUR PR.
- Risk tier: **security** — owner-only FORCE RLS incl. admins, SSRF/IDN-safe host handling, no
  secrets/prose in logs/payloads/exports.

## Done (commits on this branch)

- `dbcf9092` foundation.test.ts split → `foundation-schema-catalog.test.ts`.
- `cf06ec28` **Task 1 COMPLETE**: migration `packages/news/sql/0159_news_personalization.sql`
  (4 tables, FORCE RLS owner-only, app-runtime-only grants), Kysely types + row aliases
  (`packages/db/src/types.ts`), manifest migrations/ownedTables/cascade tables
  (`packages/news/src/manifest.ts`), schema-posture tests
  (`tests/integration/news-personalization-repository.test.ts` — Task 3 extends this file with
  repository tests). All green: 3 integration files 18/18, module-registry 13/13, lifecycle
  allowlist 2/2, `check:file-size`, db+news typecheck, prettier+eslint. `pnpm db:migrate`
  applied 0159 to dev DB. agentmemory saved (RLS classification, mem_mrg4sogq).

## Next: Task 2 mid-flight (plan §Task 2)

- **RED test COMMITTED with this doc**: `tests/unit/news-personalization-domain.test.ts` — fails
  (modules don't exist yet). It defines the exact expected API; make it green:
  1. Create `packages/news/src/personalization-domain.ts`: result-union
     `normalizePublisherDomain(input)` → `{ok:true,domain}|{ok:false,reason}` (trim; ≤2048 input;
     prepend `https://` if schemeless; WHATWG URL parse; reject non-https/credentials/port/IP
     literals (v4 dotted-quad post-parse + `[`/`:` for v6)/single-label/invalid labels; strip
     trailing dot; ≤253; punycode via URL parser). `publisherDomainMatches(excluded,candidate)` =
     exact or `candidate.endsWith("." + excluded)`. `assertSnapshotPayload` + exported caps
     `NEWS_SNAPSHOT_MAX_ARTICLES=40`, `NEWS_SNAPSHOT_MAX_STRING_LENGTH`,
     `NEWS_SNAPSHOT_MAX_TOTAL_BYTES` (+ depth cap): object root, `articles` array ≤40 objects,
     per-string cap, nesting cap, JSON-only values, total-bytes cap. Dependency-free, no AJV.
  2. Extend `packages/shared/src/news-api.ts` (browser-safe; re-exported via index line 33):
     `getNewsPersonalizationSchema` (response.200: required
     `[availability, customSources, customTopics, sourceExclusions, snapshot]`,
     `additionalProperties:false`, snapshot = metadata only `{compiledAt, expiresAt,
     articleCount}` nullable, NO payload/fingerprint/provider/model fields anywhere),
     `createNewsSourceExclusionSchema` (body: single `source` string, min 1 max 2048),
     `deleteNewsSourceExclusionSchema` (params id uuid) + matching DTO interfaces per plan
     §Task 2 (availability flags: aiConfigured, webSearchConfigured, customSourceByUrlEnabled,
     customSourceByNameEnabled, freeformTopicsEnabled).
  3. `pnpm exec vitest run tests/unit/news-personalization-domain.test.ts` green; shared+news
     typecheck; prettier+eslint; commit Task 2 files explicit paths (include the test file —
     already committed, amend not needed, just commit the new sources).
- Then Tasks 3–6 per plan sections.

## Traps (verified)

- Integration runner: `pnpm exec tsx scripts/test-integration.ts <files>` (isolated DB).
- Foundation migration ledger `toEqual` lives in **foundation-schema-catalog.test.ts** (0159 row
  added).
- `pg_policies.roles` is `name[]` — cast `roles::text[]` in tests.
- fast-json-stringify strips undeclared response fields — keep schemas in lockstep with DTOs.
- Prettier-format any committed doc; `git add` explicit paths only; never touch board/merge.
- Escalations via `herdr-pane-message` to label `Coordinator`, tags `[SECURITY]`/`[RLS]`/`[CRIT]`.
- Relay trigger: context-meter 70% warning → commit, update THIS doc, spawn Fable successor same
  worktree, notify Coordinator, request reap.
