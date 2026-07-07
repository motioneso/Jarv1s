import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { FollowedNextMatch, FollowedTeamCard } from "@jarv1s/shared";
import type { LocaleSettingsDto } from "@jarv1s/shared";

import { TOURNAMENT_COMPETITIONS } from "./competitions.js";
import { formatDate, formatTime, useUserLocale } from "./locale.js";
import { Crest, FormPips, LiveDot } from "./sports-parts.js";
import { NewsIcon } from "./sports-news.js";

const SETTINGS_HREF = "/settings?section=modules&module=sports";

// Server sends "#0 · -7.5 pts" when ESPN has no real rank/points for a league (MLB GB leaks
// into points) — a nonsense line is worse than none. Also hidden for knockout tournaments,
// where a group-stage standing reads as a league position, and for leagues that aren't in
// progress: "#14 · 0 pts" / "#3 · 0-0" is last season's rank next to a blank record (live
// feedback mra39rlv; the server now nulls these too, this guards the older prod payload).
function standingIsSane(card: FollowedTeamCard): boolean {
  if (!card.standing) return false;
  if (TOURNAMENT_COMPETITIONS.has(card.competitionKey)) return false;
  if (/·\s*(0 pts|0-0)$/.test(card.standing)) return false;
  // Negative-points guard is anchored after the separator: the old bare /-\d/ also matched
  // every W-L record ("#3 · 10-2") and silently hid ALL US-league standings on live data
  // (live feedback mraxrdxr, mraz6m43) — fixtures never caught it because they used the
  // already-fixed "2nd · NFC North" form.
  return !card.standing.startsWith("#0") && !/·\s*-\d/.test(card.standing);
}

// Reader priority (live feedback mra54n4h): live game first, then any team whose season is
// actually in motion — played within the last ten days or plays within the next ten — then the
// idle/off-season rest. Within each tier the freshest news wins (newsRecency); teams with no
// recent story sink to the tier's tail in server order.
const IN_SEASON_WINDOW_MS = 10 * 24 * 60 * 60 * 1000;

function inSeason(card: FollowedTeamCard, now: number): boolean {
  if (card.status === "live" || card.status === "today") return true;
  // Optional-chained reads: the prod API may still serve pre-#845 cards without these fields.
  const last = card.lastMatchAt ? new Date(card.lastMatchAt).getTime() : null;
  if (last !== null && now - last <= IN_SEASON_WINDOW_MS) return true;
  const next = card.nextMatch ? new Date(card.nextMatch.startsAt).getTime() : null;
  return next !== null && next - now <= IN_SEASON_WINDOW_MS;
}

function tickerPriority(card: FollowedTeamCard, now: number): number {
  if (card.status === "live") return 0;
  return inSeason(card, now) ? 1 : 2;
}

// Newest-first news timestamp; teams without a story rank behind any team that has one.
// stories arrive newest-first from the service, so [0] is the freshest.
function newsRecency(card: FollowedTeamCard): number {
  const newest = card.stories[0];
  return newest ? new Date(newest.publishedAt).getTime() : Number.NEGATIVE_INFINITY;
}

// "vs Green Bay Packers" + "Sat, Jul 4 · 3:00 PM" — user's persisted locale + timezone (spec D2).
// Split so the ticker can stack opponent and kickoff on their own lines (live feedback mra387k7);
// formatNextMatch keeps the one-line form for the Today widget's FollowedCard.
export function nextMatchParts(
  next: FollowedNextMatch,
  locale: LocaleSettingsDto
): { opponent: string; when: string } {
  const at = next.startsAt;
  const date = formatDate(at, locale, { weekday: "short", month: "short", day: "numeric" });
  const time = formatTime(at, locale);
  return {
    opponent: `${next.homeAway === "home" ? "vs" : "at"} ${next.opponentName}`,
    when: `${date} · ${time}`
  };
}

export function formatNextMatch(next: FollowedNextMatch, locale: LocaleSettingsDto): string {
  const parts = nextMatchParts(next, locale);
  return `${parts.opponent} · ${parts.when}`;
}

// Newspaper-style scoreboard strip: one dense block per followed team. Horizontal scroll;
// tabIndex + role="region" make the overflow keyboard-reachable (arrow keys scroll a focused
// scrollable region). Whole-league follows no longer render a block here (header redesign
// pass) — the league-grouped sections below already carry them. Team stories now arrive on
// the card itself (card.stories, mrb0pk1n), so the old headlines prop + client-side
// title-matching are gone: the service's teamKeys tagging is the one source of truth.
export function SportsTicker(props: { followed: readonly FollowedTeamCard[] }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [atStart, setAtStart] = useState(true);
  const [atEnd, setAtEnd] = useState(false);

  function updateEdges(): void {
    const el = scrollRef.current;
    if (!el) return;
    setAtStart(el.scrollLeft <= 1);
    setAtEnd(el.scrollLeft + el.clientWidth >= el.scrollWidth - 1);
  }

  // Re-measure the scroll edges when content or viewport changes, so the arrows only render
  // when there is actually somewhere to scroll.
  useEffect(() => {
    updateEdges();
    window.addEventListener("resize", updateEdges);
    return () => window.removeEventListener("resize", updateEdges);
  }, [props.followed]);

  if (props.followed.length === 0) return null;
  const now = Date.now();
  const ordered = [...props.followed].sort(
    (a, b) => tickerPriority(a, now) - tickerPriority(b, now) || newsRecency(b) - newsRecency(a)
  );

  function nudge(direction: -1 | 1): void {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollBy({ left: direction * Math.round(el.clientWidth * 0.8), behavior: "smooth" });
  }

  return (
    <section className="sp-ticker" aria-label="Followed">
      <div className="sp-ticker__hd">
        <span className="sp-ticker__kicker">Followed</span>
        <a className="sp-ticker__manage" href={SETTINGS_HREF}>
          Manage
        </a>
      </div>
      <div className="sp-ticker__row">
        <button
          type="button"
          className="sp-ticker__nav"
          aria-label="Scroll left"
          hidden={atStart}
          onClick={() => nudge(-1)}
        >
          <ChevronLeft size={16} aria-hidden="true" />
        </button>
        <div
          className="sp-ticker__scroll"
          ref={scrollRef}
          onScroll={updateEdges}
          tabIndex={0}
          role="region"
          aria-label="Followed teams"
        >
          {ordered.map((card) => (
            <TickerTeam key={`${card.competitionKey}:${card.teamKey}`} card={card} />
          ))}
        </div>
        <button
          type="button"
          className="sp-ticker__nav"
          aria-label="Scroll right"
          hidden={atEnd}
          onClick={() => nudge(1)}
        >
          <ChevronRight size={16} aria-hidden="true" />
        </button>
      </div>
    </section>
  );
}

function TickerTeam(props: { card: FollowedTeamCard }) {
  const { card } = props;
  // Pre-game today cards drop the matchup line (the Next footer already names the fixture,
  // mrawrk0e) — but blanking the whole primary slot left those cards a hollow void next to
  // their news-status neighbors (top-area feedback 2026-07-07). Only the matchup text was
  // redundant; fill the slot with news instead so every non-score card shares one anatomy.
  const showNews =
    card.status === "news" || (card.status === "today" && card.todayGameState !== "final");
  // Lead story owns the primary slot (thumbnail + title); the rest are the small text links
  // below — up to three total per club (live feedback mrb0pk1n). "No recent news" only shows
  // when the club truly has no stories (mrathm2y).
  const lead = card.stories[0] ?? null;
  const stories = card.stories.slice(1);
  // The card used to open with a competition/status eyebrow row ("MLB · today") — cut per
  // live feedback mratgoq4; it repeated info the content below already carries. Only the
  // live signal survives, folded into the header row so a game in progress still reads.
  return (
    <article className="sp-tk">
      <header className="sp-tk__head">
        <div className="sp-tk__hd">
          <Crest name={card.name} crestUrl={card.crestUrl} size="sm" />
          <span className="sp-tk__name">{card.name}</span>
          {card.status === "live" ? (
            <span className="sp-tk__live">
              <LiveDot />
              Live
            </span>
          ) : null}
        </div>
        {/* Standing + form live directly under the team name, above the header rule — they
            identify the team's season, so they belong with the identity block, not docked at
            the card base (live feedback mrawlzb7, supersedes the mrawcw2y bottom-docking) */}
        {standingIsSane(card) || card.form.length > 0 ? (
          <div className="sp-tk__sub">
            {standingIsSane(card) ? <span className="sp-tk__standing">{card.standing}</span> : null}
            <FormPips form={card.form} />
          </div>
        ) : null}
      </header>
      {/* Pre-game today matchups don't repeat the fixture here (the Next footer carries it,
          mrawrk0e) — the slot shows news instead of going blank (top-area feedback
          2026-07-07); a finished or in-progress game's score still owns it. */}
      <div className="sp-tk__primary">
        {showNews ? (
          <>
            {/* Headline art as a small thumb when ESPN provides it (live feedback mra5xnt2);
                the generic news glyph is the artless fallback. alt="" — the linked title
                right next to it already names the story. */}
            {lead?.imageUrl ? (
              <img className="sp-tk__thumb" src={lead.imageUrl} alt="" loading="lazy" />
            ) : (
              <span className="sp-tk__newsic">
                <NewsIcon />
              </span>
            )}
            {lead ? (
              <a className="sp-tk__newstx" href={lead.url} target="_blank" rel="noreferrer">
                {lead.title}
              </a>
            ) : (
              <span className="sp-tk__newstx">No recent news</span>
            )}
          </>
        ) : (
          // Matchup lines ("Blue Jays @ Giants") get body type and wrap; score lines stay mono.
          // "· Scheduled" is server noise; the kickoff time lives in the Next footer below
          // (live feedback mrawhf6q), not appended here.
          <span className={/\d/.test(card.primary) ? "sp-tk__score" : "sp-tk__matchup"}>
            {card.primary.replace(/\s*·\s*Scheduled$/i, "")}
          </span>
        )}
      </div>
      {stories.length > 0 ? (
        <ul className="sp-tk__stories">
          {/* FollowedTeamNews carries no id — the url is the stable identity (service dedups by it) */}
          {stories.map((story) => (
            <li key={story.url}>
              <a className="sp-tk__storylink" href={story.url} target="_blank" rel="noreferrer">
                {story.title}
              </a>
            </li>
          ))}
        </ul>
      ) : null}
      {/* Next-game footer: opponent crest stands in for the "Next" label + name text
          (live feedback mrawvc48) — the logo identifies the opponent at a glance; the
          full name stays for screen readers inside NextMatchLines. Hidden while the team
          is live: the in-progress score owns the card until the game ends (mrawrk0e).
          Today games use this same slot with "Today" standing in for the date (mrawhf6q). */}
      {card.nextMatch && card.status !== "live" ? (
        <div className="sp-tk__next">
          <Crest
            name={card.nextMatch.opponentName}
            crestUrl={card.nextMatch.opponentCrestUrl ?? null}
            size="sm"
          />
          <NextMatchLines next={card.nextMatch} today={card.status === "today"} />
        </div>
      ) : null}
    </article>
  );
}

// The opponent crest next door carries the identity visually (live feedback mrawvc48 —
// supersedes the visible "vs Green Bay Packers" line from mra387k7), so the name text is
// sr-only: sighted users see logo + kickoff, screen readers still hear "vs Green Bay
// Packers". For a game later today the date is dead weight — "Today" reads faster than
// "Tue, Jul 7" (live feedback mrawhf6q).
function NextMatchLines(props: { next: FollowedNextMatch; today?: boolean }) {
  const locale = useUserLocale();
  const { opponent, when } = nextMatchParts(props.next, locale);
  return (
    <span className="sp-tk__nextline">
      <span className="sp-sronly">{opponent}</span>
      <span className="sp-tk__nextwhen">
        {props.today ? `Today · ${formatTime(props.next.startsAt, locale)}` : when}
      </span>
    </span>
  );
}
