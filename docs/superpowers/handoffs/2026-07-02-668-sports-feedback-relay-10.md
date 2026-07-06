# Relay 10 — #668 Sports Feedback Pass

Continue via `coordinated-build`. Read this doc IN FULL, then resume at Task 7.

Issue: https://github.com/motioneso/Jarv1s/issues/668
Spec: `docs/superpowers/specs/2026-07-01-sports-feedback-pass-design.md` (approved 2026-07-01)
Plan: `docs/superpowers/plans/2026-07-01-sports-feedback-pass.md`
Branch/worktree: `coord/668-sports-feedback-build` at `~/Jarv1s/.claude/worktrees/668-sports-feedback-build`
Coordinator label: `Coordinator` (resolve pane fresh by label — never a baked `…-N` number)
Relay threshold: ~80–100k tokens, or immediately on seeing a compaction summary.

## What's done (this session)

**Tasks 1–5 committed** (prior sessions), latest before this session `03883f43`.

**Task 6 committed this session at `304611c8`** — "top stories rail, league news grid, linked
photo hero":

- `packages/shared/src/sports-api.ts`: new `LeagueNewsGroup { competitionKey, competitionLabel,
  headlines }`. `SportsOverviewResponse.headlines` replaced by `topStories` (ranked, capped 6) +
  `leagueNews`. Schema updated to match (`leagueNewsGroupSchema` added, `required`/`properties`
  swapped).
- `packages/sports/src/sports-service.ts`: `TOP_STORIES_CAP = 6`. New pure helpers `byNewest` and
  `rankTopStories` (team-tagged-first newest, then newest-per-followed-competition backfill, cap
  6). `getOverview` now computes `topStories`/`leagueNews` (league news = per-competition newest,
  deduped against `topStories`) instead of the flat `headlines`. `buildHero`'s signature
  simplified — takes `topStories` directly instead of `competitionKeys`/`headlinesByComp`.
- `apps/web/src/sports/sports-news.tsx` **(new file)**: `isFollowed`, `NewsIcon` (moved verbatim
  from `sports-parts.tsx`), `StoryHero` (now shows `headline.imageUrl` as a real `<img>` with a
  linked title, replacing the old static "Editorial photo" placeholder), `TopStoriesRail`
  (text-only, per spec §A3 — no thumbnails), `LeagueNewsSection` (grid with thumbnails + serif
  titles).
- `apps/web/src/sports/sports-parts.tsx`: `NewsIcon` removed (moved to `sports-news.tsx`).
- `apps/web/src/sports/sports-page.tsx`: local `isFollowed`, `StoryHero`, `HeadlinesRail` deleted;
  now imports `isFollowed`, `LeagueNewsSection`, `NewsIcon`, `StoryHero`, `TopStoriesRail` from
  `./sports-news`. `SplitSection` rail renders `TopStoriesRail` instead of `HeadlinesRail`.
  `<LeagueNewsSection groups={data.leagueNews} />` rendered full-width after `<SplitSection />` in
  the followed layout, and again in `EmptyState` after `sp-emptyboard` (inside the `hasSlate`
  fragment). `EmptyState.hasSlate` now also checks `topStories.length`/`leagueNews.length`.
- `apps/web/src/styles/sports-3.css` **(new file, fork from plan)** — plan said `sports-2.css`,
  but that name is already taken (committed in #656/#666, used by
  `apps/web/src/settings/settings-page.tsx` for the module-settings pane — unrelated to this
  page). Used `sports-3.css` instead, imported directly after `sports-1.css` in
  `sports-page.tsx`. Content is exactly the plan's Step 5 CSS block (story-photo object-fit,
  hero-link underline, `.sp-news__*` grid/card/img/title/date rules — tokens only, no raw
  colors).
- Tests: `tests/unit/sports-service.test.ts` — ranking/grouping tests were already green from
  Steps 1–3 (prior session in this run, before this relay). `tests/unit/sports-page.test.tsx` —
  `headline()` fixture helper gained an `overrides: Partial<Headline>` param;
  `makeOverview()`'s `headlines` replaced with `topStories` + a `leagueNews` group; new test
  "renders the top stories rail and league news grid"; story-hero test extended with
  `imageUrl` + assertions for the rendered `<img src>` and the linked hero title `href`.
  `tests/unit/sports-scaffold.test.ts` — bare fixture's `headlines: []` replaced with
  `topStories: []` + `leagueNews: []`. `tests/unit/sports-routes.test.ts` and
  `tests/unit/web-sports-client.test.ts` needed **no changes** — neither hardcodes an overview
  literal with a `headlines` field (routes test drives the real `SportsService`; the
  `sourceTeamIds`/`sourceTeamId` leak-pin assertions still pass against the new shape).

**Verification (this session, all green before commit):**
`pnpm vitest run tests/unit` — 224 files / 1497 passed / 2 skipped.
`pnpm typecheck` — clean (root tsc + `@jarv1s/web` tsc both exit 0).
`pnpm exec eslint` on all touched files — clean.
`pnpm exec prettier --check` — 2 files needed `--write` (`sports-page.tsx`,
`sports-service.ts`, pure reformat, re-verified green + tests/typecheck rerun after).

## Working tree state

Clean at handoff — Task 6 commit (`304611c8`) is the tip. Only untracked file is
`.claude/context-meter.log` (context-meter tooling; do not stage it, do not delete it, not part
of this feature).

## Next: Task 7 (final task)

Read the plan directly at **plan line 2073** (don't re-derive from this doc).

**Task 7** — Docs + full gate + manual LAN verification:

1. Update the LOADER-SEAM(sports) list in `packages/sports/README.md` — add seam 7 (CSP image
   hosts) and document the `sourceTeamIds`/`sourceTeamId` → `Headline.teamKeys` join + per-response
   stripping + `standingsShape` catalog flow (exact text in plan).
2. Run `pnpm verify:foundation` (full gate: lint, format:check, check:file-size,
   check:design-tokens, check:no-ambient-dates, typecheck, test:unit, db:migrate,
   test:integration). If a shared-Postgres contention failure shows up (see `multi-agent-pg
   contention` — concurrent `test:integration` can crash a shared dev Postgres), check whether
   another session is running builds concurrently before assuming a real regression; escalate to
   Coordinator if unsure.
3. Manual LAN verification per spec §8 — Vite must run with `--host` (headless box). Checklist is
   in the plan (crests render, story hero photo + linked title, "You" markers correct including an
   abbreviation-collision case, next-match formatting, standings shapes per competition, top
   stories capped at 6, league news grid below Scores). Record pass/fail per bullet in the PR
   description.
4. Commit `packages/sports/README.md` only.
5. Hand off to `coordinated-wrap-up` for the final push/PR — this branch is 17 commits ahead of
   `origin/coord/668-sports-feedback-build` and has never been pushed this run; confirm with
   Coordinator before pushing/opening the PR.

## Outstanding #668 feedback extras (still unaddressed — carried across relays, verify before Task 7 closes)

Not literal plan text; user-requested extras on the issue. Tasks 4–6 did not touch these:

- Header wording less stiff (`PageHeader` in `sports-page.tsx`, current lede: "Your teams first —
  latest results and what's next — then the wider slate and the headlines that matter.")
- Remove redundant green "Sports" label (`sp-kicker` in `PageHeader` renders `<LiveDot /> Sports`
  above "Followed" — confirm with Coordinator whether this is the one meant).
- Remove the word "cached" (`PageHeader`'s `sp-preview__lbl` shows `{degraded ? "Cached" : "Live"}`
  — confirm replacement copy with Coordinator, don't silently drop the degraded signal).
- Manage link must work (`FollowedSection`'s `<a className="sp-managebtn" href={SETTINGS_HREF}>`
  → `SETTINGS_HREF = "/settings/modules/sports"` — verify resolves once Task 7's LAN verification
  runs).
- Sports nav icon if local/small — confirm scope with Coordinator before adding anything (scope
  creep risk).

If already handled by an earlier commit in this branch's history, verify via
`git log --oneline -- apps/web/src/sports/` before redoing. These are NOT gating Task 7's commit
— raise them to Coordinator as a scope question before wrap-up, don't silently fold them in.

## Guardrails (repeat from CLAUDE.md / coordinated-build)

- Stage only exact paths per task's commit step — never `git add -A` / `git add .`.
- Never assume a migration number (n/a for this pass — no SQL).
- Escalate forks/blockers to `Coordinator` via `herdr-pane-message`, resolved fresh by label each
  time.
- Relay again at ~80–100k tokens or on a compaction summary — don't push through degraded.
- Do not touch `docs/coordination/`.
