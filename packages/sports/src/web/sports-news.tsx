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
        <h2 className="sp-hero__headline">
          {headline ? (
            <a className="sp-hero__link" href={headline.url} target="_blank" rel="noreferrer">
              {headline.title}
            </a>
          ) : (
            "No followed game today"
          )}
        </h2>
        {/* Standfirst: the article's summary as a dek under the headline, so the hero reads
            like a front page and not a bare link (live feedback mrawc8ww) */}
        {/* The competition credit line ("NHL") under the dek was cut entirely — headline +
            photo already say what the story is (live feedback mrb0opaa, ends mratrvvg). */}
        {headline?.summary ? <p className="sp-hero__dek">{headline.summary}</p> : null}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------- Latest column */

export function LatestColumn(props: { headlines: readonly Headline[] }) {
  if (props.headlines.length === 0) return null;
  return (
    <section className="sp-latest" aria-label="Latest">
      <p className="sp-col__kicker">Latest</p>
      <ol className="sp-latest__list">
        {props.headlines.slice(0, 6).map((headline) => (
          <li className="sp-latest__item" key={headline.id}>
            <a className="sp-hl" href={headline.url} target="_blank" rel="noreferrer">
              {headline.imageUrl ? (
                <img className="sp-hl__thumb" src={headline.imageUrl} alt="" loading="lazy" />
              ) : (
                <span className="sp-hl__thumb sp-hl__thumb--empty" aria-hidden="true" />
              )}
              <span className="sp-hl__body">
                <span className="sp-hl__comp">{headline.competitionLabel}</span>
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

// One league's slice of the band, tiered like a newspaper section (live feedback mrb0wd68 +
// mrb0xwwg): a lead story with art, a couple of short articles (with art when the source has
// it — "more photos"), then the rest grouped as headline-only briefs. Caps keep a busy feed
// from running the section forever; the briefs' links carry the tail.
const SHORTS_PER_SECTION = 2;
const BRIEFS_PER_SECTION = 4;

function NewsSection({ group }: { readonly group: LeagueNewsGroup }) {
  const [leadStory, ...rest] = group.headlines;
  if (!leadStory) return null;
  const shorts = rest.slice(0, SHORTS_PER_SECTION);
  const briefs = rest.slice(SHORTS_PER_SECTION, SHORTS_PER_SECTION + BRIEFS_PER_SECTION);
  return (
    <section className="sp-newsband__col" aria-label={`${group.competitionLabel} news`}>
      <h3 className="sp-newsband__section">{group.competitionLabel}</h3>
      <NewsArticle headline={leadStory} lead />
      {shorts.map((h) => (
        <NewsArticle key={h.id} headline={h} />
      ))}
      {briefs.length > 0 ? (
        <div className="sp-newsband__briefs">
          <p className="sp-newsband__briefslabel">In brief</p>
          <ul className="sp-newsband__brieflist">
            {briefs.map((h) => (
              <li className="sp-newsband__brief" key={h.id}>
                <a className="sp-newsband__brieflink" href={h.url} target="_blank" rel="noreferrer">
                  {h.title}
                </a>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

// Short articles keep their continue-reading link — the newspaper FEEL comes from the tiering
// and column rules, not from cutting the way out to the full story (mrb0wd68).
function NewsArticle({ headline, lead = false }: { readonly headline: Headline; lead?: boolean }) {
  return (
    <article className={lead ? "sp-newsband__art sp-newsband__art--lead" : "sp-newsband__art"}>
      {headline.imageUrl ? (
        <img className="sp-newsband__img" src={headline.imageUrl} alt="" loading="lazy" />
      ) : null}
      <h4 className="sp-newsband__title">{headline.title}</h4>
      {headline.summary ? <p className="sp-newsband__blurb">{headline.summary}</p> : null}
      <a className="sp-newsband__more" href={headline.url} target="_blank" rel="noreferrer">
        Continue reading →
      </a>
    </article>
  );
}

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
      {/* One column per league, separated by newspaper column rules (mrb0wd68); the flat
          all-equal card grid this replaces read as a widget wall, not a news section. */}
      <div className="sp-newsband__cols">
        {shown.map((group) => (
          <NewsSection key={group.competitionKey} group={group} />
        ))}
      </div>
    </section>
  );
}
