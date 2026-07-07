import "./styles/sports-1.css";
import "./styles/sports-3.css";
import "./styles/sports-4-grid.css";
import "./styles/sports-5-editorial.css";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { GameSide, OverviewHero, SportsOverviewResponse } from "@jarv1s/shared";

import { getSportsOverview } from "./sports-client.js";
import { sportsQueryKeys } from "./query-keys.js";
import { formatDate, formatTime, useUserLocale } from "./locale.js";
import { CalendarIcon, Crest, LiveDot, TrophyIcon } from "./sports-parts.js";
import { LatestColumn, NewsBand, StoryHero } from "./sports-news.js";
import { SportsTicker } from "./sports-ticker.js";
import { AroundLeaguesTicker } from "./sports-around-ticker.js";
import { StandingsRail } from "./sports-standings.js";

const SETTINGS_HREF = "/settings?section=modules&module=sports";

// Matches the server's SCOREBOARD_TTL_MS cadence (packages/sports/src/sports-service.ts) without
// over-polling once nothing is actually live (#762). Exported for reuse by the Today "Sports
// desk" widget (./today-widget.tsx), which polls the same query on the same cadence.
export const LIVE_REFETCH_INTERVAL_MS = 60_000;

// A still-pulsing LiveDot next to a frozen score is worse than no live indicator at all — this
// decides whether the overview query should keep polling (#762). Exported for direct unit testing
// of the polling decision (see tests/unit/sports-page.test.tsx).
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

  return (
    <div className="sp-wrap">
      <PageHeader />
      {data.degraded ? <DegradedBand /> : null}

      {hasFollows ? (
        <>
          <SportsTicker followed={data.followed} leagues={data.followedLeagues} />
          <AroundLeaguesTicker groups={data.scoreboard} />
          <Hero hero={data.hero} />
          <BroadsheetGrid overview={data} followedPairs={followedPairs} />
          <NewsBand groups={data.leagueNews} />
        </>
      ) : (
        <EmptyState data={data} followedPairs={followedPairs} />
      )}
    </div>
  );
}

function PageHeader() {
  const locale = useUserLocale();
  return (
    <header className="sp-masthead">
      <h1 className="sp-masthead__title">Sports</h1>
      <span className="sp-masthead__meta">{formatDate(new Date(), locale)}</span>
    </header>
  );
}

// Quiet, non-blocking notice for a partial provider outage — the page still renders with
// whatever loaded, this just explains why something might be missing (#765 M1).
function DegradedBand() {
  return (
    <p className="sp-degraded" role="status">
      Scores are temporarily unavailable for some leagues. Showing what we could load.
    </p>
  );
}

// Cold-load placeholder while the first overview fetch is in flight — matches the shapes of
// the sections it stands in for so nothing jumps around once real data lands (#765 M2).
function SportsSkeleton() {
  return (
    <div className="sp-skeleton" role="status" aria-label="Loading your teams">
      <div className="sp-skel sp-skel--ticker" aria-hidden="true" />
      <div className="sp-skel sp-skel--around" aria-hidden="true" />
      <div className="sp-skel sp-skel--hero" aria-hidden="true" />
      <div className="sp-skel sp-skel--grid" aria-hidden="true" />
    </div>
  );
}

/* ---------------------------------------------------------------- Hero */

function Hero(props: { hero: OverviewHero }) {
  if (props.hero.mode === "gameday") {
    return <GamedayHero hero={props.hero} />;
  }
  return <StoryHero headline={props.hero.headline} />;
}

function GamedayHero(props: { hero: Extract<OverviewHero, { mode: "gameday" }> }) {
  const { game, competitionLabel, alsoToday } = props.hero;
  const locale = useUserLocale();
  return (
    <section className="sp-hero sp-hero--live" aria-label="Gameday">
      <div className="sp-hero__eyebrow">
        {game.state === "live" ? (
          <span className="sp-live">
            <LiveDot />
            Live
          </span>
        ) : null}
        <span className="sp-hero__comp">{competitionLabel}</span>
        <span className="sp-hero__phase">
          {game.state === "pre" ? formatTime(game.startsAt, locale) : game.statusDetail}
        </span>
      </div>
      <div className="sp-hero__match">
        <HeroSide side={game.away} />
        <div
          className="sp-hero__score"
          aria-live={game.state === "live" ? "polite" : undefined}
          aria-atomic={game.state === "live" ? "true" : undefined}
        >
          <span className="n">{game.away.score ?? "–"}</span>
          <span className="dash">–</span>
          <span className="n">{game.home.score ?? "–"}</span>
        </div>
        <HeroSide side={game.home} />
      </div>
      <div className="sp-hero__foot">
        <span className="sp-hero__note">
          {game.home.name} vs {game.away.name}
        </span>
      </div>
      {alsoToday ? (
        <div className="sp-hero__also">
          <CalendarIcon />
          <b>Also today:</b> {alsoToday}
        </div>
      ) : null}
    </section>
  );
}

function HeroSide(props: { side: GameSide }) {
  return (
    <div className={`sp-hero__side${props.side.winner ? " is-lead" : ""}`}>
      <Crest
        name={props.side.name}
        shortName={props.side.shortName}
        crestUrl={props.side.crestUrl}
        size="lg"
      />
      <span className="sp-hero__team">{props.side.name}</span>
    </div>
  );
}

/* ---------------------------------------------------------------- Broadsheet body */

function BroadsheetGrid(props: {
  overview: SportsOverviewResponse;
  followedPairs: ReadonlySet<string>;
}) {
  return (
    <div className="sp-grid">
      <div className="sp-grid__main">
        <LatestColumn headlines={props.overview.topStories} followedPairs={props.followedPairs} />
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
          <BroadsheetGrid overview={props.data} followedPairs={props.followedPairs} />
          <NewsBand groups={props.data.leagueNews} />
        </div>
      ) : null}
    </>
  );
}
