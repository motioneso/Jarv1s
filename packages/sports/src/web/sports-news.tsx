import { useState, type ReactNode } from "react";
import type { Headline, LeagueNewsGroup } from "@jarv1s/shared";

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
      </div>
    </section>
  );
}

/* ------------------------------------------------------------- Latest column */

export function LatestColumn(props: {
  headlines: readonly Headline[];
  followedPairs: ReadonlySet<string>;
}) {
  if (props.headlines.length === 0) return null;
  return (
    <section className="sp-latest" aria-label="Latest">
      <p className="sp-col__kicker">Latest</p>
      <ol className="sp-latest__list">
        {props.headlines.slice(0, 6).map((headline, index) => (
          <li className="sp-latest__item" key={headline.id}>
            <a className="sp-hl" href={headline.url} target="_blank" rel="noreferrer">
              <span className="sp-hl__num">{index + 1}</span>
              {headline.imageUrl ? (
                <img className="sp-hl__thumb" src={headline.imageUrl} alt="" loading="lazy" />
              ) : (
                <span className="sp-hl__thumb sp-hl__thumb--empty" aria-hidden="true" />
              )}
              <span className="sp-hl__body">
                <span className="sp-hl__comp">{headline.competitionLabel}</span>
                {headline.teamKeys.some((k) =>
                  isFollowed(props.followedPairs, headline.competitionKey, k)
                ) ? (
                  <span className="sp-hl__you">
                    <span className="d" />
                    You
                  </span>
                ) : null}
                <span className="sp-hl__title">{headline.title}</span>
              </span>
            </a>
          </li>
        ))}
      </ol>
    </section>
  );
}

/* ----------------------------------------------------------------- News band */

export function NewsBand({ groups }: { readonly groups: readonly LeagueNewsGroup[] }) {
  const [filterKey, setFilterKey] = useState<string>("all");
  if (groups.length === 0) return null;
  const shown = filterKey === "all" ? groups : groups.filter((g) => g.competitionKey === filterKey);

  return (
    <section className="sp-newsband" aria-label="League news">
      <div className="sp-newsband__head">
        <p className="sp-col__kicker">News</p>
        <select
          className="sp-newsband__filter"
          aria-label="Filter news by league"
          value={filterKey}
          onChange={(event) => setFilterKey(event.currentTarget.value)}
        >
          <option value="all">All leagues</option>
          {groups.map((group) => (
            <option key={group.competitionKey} value={group.competitionKey}>
              {group.competitionLabel}
            </option>
          ))}
        </select>
      </div>
      <div className="sp-newsband__grid">
        {shown.flatMap((group) =>
          group.headlines.map((headline, index) => (
            <article className="sp-newsband__card" key={`${group.competitionKey}:${headline.id}`}>
              {index === 0 && headline.imageUrl ? (
                <img className="sp-newsband__img" src={headline.imageUrl} alt="" loading="lazy" />
              ) : null}
              <span className="sp-hl__comp">{group.competitionLabel}</span>
              <h3 className="sp-newsband__title">{headline.title}</h3>
              {headline.summary ? <p className="sp-newsband__blurb">{headline.summary}</p> : null}
              <a className="sp-newsband__more" href={headline.url} target="_blank" rel="noreferrer">
                Continue reading →
              </a>
            </article>
          ))
        )}
      </div>
    </section>
  );
}
