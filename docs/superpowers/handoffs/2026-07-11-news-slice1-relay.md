# Relay — News Slice 1 build (continuation)

**You are the successor build agent. Model MUST be Fable (`claude-fable-5`) — Ben's directive;
if you relay again, spawn Fable.**

## Pointers (read by section, never in full)

- Spec: `docs/superpowers/specs/2026-07-11-personalized-news-sources-topics.md`
- Plan (approved by Coordinator, adversarially reviewed): `docs/superpowers/plans/2026-07-11-personalized-news-slice1.md` — execute Tasks 1–6 in order, TDD.
- Original spawn handoff (bans/routing/risk tier): `docs/coordination/2026-07-11-news-slice1-build-handoff.md` (READ ONLY — never commit/touch `docs/coordination/`).
- Branch: `feat/news-slice1` in THIS worktree (`~/Jarv1s/.claude/worktrees/coord-2026-06-30-rfa-fleet/.claude/worktrees/news-slice1-build`). Current with `origin/main@6b37bc01`.

## State

- Plan APPROVED by Coordinator (label `Coordinator`, session `58a78927-385c-4b1d-8fa0-94db20255d6f` = authority; resolve pane fresh by label, verify exactly one).
- Task issue **#953**, epic **#954** — PR must say "Part of #954" and reference #953.
- Migration number **0159 reserved** (local max 0158; only open PR #952 has no SQL). FINAL number = landing order; re-check before PR.
- Risk tier: **security** — unanimous cross-provider council gate; build to owner-only FORCE RLS incl. admins, SSRF/IDN-safe host handling, no secrets/prose in logs/payloads/exports.

## Done (commits on this branch)

- `1cda4286` chore: prettier fixup of committed review doc (format:check now green).
- `dbcf9092` **Task 1 partial**: `foundation.test.ts` (580 lines) split → `tests/integration/foundation-schema-catalog.test.ts` (474 lines, byte-for-byte bodies: migration ledger + catalog/grant/policy tests). 31/31 green via `pnpm exec tsx scripts/test-integration.ts tests/integration/foundation.test.ts tests/integration/foundation-schema-catalog.test.ts`. `check:file-size` green.

## Next (Task 1 remainder — plan §Task 1)

1. Failing tests first: add `0159` row to the ledger `toEqual` in **foundation-schema-catalog.test.ts** (ledger moved there); four table names in `tests/integration/module-data-lifecycle-cascade.test.ts`; start `tests/integration/news-personalization-repository.test.ts` (RLS assertions, completed in Task 3).
2. Write `packages/news/sql/0159_news_personalization.sql`: 4 tables per plan §Data model (news_custom_sources / news_custom_topics / news_source_exclusions / news_compilation_snapshots), ENABLE+FORCE RLS, owner-only policies vs `app.current_actor_user_id()`, app-runtime grants only (NO worker grants), checks/bounds/uniques incl. case-insensitive topic label expression index.
3. Kysely types in `packages/db/src/types.ts`; manifest `database.migrations` + `ownedTables` + cascade tables in `packages/news/src/manifest.ts`.
4. `pnpm db:migrate`, focused tests, cascade test, `check:file-size`, db typecheck. Commit explicit paths only.
5. Then Tasks 2–6 per plan. Session task list (TaskList) mirrors plan tasks 1–6.

## Traps (verified this run)

- fileParallelism false; integration runner provisions isolated DB (`scripts/test-integration.ts <files>`).
- foundation ledger `toEqual` now lives in **foundation-schema-catalog.test.ts**, not foundation.test.ts.
- Prettier-format any doc you commit (handoff-doc prettier trap).
- `git add` explicit paths only; never `git add -A`. Never touch board/merge — Coordinator owns.
- Escalations via `herdr-pane-message` to label `Coordinator`, tags `[SECURITY]`/`[RLS]`/`[CRIT]`.
- Relay trigger: context-meter 70% warning → commit, update THIS doc, spawn Fable successor same worktree, notify Coordinator, request reap.
