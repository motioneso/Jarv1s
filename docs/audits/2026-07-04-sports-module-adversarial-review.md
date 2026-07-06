# Sports Module — Adversarial Review (functionality + UX)

**Date:** 2026-07-04
**Grounded on:** detached worktree at `origin/main` @ `422157a1` (local `main` was 52 commits behind; preflight failed as designed, audit ran against the fresh ref).
**Scope:** `packages/sports/*`, `apps/web/src/sports/*`, `apps/web/src/api/sports-client.ts`, `packages/shared/src/sports-api.ts`, briefings wiring. Focus: does the module behave like a first-class Jarvis surface — functionality and user experience. Security posture reviewed only where it intersects functionality.

**Verdict:** solid architecture (adapter seam, owner-only RLS, DataContextDb everywhere, never-red + reduced-motion honored, briefing wired morning + evening). But the module has **two HIGH defects that break its core promise at the exact moment a sports fan uses it** (evening games vanish; live scores freeze), and two more HIGH UX gaps that make league-level follows and first-run feel second-class. It is not yet first-class.

---

## HIGH

### H1 — UTC "today" makes evening games disappear from the whole module

`SportsService.today()` is `now().toISOString().slice(0, 10)` — the **UTC** date
(`packages/sports/src/sports-service.ts:286`). ESPN's `scoreboard?dates=YYYYMMDD` interprets the
date in US Eastern. From ~7–8pm ET onward (UTC midnight), every overview/briefing request asks for
**tomorrow's** slate:

- Tonight's prime-time game drops out of the gameday hero, the followed-team card flips from
  `live`/`today` to `news`, and the scoreboard section loses the game — mid-game.
- `getFollowedFactsForToday` returns nothing for tonight's game, so the **evening briefing's
  "News & sports" section goes quiet exactly when there's a result to report**
  (`packages/briefings/src/compose-evening.ts` consumes this tool).
- The wrong day is then cached for 3 minutes per competition, so it self-reinforces.

The frontend already resolves the user's persisted locale/timezone for `formatNextMatch`
(`apps/web/src/sports/sports-page.tsx:28`); the service has no timezone concept at all. Fix:
compute "today" in the user's timezone (or minimally US/Eastern to match ESPN), and include that
resolved date in the cache key.

### H2 — "LIVE" badge pulses over a frozen score

The overview query has no `refetchInterval` (`apps/web/src/sports/sports-page.tsx:36`), and the
app-wide defaults are `staleTime: 15s`, `refetchOnWindowFocus: false` (`apps/web/src/main.tsx:19`).
Once loaded, the page **never updates** — a user watching a live game sees an animated live dot
next to a score that silently stops being true. Server TTL (3 min scoreboard) is ready for polling;
the client just never polls. Fix: `refetchInterval` (~60–90s, only while a `live` game is in the
payload, `refetchIntervalInBackground: false`).

### H3 — Whole-league followers are told they follow nothing

`hasFollows = data.followed.length > 0` counts only **team** cards
(`apps/web/src/sports/sports-page.tsx:58`), and the service builds cards/hero only from
`teamKey`-bearing follows (`packages/sports/src/sports-service.ts:117`). A user who follows "All
of NFL" (a first-class option the picker offers prominently) gets:

- The **"Follow your teams" empty-state banner** — while their league's scoreboard renders below it.
- No gameday hero ever, no briefing-adjacent highlight; league follows only feed the slate.

The follow model treats league follows as first-class; the page treats them as absence. Fix: a
distinct "following N leagues" header state (never the empty CTA), and let the story/gameday hero
draw from followed leagues.

### H4 — First-run page is empty; the spec's "useful any day" promise fails for new users

`getOverview` fetches only followed competitions. Zero follows → zero scoreboard, zero headlines,
`hero.headline: null` → the page is a lone CTA card. Spec §4.6a promised "general scores and
headlines below" the empty state, and the frontend even ships the slate-under-empty branch —
`hasSlate` in `EmptyState` (`apps/web/src/sports/sports-page.tsx:480`) — which is **unreachable
for a zero-follow user** (it only fires for the H3 league-only case). First impression of the
module is a blank page. Fix: default slate (e.g., marquee + in-season competitions) when follows
are empty.

---

## MEDIUM

### M1 — Degradation is completely silent

The service diligently threads `degraded: true` through every source failure — and **no web code
reads it** (zero references in `apps/web`). Full ESPN outage with follows → cards with empty
primary text, no form, no standing, story hero with no story, no explanation. The settings picker
is worse: `getCatalog` never errors (empty `teams` on failure), so competitions render with "0
teams" and the user simply cannot follow anything, with no message. Spec exit criteria called for
an authored degraded state. Fix: a quiet "Scores are temporarily unavailable" band when
`degraded`, and a retry affordance in the picker when a competition has zero teams.

### M2 — Cold load is a serial ESPN crawl

`getOverview` awaits scoreboard → standings → teams → headlines per competition **sequentially**,
then one schedule call per followed team (`packages/sports/src/sports-service.ts:125-185`);
`getCatalog` serially lists teams for all 8 competitions (`fifa.world` alone is ~200+ national
teams). A realistic 3-league / 4-team user pays ~16 sequential round-trips on a cold cache behind
a single "Loading your teams…" line. No `Promise.all`, no in-flight coalescing (concurrent users
each trigger their own fetch storm). Fix: parallelize per-competition fetches and add a loading
skeleton.

### M3 — `competitionKey` never validated against the catalog; one bad row degrades the page forever

POST body allows any ≤100-char string (`packages/shared/src/sports-api.ts:486`). A follow row with
an unknown key makes `resolve()` throw on every overview (`packages/sports/src/source/espn-source.ts:57`),
caught into `degraded: true` — permanently, invisibly (see M1), on every load. Same failure mode
if a catalog key is ever renamed/retired (e.g., `fifa.world` off-cycle). The picker also renders
orphan follows as raw keys. Fix: validate against `SPORTS_CATALOG` on create (400 otherwise) and
skip-with-notice unknown keys in the service.

### M4 — Raw competition keys leak into the editorial UI

Gameday hero eyebrow (`sports-page.tsx:111`), story hero (`sports-news.tsx:50`) and top-stories
rail (`sports-news.tsx:93`) render `competitionKey.toUpperCase()`: **"ENG.1"**, **"USA.1"**,
**"UEFA.CHAMPIONS"** — on the page whose design language is "editorial, NYT-sports". Half the
catalog is affected. Labels are already in the payload everywhere else; use them.

### M5 — DELETE `/api/sports/follows/:id` has no param validation

A non-UUID `id` reaches the Postgres uuid cast (`packages/sports/src/repository.ts:66`) and
surfaces as a DB error → 500-class response instead of 400/404. Low effort: `params` schema with
`format: "uuid"`.

---

## LOW / polish

- **L1** Gameday hero footer prints "{home} vs {away}" under a score displayed **away–home**
  (`sports-page.tsx:117-127`); flipped conventions invite misreading a final.
- **L2** `resultOf` defaults a scoreless/winner-less final to **"L"**
  (`sports-service.ts:512`): postponed or abandoned fixtures can paint phantom losses into form
  pips and card result lines.
- **L3** `findTeamGame` returns the first match only — MLB doubleheaders show game 1 all day
  (`sports-service.ts:473`).
- **L4** Settings pane: one global `pending` disables **every** button during any mutation
  (bulk-following ~10 teams is a click-wait-click slog); no optimistic updates; and follow
  mutations invalidate only `["sports","follows"]` — not the overview key — so "Manage → back to
  /sports" inside the 15s stale window shows the old page (`packages/sports/src/settings/index.tsx:265`).
- **L5** Scoreboard filter chip state survives refetches; if the selected competition drops out of
  the payload the board renders empty with no hint (`sports-page.tsx:252`).
- **L6** Briefing league-follow fact says "N games **play** today" while counting finals
  (`sports-service.ts:274`).
- **L7** Champions League is catalogued as `standingsShape: "groups"`; the competition switched to
  a single league phase in 2024–25 — verify ESPN's `children` shape live, fixtures won't catch it.

## What holds up well

Owner-only RLS + duplicate-follow guard in the repository; every route through
`withDataContext`; the `SportsSource` adapter is genuinely swappable and fixture-tested; POST body
validation exists (contra spec-drift fears); never-red result semantics and
`prefers-reduced-motion` are honored in CSS; briefing facts are wired into both morning and
evening composers behind the trust boundary; picker search (issue #688) works over teams and
leagues.

## Suggested fix order

H1 → H2 (the "watching my team tonight" loop), then H3/H4 (follow-model + first-run UX), then
M1/M4 (honest, polished surface), then M2/M3/M5 and the L-batch.
