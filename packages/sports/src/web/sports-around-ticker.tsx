import { useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { GameSummary, LocaleSettingsDto, ScoreboardGroup } from "@jarv1s/shared";

import { formatTime, useUserLocale } from "./locale.js";

function scoreLabel(game: GameSummary, locale: LocaleSettingsDto): string {
  if (game.state === "pre") return formatTime(game.startsAt, locale);
  const away = game.away.score ?? 0;
  const home = game.home.score ?? 0;
  return `${game.away.shortName} ${away}–${home} ${game.home.shortName}`;
}

// Second, denser scores strip under the followed-teams ticker: every league's games in one
// horizontally-scrollable row, grouped by competition (#839 task 5). Distinct from the
// chip-filtered <Scoreboard> section below the hero — this is an at-a-glance "everything that's
// on" strip, not a browseable list.
export function AroundLeaguesTicker({ groups }: { readonly groups: readonly ScoreboardGroup[] }) {
  const locale = useUserLocale();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [atStart, setAtStart] = useState(true);
  const [atEnd, setAtEnd] = useState(false);

  if (groups.length === 0) return null;

  function updateEdges(): void {
    const el = scrollRef.current;
    if (!el) return;
    setAtStart(el.scrollLeft <= 1);
    setAtEnd(el.scrollLeft + el.clientWidth >= el.scrollWidth - 1);
  }

  function nudge(direction: -1 | 1): void {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollBy({ left: direction * Math.round(el.clientWidth * 0.8), behavior: "smooth" });
  }

  return (
    <section className="sp-around" aria-label="Scores around the leagues">
      <button
        type="button"
        className="sp-around__nav sp-around__nav--left"
        aria-label="Scroll left"
        hidden={atStart}
        onClick={() => nudge(-1)}
      >
        <ChevronLeft size={16} aria-hidden="true" />
      </button>
      <div
        className="sp-around__scroll"
        ref={scrollRef}
        onScroll={updateEdges}
        tabIndex={0}
        role="group"
      >
        {groups.map((group) => (
          <div className="sp-around__group" key={group.competitionKey}>
            <span className="sp-around__league">{group.competitionLabel}</span>
            {group.games.map((game) => (
              <span className="sp-around__score" key={game.id}>
                {scoreLabel(game, locale)}
              </span>
            ))}
          </div>
        ))}
      </div>
      <button
        type="button"
        className="sp-around__nav sp-around__nav--right"
        aria-label="Scroll right"
        hidden={atEnd}
        onClick={() => nudge(1)}
      >
        <ChevronRight size={16} aria-hidden="true" />
      </button>
    </section>
  );
}
