# Sports settings dogfood hardening (#989)

**Status:** Draft (awaiting Fable approval)

**Date:** 2026-07-12

**Grounded on:** `origin/main` @ `3ca138eb508a2c1bb552514d52b6d2d7f1f7e6fc`

**Tier:** routine (module-owned presentation and interaction; no data, auth, or policy change)

**Builds on:** #688, #855, #907, #903;
`2026-07-09-sports-federation-club-following.md` and
`2026-07-08-sports-followed-team-dedupe.md`

## Problem

Sports settings already ships the expensive parts of the intended design: debounced cross-league
team search, lazy league rosters, confederation grouping, a followed summary, and reversible
competition-scoped follows. The dogfood pass found a smaller but important usability delta:

- the empty-search view still renders every league row, so the primary search path is followed by a
  long catalog;
- active and inactive team buttons rely mostly on styling, while whole-league controls combine
  “Follow all…” with “Following”; neither gives a clear state and next action;
- pending and failed writes use pane-wide generic copy instead of naming the team or league the user
  tried to change;
- existing unit tests prove rendering helpers, but no browser test proves that a person can search,
  follow, see the state change, and unfollow at desktop and narrow widths.

This is a delta hardening pass, not another Sports picker redesign.

## Decisions

1. **Search remains the primary discovery path.** Keep the existing two-character, debounced server
   search and its partial/degraded semantics. Followed selections remain above it. Move the full
   confederation catalog behind one clearly labelled, collapsed-by-default “Browse leagues”
   disclosure so an empty query does not immediately expand 46 league rows.
2. **Use one truthful control model everywhere.** An inactive team reads “Follow {team}”; an active
   team visibly reads “Following” and exposes “Unfollow {team}” as its accessible action. An inactive
   league reads “Follow all of {league}”; an active league reads “Following all of {league}” and
   exposes “Unfollow all of {league}”. Search and browse use the same labels and `aria-pressed`
   semantics.
3. **The current mutation is the only pending control.** While a write is in flight, its initiating
   control says “Following…” or “Unfollowing…” and is disabled. Other controls need not be frozen.
   On success, the refetched follow state is the confirmation. On failure, keep the prior truthful
   state and show an adjacent, user-language retry message naming the target.
4. **Competition-scoped follow rows remain separately removable.** #855 deliberately preserved one
   stored follow per `(competitionKey, teamKey)` and dedupes club cards in
   `SportsService.getOverview()`. Settings must not invent name-based club identity, hide a stored
   row, or block a valid second-competition follow. Each stored row remains visible and removable;
   downstream card grouping stays the canonical dedupe.
5. **Reuse the shipped query and mutation seams.** Keep `sportsQueryKeys.teamSearch`,
   `sportsQueryKeys.leagueTeams`, `createSportsFollow`, `deleteSportsFollow`, and the existing follow
   refetch. No optimistic storage model, toast framework, endpoint, schema, or dependency is added.
6. **The disclosure is secondary navigation, not a new picker.** Reuse `BrowseGroups` and its
   one-league-at-a-time lazy roster. Preserve search errors, warm-fill notes, orphan-follow removal,
   and authored `sp-*`/`jds-*` states.

## Reconciled shipped contracts

| Existing behavior                         | This pass                                           |
| ----------------------------------------- | --------------------------------------------------- |
| Cross-league search after two characters  | Preserved; still the first discovery affordance     |
| Lazy per-league roster fetch              | Preserved inside collapsed browse                   |
| Partial search and retry copy from #907   | Preserved                                           |
| Competition-scoped follow storage         | Preserved; each row remains independently removable |
| Club-card dedupe in Sports overview #855  | Preserved; no picker-level fuzzy dedupe             |
| Unknown/orphan follow cleanup             | Preserved                                           |
| #903 deterministic primary selection work | Not duplicated; it remains service/repository scope |

## Slices

### Slice 1 — truthful discovery and follow state

- Put `BrowseGroups` behind the collapsed “Browse leagues” disclosure without changing its lazy
  roster behavior.
- Share the visible/accessibility state vocabulary between search and browse controls instead of
  maintaining two subtly different label branches.
- Track the mutation target and direction just far enough to localize pending/error feedback.
- Add focused component tests for active/inactive team and league labels, `aria-pressed`, disclosure
  default state, target-local pending copy, and retryable failure copy.

### Slice 2 — authored responsive presentation

- Tighten hierarchy and indentation using the existing Sports/settings classes and design tokens.
- Keep followed summary, search, disclosure trigger, league groups, and expanded roster legible at
  desktop and narrow widths without horizontal scrolling or clipped controls.
- Add no raw colors outside `apps/web/src/styles/tokens.css` and no new design-system primitive.

### Slice 3 — focused Playwright acceptance

- Add a stateful route mock local to the Sports settings spec for catalog, follows, search, and
  create/delete follow calls. Do not call ESPN or require a real user account.
- Drive the real module settings contribution through
  `/settings?section=modules&module=sports`; selectors start at the “Sports” pane heading and use
  roles/accessible names, not Settings-shell DOM classes.
- Prove search → follow → `Following` → unfollow for an individual team and follow-all →
  `Following all…` → unfollow-all for a league.
- Repeat the critical path at a narrow viewport and assert the browse disclosure starts collapsed,
  can be keyboard-opened, and does not produce horizontal overflow.

## Expected paths and collision locks

- Product: `~/Jarv1s/packages/sports/src/settings/index.tsx`
- Styles: `~/Jarv1s/packages/sports/src/settings/sports-2.css`
- Unit: `~/Jarv1s/tests/unit/settings-sports-pane.test.tsx`
- E2E: `~/Jarv1s/tests/e2e/sports-settings.spec.ts`

Do not edit Sports routes, service, repository, shared contracts, SQL, or provider adapters. #903
owns deterministic primary-follow selection in the service/repository. #986 owns Settings
shell/chrome/navigation; this issue uses its public module deep link and must not edit shell files.
#1000 may consume the post-#986 Settings structure, so its selectors should remain shell-owned while
this spec's selectors remain pane-owned. #989 and #990 can build in parallel because their product,
style, unit, and E2E files do not overlap. #988 performs the final combined walkthrough after both
land.

## Desktop and narrow acceptance

- [ ] Desktop opens with followed selections and search prominent; the full league catalog is
      collapsed.
- [ ] Searching by a team name returns the expected team without opening browse or rendering every
      league roster.
- [ ] Inactive and active team controls expose “Follow …” and “Unfollow …” respectively, with a
      visible “Following” state and correct `aria-pressed` value.
- [ ] Inactive and active whole-league controls expose “Follow all …” and “Unfollow all …”
      respectively; the active visible state says “Following all of …”.
- [ ] The initiating control alone shows “Following…”/“Unfollowing…” while pending; a failed write
      retains the prior state and names the target in a retryable message.
- [ ] Opening browse fetches only the selected league roster and preserves #907 loading, degraded,
      partial, and retry behavior.
- [ ] Each competition-scoped follow remains individually visible/removable, while the Sports
      overview continues to dedupe the same club's downstream card per #855.
- [ ] At a narrow viewport, search, disclosure, follow states, and remove controls remain keyboard
      reachable and readable with no horizontal overflow.
- [ ] Focused unit tests and `tests/e2e/sports-settings.spec.ts` pass; `pnpm check:design-tokens`,
      `pnpm verify:foundation`, and `git diff --check` pass before merge.

## Non-goals

- No follow schema, migration, RLS, route, or provider change.
- No name-based club master record or picker-level club dedupe; #855's service grouping remains
  authoritative.
- No fix for #903, Sports overview/cards, scores, standings, or story feedback (#906).
- No client-side full-catalog search, eager roster fan-out, fuzzy matching, or new search service.
- No Settings shell/navigation work (#986), screenshot-capture expansion, or broad visual redesign.
