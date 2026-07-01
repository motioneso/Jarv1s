import "../styles/sports-1.css";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type {
  FollowedTeamCard,
  GameSide,
  GameSummary,
  Headline,
  OverviewHero,
  ScoreboardGroup,
  SportsOverviewResponse,
  StandingsGroup
} from "@jarv1s/shared";

import { getSportsOverview } from "../api/sports-client";
import { queryKeys } from "../api/query-keys";
import {
  CalendarIcon,
  Crest,
  FormPips,
  LiveDot,
  NewsIcon,
  RationaleChip,
  TrophyIcon
} from "./sports-parts";

const SETTINGS_HREF = "/settings/modules/sports";

export function SportsPage() {
  const overviewQuery = useQuery({
    queryKey: queryKeys.sports.overview,
    queryFn: () => getSportsOverview()
  });
  const data = overviewQuery.data;

  const followedKeys = useMemo(
    () => new Set(data?.followedTeamKeys ?? []),
    [data?.followedTeamKeys]
  );

  if (!data) {
    return (
      <div className="sp-wrap">
        <PageHeader degraded={false} />
        <p className="sp-lede" role="status">
          {overviewQuery.isError ? "Sports are unavailable right now." : "Loading your teams…"}
        </p>
      </div>
    );
  }

  const hasFollows = data.followed.length > 0;

  return (
    <div className="sp-wrap">
      <PageHeader degraded={data.degraded} />

      {hasFollows ? (
        <>
          <Hero hero={data.hero} />
          <FollowedSection followed={data.followed} />
          <SplitSection data={data} followedKeys={followedKeys} />
        </>
      ) : (
        <EmptyState data={data} followedKeys={followedKeys} />
      )}
    </div>
  );
}

function PageHeader(props: { degraded: boolean }) {
  return (
    <header className="sp-top">
      <div className="sp-top__main">
        <div className="sp-kicker">
          <LiveDot />
          Sports
        </div>
        <h1 className="sp-title">Followed</h1>
        <p className="sp-lede">
          Your teams first — latest results and what&rsquo;s next — then the wider slate and the
          headlines that matter.
        </p>
      </div>
      <div className="sp-top__aside">
        <div className="sp-preview">
          <span className="sp-preview__lbl">{props.degraded ? "Cached" : "Live"}</span>
        </div>
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

function StoryHero(props: { headline: Headline | null }) {
  return (
    <section className="sp-hero sp-hero--story sp-hero--split" aria-label="Top story">
      <div className="sp-photo sp-photo--herostory">
        <span className="sp-photo__cap">Editorial photo</span>
      </div>
      <div className="sp-hero__storybody">
        <span className="sp-hero__comp">
          {props.headline ? props.headline.competitionKey.toUpperCase() : "Sports"}
        </span>
        <h2 className="sp-hero__headline">
          {props.headline ? props.headline.title : "No followed game today"}
        </h2>
        <p className="sp-hero__dek">
          No followed team is playing right now — here&rsquo;s the story worth reading, with scores
          and headlines below.
        </p>
      </div>
    </section>
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
            <span className="sp-fc__newstx">{card.primary}</span>
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
          <span className="sp-fc__nextmatch">{card.nextMatch}</span>
        </div>
      ) : null}
    </article>
  );
}

/* ---------------------------------------------------------------- Split: scores + rail */

function SplitSection(props: { data: SportsOverviewResponse; followedKeys: ReadonlySet<string> }) {
  return (
    <div className="sp-split">
      <div className="sp-body">
        <Scoreboard groups={props.data.scoreboard} followedKeys={props.followedKeys} />
      </div>
      <div className="sp-railcol">
        <HeadlinesRail headlines={props.data.headlines} followed={props.data.followed} />
        <StandingsRail groups={props.data.standings} followedKeys={props.followedKeys} />
      </div>
    </div>
  );
}

function Scoreboard(props: {
  groups: readonly ScoreboardGroup[];
  followedKeys: ReadonlySet<string>;
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
                <GameRow key={game.id} game={game} followedKeys={props.followedKeys} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function GameRow(props: { game: GameSummary; followedKeys: ReadonlySet<string> }) {
  const { game } = props;
  const mine =
    props.followedKeys.has(game.home.teamKey) || props.followedKeys.has(game.away.teamKey);
  return (
    <div className={`sp-game${mine ? " sp-game--you" : ""}`}>
      <div className="sp-game__sides">
        <GameSideRow side={game.away} followedKeys={props.followedKeys} />
        <GameSideRow side={game.home} followedKeys={props.followedKeys} />
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

function GameSideRow(props: { side: GameSide; followedKeys: ReadonlySet<string> }) {
  const mine = props.followedKeys.has(props.side.teamKey);
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

function HeadlinesRail(props: {
  headlines: readonly Headline[];
  followed: readonly FollowedTeamCard[];
}) {
  const youComps = useMemo(
    () => new Set(props.followed.map((card) => card.competitionKey)),
    [props.followed]
  );
  if (props.headlines.length === 0) return null;
  return (
    <section className="sp-rail" aria-label="Headlines">
      <div className="sp-rail__hd">
        <NewsIcon />
        Headlines
      </div>
      <div className="sp-rail__list">
        {props.headlines.map((headline) => (
          <a
            key={headline.id}
            className="sp-hl"
            href={headline.url}
            target="_blank"
            rel="noreferrer"
          >
            <div className="sp-hl__top">
              <span className="sp-hl__comp">{headline.competitionKey.toUpperCase()}</span>
              {youComps.has(headline.competitionKey) ? (
                <span className="sp-hl__you">
                  <span className="d" />
                  You
                </span>
              ) : null}
            </div>
            <div className="sp-hl__title">{headline.title}</div>
          </a>
        ))}
      </div>
    </section>
  );
}

function StandingsRail(props: {
  groups: readonly StandingsGroup[];
  followedKeys: ReadonlySet<string>;
}) {
  const [tab, setTab] = useState(0);
  const group = props.groups[Math.min(tab, props.groups.length - 1)];
  if (!group) return null;
  return (
    <section className="sp-standings" aria-label="Standings">
      <div className="sp-standings__hd">
        <TrophyIcon />
        Standings
      </div>
      {props.groups.length > 1 ? (
        <div className="sp-standings__tabs">
          {props.groups.map((candidate, index) => (
            <button
              key={candidate.competitionKey}
              type="button"
              className={`sp-stab${index === tab ? " is-on" : ""}`}
              onClick={() => setTab(index)}
            >
              {candidate.competitionLabel}
            </button>
          ))}
        </div>
      ) : null}
      <table className="sp-tbl">
        <thead>
          <tr>
            <th className="pos">#</th>
            <th className="tm">{group.competitionLabel}</th>
            <th>P</th>
          </tr>
        </thead>
        <tbody>
          {group.rows.map((row) => (
            <tr
              key={row.teamKey}
              className={props.followedKeys.has(row.teamKey) ? "is-you" : undefined}
            >
              <td className="pos">
                {row.qualifies ? <span className="sp-tbl__adv" /> : null}
                {row.rank}
              </td>
              <td className="tm">
                <span className="nm">{row.name}</span>
              </td>
              <td>{row.points ?? row.wins}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

/* ---------------------------------------------------------------- Empty state */

function EmptyState(props: { data: SportsOverviewResponse; followedKeys: ReadonlySet<string> }) {
  const hasSlate = props.data.scoreboard.length > 0 || props.data.headlines.length > 0;
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
            <Scoreboard groups={props.data.scoreboard} followedKeys={props.followedKeys} />
          </div>
          <div className="sp-railcol">
            <HeadlinesRail headlines={props.data.headlines} followed={props.data.followed} />
          </div>
        </div>
      ) : null}
    </>
  );
}
