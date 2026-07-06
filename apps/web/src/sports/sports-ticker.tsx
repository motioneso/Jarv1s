import type { FollowedLeagueRef, FollowedNextMatch, FollowedTeamCard } from "@jarv1s/shared";
import type { LocaleSettingsDto } from "@jarv1s/shared";

import { formatDate, formatTime, useUserLocale } from "../locale/locale-format.js";
import { Crest, FormPips, LiveDot } from "./sports-parts";
import { NewsIcon } from "./sports-news";

const SETTINGS_HREF = "/settings?section=modules&module=sports";

// "vs Green Bay Packers · Sat, Jul 4 · 3:00 PM" — user's persisted locale + timezone (spec D2).
// Moved from sports-page.tsx with the ticker refactor (#829).
export function formatNextMatch(next: FollowedNextMatch, locale: LocaleSettingsDto): string {
  const at = next.startsAt;
  const date = formatDate(at, locale, { weekday: "short", month: "short", day: "numeric" });
  const time = formatTime(at, locale);
  return `${next.homeAway === "home" ? "vs" : "at"} ${next.opponentName} · ${date} · ${time}`;
}

// Newspaper-style scoreboard strip: league follows lead (kept first-class per #763), then one
// dense block per followed team. Horizontal scroll; tabIndex + role="region" make the overflow
// keyboard-reachable (arrow keys scroll a focused scrollable region).
export function SportsTicker(props: {
  followed: readonly FollowedTeamCard[];
  leagues: readonly FollowedLeagueRef[];
}) {
  if (props.followed.length === 0 && props.leagues.length === 0) return null;
  return (
    <section className="sp-ticker" aria-label="Followed">
      <div
        className="sp-ticker__scroll"
        tabIndex={0}
        role="region"
        aria-label="Followed teams and leagues"
      >
        {props.leagues.length > 0 ? <LeagueBlocks leagues={props.leagues} /> : null}
        {props.followed.map((card) => (
          <TickerTeam key={`${card.competitionKey}:${card.teamKey}`} card={card} />
        ))}
      </div>
      <a className="sp-ticker__manage" href={SETTINGS_HREF}>
        Manage
      </a>
    </section>
  );
}

function LeagueBlocks(props: { leagues: readonly FollowedLeagueRef[] }) {
  const count = props.leagues.length;
  return (
    <div className="sp-tk sp-tk--league">
      <span className="sp-tk__eyebrow">{`Following ${count} league${count === 1 ? "" : "s"}`}</span>
      <div className="sp-tk__leagues">
        {props.leagues.map((league) => (
          <span key={league.competitionKey} className="sp-tk__leaguename">
            {league.competitionLabel}
          </span>
        ))}
      </div>
    </div>
  );
}

function TickerTeam(props: { card: FollowedTeamCard }) {
  const { card } = props;
  const locale = useUserLocale();
  return (
    <article className="sp-tk">
      <div className="sp-tk__hd">
        <Crest name={card.name} crestUrl={card.crestUrl} size="sm" />
        <span className="sp-tk__name">{card.name}</span>
        {card.status === "live" ? (
          <span className="sp-tk__live">
            <LiveDot />
            Live
          </span>
        ) : (
          <span className="sp-tk__status">{card.status}</span>
        )}
      </div>
      <div className="sp-tk__primary">
        {card.status === "news" ? (
          <>
            <span className="sp-tk__newsic">
              <NewsIcon />
            </span>
            {card.news ? (
              <a className="sp-tk__newstx" href={card.news.url} target="_blank" rel="noreferrer">
                {card.news.title}
              </a>
            ) : (
              <span className="sp-tk__newstx">No recent news</span>
            )}
          </>
        ) : (
          <span className="sp-tk__score">{card.primary}</span>
        )}
      </div>
      <div className="sp-tk__meta">
        {card.standing ? <span className="sp-tk__standing">{card.standing}</span> : null}
        <FormPips form={card.form} />
      </div>
      {card.nextMatch ? (
        <div className="sp-tk__next">{formatNextMatch(card.nextMatch, locale)}</div>
      ) : null}
    </article>
  );
}
