import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { getSportsOverview } from "./sports-client.js";
import { sportsQueryKeys } from "./query-keys.js";
import { hasLiveGame, LIVE_REFETCH_INTERVAL_MS } from "./sports-page.js";
import { orderFollowedCards, TickerTeam } from "./sports-ticker.js";

/**
 * Today "Sports desk" widget (#799 module-web-registry Phase A).
 *
 * Reuses the same `getSportsOverview()` query as the `/sports` page (identical
 * `sportsQueryKeys.overview` key, so it shares the React Query cache).
 *
 * The cards ARE the desk page's ticker cards (live feedback mrb4mhxt): the widget's old
 * bespoke FollowedCard had drifted a full redesign behind the desk — status-tag pills the
 * desk cut (mratgoq4), no story thumbnails, bottom-docked form row (superseded by mrawlzb7),
 * raw server order. Rendering `TickerTeam` in a grid keeps both surfaces in lockstep by
 * construction; `.sp-tkgrid` restyles the cards from scroll-strip segments into /today's
 * bordered-card idiom. Same reader-priority order as the desk: live, then in-season, then
 * idle — the widget's 4-card cap should spend itself on teams that matter today.
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
      <div className="sp-tkgrid">
        {orderFollowedCards(data.followed, Date.now())
          .slice(0, 4)
          .map((card) => (
            <TickerTeam key={`${card.competitionKey}:${card.teamKey}`} card={card} />
          ))}
      </div>
    </section>
  );
}
