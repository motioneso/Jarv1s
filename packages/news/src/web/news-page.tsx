import "./styles/news-1.css";
import "./styles/news-2.css";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Newspaper } from "lucide-react";
import { NEWS_TOPIC_KEYS } from "@jarv1s/shared";
import type { NewsHeadline, NewsOverviewResponse, NewsTopicKey } from "@jarv1s/shared";

import { getNewsOverview } from "./news-client.js";
import { newsQueryKeys } from "./query-keys.js";
import { HeroCarousel, NewsMosaic, SourceRail, interleaveGroups } from "./news-mosaic.js";

const SETTINGS_HREF = "/settings?section=modules&module=news";

type TopicFilter = NewsTopicKey | "all";

function matchesTopic(headline: NewsHeadline, filter: TopicFilter): boolean {
  return filter === "all" || headline.topicKey === filter;
}

export function NewsPage() {
  const overviewQuery = useQuery({
    queryKey: newsQueryKeys.overview,
    queryFn: () => getNewsOverview()
    // No refetch interval: feeds move on the server's 10-minute dataset TTL, so polling
    // faster than that only re-reads the cache. Default window-focus refetch is enough.
  });
  const data = overviewQuery.data;
  const [topicFilter, setTopicFilter] = useState<TopicFilter>("all");

  if (!data) {
    return (
      <div className="nw-wrap">
        <Masthead activeTopics={[]} filter="all" onFilter={setTopicFilter} />
        {overviewQuery.isError ? (
          <p className="nw-lede" role="status">
            News is unavailable right now.
          </p>
        ) : (
          <NewsSkeleton />
        )}
      </div>
    );
  }

  const hasStories = data.sourceGroups.length > 0 || data.topStories.length > 0;
  // The wire type for activeTopics is string[] (JSON schema output); narrow it once at the
  // boundary so the masthead's label lookup stays keyed by NewsTopicKey.
  const activeTopics = data.activeTopics.filter((topic): topic is NewsTopicKey =>
    (NEWS_TOPIC_KEYS as readonly string[]).includes(topic)
  );
  // The chip row only offers topics the user actually follows — in top-front-page mode every
  // headline's topicKey is null, so topic chips would filter everything out and lie.
  const filter: TopicFilter = activeTopics.includes(topicFilter as NewsTopicKey)
    ? topicFilter
    : "all";

  const topStories = data.topStories.filter((h) => matchesTopic(h, filter));
  const groups = data.sourceGroups
    .map((group) => ({
      ...group,
      headlines: group.headlines.filter((h) => matchesTopic(h, filter))
    }))
    .filter((group) => group.headlines.length > 0);
  // The mosaic pool excludes the carousel's slides so no story renders twice on one page.
  const carouselIds = new Set(topStories.slice(0, 5).map((h) => h.id));
  const pool = interleaveGroups(groups).filter((h) => !carouselIds.has(h.id));

  return (
    <div className="nw-wrap">
      <Masthead activeTopics={activeTopics} filter={filter} onFilter={setTopicFilter} />
      {hasStories ? (
        <>
          <HeroCarousel headlines={topStories} />
          <div className="nw-grid">
            <div className="nw-grid__main">
              <NewsMosaic pool={pool} />
            </div>
            <aside className="nw-grid__rail">
              <SourceRail groups={groups} />
            </aside>
          </div>
          {data.degraded ? (
            <p className="nw-degraded" role="status">
              Some sources didn&rsquo;t respond just now — this front page may be incomplete.
            </p>
          ) : null}
        </>
      ) : (
        <EmptyState data={data} />
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- Masthead */

// Broadsheet masthead in the sports idiom (hairline-boxed section bar) — but where sports'
// nav is an inert preview, these chips are functional topic filters over the loaded page.
// "All" + one chip per followed topic; hidden entirely in top-front-page mode (no topics).
function Masthead(props: {
  activeTopics: readonly NewsTopicKey[];
  filter: TopicFilter;
  onFilter: (filter: TopicFilter) => void;
}) {
  const labels: Record<NewsTopicKey, string> = {
    world: "World",
    us: "U.S.",
    politics: "Politics",
    business: "Business",
    technology: "Technology",
    science: "Science",
    health: "Health",
    culture: "Culture"
  };
  return (
    <header className="nw-mast">
      {props.activeTopics.length > 0 ? (
        <nav className="nw-mast__nav" aria-label="Filter by topic">
          <button
            type="button"
            className="nw-mast__chip"
            aria-pressed={props.filter === "all"}
            onClick={() => props.onFilter("all")}
          >
            All
          </button>
          {props.activeTopics.map((topicKey) => (
            <button
              key={topicKey}
              type="button"
              className="nw-mast__chip"
              aria-pressed={props.filter === topicKey}
              onClick={() => props.onFilter(topicKey)}
            >
              {labels[topicKey]}
            </button>
          ))}
        </nav>
      ) : (
        // Top-front-page mode: no functional chips, so the band carries the section identity
        // instead of sitting empty between its two rules.
        <p className="nw-mast__plate">Front pages from your sources</p>
      )}
    </header>
  );
}

/* ---------------------------------------------------------------- Skeleton */

// Cold-load placeholder matching the shapes it stands in for (hero, then grid) so nothing
// jumps around once real data lands — same idiom as sports' skeleton.
function NewsSkeleton() {
  return (
    <div className="nw-skeleton" role="status" aria-label="Loading news">
      <div className="nw-skel nw-skel--hero" aria-hidden="true" />
      <div className="nw-skel nw-skel--grid" aria-hidden="true" />
    </div>
  );
}

/* ---------------------------------------------------------------- Empty state */

function EmptyState({ data }: { readonly data: NewsOverviewResponse }) {
  const noSources = data.enabledSources.length === 0;
  return (
    <section className="nw-empty" aria-label="No news to show">
      <div className="nw-empty__inner">
        <span className="nw-empty__mark">
          <Newspaper size={28} aria-hidden="true" />
        </span>
        <h2 className="nw-empty__title">
          {noSources ? "Choose your sources" : "Nothing on the wire"}
        </h2>
        <p className="nw-empty__lede">
          {noSources
            ? "Pick the publications and topics you care about — this page becomes their combined front page."
            : "Your sources didn't return any stories just now. Check back shortly, or adjust your sources and topics."}
        </p>
        <a className="nw-empty__btn" href={SETTINGS_HREF}>
          Choose sources
        </a>
      </div>
    </section>
  );
}
