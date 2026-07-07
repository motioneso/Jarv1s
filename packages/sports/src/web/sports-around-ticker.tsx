import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { GameSide, GameSummary, LocaleSettingsDto, ScoreboardGroup } from "@jarv1s/shared";

import { LEAGUE_LOGOS, SOCCER_COMPETITIONS } from "./competitions.js";
import { formatTime, useUserLocale } from "./locale.js";

// Marks hide themselves on a broken/missing image so entries degrade to text-only.
function Mark(props: { src: string | null; size: number; className: string }) {
  const [broken, setBroken] = useState(false);
  if (!props.src || broken) return null;
  return (
    <img
      className={props.className}
      src={props.src}
      alt=""
      width={props.size}
      height={props.size}
      loading="lazy"
      onError={() => setBroken(true)}
    />
  );
}

// Crest-only team mark — the full name lives in the game's hover title. Teams without a
// usable crest keep their short name so a score never reads as "? 2–1 ?".
function TeamMark(props: { side: GameSide }) {
  const [broken, setBroken] = useState(false);
  const { side } = props;
  if (!side.crestUrl || broken) {
    return <span className="sp-around__team">{side.shortName}</span>;
  }
  return (
    <img
      className="sp-around__crest"
      src={side.crestUrl}
      alt={side.shortName}
      width={18}
      height={18}
      loading="lazy"
      onError={() => setBroken(true)}
    />
  );
}

function AroundGame(props: { game: GameSummary; soccer: boolean; locale: LocaleSettingsDto }) {
  const { game, soccer, locale } = props;
  const first: GameSide = soccer ? game.home : game.away;
  const second: GameSide = soccer ? game.away : game.home;
  const pre = game.state === "pre";
  const mid = pre ? (soccer ? "v" : "at") : `${first.score ?? "–"}–${second.score ?? "–"}`;
  return (
    <span className="sp-around__game" title={`${first.name} ${mid} ${second.name}`}>
      <TeamMark side={first} />
      <span className="sp-around__mid">{mid}</span>
      <TeamMark side={second} />
      <span className="sp-around__status">
        {pre ? formatTime(game.startsAt, locale) : game.statusDetail}
      </span>
    </span>
  );
}

// Live games lead each league group, then finals, then scheduled — "what's on right now"
// reads before results.
const STATE_ORDER: Record<GameSummary["state"], number> = { live: 0, final: 1, pre: 2 };

function byLiveness(a: GameSummary, b: GameSummary): number {
  return STATE_ORDER[a.state] - STATE_ORDER[b.state];
}

// The server's scoreboard spans two ESPN days (yesterday..today Eastern) so tonight's games
// survive the Eastern-midnight flip — at 9:30 PM Pacific "today" alone is already tomorrow's
// slate. That means this filter can no longer show a feed verbatim; it has to cut the far day.
const NEAR_GAME_WINDOW_MS = 12 * 60 * 60 * 1000;

function startMs(game: GameSummary): number {
  return new Date(game.startsAt).getTime();
}

// A league with anything live shows the current slate: every live game plus whatever else
// starts within NEAR_GAME_WINDOW_MS of now — this morning's finals and tonight's kickoffs,
// but not yesterday's results or tomorrow's schedule from the two-day feed. With nothing
// live the strip shows whichever is closer to now: the most recent results or the next
// kickoffs — not both (live feedback mra4swdr). Distance to a final is measured from its
// start; close enough for "which side of now is this league on".
function nearNow(games: readonly GameSummary[]): GameSummary[] {
  const sorted = [...games].sort(byLiveness);
  const now = Date.now();
  if (sorted.some((g) => g.state === "live")) {
    return sorted.filter(
      (g) => g.state === "live" || Math.abs(startMs(g) - now) <= NEAR_GAME_WINDOW_MS
    );
  }
  const finals = sorted.filter((g) => g.state === "final");
  const pres = sorted.filter((g) => g.state === "pre");
  if (finals.length === 0 || pres.length === 0) return sorted;
  const sincePrev = now - Math.max(...finals.map(startMs));
  const untilNext = Math.min(...pres.map(startMs)) - now;
  return sincePrev <= untilNext ? finals : pres;
}

// Second, denser scores strip under the followed-teams ticker: every league's games in one
// horizontally-scrollable row, grouped by competition (#839). Complements the hero above it —
// this is an at-a-glance "everything that's on" strip, not a browseable list.
export function AroundLeaguesTicker({ groups }: { readonly groups: readonly ScoreboardGroup[] }) {
  const locale = useUserLocale();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [atStart, setAtStart] = useState(true);
  const [atEnd, setAtEnd] = useState(false);

  function updateEdges(): void {
    const el = scrollRef.current;
    if (!el) return;
    setAtStart(el.scrollLeft <= 1);
    setAtEnd(el.scrollLeft + el.clientWidth >= el.scrollWidth - 1);
  }

  // Measure edges on mount and whenever `groups` changes (content can grow/shrink), plus on
  // viewport resize — a wider viewport can turn an overflowing strip into a non-overflowing one.
  // Without this, a strip that never fires `scroll` (content fits, or exactly fits) would render a
  // dead right arrow at rest.
  useEffect(() => {
    updateEdges();
    window.addEventListener("resize", updateEdges);
    return () => window.removeEventListener("resize", updateEdges);
  }, [groups]);

  if (groups.length === 0) return null;

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
        role="region"
        aria-label="All scores, scrollable"
      >
        <span className="sp-around__label">Around the leagues</span>
        {groups.map((group) => (
          <div className="sp-around__group" key={group.competitionKey}>
            <span className="sp-around__league">
              <Mark
                src={LEAGUE_LOGOS[group.competitionKey] ?? null}
                size={16}
                className="sp-around__logo"
              />
              {group.competitionLabel}
            </span>
            {nearNow(group.games).map((game) => (
              <AroundGame
                key={game.id}
                game={game}
                soccer={SOCCER_COMPETITIONS.has(group.competitionKey)}
                locale={locale}
              />
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
