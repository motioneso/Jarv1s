# Relay — News Slice 1 build (continuation, hop 3 → hop 4)

**You are the successor build agent. Model MUST be Fable (`claude-fable-5`) — Ben's directive;
if you relay again, spawn Fable.**

## Pointers (read by section, never in full)

- Spec: `docs/superpowers/specs/2026-07-11-personalized-news-sources-topics.md`
- Plan (Coordinator-approved): `docs/superpowers/plans/2026-07-11-personalized-news-slice1.md` —
  Tasks 1–6 in order, TDD. Read ONLY the section for the current task.
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
  (4 tables, FORCE RLS owner-only, app-runtime-only grants), Kysely types, manifest wiring,
  schema-posture tests. agentmemory saved (RLS classification, mem_mrg4sogq).
- `d62d6cc4` **Task 2 COMPLETE**: `packages/news/src/personalization-domain.ts`
  (normalizePublisherDomain result-union, publisherDomainMatches, assertSnapshotPayload + caps)
  and `packages/shared/src/news-api.ts` personalization DTOs/schemas (snapshot metadata-only,
  NO payload/fingerprint/provider/model fields). Unit 57/57 green.
- `3c24cb95` **Task 3 COMPLETE**: `packages/news/src/personalization-repository.ts`
  (DataContext-only; DTO reads never select `validation_fingerprint`; idempotent atomic
  cap-guarded createExclusion → typed `NewsPersonalizationLimitError`; atomic per-owner snapshot
  upsert; `assertSnapshotPayload` runs BEFORE any SQL). Tests: unit 60/60
  (`tests/unit/news-personalization-{domain,repository}.test.ts`), integration 11/11
  (`tests/integration/news-personalization-repository.test.ts` — RLS owner isolation incl.
  admin actor, duplicate idempotency, per-owner cap, snapshot atomicity). Typecheck/lint/format
  green.

## Next: Task 4 (plan §Task 4 — routes + service wiring)

- Read plan §Task 4 first, then spec sections it cites. RED test first (TDD).
- Scope from plan: GET `/api/news/personalization` + POST/DELETE
  `/api/news/source-exclusions` under existing news perms (news.view / news.prefs);
  `NewsPersonalizationAvailabilityPort` injected callbacks (hasJsonModel via
  `AiRepository.resolveModelForCapability(scopedDb, "json")`, hasWebSearch via Brave key check);
  availability booleans in GET response; NewsService exclusion filtering of curated sources
  (canonical homepage domain pre-fetch + composed-headline hostname drop via
  `publisherDomainMatches`); module-registry wiring. Snapshot in GET = metadata only.
- Then Task 5 (News Settings UI sections) and Task 6 (data-lifecycle export: sources/topics/
  exclusions included, snapshots+fingerprints OMITTED; then `pnpm verify:foundation` + full
  integration; closeout via `coordinated-wrap-up` → PR "Part of #954", references #953).

## Traps (verified)

- Integration runner: `pnpm exec tsx scripts/test-integration.ts <files>` (isolated DB).
- Foundation migration ledger `toEqual` lives in **foundation-schema-catalog.test.ts** (0159 row
  added).
- `pg_policies.roles` is `name[]` — cast `roles::text[]` in tests.
- fast-json-stringify strips undeclared response fields — keep schemas in lockstep with DTOs
  (`packages/shared/src/news-api.ts`), and test via `app.inject`, not the service directly.
- Custom source/topic WRITES are Slice 2 — Slice 1 repository only reads/exports them.
- Prettier-format any committed doc; `git add` explicit paths only; never touch board/merge.
- Escalations via `herdr-pane-message` to label `Coordinator`, tags `[SECURITY]`/`[RLS]`/`[CRIT]`.
- Relay trigger: context-meter 70% warning → commit, update THIS doc, spawn Fable successor same
  worktree, notify Coordinator, request reap.
