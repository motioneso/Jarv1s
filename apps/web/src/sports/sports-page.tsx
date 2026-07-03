import "../styles/sports-1.css";
import "../styles/sports-3.css";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type {
  FollowedNextMatch,
  FollowedTeamCard,
  GameSide,
  GameSummary,
  OverviewHero,
  ScoreboardGroup,
  SportsOverviewResponse,
  StandingsGroup,
  StandingsRow
} from "@jarv1s/shared";
import type { LocaleSettingsDto } from "@jarv1s/shared";

import { getSportsOverview } from "../api/sports-client";
import { queryKeys } from "../api/query-keys";
import { formatDate, formatTime, useUserLocale } from "../locale/locale-format.js";
import { CalendarIcon, Crest, FormPips, LiveDot, RationaleChip, TrophyIcon } from "./sports-parts";
import { isFollowed, LeagueNewsSection, NewsIcon, StoryHero, TopStoriesRail } from "./sports-news";

const SETTINGS_HREF = "/settings?section=modules&module=sports";

// "vs Green Bay Packers · Sat, Jul 4 · 3:00 PM" — user's persisted locale + timezone (spec D2)
function formatNextMatch(next: FollowedNextMatch, locale: LocaleSettingsDto): string {
  const at = next.startsAt;
  const date = formatDate(at, locale, { weekday: "short", month: "short", day: "numeric" });
  const time = formatTime(at, locale);
  return `${next.homeAway === "home" ? "vs" : "at"} ${next.opponentName} · ${date} · ${time}`;
}

export function SportsPage() {
  const overviewQuery = useQuery({
    queryKey: queryKeys.sports.overview,
    queryFn: () => getSportsOverview()
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
        <p className="sp-lede" role="status">
          {overviewQuery.isError ? "Sports are unavailable right now." : "Loading your teams…"}
        </p>
      </div>
    );
  }

  const hasFollows = data.followed.length > 0;

  return (
    <div className="sp-wrap">
      <PageHeader />

      {hasFollows ? (
        <>
          <Hero hero={data.hero} />
          <FollowedSection followed={data.followed} />
          <SplitSection data={data} followedPairs={followedPairs} />
          <LeagueNewsSection groups={data.leagueNews} />
        </>
      ) : (
        <EmptyState data={data} followedPairs={followedPairs} />
      )}
    </div>
  );
}

function PageHeader() {
  return (
    <header className="sp-top">
      <div className="sp-top__main">
        <h1 className="sp-title">Your teams, today.</h1>
        <p className="sp-lede">
          Latest scores and what&rsquo;s next, then the wider slate and the headlines that matter.
        </p>
      </div>
    </header>
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
  const { game, rationale, alsoToday } = props.hero;
  return (
    <section className="sp-hero sp-hero--live" aria-label="Gameday">
      <div className="sp-hero__eyebrow">
        {game.state === "live" ? (
          <span className="sp-live">
            <LiveDot />
            Live
          </span>
        ) : (
          <span className="sp-hero__comp">{game.competitionKey.toUpperCase()}</span>
        )}
        <span className="sp-hero__phase">{game.statusDetail}</span>
      </div>
      <div className="sp-hero__match">
        <HeroSide side={game.away} />
        <div className="sp-hero__score">
          <span className="n">{game.away.score ?? "–"}</span>
          <span className="dash">–</span>
          <span className="n">{game.home.score ?? "–"}</span>
        </div>
        <HeroSide side={game.home} />
      </div>
      <div className="sp-hero__foot">
        <RationaleChip>{rationale}</RationaleChip>
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

/* ---------------------------------------------------------------- Followed teams */

function FollowedSection(props: { followed: readonly FollowedTeamCard[] }) {
  return (
    <section className="sp-sec" aria-label="Followed teams">
      <div className="sp-sec__head">
        <h2 className="sp-sec__title">
          Your teams <span className="sub">{props.followed.length} followed</span>
        </h2>
        <a className="sp-managebtn" href={SETTINGS_HREF}>
          Manage
        </a>
      </div>
      <div className="sp-fcgrid">
        {props.followed.map((card) => (
          <FollowedCard key={`${card.competitionKey}:${card.teamKey}`} card={card} />
        ))}
      </div>
    </section>
  );
}

function FollowedCard(props: { card: FollowedTeamCard }) {
  const { card } = props;
  const locale = useUserLocale();
  return (
    <article className="sp-fc">
      <div className="sp-fc__hd">
        <Crest name={card.name} crestUrl={card.crestUrl} size="md" />
        <div className="sp-fc__id">
          <span className="sp-fc__name">{card.name}</span>
          <span className="sp-fc__comp">{card.competitionLabel}</span>
        </div>
        <span className={`sp-tag sp-tag--${card.status}`}>{card.status}</span>
      </div>

      <div className="sp-fc__primary">
        {card.status === "news" ? (
          <>
            <span className="sp-fc__newsic">
              <NewsIcon />
            </span>
            {card.news ? (
              <a className="sp-fc__newstx" href={card.news.url} target="_blank" rel="noreferrer">
                {card.news.title}
              </a>
            ) : (
              <span className="sp-fc__newstx">No recent news</span>
            )}
          </>
        ) : (
          <span className="sp-fc__resscore">{card.primary}</span>
        )}
      </div>

      <div className="sp-fc__form">
        {card.standing ? (
          <span className="sp-fc__standing">
            <TrophyIcon />
            {card.standing}
          </span>
        ) : null}
        <FormPips form={card.form} />
      </div>

      {card.nextMatch ? (
        <div className="sp-fc__next">
          <span className="sp-fc__nextlbl">
            <CalendarIcon />
            Next
          </span>
          <span className="sp-fc__nextmatch">{formatNextMatch(card.nextMatch, locale)}</span>
        </div>
      ) : null}
    </article>
  );
}

/* ---------------------------------------------------------------- Split: scores + rail */

function SplitSection(props: { data: SportsOverviewResponse; followedPairs: ReadonlySet<string> }) {
  return (
    <div className="sp-split">
      <div className="sp-body">
        <Scoreboard groups={props.data.scoreboard} followedPairs={props.followedPairs} />
        <TopStoriesRail headlines={props.data.topStories} followedPairs={props.followedPairs} />
      </div>
      <div className="sp-railcol">
        <StandingsRail groups={props.data.standings} followedPairs={props.followedPairs} />
      </div>
    </div>
  );
}

function Scoreboard(props: {
  groups: readonly ScoreboardGroup[];
  followedPairs: ReadonlySet<string>;
}) {
  const [active, setActive] = useState<string>("all");
  const groups =
    active === "all" ? props.groups : props.groups.filter((g) => g.competitionKey === active);

  return (
    <section className="sp-sec" aria-label="Scores">
      <div className="sp-sec__head">
        <h2 className="sp-sec__title">Scores</h2>
        <div className="sp-chips">
          <button
            type="button"
            className={`sp-chip${active === "all" ? " is-on" : ""}`}
            onClick={() => setActive("all")}
          >
            All
          </button>
          {props.groups.map((group) => (
            <button
              key={group.competitionKey}
              type="button"
              className={`sp-chip${active === group.competitionKey ? " is-on" : ""}`}
              onClick={() => setActive(group.competitionKey)}
            >
              {group.competitionLabel}
            </button>
          ))}
        </div>
      </div>
      <div className="sp-board">
        {groups.map((group) => (
          <div key={group.competitionKey} className="sp-boardgrp">
            <div className="sp-boardgrp__hd">
              <span className="nm">{group.competitionLabel}</span>
            </div>
            <div className="sp-boardgrp__games">
              {group.games.map((game) => (
                <GameRow key={game.id} game={game} followedPairs={props.followedPairs} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function GameRow(props: { game: GameSummary; followedPairs: ReadonlySet<string> }) {
  const { game } = props;
  const mine =
    isFollowed(props.followedPairs, game.competitionKey, game.home.teamKey) ||
    isFollowed(props.followedPairs, game.competitionKey, game.away.teamKey);
  return (
    <div className={`sp-game${mine ? " sp-game--you" : ""}`}>
      <div className="sp-game__sides">
        <GameSideRow
          side={game.away}
          competitionKey={game.competitionKey}
          followedPairs={props.followedPairs}
        />
        <GameSideRow
          side={game.home}
          competitionKey={game.competitionKey}
          followedPairs={props.followedPairs}
        />
      </div>
      <div className="sp-game__status">
        {game.state === "live" ? (
          <span className="sp-game__live">
            <LiveDot />
            {game.statusDetail}
          </span>
        ) : game.state === "final" ? (
          <span className="sp-game__ft">{game.statusDetail}</span>
        ) : (
          <span className="sp-game__time">{game.statusDetail}</span>
        )}
      </div>
    </div>
  );
}

function GameSideRow(props: {
  side: GameSide;
  competitionKey: string;
  followedPairs: ReadonlySet<string>;
}) {
  const mine = isFollowed(props.followedPairs, props.competitionKey, props.side.teamKey);
  return (
    <div className={`sp-game__side${props.side.winner ? " is-win" : ""}${mine ? " is-mine" : ""}`}>
      <Crest
        name={props.side.name}
        shortName={props.side.shortName}
        crestUrl={props.side.crestUrl}
        size="sm"
      />
      <span className="sp-game__team">{props.side.name}</span>
      {props.side.record ? <span className="sp-game__rec">{props.side.record}</span> : null}
      <span className="sp-game__num">{props.side.score ?? "–"}</span>
    </div>
  );
}

function StandingsRail(props: {
  groups: readonly StandingsGroup[];
  followedPairs: ReadonlySet<string>;
}) {
  const pages = props.groups.flatMap((group) =>
    group.sections.map((section) => ({ group, section }))
  );
  const [pageIndex, setPageIndex] = useState(0);
  const activeIndex = Math.min(pageIndex, pages.length - 1);
  const page = pages[activeIndex];
  if (!page) return null;
  const { group, section } = page;
  const hasPages = pages.length > 1;
  const showPrev = () => setPageIndex((index) => (index + pages.length - 1) % pages.length);
  const showNext = () => setPageIndex((index) => (index + 1) % pages.length);
  const selectLeague = (competitionKey: string) => {
    const nextIndex = pages.findIndex((p) => p.group.competitionKey === competitionKey);
    if (nextIndex >= 0) setPageIndex(nextIndex);
  };
  const label = section.label ?? group.competitionLabel;
  return (
    <section className="sp-standings" aria-label="Standings">
      <div className="sp-standings__hd">
        <span className="sp-standings__title">
          <TrophyIcon />
          Standings
        </span>
        {hasPages ? (
          <span className="sp-standings__nav">
            <select
              className="sp-standings__select"
              aria-label="Select standings league"
              value={group.competitionKey}
              onChange={(event) => selectLeague(event.currentTarget.value)}
            >
              {props.groups.map((option) => (
                <option key={option.competitionKey} value={option.competitionKey}>
                  {option.competitionLabel}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="sp-iconbtn"
              onClick={showPrev}
              aria-label="Previous standings"
            >
              <ChevronLeft size={14} aria-hidden="true" />
            </button>
            <span className="sp-standings__count">
              {activeIndex + 1}/{pages.length}
            </span>
            <button
              type="button"
              className="sp-iconbtn"
              onClick={showNext}
              aria-label="Next standings"
            >
              <ChevronRight size={14} aria-hidden="true" />
            </button>
          </span>
        ) : null}
      </div>
      <table className="sp-tbl">
        <thead>
          <tr>
            {group.standingsShape !== "record" ? <th className="pos">#</th> : null}
            <th className="tm">{label}</th>
            {group.standingsShape === "record" ? (
              <>
                <th>W-L</th>
                <th>{section.rows.some((r) => r.points !== null) ? "Pts" : "Pct"}</th>
              </>
            ) : (
              <th>Pts</th>
            )}
          </tr>
        </thead>
        <tbody>
          {section.rows.map((row) => (
            <tr
              key={row.teamKey}
              className={
                isFollowed(props.followedPairs, group.competitionKey, row.teamKey)
                  ? "is-you"
                  : undefined
              }
            >
              {group.standingsShape !== "record" ? (
                <td className="pos">
                  {row.qualifies ? <span className="sp-tbl__adv" /> : null}
                  {row.rank}
                </td>
              ) : null}
              <td className="tm">
                <span className="nm">{row.name}</span>
              </td>
              {group.standingsShape === "record" ? (
                <>
                  <td>{recordLine(row)}</td>
                  <td>{row.points ?? formatPct(row.winPercent)}</td>
                </>
              ) : (
                <td>{row.points ?? "–"}</td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function recordLine(row: StandingsRow): string {
  return row.draws !== null && row.draws > 0
    ? `${row.wins}-${row.losses}-${row.draws}`
    : `${row.wins}-${row.losses}`;
}

function formatPct(winPercent: number | null): string {
  return winPercent === null ? "–" : winPercent.toFixed(3).replace(/^0/, "");
}

/* ---------------------------------------------------------------- Empty state */

function EmptyState(props: { data: SportsOverviewResponse; followedPairs: ReadonlySet<string> }) {
  const hasSlate =
    props.data.scoreboard.length > 0 ||
    props.data.topStories.length > 0 ||
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
          <div className="sp-body">
            <Scoreboard groups={props.data.scoreboard} followedPairs={props.followedPairs} />
            <TopStoriesRail headlines={props.data.topStories} followedPairs={props.followedPairs} />
          </div>
          <LeagueNewsSection groups={props.data.leagueNews} />
        </div>
      ) : null}
    </>
  );
}
