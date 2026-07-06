# Relay 2 — #668 Sports Feedback Pass (build agent)

Continue via `coordinated-build`. Issue: https://github.com/motioneso/Jarv1s/issues/668

## Where

- Branch/worktree: `coord/668-sports-feedback-build` @ `~/Jarv1s/.claude/worktrees/668-sports-feedback-build` (unchanged — resume in place, skip `pnpm install`, `node_modules` present).
- Spec: `docs/superpowers/specs/2026-07-01-sports-feedback-pass-design.md`
- Plan (authority, follow verbatim): `docs/superpowers/plans/2026-07-01-sports-feedback-pass.md` — 7 tasks.
- Prior handoff (superseded): `docs/superpowers/handoffs/2026-07-01-668-sports-feedback-relay.md`
- Coordinator: Herdr label `Coordinator` (Codex agent; resolve fresh by label — pane id was `w1:p2E` at relay time, do not trust it). Sent it a queued status ping at relay time; no reply required to proceed.

## Done (this relay)

- Verified Task 1 premises still match branch (unchanged from prior relay note).
- Task 1 Step 1-2 done (from prior relay): `tests/unit/static-web-csp.test.ts` written, confirmed RED (3/3 fail — `SPA_CSP` not exported, nginx missing hosts).
- Task 1 Step 3 done, **uncommitted** (correct — plan commits at Step 9 once green):
  - `packages/sports/src/source/sports-source.ts`: added `readonly imageHosts: readonly string[]` to `SportsSource` interface with the `LOADER-SEAM(sports) 7` doc comment.
  - `packages/sports/src/source/espn-source.ts`: added `export const ESPN_IMAGE_HOSTS: readonly string[] = ["a.espncdn.com", "s.secure.espncdn.com"]` below `CORE_BASE`, and `readonly imageHosts = ESPN_IMAGE_HOSTS;` as the first class field on `EspnSportsSource`.
- Current tree state is intentionally RED (typecheck will fail — fake `SportsSource` test literals don't implement `imageHosts` yet). This is expected TDD mid-state, not a bug.

## Next (resume Task 1 at Step 4, per plan doc exactly)

`docs/superpowers/plans/2026-07-01-sports-feedback-pass.md` Task 1, Steps 4-9:

4. Update every fake `SportsSource` literal — `grep -rn "listTeams: async" tests/unit`; add `imageHosts: [],` as the first property in each (at least `tests/unit/sports-service.test.ts` `makeSource` and the fake in `tests/unit/sports-routes.test.ts`).
5. Export `MODULE_IMAGE_CSP_HOSTS: readonly string[] = createEspnSportsSource().imageHosts;` from `packages/module-registry/src/index.ts` near the sports registration block (~line 796).
6. In `apps/api/src/static-web.ts`: import `MODULE_IMAGE_CSP_HOSTS`, replace the existing `SPA_CSP` const (lines 29-32) per the plan's exact snippet (composes `IMG_SRC`, exports `SPA_CSP`; the `reply.header(...)` call site is unchanged). Check `grep -rn "img-src" tests/` for any test asserting the old literal and update it.
7. Mirror hosts into `infra/nginx/jarv1s-web.conf` line 22 `img-src`, with the sync comment from the plan.
8. Run `pnpm vitest run tests/unit/static-web-csp.test.ts tests/unit/sports-service.test.ts tests/unit/sports-routes.test.ts` (expect PASS) then `pnpm typecheck` (expect exit 0).
9. Commit **exactly** these paths:
   ```
   git add packages/sports/src/source/sports-source.ts packages/sports/src/source/espn-source.ts packages/module-registry/src/index.ts apps/api/src/static-web.ts infra/nginx/jarv1s-web.conf tests/unit/static-web-csp.test.ts tests/unit/sports-service.test.ts tests/unit/sports-routes.test.ts
   git commit -m "#668 feat(sports): CSP img-src follows SportsSource image hosts" -m "Co-Authored-By: Claude <noreply@anthropic.com>"
   ```

Then continue Tasks 2-7 in order, exactly as written in the plan (each has full code snippets — use verbatim unless drift found, then escalate per `coordinated-build` step ½):

- Task 2: source enrichment (`Headline.imageUrl`/`teamKeys`, `SourceTeamRef`/`SourceHeadline`, `espn-source.ts` `getHeadlines`/`listTeams` rewrite, `nfl-news.json` fixture, service plumbing, leak-safety pins).
- Task 3: competition-correct standings (`StandingsShape`/`StandingsSection`/`StandingsGroup`, `catalog.ts` `standingsShape`, `espn-source.ts` `getStandings` full rewrite over ALL `children`, service `standingsByComp`, shape-aware `StandingsRail`).
- Task 4: relevance (`FollowedTeamRef` DTO, service `teamsFor` + `resolveHeadlineTeamKeys`, `followedTeams` pairs replacing `followedTeamKeys`, page-side prop renames).
- Task 5: followed-team cards (`FollowedTeamNews`/`FollowedNextMatch` DTOs, `buildCard` rewrite w/ catalog fallback chain, `newestTeamHeadline`/`nextMatchFor` helpers).
- Task 6: Top Stories rail + league news grid + photo hero (`LeagueNewsGroup` DTO, `rankTopStories`, new `apps/web/src/sports/sports-news.tsx`, new `apps/web/src/styles/sports-2.css` — `sports-1.css` is at 992/1000 lines, do not add to it).
- Task 7: docs (README seam list) + `pnpm verify:foundation` full gate + manual LAN verification checklist (6 bullets) in PR description.

## After Task 7

Invoke `coordinated-wrap-up`: pre-push trio (`pnpm format:check && pnpm lint && pnpm typecheck`, `git fetch origin main && git rebase origin/main`), push branch, open PR linked to #668, comment on #668 with PR URL + commit SHA + verification evidence, report to Coordinator. Do not touch board/milestones/merge.

## Guardrails (unchanged)

No `docs/coordination/` edits. No `git add -A`/`git add .` — explicit paths only. Task-scoped `#668`-prefixed commits. Escalate spec/plan contradictions instead of guessing. Relay again at ~80-100k tokens or on compaction-summary sighting (this repo's context-meter hook fires a hard checkpoint around 70% of window — treat that as the relay trigger too).
