# Relay 8 — #668 Sports Feedback Pass

Continue via `coordinated-build`. Read this doc IN FULL, then resume at Task 5.

Issue: https://github.com/motioneso/Jarv1s/issues/668
Spec: `docs/superpowers/specs/2026-07-01-sports-feedback-pass-design.md` (approved 2026-07-01)
Plan: `docs/superpowers/plans/2026-07-01-sports-feedback-pass.md`
Branch/worktree: `coord/668-sports-feedback-build` at `~/Jarv1s/.claude/worktrees/668-sports-feedback-build`
Coordinator label: `Coordinator` (resolve pane fresh by label — never a baked `…-N` number)
Relay threshold: ~80–100k tokens, or immediately on seeing a compaction summary.

## What's done (this session)

**Tasks 1–3 committed** (from prior sessions), latest `9e0ad81c`.

**Task 4 committed this session at `d788593b`** — "team-level relevance — headline teamKeys join
and followed-team pairs":

- `packages/shared/src/sports-api.ts`: `FollowedTeamRef` DTO; `SportsOverviewResponse.followedTeamKeys`
  (string[]) replaced by `followedTeams: readonly FollowedTeamRef[]` ({competitionKey, teamKey});
  schema updated to match.
- `packages/sports/src/sports-service.ts`: new private `teamsFor(competitionKey, state)` (used by
  both `getCatalog` and `getOverview`); new pure `resolveHeadlineTeamKeys(headlines, teams)` joins
  provider `sourceTeamIds` → `teamKeys` on headlines before they're stored per-competition;
  `getOverview` return now emits `followedTeams` pairs instead of flat `followedTeamKeys`.
- `apps/web/src/sports/sports-page.tsx`: `followedKeys: Set<string>` replaced everywhere with
  `followedPairs: Set<string>` (`"${competitionKey}:${teamKey}"`) + module helper `isFollowed(pairs,
  competitionKey, teamKey)`. Threaded through `SplitSection`, `Scoreboard`, `GameRow` (now also
  takes/passes `competitionKey`), `GameSideRow` (now takes `competitionKey` prop), `HeadlinesRail`
  (dropped the `youComps` competition-level memo — "You" chip is now team-level via
  `headline.teamKeys.some(...)`), `StandingsRail`, `EmptyState`.
- Tests updated: `tests/unit/sports-service.test.ts` (2 new tests: pairs shape, headline teamKeys
  join), `tests/unit/sports-page.test.tsx` (`makeOverview` fixture + new pair-scoped collision test:
  same `teamKey` "min" in two different competitions must not cross-mark `is-you`),
  `tests/unit/sports-routes.test.ts` (overview assertion moved to `followedTeams` pairs),
  `tests/unit/sports-scaffold.test.ts` (fixture-only fix — not in the plan's Task 4 file list but
  needed for typecheck; it had its own `followedTeamKeys` literal).

**Verification:** `pnpm vitest run tests/unit` — 224 files / 1490 passed / 2 skipped. `pnpm
typecheck` — clean (root tsc + `@jarv1s/web` tsc both exit 0).

**Not yet done:** pre-push trio (`format:check && lint && typecheck`) + rebase — not run this
session since we're not pushing yet (mid-plan). Run it before the eventual `coordinated-wrap-up`
push, per that skill's step 3b.

## Working tree state

Clean at handoff — Task 4 commit is the tip. Only untracked file is
`.claude/context-meter.log` (context-meter tooling; do not stage it, do not delete it, not part
of this feature).

## Next: Tasks 5–7

Read the plan sections directly (don't re-derive from this doc):

- **Task 5** (plan line 1192): Followed-team cards — real names/crests, linked news, structured
  next match (A2, B card half, C2, D1, D2). Consumes `SourceHeadline.teamKeys` (joined in Task 4,
  now live) and `teamsFor(competitionKey, state)` (also now live — reuse it, don't re-add).
- **Task 6** (plan line 1559): Top Stories rail + league news grid + linked photo hero (E, B hero
  half, A3 render). New file `apps/web/src/sports/sports-news.tsx` per Global Constraints (keeps
  `sports-page.tsx` under the 1000-line file-size gate — `sports-1.css` is at 992, new CSS goes to
  new `apps/web/src/styles/sports-2.css`).
- **Task 7** (plan line 2073): Docs + full gate + manual LAN verification. This is where
  `pnpm verify:foundation` (or the scoped equivalent if Postgres is contended — see plan
  Coordination section) runs, plus the final push happens via `coordinated-wrap-up`.

## Outstanding #668 feedback extras to fold in (not literal plan text — verify against relay-5/6
if this doc set still exists, otherwise confirm with Coordinator before Task 7 closes)

These were user-requested extras on the issue, to preserve/complete by the time this pass wraps:

- Header wording less stiff (see `PageHeader` in `sports-page.tsx`, current lede: "Your teams
  first — latest results and what's next — then the wider slate and the headlines that matter.")
- Remove redundant green "Sports" label (check `sp-kicker` in `PageHeader` — currently renders
  `<LiveDot /> Sports` above the "Followed" title; confirm with Coordinator whether this is the one
  meant, or a different now-removed element from an earlier pass).
- Remove the word "cached" at the top (`PageHeader`'s `sp-preview__lbl` shows `{degraded ? "Cached"
  : "Live"}` — confirm intended replacement copy with Coordinator, don't silently drop the degraded
  signal).
- Manage link must work (`FollowedSection`'s `<a className="sp-managebtn" href={SETTINGS_HREF}>` →
  `SETTINGS_HREF = "/settings/modules/sports"` — verify this route actually resolves once Task 7's
  LAN verification runs).
- Sports nav icon if local/small (check the app shell nav — not yet touched by this plan; likely a
  small icon-asset addition, confirm scope with Coordinator before adding anything to avoid scope
  creep beyond this issue).

None of the above are in the Task 4 diff — flagging so Task 7 (or an earlier task if a task's file
touches these) doesn't close the issue without addressing them. If already handled by an earlier
commit in this branch's history, verify via `git log --oneline -- apps/web/src/sports/` before
redoing.

## Guardrails (repeat from CLAUDE.md / coordinated-build)

- Stage only exact paths per task's commit step — never `git add -A` / `git add .`.
- Never assume a migration number (n/a for this pass — no SQL).
- Escalate forks/blockers to `Coordinator` via `herdr-pane-message`, resolved fresh by label each
  time.
- Relay again at ~80–100k tokens or on a compaction summary — don't push through degraded.
- Do not touch `docs/coordination/`.
