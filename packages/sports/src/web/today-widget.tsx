import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { FollowedTeamCard } from "@jarv1s/shared";

import { getSportsOverview } from "./sports-client.js";
import { sportsQueryKeys } from "./query-keys.js";
import { hasLiveGame, LIVE_REFETCH_INTERVAL_MS } from "./sports-page.js";
import { useUserLocale } from "./locale.js";
import { CalendarIcon, Crest, FormPips, TrophyIcon } from "./sports-parts.js";
import { NewsIcon } from "./sports-news.js";
import { formatNextMatch } from "./sports-ticker.js";

/**
 * Today "Sports desk" widget (#799 module-web-registry Phase A).
 *
 * Replaces the old hardcoded `SportsDesk` in `apps/web/src/today/today-page.tsx`, which rendered
 * demo/placeholder data from `TodayFeed["sports"]` — dead code, since no caller ever populated
 * that field with real data. This widget instead reuses the same `getSportsOverview()` query
 * (identical `sportsQueryKeys.overview` key, so it shares the React Query cache with the
 * `/sports` page). `FollowedCard` lives here (not on the `/sports` page) because this widget is
 * its only consumer since the ticker refactor (#837). This is a real-data-contract addition, not
 * a byte-identical port — see the design spec's declared screenshot-diff exemption for this
 * widget.
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

/* ---------------------------------------------------------------- Followed card (Today widget) */

function FollowedCard(props: { card: FollowedTeamCard }) {
  const { card } = props;
  const locale = useUserLocale();
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
            {/* Lead story only — the widget card has one news line; the full three-story
                list lives on the sports page ticker (mrb0pk1n). */}
            {card.stories[0] ? (
              <a
                className="sp-fc__newstx"
                href={card.stories[0].url}
                target="_blank"
                rel="noreferrer"
              >
                {card.stories[0].title}
              </a>
            ) : (
              <span className="sp-fc__newstx">No recent news</span>
            )}
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
          <span className="sp-fc__nextmatch">{formatNextMatch(card.nextMatch, locale)}</span>
        </div>
      ) : null}
    </article>
  );
}
