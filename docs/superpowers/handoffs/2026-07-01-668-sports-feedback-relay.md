# Relay — #668 Sports Feedback Pass (build agent)

Continue via `coordinated-build`. Issue: https://github.com/motioneso/Jarv1s/issues/668

## Where

- Branch/worktree: `coord/668-sports-feedback-build` @ `~/Jarv1s/.claude/worktrees/668-sports-feedback-build` (unchanged — resume in place, skip `pnpm install`, `node_modules` present).
- Spec: `docs/superpowers/specs/2026-07-01-sports-feedback-pass-design.md`
- Plan (authority, follow verbatim): `docs/superpowers/plans/2026-07-01-sports-feedback-pass.md` — 7 tasks.
- Original handoff: `docs/coordination/handoffs/2026-07-01-668-sports-feedback-build.md`
- Coordinator: Herdr label `Coordinator` (Codex agent, `pane_id: w1:p2E` at relay time — **resolve fresh by label**, don't trust that pane id).

## Done

- Verified Task 1-3 plan premises against actual branch (no drift): `packages/sports/src/source/sports-source.ts`, `espn-source.ts`, `apps/api/src/static-web.ts`, `infra/nginx/jarv1s-web.conf`, `packages/module-registry/src/index.ts` all match what the plan expects (no `imageHosts` field yet, `SPA_CSP` not exported yet, standings bug at `espn-source.ts:190` reads only `children[0]` confirmed present).
- Task 1 Step 1 done: wrote `tests/unit/static-web-csp.test.ts` (new file, **uncommitted, still on disk** — do not delete, it's step 1 of Task 1, not throwaway).
- Task 1 Step 2 done: ran `pnpm vitest run tests/unit/static-web-csp.test.ts` — confirmed 3/3 RED as expected (`SPA_CSP` not exported, nginx conf missing the espncdn hosts).

## Next (resume Task 1 at Step 3, per the plan doc exactly)

Follow `docs/superpowers/plans/2026-07-01-sports-feedback-pass.md` Task 1 Steps 3-9 verbatim:
3. Add `imageHosts: readonly string[]` to `SportsSource` interface (`sports-source.ts`) with `LOADER-SEAM(sports) 7` doc comment.
4. Add `ESPN_IMAGE_HOSTS` const + `imageHosts` property to `EspnSportsSource` (`espn-source.ts`).
5. Export `MODULE_IMAGE_CSP_HOSTS: readonly string[] = createEspnSportsSource().imageHosts;` from `packages/module-registry/src/index.ts` near the existing sports registration block (~line 796).
6. In `apps/api/src/static-web.ts`: import `MODULE_IMAGE_CSP_HOSTS`, compose `IMG_SRC`, `export const SPA_CSP`.
7. Mirror the same hosts into `infra/nginx/jarv1s-web.conf` line 22 `img-src`, with a sync comment.
8. Update fake `SportsSource` test literals in `tests/unit/sports-service.test.ts` and `tests/unit/sports-routes.test.ts` to add `imageHosts: []` (or real hosts per plan — check exact plan text).
9. Run `pnpm vitest run tests/unit/static-web-csp.test.ts tests/unit/sports-service.test.ts tests/unit/sports-routes.test.ts && pnpm typecheck`. Then commit **exactly** these paths (per plan):
   ```
   git add packages/sports/src/source/sports-source.ts packages/sports/src/source/espn-source.ts packages/module-registry/src/index.ts apps/api/src/static-web.ts infra/nginx/jarv1s-web.conf tests/unit/static-web-csp.test.ts tests/unit/sports-service.test.ts tests/unit/sports-routes.test.ts
   git commit -m "#668 feat(sports): CSP img-src follows SportsSource image hosts" -m "Co-Authored-By: Claude <noreply@anthropic.com>"
   ```

Then continue Tasks 2-7 in order, exactly as written in the plan (each already has full code snippets — do not re-derive, use them verbatim unless drift is found, in which case escalate per `coordinated-build` step ½ discipline):
- Task 2: source enrichment (`Headline.imageUrl`/`teamKeys`, `SourceTeamRef`/`SourceHeadline`, `espn-source.ts` `getHeadlines`/`listTeams` rewrite, `nfl-news.json` fixture, service plumbing, leak-safety pins).
- Task 3: competition-correct standings (`StandingsShape`/`StandingsSection`/`StandingsGroup`, `catalog.ts` `standingsShape`, `espn-source.ts` `getStandings` full rewrite over ALL `children`, not just `[0]`, service `standingsByComp`, shape-aware `StandingsRail`).
- Task 4: relevance (`FollowedTeamRef` DTO, service `teamsFor` + `resolveHeadlineTeamKeys`, `followedTeams` pairs replacing `followedTeamKeys`, page-side prop renames).
- Task 5: followed-team cards (`FollowedTeamNews`/`FollowedNextMatch` DTOs, `buildCard` rewrite w/ catalog fallback chain, `newestTeamHeadline`/`nextMatchFor` helpers).
- Task 6: Top Stories rail + league news grid + photo hero (`LeagueNewsGroup` DTO, `rankTopStories`, new `apps/web/src/sports/sports-news.tsx`, new `apps/web/src/styles/sports-2.css` — `sports-1.css` is at 992/1000 lines, do not add to it).
- Task 7: docs (README seam list) + `pnpm verify:foundation` full gate + manual LAN verification checklist (6 bullets) in PR description.

## After Task 7

Invoke `coordinated-wrap-up`: pre-push trio (`pnpm format:check && pnpm lint && pnpm typecheck`, `git fetch origin main && git rebase origin/main`), push branch, open PR linked to #668, comment on #668 with PR URL + commit SHA + verification evidence, report to Coordinator. Do not touch board/milestones/merge.

## Guardrails (unchanged from original handoff)

No `docs/coordination/` edits. No `git add -A`/`git add .` — explicit paths only. Task-scoped `#668`-prefixed commits. Escalate spec/plan contradictions instead of guessing. Relay again at ~80-100k tokens or on compaction-summary sighting.
