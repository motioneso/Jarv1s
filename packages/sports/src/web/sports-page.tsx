import "./styles/sports-1.css";
import "./styles/sports-3.css";
import "./styles/sports-4-grid.css";
import "./styles/sports-5-editorial.css";
import "./styles/sports-6-newsband.css";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { GameSide, Headline, OverviewHero, SportsOverviewResponse } from "@jarv1s/shared";

import { getSportsOverview } from "./sports-client.js";
import { sportsQueryKeys } from "./query-keys.js";
import { formatTime, useUserLocale } from "./locale.js";
import { teamBarColor } from "./team-colors.js";
import { Crest, LiveDot, TrophyIcon } from "./sports-parts.js";
import { HeroCarousel, LatestColumn, NewsBand } from "./sports-news.js";
import { SportsTicker } from "./sports-ticker.js";
import { AroundLeaguesBoard, AroundLeaguesTicker } from "./sports-around-ticker.js";
import { SOCCER_COMPETITIONS } from "./competitions.js";
import { StandingsRail } from "./sports-standings.js";

const SETTINGS_HREF = "/settings?section=modules&module=sports";

// The around-the-leagues strip's slate moved into the broadsheet main column as
// AroundLeaguesBoard (live feedback mrb4w77y) — Ben: "this would kill the top strip
// entirely. But let's just hide it at first in case we want to bring it back", so the strip
// stays mounted behind this flag instead of being deleted. Typed `boolean` so TS doesn't
// narrow the render arm to unreachable.
const SHOW_AROUND_STRIP: boolean = false;

// Matches the server's SCOREBOARD_TTL_MS cadence (packages/sports/src/sports-service.ts) without
// over-polling once nothing is actually live (#762). Exported for reuse by the Today "Sports
// desk" widget (./today-widget.tsx), which polls the same query on the same cadence.
export const LIVE_REFETCH_INTERVAL_MS = 60_000;

// A still-pulsing LiveDot next to a frozen score is worse than no live indicator at all — this
// decides whether the overview query should keep polling (#762). Exported for direct unit testing
// of the polling decision (see tests/unit/sports-page.test.tsx).
// The old prod server (live preview proxies to it) sends a gameday hero all day; the new
// server only does from T−15min through the final whistle (live feedback mra4kqpf). Mirror
// that gate here so the preview behaves now and stale caches never regress it: outside the
// window the hero demotes to a story hero led by the top story, exactly what the new server
// would have sent.
const GAMEDAY_HERO_LEAD_MS = 15 * 60 * 1000;

function demoteEarlyGameday(data: SportsOverviewResponse): OverviewHero {
  const hero = data.hero;
  if (hero.mode !== "gameday") return hero;
  const { game } = hero;
  if (game.state === "live") return hero;
  if (
    game.state === "pre" &&
    new Date(game.startsAt).getTime() - Date.now() <= GAMEDAY_HERO_LEAD_MS
  ) {
    return hero;
  }
  return { mode: "story", headline: data.topStories[0] ?? null };
}

export function hasLiveGame(data: SportsOverviewResponse | undefined): boolean {
  if (!data) return false;
  if (data.hero.mode === "gameday" && data.hero.game.state === "live") return true;
  if (data.followed.some((card) => card.status === "live")) return true;
  return data.scoreboard.some((group) => group.games.some((game) => game.state === "live"));
}

export function SportsPage() {
  const overviewQuery = useQuery({
    queryKey: sportsQueryKeys.overview,
    queryFn: () => getSportsOverview(),
    // Poll only while a live game is actually in the payload; a static interval would be wasteful
    // once nothing is live, and with no interval at all the page never refetches after mount, so a
    // live score silently goes stale behind a still-pulsing LiveDot (#762). Re-enable window-focus
    // refetch for this query specifically (overriding the app-wide default in main.tsx) so tabbing
    // back in also gets a fresh read, independent of the interval timer.
    refetchInterval: (query) => (hasLiveGame(query.state.data) ? LIVE_REFETCH_INTERVAL_MS : false),
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true
  });
  const data = overviewQuery.data;

  const followedPairs = useMemo(
    () => new Set((data?.followedTeams ?? []).map((f) => `${f.competitionKey}:${f.teamKey}`)),
    [data?.followedTeams]
  );

  if (!data) {
    return (
      <div className="sp-wrap">
        <PageHeader />
        {overviewQuery.isError ? (
          <p className="sp-lede" role="status">
            Sports are unavailable right now.
          </p>
        ) : (
          <SportsSkeleton />
        )}
      </div>
    );
  }

  // A whole-league follow (no individual team) is a first-class picker option — treat it as
  // "has follows" too, and never fall through to the "Follow your teams" empty state just
  // because there's no team card to show (#763).
  const hasTeamFollows = data.followed.length > 0;
  const hasLeagueFollows = data.followedLeagues.length > 0;
  const hasFollows = hasTeamFollows || hasLeagueFollows;
  const hero = demoteEarlyGameday(data);
  // The old hero-vs-Latest dedupe (mra4os7y) is gone with the rebuild: on a quiet day the
  // carousel consumes the whole topStories pool and no list renders; on a gameday the
  // featured-game bar owns the hero and the full pool renders once as the combined list
  // (mrb4w77y) — either way each story appears exactly once.

  return (
    <div className="sp-wrap">
      <PageHeader hero={hero} />

      {hasFollows ? (
        <>
          {/* Front-page lead (mrbalm9x, Ben 2026-07-07): the biggest thing on the page leads,
              ABOVE the followed ticker — /sports is a front page, not a personalized dashboard.
              The two hero modes are mutually exclusive, so exactly one lead renders here:
              gameday → the featured game is the lead; quiet day → the top-stories carousel is.
              The ticker ("my teams") drops to the second beat below. */}
          {hero.mode === "gameday" ? (
            <FeaturedGameBar hero={hero} story={findFeaturedStory(hero, data)} />
          ) : (
            <HeroCarousel headlines={data.topStories} />
          )}
          <SportsTicker followed={data.followed} />
          {SHOW_AROUND_STRIP ? <AroundLeaguesTicker groups={data.scoreboard} /> : null}
          <BroadsheetGrid
            overview={data}
            followedPairs={followedPairs}
            // Gameday: the carousel is replaced by the game bar, so the top stories collapse
            // into a combined list at the head of the main column (mrb4w77y).
            withTopStories={hero.mode === "gameday"}
          />
          <NewsBand groups={data.leagueNews} followedPairs={followedPairs} />
        </>
      ) : (
        <EmptyState data={data} followedPairs={followedPairs} />
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- Masthead */

// Soccer reads home-first ("Liverpool v Chelsea", home half leads the score bar); the US
// leagues read visitor-first ("Bills at Dolphins", away half leads). Data, not preference —
// it's how each sport's scorelines are written everywhere else the user sees them.

// "Live: Giants at Dodgers" — the event masthead line, rendered as broadsheet display type.
// Everything in it is real: game state + the two teams from the featured game.
function eventTitle(game: Extract<OverviewHero, { mode: "gameday" }>["game"]): string {
  const lead = game.state === "live" ? "Live" : game.state === "final" ? "Final" : "Today";
  const matchup = SOCCER_COMPETITIONS.has(game.competitionKey)
    ? `${game.home.shortName} v ${game.away.shortName}`
    : `${game.away.shortName} at ${game.home.shortName}`;
  return `${lead}: ${matchup}`;
}

// Broadsheet masthead: a thin folio strip (date · SPORTS nameplate · manage), then — on a
// gameday — the event headline at real display scale (header redesign pass, follows the
// nyt_style_sports_mockup layout in sans).
function PageHeader(props: { hero?: OverviewHero }) {
  const gameday = props.hero?.mode === "gameday" ? props.hero : null;
  return (
    <header className="sp-mast">
      {/* Folio cleared (Ben 2026-07-07, /sports masthead note): the date line, the "The Sports
          Desk" nameplate, and the Manage link are all removed from the masthead. The app topbar
          already titles the page "Sports", so the page isn't left untitled; the followed-teams
          label + Manage now live on the ticker head below (see SportsTicker). The section-nav bar
          becomes the masthead's leading element. Reverses the folio build (mrb8p4e2/mrba9d2y). */}
      {/* PREVIEW ONLY (mrbafoxu) — sport-section nav in the band between the folio rule and the
          masthead's base rule. Ben asked to see the look now; the real links to sport-specific
          pages are a future story that needs its own task issue + spec before routing/wiring, so
          these are inert spans (not anchors) — appearance only, nothing navigates yet. */}
      <nav className="sp-mast__nav" aria-label="Sports sections (preview)">
        {["Soccer", "Hockey", "Football", "Baseball", "Basketball"].map((sport) => (
          <span className="sp-mast__navlink" key={sport}>
            {sport}
          </span>
        ))}
        {/* "More" catch-all (mrbakozc) — the way into sports outside the followed set, so a user
            can reach whatever sports news they want. Still inert preview; destination TBD. */}
        <span className="sp-mast__navlink sp-mast__navlink--more">More</span>
      </nav>
      {gameday ? <p className="sp-mast__event">{eventTitle(gameday.game)}</p> : null}
    </header>
  );
}

// Cold-load placeholder while the first overview fetch is in flight — matches the shapes of
// the sections it stands in for so nothing jumps around once real data lands (#765 M2).
function SportsSkeleton() {
  return (
    <div className="sp-skeleton" role="status" aria-label="Loading your teams">
      {/* The around-strip skeleton row left with the strip itself (mrb4w77y — strip hidden,
          its slate now loads inside the grid block below). */}
      <div className="sp-skel sp-skel--ticker" aria-hidden="true" />
      <div className="sp-skel sp-skel--hero" aria-hidden="true" />
      <div className="sp-skel sp-skel--grid" aria-hidden="true" />
    </div>
  );
}

/* ---------------------------------------------------------------- Featured-game score bar */

// Full-width team-color score bar under the event masthead: leading team's color fills the
// left half, trailing team's the right, scores pinned to the outer edges, game clock in the
// paper-colored center chip. Colors come from the static map in team-colors.ts; unmapped
// teams get the neutral ink treatment from CSS.
// Photo + blurb band under the score bar (mockup's featured-game treatment): reuse a real
// headline about this matchup from the overview payload. Honest data only — if no headline
// mentions either team, no band renders. Prefers the service's teamKeys join; falls back to
// scanning titles for a team name, since some sources emit empty teamKeys.
function findFeaturedStory(
  hero: Extract<OverviewHero, { mode: "gameday" }>,
  overview: SportsOverviewResponse
): Headline | null {
  const { game } = hero;
  const keys = new Set([game.home.teamKey, game.away.teamKey]);
  const names = [game.home.shortName, game.away.shortName].map((name) => name.toLowerCase());
  // A story about *this* game (preview, recap, highlights) tags or names both clubs.
  // Single-team pieces and league-wide listicles — which ESPN tags with the whole league,
  // hence the tag-count cap — never qualify: no band beats a band about the wrong thing.
  const aboutThisGame = (h: Headline) => {
    if (h.competitionKey !== game.competitionKey || h.teamKeys.length > 6) return false;
    const tagged = h.teamKeys.filter((key) => keys.has(key)).length;
    const named = names.filter((name) => h.title.toLowerCase().includes(name)).length;
    return Math.max(tagged, named) >= 2;
  };
  const candidates = [
    ...overview.topStories,
    ...overview.leagueNews.flatMap((group) => group.headlines)
  ].filter(aboutThisGame);
  return (
    candidates.find((h) => h.imageUrl && h.summary) ??
    candidates.find((h) => h.imageUrl) ??
    candidates[0] ??
    null
  );
}

function FeaturedStoryBand(props: { story: Headline }) {
  const { story } = props;
  const [broken, setBroken] = useState(false);
  return (
    <a className="sp-scorebar__story" href={story.url} target="_blank" rel="noreferrer">
      {story.imageUrl && !broken ? (
        <img
          className="sp-scorebar__photo"
          src={story.imageUrl}
          alt=""
          loading="lazy"
          onError={() => setBroken(true)}
        />
      ) : null}
      <span className="sp-scorebar__storycopy">
        <span className="sp-scorebar__storytitle">{story.title}</span>
        {story.summary ? <span className="sp-scorebar__storydek">{story.summary}</span> : null}
      </span>
    </a>
  );
}

function FeaturedGameBar(props: {
  hero: Extract<OverviewHero, { mode: "gameday" }>;
  story: Headline | null;
}) {
  const { game, competitionLabel } = props.hero;
  const locale = useUserLocale();
  const soccer = SOCCER_COMPETITIONS.has(game.competitionKey);
  const left = soccer ? game.home : game.away;
  const right = soccer ? game.away : game.home;
  const clock = game.state === "pre" ? formatTime(game.startsAt, locale) : game.statusDetail;
  return (
    <section
      className="sp-scorebar"
      aria-label="Featured game"
      aria-live={game.state === "live" ? "polite" : undefined}
      aria-atomic={game.state === "live" ? "true" : undefined}
    >
      <div className="sp-scorebar__bar">
        <ScoreBarSide side={left} competitionKey={game.competitionKey} edge="l" />
        <div className="sp-scorebar__mid">
          {game.state === "live" ? <LiveDot /> : null}
          <span className="sp-scorebar__clock">{clock}</span>
        </div>
        <ScoreBarSide side={right} competitionKey={game.competitionKey} edge="r" />
      </div>
      <div className="sp-scorebar__foot">
        <span className="sp-scorebar__comp">{competitionLabel}</span>
      </div>
      {props.story ? <FeaturedStoryBand story={props.story} /> : null}
    </section>
  );
}

function ScoreBarSide(props: { side: GameSide; competitionKey: string; edge: "l" | "r" }) {
  const { side, edge } = props;
  const color = teamBarColor(props.competitionKey, side.teamKey);
  return (
    <div
      className={`sp-scorebar__side sp-scorebar__side--${edge}`}
      style={color ? { background: color.bg, color: color.fg } : undefined}
    >
      {side.crestUrl ? (
        // Oversized ghost of the club crest bleeding off the color band — decorative only,
        // deliberately cropped by the side's overflow (live feedback mra36r06).
        <img
          className="sp-scorebar__watermark"
          src={side.crestUrl}
          alt=""
          aria-hidden="true"
          loading="lazy"
        />
      ) : null}
      <span className="sp-scorebar__score">{side.score ?? ""}</span>
      <span className="sp-scorebar__team" title={side.name}>
        <span className="sp-scorebar__team-full">{side.name}</span>
        <span className="sp-scorebar__team-abbr" aria-hidden="true">
          {side.shortName}
        </span>
      </span>
      <Crest name={side.name} shortName={side.shortName} crestUrl={side.crestUrl} size="md" />
    </div>
  );
}

/* FollowedCard moved to its only consumer, today-widget.tsx (#837 cleanup on main) — /sports
   itself renders the ticker strip instead since the #831 refactor. */

/* ---------------------------------------------------------------- Broadsheet body */

// Main column is the around-the-leagues board now (mrb4w77y) — the Top-stories list that
// held this slot only returns above the board when the carousel isn't showing those same
// stories (gameday, and the no-follow slate where no hero renders at all).
function BroadsheetGrid(props: {
  overview: SportsOverviewResponse;
  followedPairs: ReadonlySet<string>;
  withTopStories?: boolean;
}) {
  return (
    <div className="sp-grid">
      <div className="sp-grid__main">
        {props.withTopStories ? <LatestColumn headlines={props.overview.topStories} /> : null}
        <AroundLeaguesBoard
          groups={props.overview.scoreboard}
          followedPairs={props.followedPairs}
        />
      </div>
      <aside className="sp-grid__rail">
        <StandingsRail groups={props.overview.standings} followedPairs={props.followedPairs} />
      </aside>
    </div>
  );
}

/* ---------------------------------------------------------------- Empty state */

function EmptyState(props: { data: SportsOverviewResponse; followedPairs: ReadonlySet<string> }) {
  const hasSlate =
    props.data.topStories.length > 0 ||
    props.data.standings.length > 0 ||
    props.data.leagueNews.length > 0;
  return (
    <>
      <section className="sp-empty" aria-label="No teams followed">
        <div className="sp-empty__inner">
          <span className="sp-empty__mark">
            <TrophyIcon />
          </span>
          <h2 className="sp-empty__title">Follow your teams</h2>
          <p className="sp-empty__lede">
            Pick the teams and competitions you care about — this page fills with their scores,
            results, and headlines.
          </p>
          <a className="sp-nofollow__btn" href={SETTINGS_HREF}>
            Choose teams to follow
          </a>
        </div>
      </section>
      {hasSlate ? (
        <div className="sp-emptyboard">
          {/* No hero renders on the zero-follow slate, so the combined Top-stories list is
              this user's only route to the topStories pool (mrb4w77y). */}
          <BroadsheetGrid
            overview={props.data}
            followedPairs={props.followedPairs}
            withTopStories
          />
          <NewsBand groups={props.data.leagueNews} followedPairs={props.followedPairs} />
        </div>
      ) : null}
    </>
  );
}
