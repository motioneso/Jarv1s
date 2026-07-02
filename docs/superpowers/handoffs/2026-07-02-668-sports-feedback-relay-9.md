# Relay 9 — #668 Sports Feedback Pass

Continue via `coordinated-build`. Read this doc IN FULL, then resume at Task 6.

Issue: https://github.com/motioneso/Jarv1s/issues/668
Spec: `docs/superpowers/specs/2026-07-01-sports-feedback-pass-design.md` (approved 2026-07-01)
Plan: `docs/superpowers/plans/2026-07-01-sports-feedback-pass.md`
Branch/worktree: `coord/668-sports-feedback-build` at `~/Jarv1s/.claude/worktrees/668-sports-feedback-build`
Coordinator label: `Coordinator` (resolve pane fresh by label — never a baked `…-N` number)
Relay threshold: ~80–100k tokens, or immediately on seeing a compaction summary.

## What's done (this session)

**Tasks 1–4 committed** (prior sessions), latest before this session `d788593b`.

**Task 5 committed this session at `03883f43`** — "card names/crests via catalog, linked team
news, structured next match":

- `packages/shared/src/sports-api.ts`: new `FollowedTeamNews { title, url }` and
  `FollowedNextMatch { opponentName, homeAway, startsAt }`; `FollowedTeamCard.news` added,
  `.nextMatch` retyped from `string | null` to `FollowedNextMatch | null`; schema updated
  (`news` added to required, both `news`/`nextMatch` now `oneOf [null, object]`).
- `packages/sports/src/sports-service.ts`: `teamsByComp` map populated alongside the existing
  per-competition `teamsFor` call (Task 4), passed into `buildCard` as new final param `teams`.
  `buildCard` name/crest precedence is now todaySide → catalogTeam → scheduleSide → uppercase key
  (was todaySide → schedule → raw key). `teamNameFromSchedule` replaced by `scheduleSideFor`
  (returns the `GameSide`, not just a name). New `newestTeamHeadline(headlines, teamKey)` populates
  `card.news` (newest team-tagged headline by `publishedAt`). `nextMatchLine` (string) replaced by
  `nextMatchFor` (struct). `primary` is now `""` on news-status cards (news content moved to the
  dedicated `news` field).
- `apps/web/src/sports/sports-page.tsx`: `FollowedCard`'s news branch renders `card.news` as a
  link (`<a href={news.url}>`) or "No recent news"; added `formatNextMatch(next)` helper +
  `NEXT_MATCH_DATE`/`NEXT_MATCH_TIME` `Intl.DateTimeFormat` consts (browser locale/timezone, spec
  D2) rendering `"vs/at {opponentName} · {date} · {time}"`.
- Tests: `tests/unit/sports-service.test.ts` (3 new: structured nextMatch, news-card link,
  empty-news state; old `toContain("GB")` string assertion deleted). `tests/unit/sports-page.test.tsx`
  (`followedCard()` fixture gained `news: null` + structured `nextMatch`; assertion changed from
  `"vs Green Bay · Sun 1:00 PM"` to `"vs Green Bay Packers"`; new test for news-card link
  rendering). `tests/unit/sports-routes.test.ts` **not modified** — it exercises the real
  `SportsService` through Fastify schema validation, no card-shape literal to update.

**Verification:** `pnpm vitest run tests/unit` — 224 files / 1494 passed / 2 skipped. `pnpm
typecheck` — clean (root tsc + `@jarv1s/web` tsc both exit 0).

**Not yet done:** pre-push trio (`format:check && lint && typecheck`) + rebase — still not run,
still mid-plan, not pushing yet.

## Working tree state

Clean at handoff — Task 5 commit (`03883f43`) is the tip. Only untracked file is
`.claude/context-meter.log` (context-meter tooling; do not stage it, do not delete it, not part
of this feature).

## Next: Task 6 (then Task 7)

Read the plan directly at **plan line 1559** (don't re-derive from this doc) — it is long and
detailed (8 steps, full file contents for the new `sports-news.tsx` module and `sports-2.css`).
Premises verified current as of this handoff:
`packages/shared/src/sports-api.ts:136` still has `readonly headlines: readonly Headline[];` (not
yet split into `topStories`/`leagueNews`); `apps/web/src/sports/sports-page.tsx` still has local
`isFollowed` (line 31), `StoryHero` (line 181), `HeadlinesRail` (line 405) — none yet moved to the
new `sports-news.tsx`.

**Task 6** (plan line 1559): Top Stories rail + league news grid + linked photo hero. New file
`apps/web/src/sports/sports-news.tsx` (moves `NewsIcon`, `isFollowed`, adds `StoryHero`,
`TopStoriesRail`, `LeagueNewsSection` — full source given in the plan). New file
`apps/web/src/styles/sports-2.css` (per Global Constraints: `sports-1.css` is at 992/1000 lines,
new CSS must go to a new file). `SportsOverviewResponse.headlines` → `topStories` (ranked, capped
at 6) + `leagueNews` (grouped, deduped against topStories). Ranking: team-tagged-first newest,
then newest-per-followed-competition backfill, cap 6 (`rankTopStories` helper, full body in plan).
8 steps — TDD service tests first, then DTO/schema, then service ranking, then the new component
file, then CSS, then wire `sports-page.tsx` (delete local `StoryHero`/`NewsIcon`/`isFollowed`/
`HeadlinesRail`, import from `sports-news.tsx` instead), then fixture updates in
`sports-page.test.tsx`/`sports-routes.test.ts` (grep `\.headlines` across `apps/web/src tests/unit`
for stragglers, e.g. `web-sports-client.test.ts`), then full test+typecheck+commit.

I already created GitHub-tracking-style todos #7–#14 for Task 6's 8 steps in this session's task
list (TaskCreate) — if your harness shares that task list, use `TaskList`/`TaskGet` to resume from
there; otherwise just follow the plan's step numbering directly, it's equivalent.

**Task 7** (plan line 2073): Docs + full gate + manual LAN verification — final task, runs
`pnpm verify:foundation` (or scoped equivalent if Postgres is contended, see plan Coordination
section) and does the final push via `coordinated-wrap-up`.

## Outstanding #668 feedback extras (still unaddressed — carried from relay-8, verify before Task 7 closes)

Not literal plan text; user-requested extras on the issue. None of Tasks 4–5 touched these:

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
`git log --oneline -- apps/web/src/sports/` before redoing.

## Guardrails (repeat from CLAUDE.md / coordinated-build)

- Stage only exact paths per task's commit step — never `git add -A` / `git add .`.
- Never assume a migration number (n/a for this pass — no SQL).
- Escalate forks/blockers to `Coordinator` via `herdr-pane-message`, resolved fresh by label each
  time.
- Relay again at ~80–100k tokens or on a compaction summary — don't push through degraded.
- Do not touch `docs/coordination/`.
