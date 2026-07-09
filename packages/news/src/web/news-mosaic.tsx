import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { NewsHeadline, NewsSourceGroup } from "@jarv1s/shared";

import { featureEligible } from "../ranking.js";

/* --------------------------------------------------------------- Pool helpers */

// The mosaic draws on every source group, but a straight concat would let the first source
// monopolize the top of the page. Round-robin interleave (each source's lead, then each
// source's second story, …) keeps the mix broadsheet-honest: the server already ranked each
// group internally, so position i is "the i-th best from that desk". Exported for unit tests.
export function interleaveGroups(groups: readonly NewsSourceGroup[]): NewsHeadline[] {
  const out: NewsHeadline[] = [];
  const deepest = groups.reduce((max, group) => Math.max(max, group.headlines.length), 0);
  for (let i = 0; i < deepest; i += 1) {
    for (const group of groups) {
      const headline = group.headlines[i];
      if (headline) out.push(headline);
    }
  }
  return out;
}

export interface MosaicPlan {
  readonly feature: NewsHeadline | null;
  /** Feature + majors + standards in pool order; majors flagged via `majorIds`. */
  readonly mosaic: readonly NewsHeadline[];
  readonly majorIds: ReadonlySet<string>;
  readonly briefs: readonly NewsHeadline[];
}

// Mosaic caps (spec "Page layout"): the feature breaks out full-width, two art-required
// majors take double columns, six standards fill the grid, and the tail collapses into a
// single "In brief" list so a busy day widens the tail instead of running the grid forever.
const MAJORS_CAP = 2;
const STANDARDS_CAP = 6;
const BRIEFS_CAP = 10;

// Pure tiering over an already-ordered pool (exported for unit tests). Majors need art —
// a double-column slot with no image is just a wide gap; the feature additionally needs a
// dek (featureEligible) to carry the top of the page.
export function composeMosaic(pool: readonly NewsHeadline[]): MosaicPlan {
  const feature = pool.find(featureEligible) ?? null;
  const rest = pool.filter((headline) => headline !== feature);
  const majorIds = new Set(
    rest
      .filter((headline) => headline.imageUrl)
      .slice(0, MAJORS_CAP)
      .map((headline) => headline.id)
  );
  const flow = rest.filter((headline) => !majorIds.has(headline.id));
  const standards = flow.slice(0, STANDARDS_CAP);
  const mosaicIds = new Set([...majorIds, ...standards.map((headline) => headline.id)]);
  return {
    feature,
    // Pool order preserved across both tiers so the page reads big → small.
    mosaic: rest.filter((headline) => mosaicIds.has(headline.id)),
    majorIds,
    briefs: flow.slice(STANDARDS_CAP, STANDARDS_CAP + BRIEFS_CAP)
  };
}

/* ------------------------------------------------------------- Hero carousel */

// Same rotation idiom as sports' quiet-day hero (packages/sports/src/web/sports-news.tsx):
// five slides max, slow crossfade, hover/focus pauses, reduced motion disables auto-advance.
const CAROUSEL_CAP = 5;
const CAROUSEL_ADVANCE_MS = 7000;

function kicker(headline: NewsHeadline): string {
  return headline.topicLabel
    ? `${headline.sourceLabel} · ${headline.topicLabel}`
    : headline.sourceLabel;
}

function HeroSlide({ headline, active }: { readonly headline: NewsHeadline; active: boolean }) {
  return (
    <article
      className={active ? "nw-carousel__slide nw-carousel__slide--active" : "nw-carousel__slide"}
      role="group"
      aria-roledescription="slide"
      aria-hidden={!active}
    >
      <div className="nw-hero">
        {headline.imageUrl ? (
          <img className="nw-hero__photo" src={headline.imageUrl} alt="" loading="lazy" />
        ) : (
          <div className="nw-hero__photo nw-hero__photo--empty" aria-hidden="true" />
        )}
        <div className="nw-hero__body">
          <p className="nw-hero__kicker">
            <span className="nw-hero__kicker-desk">Top story</span>
            <span className="nw-hero__kicker-src">{kicker(headline)}</span>
          </p>
          <h2 className="nw-hero__headline">
            {/* Inactive slides stay in the DOM for the crossfade but must not be tab stops */}
            <a
              className="nw-hero__link"
              href={headline.url}
              target="_blank"
              rel="noreferrer"
              tabIndex={active ? undefined : -1}
            >
              {headline.title}
            </a>
          </h2>
          {headline.summary ? <p className="nw-hero__dek">{headline.summary}</p> : null}
          <a
            className="nw-more"
            href={headline.url}
            target="_blank"
            rel="noreferrer"
            tabIndex={active ? undefined : -1}
          >
            Continue reading<span aria-hidden="true"> →</span>
          </a>
        </div>
      </div>
    </article>
  );
}

export function HeroCarousel({ headlines }: { readonly headlines: readonly NewsHeadline[] }) {
  const slides = headlines.slice(0, CAROUSEL_CAP);
  const count = slides.length;
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  // A refetch can shrink the pool while we're pointing past its end — clamp, don't crash.
  const active = Math.min(index, Math.max(count - 1, 0));

  useEffect(() => {
    if (paused || count < 2) return;
    // matchMedia in an effect, not render: SSR has no window, and this respects a user
    // flipping the OS setting mid-session on the next slide change.
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = window.setInterval(
      () => setIndex((current) => (current + 1) % count),
      CAROUSEL_ADVANCE_MS
    );
    return () => window.clearInterval(timer);
  }, [paused, count]);

  if (count === 0) return null;

  return (
    <section
      className="nw-carousel"
      aria-label="Top stories"
      aria-roledescription="carousel"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      {/* All slides render stacked in one grid cell (CSS) so the stage holds the tallest
          slide's height — no reflow jump between a dek-heavy story and a bare headline. */}
      <div className="nw-carousel__stage">
        {slides.map((headline, i) => (
          <HeroSlide key={headline.id} headline={headline} active={i === active} />
        ))}
      </div>
      {count > 1 ? (
        <div className="nw-carousel__ctl">
          <button
            type="button"
            className="nw-carousel__nav"
            aria-label="Previous story"
            onClick={() => setIndex((active - 1 + count) % count)}
          >
            <ChevronLeft size={16} aria-hidden="true" />
          </button>
          <div className="nw-carousel__dots">
            {slides.map((headline, i) => (
              <button
                key={headline.id}
                type="button"
                className="nw-carousel__dot"
                aria-label={`Story ${i + 1} of ${count}`}
                aria-current={i === active || undefined}
                onClick={() => setIndex(i)}
              />
            ))}
          </div>
          <button
            type="button"
            className="nw-carousel__nav"
            aria-label="Next story"
            onClick={() => setIndex((active + 1) % count)}
          >
            <ChevronRight size={16} aria-hidden="true" />
          </button>
        </div>
      ) : null}
    </section>
  );
}

/* -------------------------------------------------------------------- Mosaic */

function MosaicArticle({
  headline,
  major = false
}: {
  readonly headline: NewsHeadline;
  major?: boolean;
}) {
  return (
    <article className={major ? "nw-mosaic__art nw-mosaic__art--major" : "nw-mosaic__art"}>
      {headline.imageUrl ? (
        <img className="nw-mosaic__img" src={headline.imageUrl} alt="" loading="lazy" />
      ) : null}
      <p className="nw-mosaic__artkicker">{kicker(headline)}</p>
      <h4 className="nw-mosaic__title">{headline.title}</h4>
      {headline.summary ? <p className="nw-mosaic__blurb">{headline.summary}</p> : null}
      <a className="nw-more" href={headline.url} target="_blank" rel="noreferrer">
        Continue reading →
      </a>
    </article>
  );
}

function FeatureArticle({ headline }: { readonly headline: NewsHeadline }) {
  return (
    <article className="nw-feature">
      {headline.imageUrl ? (
        <img className="nw-feature__img" src={headline.imageUrl} alt="" loading="lazy" />
      ) : null}
      <div className="nw-feature__body">
        <p className="nw-feature__kicker">{kicker(headline)}</p>
        <h3 className="nw-feature__title">{headline.title}</h3>
        {headline.summary ? <p className="nw-feature__blurb">{headline.summary}</p> : null}
        <a className="nw-more" href={headline.url} target="_blank" rel="noreferrer">
          Continue reading →
        </a>
      </div>
    </article>
  );
}

export function NewsMosaic({ pool }: { readonly pool: readonly NewsHeadline[] }) {
  const plan = composeMosaic(pool);
  if (pool.length === 0) return null;
  return (
    <section className="nw-band" aria-label="Today's stories">
      {plan.feature ? <FeatureArticle headline={plan.feature} /> : null}
      <div className="nw-mosaic">
        {plan.mosaic.map((headline) => (
          <MosaicArticle
            key={headline.id}
            headline={headline}
            major={plan.majorIds.has(headline.id)}
          />
        ))}
      </div>
      {plan.briefs.length > 0 ? (
        <div className="nw-briefs">
          <p className="nw-briefs__label">In brief</p>
          <ul className="nw-briefs__list">
            {plan.briefs.map((headline) => (
              <li className="nw-briefs__item" key={headline.id}>
                <a className="nw-briefs__link" href={headline.url} target="_blank" rel="noreferrer">
                  <span className="nw-briefs__tag">{headline.sourceLabel}</span>
                  {headline.title}
                </a>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

/* --------------------------------------------------------------- Source rail */

const RAIL_ITEMS_CAP = 5;

// Right-rail "From your sources" digest: one block per enabled source, title-only links —
// the by-source complement to the cross-source mosaic (spec "Page layout").
export function SourceRail({ groups }: { readonly groups: readonly NewsSourceGroup[] }) {
  if (groups.length === 0) return null;
  return (
    <section className="nw-rail" aria-label="From your sources">
      <p className="nw-kicker">From your sources</p>
      {groups.map((group) => (
        <div className="nw-rail__group" key={group.sourceKey}>
          <a className="nw-rail__src" href={group.homepageUrl} target="_blank" rel="noreferrer">
            {group.sourceLabel}
          </a>
          <ul className="nw-rail__list">
            {group.headlines.slice(0, RAIL_ITEMS_CAP).map((headline) => (
              <li className="nw-rail__item" key={headline.id}>
                <a className="nw-rail__link" href={headline.url} target="_blank" rel="noreferrer">
                  {headline.title}
                </a>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}
