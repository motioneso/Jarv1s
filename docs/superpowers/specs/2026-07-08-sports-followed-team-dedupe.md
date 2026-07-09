# Sports followed-team dedupe (#855)

**Status:** Approved — RFA after AGY/Fable review fixes and Ben approval  
**Date:** 2026-07-08  
**Issue:** #855  
**Grounded on:** `~/Jarv1s/packages/sports/src/repository.ts`,
`~/Jarv1s/packages/sports/src/sports-service.ts`,
`~/Jarv1s/packages/sports/src/source/catalog.ts`,
`~/Jarv1s/packages/sports/src/source/sports-source.ts`,
`~/Jarv1s/packages/shared/src/sports-api.ts`, and
`~/Jarv1s/packages/sports/sql/0133_sports_follows.sql`.

## Problem

Sports follows are competition-scoped rows: `(owner_user_id, competition_key, team_key)`.
That is correct storage because the source APIs, standings, scoreboards, and schedules are
competition-scoped. But it makes the followed ticker render duplicate club cards when the same club
is followed in multiple competitions, such as Liverpool in the Premier League and Champions League.

The duplicate cards repeat the same crest, club name, form, and news while differing only in
competition-scoped facts. The product should show one club card with merged facts.

## Decision

Deduplicate in `SportsService.getOverview()` after per-competition data is fetched and before the
`FollowedTeamCard[]` response is finalized.

Do not change `app.sports_follows` in this slice. Existing rows stay valid, no migration is needed,
and the picker can continue creating/removing competition-scoped follows. The service is the right
owner because it already has the catalog teams, schedules, standings, scoreboards, and headlines
needed to merge cards correctly.

## Design

Add a small service-local grouping step before followed-team schedule/headline fetches:

1. Exclude whole-competition follows (`teamKey: null`) from the grouping step. They continue to
   surface through `followedLeagues` and league-wide sections.
2. Resolve each followed team to a canonical club key.
   - Use `(CatalogEntry.espnSport, SourceTeamRef.sourceTeamId)`. ESPN ids are source-scoped, not
     globally unique across sports.
   - If `sourceTeamId` is missing, do not merge that row with any other row. Render it as its own
     card. A duplicate card is safer than mixing unrelated clubs that share a name.
3. Group followed team rows by canonical club key.
4. Fetch followed-team schedule/headline data from the grouped follow set, not the raw follow rows.
5. Build one `FollowedTeamCard` per group.

The service should avoid duplicate downstream calls for identical `(competitionKey, sourceTeamId)`
pairs. It may still fetch schedule data once per followed competition because cross-competition
fixtures are the point of the merged card.

For a grouped card:

- `teamKey` and `competitionKey` come from the primary follow.
- `competitionLabel` is the primary competition label.
- `name` and `crestUrl` use the existing `buildCard` precedence across the group's available data.
- `status` is `live` if any grouped competition has a live game today, else `today` if any has a
  non-live game today, else `news`.
- `primary` and `todayGameState` come from the selected today game when one exists.
- `stories` pools league and per-team feeds across grouped competitions, deduped by URL, newest
  first, capped by the existing card limit.
- `form` is computed from all grouped schedules merged by game time, newest finals first.
- `standing` comes only from the primary competition standings.
- `nextMatch` is the earliest future match across all grouped schedules.
- `resultMatch` comes from the selected final today game, if any.
- `lastMatchAt` is the newest completed match across all grouped schedules.
- `rationale` names all followed competitions, e.g. `You follow Liverpool in Premier League and
Champions League.`

Primary competition selection:

1. Prefer a `league` catalog entry over a `tournament`.
2. If multiple leagues exist, use the most recently created follow.
3. If only tournaments exist, use the most recently created follow.

This keeps domestic league standings as the default for clubs that also appear in cups.

## Non-goals

- No `sports_follows` migration.
- No club master-data table.
- No picker-level blocking of duplicate club follows in this slice.
- No shared API shape change unless implementation proves the existing `FollowedTeamCard` fields
  cannot represent the merged card cleanly.
- No name-only fuzzy matching between teams.

## Acceptance Criteria

- Following the same club in multiple competitions yields one `FollowedTeamCard` in
  `GET /api/sports/overview` when the source exposes the same `(espnSport, sourceTeamId)`.
- Follow rows without `sourceTeamId` are not merged by normalized name.
- Whole-competition follows are not passed through the followed-team grouping path.
- Duplicate downstream calls are avoided for identical `(competitionKey, sourceTeamId)` pairs.
- The merged card includes news from all followed competitions and per-team feeds, deduped by URL.
- The merged card's next match is the soonest future match across followed competitions.
- The merged card's standing comes from the primary league when a league follow exists.
- Existing competition-scoped follows remain removable from Settings.
- No raw source IDs, private data, or cross-user data are exposed.
- `pnpm verify:foundation` passes for the implementation PR.
