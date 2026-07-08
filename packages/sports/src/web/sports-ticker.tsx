import {
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent
} from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { FollowedNextMatch, FollowedTeamCard } from "@jarv1s/shared";
import type { LocaleSettingsDto } from "@jarv1s/shared";

import { TOURNAMENT_COMPETITIONS } from "./competitions.js";
import { formatDate, formatTime, useUserLocale } from "./locale.js";
import { Crest, FormPips, LiveDot } from "./sports-parts.js";
import { NewsIcon } from "./sports-news.js";

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

// Reader-priority ordering, shared with the Today widget so both surfaces agree on which
// teams matter right now (live feedback mrb4mhxt — the widget used to show raw server order).
export function orderFollowedCards(
  cards: readonly FollowedTeamCard[],
  now: number
): FollowedTeamCard[] {
  return [...cards].sort(
    (a, b) => tickerPriority(a, now) - tickerPriority(b, now) || newsRecency(b) - newsRecency(a)
  );
}

// "vs Green Bay Packers" + "Sat, Jul 4 · 3:00 PM" — user's persisted locale + timezone (spec D2).
// Split so the ticker can stack opponent and kickoff on their own lines (live feedback mra387k7).
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

// Newspaper-style scoreboard strip: one dense block per followed team. Horizontal scroll;
// tabIndex + role="region" make the overflow keyboard-reachable (arrow keys scroll a focused
// scrollable region). Whole-league follows no longer render a block here (header redesign
// pass) — the league-grouped sections below already carry them. Team stories now arrive on
// the card itself (card.stories, mrb0pk1n), so the old headlines prop + client-side
// title-matching are gone: the service's teamKeys tagging is the one source of truth.
// Settings deep-link for the followed-teams Manage control (Task B / ticker note). Kept as a
// local copy rather than imported from sports-page.tsx to avoid a circular import — sports-page
// imports this module for SportsTicker. Mirror of SETTINGS_HREF there; both target the sports
// module's settings section.
const SETTINGS_HREF = "/settings?section=modules&module=sports";

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
  const ordered = orderFollowedCards(props.followed, Date.now());

  function nudge(direction: -1 | 1): void {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollBy({ left: direction * Math.round(el.clientWidth * 0.8), behavior: "smooth" });
  }

  // Pointer drag-to-scroll (mrb7mwhv): the strip is wide editorial cards now, so click-and-drag
  // is the natural gesture across the row. The arrows STAY (Ben's ask) as the discoverable
  // affordance for anyone who doesn't think to drag. A 4px movement threshold latches `moved`
  // so a drag that ends over a story link doesn't also fire that link's click (onClickCapture
  // swallows it) — dragging never accidentally opens a story. Touch is left to native scroll.
  const dragRef = useRef<{ startX: number; startLeft: number; moved: boolean } | null>(null);

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>): void {
    const el = scrollRef.current;
    if (!el || event.pointerType === "touch") return;
    dragRef.current = { startX: event.clientX, startLeft: el.scrollLeft, moved: false };
  }
  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>): void {
    const el = scrollRef.current;
    const drag = dragRef.current;
    if (!el || !drag) return;
    const dx = event.clientX - drag.startX;
    if (!drag.moved && Math.abs(dx) < 4) return;
    drag.moved = true;
    el.setPointerCapture(event.pointerId);
    el.scrollLeft = drag.startLeft - dx;
  }
  function onPointerEnd(event: ReactPointerEvent<HTMLDivElement>): void {
    const el = scrollRef.current;
    if (el?.hasPointerCapture(event.pointerId)) el.releasePointerCapture(event.pointerId);
    // Clear on the next tick so the click that fires right after pointerup can still read
    // `moved` and be suppressed; a plain click (moved === false) passes through untouched.
    window.setTimeout(() => {
      dragRef.current = null;
    }, 0);
  }
  function onClickCapture(event: ReactMouseEvent<HTMLDivElement>): void {
    if (dragRef.current?.moved) {
      event.preventDefault();
      event.stopPropagation();
    }
  }

  return (
    <section className="sp-ticker" aria-label="Followed">
      {/* Section head (Task B / ticker note, Ben 2026-07-07): labels the band as the followed set
          and carries Manage, both relocated down here from the masthead folio Ben cleared.
          Reverses mrb8sxx6 (head removed) + mrb8p4e2 (Manage lifted up to the folio) — the "my
          teams" strip now owns its own titled head instead of borrowing the masthead's. */}
      <div className="sp-ticker__head">
        <h2 className="sp-ticker__label">Followed teams &amp; leagues</h2>
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
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerEnd}
          onPointerLeave={onPointerEnd}
          onClickCapture={onClickCapture}
          tabIndex={0}
          role="region"
          aria-label="Followed teams"
        >
          {ordered.map((card) => (
            <FeaturedTeamCard key={`${card.competitionKey}:${card.teamKey}`} card={card} />
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

// Desk-strip card (mrb7mwhv): the /sports followed strip deliberately diverges from the
// compact /today widget. Ben wanted far more room per team — "not so compact and busy" — and
// the strip to lead the page, so this is the roomy, image-forward variant: a wide lead-story
// banner, a serif team name at display size, and generous spacing. /today keeps the dense
// TickerTeam below. The team-semantics helpers (standingIsSane, NextMatchLines, Crest/FormPips)
// are shared so the two layouts can't drift on what a team's status/standing means.
function FeaturedTeamCard(props: { card: FollowedTeamCard }) {
  const { card } = props;
  // Same primary-slot rule as TickerTeam: a pre-game/idle card leads with news, a live or
  // finished game leads with its score (the Next footer, not this slot, carries the fixture).
  const showNews =
    card.status === "news" || (card.status === "today" && card.todayGameState !== "final");
  const lead = card.stories[0] ?? null;
  // A score card never spent stories[0] on its headline, so its link list starts at 0; a news
  // card already showed stories[0] as the headline, so its list starts at 1. Cap at two links
  // below the lead — the point of this card is air, not a wall of headlines (mrb7mwhv).
  const secondary = showNews ? card.stories.slice(1, 3) : card.stories.slice(0, 2);
  const isScore = !showNews && /\d/.test(card.primary);

  return (
    <article className="sp-feat">
      {/* Lead-story art is the banner even on score cards — it fills the new width and gives the
          strip the image-forward, editorial feel Ben referenced. Crest plate is the artless
          fallback. alt="" — the headline/name beside it already names the content. The status
          flag overlays the banner's top-left the way a broadcast bug sits on a video frame. */}
      <div className="sp-feat__banner">
        {lead?.imageUrl ? (
          <img className="sp-feat__img" src={lead.imageUrl} alt="" loading="lazy" />
        ) : (
          <span className="sp-feat__plate">
            <Crest name={card.name} crestUrl={card.crestUrl} size="lg" />
          </span>
        )}
        {card.status === "live" ? (
          <span className="sp-feat__flag sp-feat__flag--live">
            <LiveDot />
            Live
          </span>
        ) : card.status === "today" ? (
          <span className="sp-feat__flag sp-feat__flag--today">Today</span>
        ) : null}
      </div>
      <div className="sp-feat__body">
        <div className="sp-feat__idn">
          <Crest name={card.name} crestUrl={card.crestUrl} size="sm" />
          <h3 className="sp-feat__name">{card.name}</h3>
        </div>
        {standingIsSane(card) || card.form.length > 0 ? (
          <div className="sp-feat__sub">
            {standingIsSane(card) ? (
              <span className="sp-feat__standing">{card.standing}</span>
            ) : null}
            <FormPips form={card.form} />
          </div>
        ) : null}
        {/* Headline slot: a live/final score reads as the lede in mono tabular; otherwise the
            lead story headline carries it, set in the desk serif at display size. */}
        {showNews ? (
          lead ? (
            <a className="sp-feat__lead" href={lead.url} target="_blank" rel="noreferrer">
              {lead.title}
            </a>
          ) : (
            // Storyless pre-game/idle card: an honest placeholder, NEVER the matchup — the Next
            // footer already carries the fixture, so echoing card.primary here is the duplication
            // mrawrk0e forbids (the else-branch used to leak it, contradicting this card's own
            // "news-or-score, never matchup" rule). Mirrors TickerTeam's "No recent news" so the
            // /sports strip and the /today widget stay in lockstep (top-area feedback 2026-07-07).
            <span className="sp-feat__lead sp-feat__lead--empty">No recent news</span>
          )
        ) : (
          <p className={isScore ? "sp-feat__score" : "sp-feat__matchup"}>
            {card.primary.replace(/\s*·\s*Scheduled$/i, "")}
          </p>
        )}
        {secondary.length > 0 ? (
          <ul className="sp-feat__stories">
            {secondary.map((story) => (
              <li key={story.url}>
                <a className="sp-feat__storylink" href={story.url} target="_blank" rel="noreferrer">
                  {story.title}
                </a>
              </li>
            ))}
          </ul>
        ) : null}
        {/* Next-game footer stays hidden while a team is live — the in-progress score owns the
            card until full time (mrawrk0e). Today games reuse the slot with "Today" for the
            date (mrawhf6q). */}
        {card.nextMatch && card.status !== "live" ? (
          // Fixture line is a tinted section, colored by venue (mrbaaq24) — green for a home
          // game, blue for away — so a glance down the strip reads which upcoming games are at
          // home. homeAway is "home"|"away", so the modifier resolves to --home/--away.
          <div className={`sp-feat__next sp-feat__next--${card.nextMatch.homeAway}`}>
            <Crest
              name={card.nextMatch.opponentName}
              crestUrl={card.nextMatch.opponentCrestUrl ?? null}
              size="sm"
            />
            <NextMatchLines next={card.nextMatch} today={card.status === "today"} />
          </div>
        ) : null}
      </div>
    </article>
  );
}

// Exported for the Today widget (mrb4mhxt): one card component for both surfaces, so every
// desk-page refinement (thumbnails, cut status pills, standing+form in the identity block)
// shows up on /today for free instead of drifting in a parallel FollowedCard copy.
export function TickerTeam(props: { card: FollowedTeamCard }) {
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
