# Relay — #855 sports-followed-team-dedupe

**Spec:** `docs/superpowers/specs/2026-07-08-sports-followed-team-dedupe.md` (approved, #855)
**Branch/worktree:** `build/855-sports-dedupe` @ `/home/ben/Jarv1s/.claude/worktrees/855-sports-dedupe`
(off `origin/main` @ `33270eef`)
**Handoff doc:** `docs/coordination/handoffs/2026-07-09-855-sports-dedupe.md` — read it too (coordinator
label `Coordinator`, session id `dd8b3920-6924-4eaf-b2bf-4120f187c7a3`, risk tier `routine`, run-specific
bans, collision notes — you are blocking predecessor for #858 on the same code region).

**State:** Relaying at ctx 71% during the `coordinated-build` "verify spec + design" phase, BEFORE the
plan file existed. **No files changed in this worktree yet** — nothing to commit. Coordinator already
notified (queued message, ctx-71% relay). **Next action: write the plan via `superpowers:writing-plans`
to `docs/superpowers/plans/`, then message Coordinator and STOP for approval — do not write code first.**

## Spec verification — DONE, all premises hold, do not re-verify

- `SportsFollowDto.createdAt` real (repository.ts orders `created_at DESC`, maps to ISO string) — the
  "most recently created follow" primary-selection tie-break is valid.
- `CatalogEntry.espnSport` + `kind: "league"|"tournament"` real (`packages/sports/src/source/catalog.ts`).
- `SourceTeamRef.sourceTeamId: string | null` real (`packages/sports/src/source/sports-source.ts`).
- No existing grouping/dedup logic in `getOverview()` — exactly one `FollowedTeamCard` per raw follow via
  `Promise.all` + `this.buildCard(...)` today (`packages/sports/src/sports-service.ts` ~188-347).
- `followedTeamCardSchema` in `packages/shared/src/sports-api.ts:373-461` **already declares** every field
  the merged card needs (`nextMatch`, `resultMatch`, `todayGameState`, `stories`, `form`, `standing`,
  `rationale`, etc.) — **no shared-api schema change needed.** (Relevant recurring trap:
  fast-json-stringify silently drops any emitted field the schema doesn't declare —
  `additionalProperties:false` — confirmed not triggered here, but if the plan ever adds a genuinely new
  field, it MUST go in this schema file too and be tested via `app.inject`, not the service directly.)
- DB `UNIQUE (owner_user_id, competition_key, team_key)` on `sports_follows` (migration
  `packages/sports/sql/0133_sports_follows.sql`) + `DatasetClient` per-param-key caching
  (`packages/datasets/src/client.ts`) structurally already guarantee the spec's "avoid duplicate
  downstream calls for identical (competitionKey, sourceTeamId) pairs" criterion — no dedicated dedup-fetch
  code required, but the plan should still include a regression test asserting fetch-call-count.
- `tests/unit/sports-service.test.ts` (866 lines) read in full for fixture/mocking conventions
  (`FakeSourceHandlers`/`makeDatasetClient()`/`makeSource()`/`makeDeps()`, `DECLARED_DATASET_KEYS`,
  fixtures `FIXED_NOW`/`TODAY`/`dalLiveGame`/`dalSchedule`/`nflStandings`/`nflHeadlines`/`dalTeamFollow`).
  Match these conventions in new tests.
- No existing Oxford-list-join utility in the repo (`grep -rn "oxford\|joinOxford\|andJoin\|listJoin"` —
  empty). Write a small local helper inline in `sports-service.ts`.
- `sports-service.ts` is 963/1000 lines (file-size gate) — put pure grouping logic in a NEW file, not
  more code in this one.

## Design worked out (not yet written to a plan file)

**New file `packages/sports/src/followed-groups.ts`** (pure logic, own unit test file
`tests/unit/sports-followed-groups.test.ts`):
- `type ResolvedFollow = SportsFollowDto & { teamKey: string }` (the already-narrowed type used at
  `sports-service.ts` line ~152 for `followedTeams`).
- `canonicalClubKey(follow: ResolvedFollow, sourceTeamId: string | null): string | null` — returns
  `` `${catalogEntry(follow.competitionKey)?.espnSport}:${sourceTeamId}` `` or `null` if `sourceTeamId` is
  null (unmergeable → caller must give it its own singleton group).
- `interface FollowedTeamGroup { readonly key: string; readonly follows: readonly ResolvedFollow[]; readonly primary: ResolvedFollow }`
- `groupFollowedTeams(follows: readonly ResolvedFollow[], sourceTeamIdFor: (f: ResolvedFollow) => string | null): FollowedTeamGroup[]`
  — groups by `canonicalClubKey`; null-key follows each become their own singleton group (use a unique key
  per follow, e.g. `follow.id`, so they never accidentally merge with each other).
- `selectPrimaryFollow(follows: readonly ResolvedFollow[]): ResolvedFollow` — prefer
  `catalogEntry(f.competitionKey)?.kind === "league"` over `"tournament"`; tie-break by newest
  `createdAt` (ISO strings sort correctly lexicographically). Single-follow groups trivially return that
  follow.

**Refactor inside `sports-service.ts`** (DRY, preserves 100% behavior-parity with existing single-follow
tests — this is the regression safety net, run the full existing suite unmodified after the refactor):
- Add `interface ResolvedGame { readonly game: GameSummary; readonly teamKey: string }` and
  `toResolvedGames(schedule: readonly GameSummary[], teamKey: string): ResolvedGame[]`.
- Generalize `computeForm`, `nextMatchFor`, `lastMatchFor` into `computeFormAcross(games: ResolvedGame[])`,
  `nextMatchAcross(games: ResolvedGame[])`, `lastMatchAcross(games: ResolvedGame[])`; reimplement the
  original single-team functions as thin wrappers, e.g.
  `computeForm(schedule, teamKey) = computeFormAcross(toResolvedGames(schedule, teamKey))`.
- Mirror `buildHero`'s live > non-live-else-first priority to pick one "today game" across a group's
  members (each member may have a different literal `teamKey` per competition).
- `firstDefined<T>(bundles, pick)` helper over an ordered (primary-first) bundle list for merged
  `name`/`crestUrl`, preserving existing precedence: `todaySide?.name ?? catalogTeam?.name ??
  scheduleSide?.name ?? teamKey.toUpperCase()`.
- Split `teamStories(headlines, teamKey)` into a filter step + shared `toTeamStories(headlines)`
  (sort-desc `publishedAt` / dedup by `url` / `slice(TEAM_STORY_LIMIT)` / map) so the grouped path can pool
  each member's own-filtered headlines before piping into `toTeamStories()`.
- `standing` for a merged card comes ONLY from the primary bundle:
  `standingLine(primaryBundle.standings, primary.teamKey)`.
- `rationale`: singleton group keeps exact existing text `` `You follow ${name}.` ``; multi-member group
  becomes `` `You follow ${name} in ${joinLabels(competitionLabels)}.` `` where `joinLabels` is the new
  inline Oxford-join helper (`"A and B"` / `"A, B, and C"`).
- New `private buildGroupedCard(group: FollowedTeamGroup, bundles: ReadonlyMap<string, FollowedTeamBundle>, now: Date): FollowedTeamCard`
  fully replaces `buildCard` (verified: for a singleton group it reduces to byte-identical output to the
  old `buildCard`, since `orderedBundles = [primaryBundle]` in that case) — order members primary-first:
  `[group.primary, ...group.follows.filter(f => f.id !== group.primary.id)]`.
- New `interface FollowedTeamBundle { follow: ResolvedFollow; sourceTeamId: string | null; scoreboard: readonly GameSummary[]; standings: StandingsTable["sections"]; headlines: readonly SourceHeadline[]; schedule: readonly GameSummary[]; teams: readonly SourceTeamRef[] }`.
- In `getOverview()`: replace the `followedTeams.map(async follow => ... this.buildCard(...))` block with:
  build a `Map<string, FollowedTeamBundle>` keyed by `follow.id` (same per-follow fetches as today, just
  stashed instead of piped straight into `buildCard`), then
  `const groups = groupFollowedTeams(followedTeams, f => bundles.get(f.id)!.sourceTeamId)`, then
  `const cards = groups.map(g => this.buildGroupedCard(g, bundles, this.now()))`.
- `hero` computation, `rankTopStories`, `followedTeams` response field (raw per-follow list, NOT deduped —
  spec doesn't ask to change this field) — all stay exactly as-is, untouched by this refactor.
- Whole-competition follows (`teamKey: null`) already excluded from `followedTeams` upstream — grouping
  only ever sees non-null-teamKey follows, matching spec's "don't merge whole-competition follows".

## Task list for the plan (TDD order)

1. `packages/sports/src/followed-groups.ts` + its unit test file — pure grouping/primary-selection, no
   dependency on `sports-service.ts` internals.
2. Refactor `sports-service.ts` internals into the `Across`/pool primitives (Task above) as a pure
   behavior-preserving refactor — verify via the EXISTING `tests/unit/sports-service.test.ts` suite
   passing unmodified (no new test needed for this step alone).
3. Wire bundles + grouping + `buildGroupedCard` into `getOverview()`, replacing `buildCard`. Add new tests
   to `tests/unit/sports-service.test.ts` covering: cross-competition merge into one card; unresolved
   `sourceTeamId` stays unmerged; merged `nextMatch` = soonest across competitions; merged `standing` from
   primary only; merged `stories` pooled + deduped by url; primary selection (league > tournament, then
   newest `createdAt`); no duplicate dataset fetches (call-count assertion); `rationale` lists all
   followed competition labels via Oxford join.
4. Full gate: `pnpm verify:foundation`; confirm every spec Acceptance Criterion (9 bullets) is met.

## Commands

- Gate: `pnpm verify:foundation` (= lint + format:check + check:file-size + check:design-tokens +
  check:no-ambient-dates + check:package-deps + typecheck + test:unit + db:migrate + test:integration).
- Pre-push trio: `pnpm format:check && pnpm lint && pnpm typecheck`, then
  `git fetch origin main && git rebase origin/main`.
- Unit only: `pnpm test:unit` (= `vitest run tests/unit`).

## Do NOT re-derive

All of the "Spec verification" and "Design worked out" sections above are settled — go straight to
writing the plan doc (`superpowers:writing-plans` → `docs/superpowers/plans/YYYY-MM-DD-<slug>.md`), then
message the Coordinator (confirm via `herdr pane list` exactly one pane labeled `Coordinator`) and STOP for
approval before any code.
