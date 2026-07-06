import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { getSportsOverview } from "./sports-client.js";
import { sportsQueryKeys } from "./query-keys.js";
import { hasLiveGame, FollowedCard, LIVE_REFETCH_INTERVAL_MS } from "./sports-page.js";

/**
 * Today "Sports desk" widget (#799 module-web-registry Phase A).
 *
 * Replaces the old hardcoded `SportsDesk` in `apps/web/src/today/today-page.tsx`, which rendered
 * demo/placeholder data from `TodayFeed["sports"]` — dead code, since no caller ever populated
 * that field with real data. This widget instead reuses the same `getSportsOverview()` query
 * (identical `sportsQueryKeys.overview` key, so it shares the React Query cache with the
 * `/sports` page) and the same `FollowedCard` presentation already used there. This is a
 * real-data-contract addition, not a byte-identical port — see the design spec's declared
 * screenshot-diff exemption for this widget.
 */
export function SportsTodayWidget(): ReactNode {
  const overviewQuery = useQuery({
    queryKey: sportsQueryKeys.overview,
    queryFn: () => getSportsOverview(),
    refetchInterval: (query) => (hasLiveGame(query.state.data) ? LIVE_REFETCH_INTERVAL_MS : false),
    refetchIntervalInBackground: false
  });
  const data = overviewQuery.data;
  if (!data || data.followed.length === 0) return null;

  return (
    <section className="jds-brief" aria-label="Sports desk">
      <div className="jds-brief__head">
        <span className="jds-brief__kicker">Sports desk</span>
      </div>
      <div className="jds-brief__title">Your teams, today</div>
      <div className="sp-fcgrid">
        {data.followed.slice(0, 4).map((card) => (
          <FollowedCard key={`${card.competitionKey}:${card.teamKey}`} card={card} />
        ))}
      </div>
    </section>
  );
}
