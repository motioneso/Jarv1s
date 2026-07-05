import type { ReactNode } from "react";
import type { Headline, LeagueNewsGroup } from "@jarv1s/shared";

import { formatDate, useUserLocale } from "../locale/locale-format.js";

export function isFollowed(
  pairs: ReadonlySet<string>,
  competitionKey: string,
  teamKey: string
): boolean {
  return pairs.has(`${competitionKey}:${teamKey}`);
}

export function NewsIcon(): ReactNode {
  return (
    <svg
      viewBox="0 0 24 24"
      width="15"
      height="15"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 5h13v14H4zM17 8h3v9a2 2 0 0 1-2 2h-1M7 8h7M7 12h7M7 16h4" />
    </svg>
  );
}

/* ------------------------------------------------------------- Story hero */

export function StoryHero(props: { headline: Headline | null }) {
  const { headline } = props;
  return (
    <section className="sp-hero sp-hero--story sp-hero--split" aria-label="Top story">
      {headline?.imageUrl ? (
        <img
          className="sp-photo sp-photo--herostory sp-photo--img"
          src={headline.imageUrl}
          alt=""
          loading="lazy"
        />
      ) : (
        <div className="sp-photo sp-photo--herostory" aria-hidden="true" />
      )}
      <div className="sp-hero__storybody">
        <span className="sp-hero__comp">{headline ? headline.competitionLabel : "Sports"}</span>
        <h2 className="sp-hero__headline">
          {headline ? (
            <a className="sp-hero__link" href={headline.url} target="_blank" rel="noreferrer">
              {headline.title}
            </a>
          ) : (
            "No followed game today"
          )}
        </h2>
        <p className="sp-hero__dek">
          No followed team is playing right now — here&rsquo;s the story worth reading, with scores
          and headlines below.
        </p>
      </div>
    </section>
  );
}

/* -------------------------------------------------------- Top stories rail */

export function TopStoriesRail(props: {
  headlines: readonly Headline[];
  followedPairs: ReadonlySet<string>;
}) {
  if (props.headlines.length === 0) return null;
  return (
    <section className="sp-rail" aria-label="Top stories">
      <div className="sp-rail__hd">
        <NewsIcon />
        Top stories
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
              <span className="sp-hl__comp">{headline.competitionLabel}</span>
              {headline.teamKeys.some((k) =>
                isFollowed(props.followedPairs, headline.competitionKey, k)
              ) ? (
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

/* -------------------------------------------------------- League news grid */

export function LeagueNewsSection(props: { groups: readonly LeagueNewsGroup[] }) {
  const locale = useUserLocale();
  if (props.groups.length === 0) return null;
  return (
    <section className="sp-sec" aria-label="League news">
      <div className="sp-sec__head">
        <h2 className="sp-sec__title">League news</h2>
      </div>
      {props.groups.map((group) => (
        <div key={group.competitionKey} className="sp-news__grp">
          <span className="sp-news__comp">{group.competitionLabel}</span>
          <div className="sp-news__grid">
            {group.headlines.map((headline) => (
              <a
                key={headline.id}
                className="sp-news__card"
                href={headline.url}
                target="_blank"
                rel="noreferrer"
              >
                {headline.imageUrl ? (
                  <img className="sp-news__img" src={headline.imageUrl} alt="" loading="lazy" />
                ) : null}
                <span className="sp-news__title">{headline.title}</span>
                <span className="sp-news__date">
                  {formatDate(headline.publishedAt, locale, { month: "short", day: "numeric" })}
                </span>
              </a>
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}
