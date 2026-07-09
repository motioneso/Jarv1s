// Side-effect CSS import so .nw-twlist is styled on /today even when /news was never visited
// (sports' widget gets its CSS transitively by importing from sports-page; this one doesn't).
import "./styles/news-2.css";
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { getNewsOverview } from "./news-client.js";
import { newsQueryKeys } from "./query-keys.js";

const WIDGET_CAP = 4;

/**
 * Today "News desk" widget. Reuses the same `getNewsOverview()` query as the `/news` page
 * (identical `newsQueryKeys.overview` key, so it shares the React Query cache). No polling —
 * headlines move on the server's 10-minute dataset TTL, unlike sports' live scores.
 * Renders nothing until stories exist, so a fresh install's /today stays clean.
 */
export function NewsTodayWidget(): ReactNode {
  const overviewQuery = useQuery({
    queryKey: newsQueryKeys.overview,
    queryFn: () => getNewsOverview()
  });
  const data = overviewQuery.data;
  if (!data || data.topStories.length === 0) return null;

  return (
    <section className="jds-brief" aria-label="News desk">
      <div className="jds-brief__head">
        <span className="jds-brief__kicker">News desk</span>
      </div>
      <div className="jds-brief__title">Top stories</div>
      <ul className="nw-twlist">
        {data.topStories.slice(0, WIDGET_CAP).map((headline) => (
          <li className="nw-twlist__item" key={headline.id}>
            <a className="nw-twlist__link" href={headline.url} target="_blank" rel="noreferrer">
              <span className="nw-twlist__tag">{headline.sourceLabel}</span>
              <span className="nw-twlist__title">{headline.title}</span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
