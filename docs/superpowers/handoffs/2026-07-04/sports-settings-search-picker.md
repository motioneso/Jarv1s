# Sports Settings Search Picker Handoff

## Goal

Implement Ben's settings feedback for `/settings` sports preferences:

1. Followed summary chips should show team logos for selected teams when `crestUrl` exists.
2. Hide the standalone league/browse follow sections. The search box should be the only way to add follows.
3. Search results should still let the user follow a whole league. If a team search matches a team, show that team's league as a followable league result too.

Keep this small. Do not redesign the Sports page or add new APIs.

## Base

Worktree: `~/Jarv1s/.claude/worktrees/sports-settings-search-picker`

Branch: `coord/sports-settings-search-picker`

Base: `origin/main`

## Relevant Files

- `packages/sports/src/settings/index.tsx`
- `apps/web/src/styles/sports-2.css`
- `tests/unit/settings-sports-pane.test.tsx`

## Current Behavior

`SportsSettings` currently renders:

- `FollowedSummary`
- search input
- `SearchResults` when query is non-empty
- all `CompetitionGroup` browse sections when query is empty

`SearchResults` separately renders `leagueMatches(query, competitions)` and `filterTeams(query, competitions)`.

`FollowedSummary` already passes `crestUrl` to `PickCrest` for team follows on current main. Verify it with a test using a non-null `crestUrl`; if already working, do not change production code for that part.

## Desired Behavior

Render flow:

- Always render `FollowedSummary`.
- Always render search input.
- If query is empty, do not render league browse groups. A small empty/search hint is fine only if existing local patterns make that trivial; otherwise skip it.
- If query is non-empty, render search results.

Search result league rows:

- Include direct league label matches.
- Include parent competitions for matching teams.
- De-duplicate by `competitionKey`.

This means searching `cowboys` should show:

- `Follow all of NFL`
- `Dallas Cowboys`

## Guardrails

- Ponytail mode: shortest correct diff wins.
- No new abstraction, no dependency, no data model change.
- Preserve accessibility basics on buttons and search.
- Keep class names stable where possible.
- Do not touch production env files or secrets.

## Checks

Run at minimum:

```bash
pnpm --filter @jarv1s/web typecheck
pnpm vitest run tests/unit/settings-sports-pane.test.tsx
```

If a command is unavailable or fails for unrelated environment reasons, capture the exact command and failure.

## Start

1. Run `pnpm install` if `node_modules` is missing in this worktree.
2. Read `AGENTS.md` and `CLAUDE.md`.
3. Inspect the three relevant files above.
4. Implement the minimal change.
5. Run the checks.
6. Commit the implementation with a concise message.
7. Report the commit SHA, checks, and any caveats back in the Herdr pane.
