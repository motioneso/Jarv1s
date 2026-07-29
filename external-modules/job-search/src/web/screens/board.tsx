// external-modules/job-search/src/web/screens/board.tsx
// Task 20 (#1304): the match board. Every read after onboarding goes through
// job-search.matches.list (risk:read, so invokeTool works from the browser); every write 403s
// on that same route (packages/ai/src/routes.ts's confirmation_required gate on risk:write), so
// dismiss and "Search now" both go through runQueue's manual-run queues instead (Task 18's
// api.ts). runQueue resolves to "queued", not "done" — a dismiss is therefore optimistic: hide
// the row immediately, then reconcile against the next matches.list read, restoring the row
// with a plain message if it comes back still not-dismissed (the write never actually landed).
import { h, useCallback, useEffect, useRef, useState, type ReactNodeLike } from "../runtime";
import { invokeTool, runQueue, type RunOutcome } from "../api";
import { MATCHES_LIST_MAX_LIMIT, type FailureCause } from "../../domain/records.js";
import type { AssistantSurfaceHandleV1 } from "../../domain/seed-prompt.js";
import { Inspector } from "./inspector";
import { MatchRow } from "./match-row";
import { MatchRecordCard, useDiscuss } from "./discuss";
import { isScored, type BoardMatch, type MatchDetail, type PortalListItem } from "../board-types";

// N43: `MATCHES_LIST_MAX_LIMIT` is defined once in domain/records.ts and imported by both this
// screen and worker/handlers/matches.ts's requireLimit — there is no local literal here to drift
// out of sync (a999a081 shipped the handler at a lower value while this file still asked for 40,
// and every board load threw InputError; see the ruling for why the fix is a shared constant, not
// a synced pair). The tool has no default, so an omitted limit throws rather than silently
// defaulting to an unbounded read; passing the max shows the whole board in one page — Task 20 was
// never asked to build pagination (#1333 tracks paging as a separate, out-of-scope product
// question).

type MatchesState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; items: BoardMatch[] };

type SortKey = "fit" | "want";
interface SortState {
  key: SortKey;
  dir: "asc" | "desc";
}

// #1330: a dedicated state machine for the async job-search.match.get fetch, kept separate from
// MatchesState because selecting a row must never perturb the list's own loading/ready/error
// state. Resets to idle whenever nothing is selected, so a later selection can never render a
// stale detail left over from the previous row.
type DetailState =
  | { status: "idle" }
  | { status: "loading"; matchId: string }
  | { status: "ready"; matchId: string; detail: MatchDetail }
  | { status: "error"; matchId: string; message: string };

export interface BoardScreenProps {
  profileId: string;
  // Task 20/#1304: absent on a v1.1 host or before root.tsx has one to hand down — Discuss simply
  // isn't offered in that case (useDiscuss's own no-op stance), same optionality as onboarding.tsx.
  assistantSurface?: AssistantSurfaceHandleV1;
}

// Unscored rows sort last regardless of direction (the part file's explicit rule); scored rows
// compare only by the active key's own numeric value. Never blends fit and want into one
// comparator — sorting by one must never reorder by the other (L9's fit/want non-blending,
// extended to sort behavior, not just display).
/** How the board reads before the user has touched a column header.
 *
 * Not "whatever order the store returned". A board's whole claim is "here are the roles worth your
 * time", and unsorted it opened on an AI Model Engineer scoring 8 while five 88s sat below the
 * fold — which reads as a broken matcher rather than an unsorted table. Fit first because fit is
 * the axis the résumé evidence supports; want is the user's own preference and is never blended
 * into it (L9). Unscored rows sort last either way: they have no number to rank by, and burying
 * them keeps the top of the board answerable. */
const DEFAULT_SORT: SortState = { key: "fit", dir: "desc" };

/** Which default actually applies to THESE rows.
 *
 * Fit is the better default, but only where there is a Fit to sort by. With no résumé on file
 * every read row carries `fit: null`, and defaulting to a column of blanks leaves the board in
 * whatever order the store happened to return — the exact "reads as a broken matcher" the
 * default sort exists to prevent, now with a ▼ over an empty column claiming it is sorted. Want
 * is answerable without a résumé, so it takes over until a résumé makes Fit mean something. */
function defaultSortFor(items: BoardMatch[]): SortState {
  return items.some((item) => item.fit !== null) ? DEFAULT_SORT : { key: "want", dir: "desc" };
}

function sortMatches(items: BoardMatch[], sort: SortState | null): BoardMatch[] {
  const { key, dir } = sort ?? defaultSortFor(items);
  const scored = items.filter(isScored);
  const unscored = items.filter((item) => !isScored(item));
  scored.sort((a, b) => {
    const av = key === "fit" ? a.fit : a.want;
    const bv = key === "fit" ? b.fit : b.want;
    // A null on the active axis means "no basis to score", not "scored zero", so it sorts to the
    // bottom in BOTH directions — the same treatment an unread row gets. Subtracting it as if it
    // were 0 would make ascending order open on a block of blanks and rank them beneath a row
    // the model actually judged badly.
    if (av === null && bv === null) return 0;
    if (av === null) return 1;
    if (bv === null) return -1;
    return dir === "asc" ? av - bv : bv - av;
  });
  return [...scored, ...unscored];
}

/** Shows the effective sort, including the default one nobody has clicked — a table that is
 *  sorted but shows no indicator invites the reader to distrust the order. */
function sortIndicator(sort: SortState | null, key: SortKey, items: BoardMatch[]): string {
  const effective = sort ?? defaultSortFor(items);
  if (effective.key !== key) return "";
  return effective.dir === "asc" ? " ▲" : " ▼";
}

// lastOkAt is an ISO timestamp or null (never crawled to a success yet); this is deliberately a
// plain date, not a relative "3 days ago" phrase — the module has no ambient-clock allowance
// (check:no-ambient-dates) and a raw ISO slice needs none, unlike a relative-time computation.
function lastWorkedText(lastOkAt: string | null): string {
  return lastOkAt ? `Last worked ${lastOkAt.slice(0, 10)}.` : "Has never completed a search.";
}

// K2: bucket tabs partition the same ≤25-row set the sort controls already operate on — filtering
// is client-side, there is no second fetch per tab (matches.list has no notion of a "bucket";
// MatchState is the only state it tracks). "New" absorbs both `unscored` and `new`: the plan names
// only Saved (`seen`) and Passed (`dismissed`) explicitly, and the two remaining states share the
// one fact that actually matters here — nothing has happened to this match yet — so splitting them
// into a fourth tab would draw a distinction the board has no other use for.
type Bucket = "new" | "saved" | "passed";

const BUCKETS: ReadonlyArray<{ key: Bucket; label: string }> = [
  { key: "new", label: "New" },
  { key: "saved", label: "Saved" },
  { key: "passed", label: "Passed" }
];

function bucketOf(item: BoardMatch): Bucket {
  if (item.state === "seen") return "saved";
  if (item.state === "dismissed") return "passed";
  return "new";
}

// Renders a degraded or disabled portal's authored cause verbatim — never composed here.
// describeFailure (domain/records.ts) is the single authored voice for every failure sentence
// (Task 5's rule); N6 is why the board fetches this at all (nothing else can reach
// listPortals(profileId) from the browser). A self-disabled portal (login_required,
// cause.disabled === true) renders as calm disabled-with-cause, not an alert — otherwise a user
// would keep re-enabling a portal that can only ever fail the same way. cause.summary never
// mentions lastOkAt (records.ts's describeFailure has no reason to — a login-wall stops before
// retrieving anything), so "when it last worked" is rendered here, once, for every flagged
// portal regardless of failure kind.
function PortalBanner(props: { portals: PortalListItem[] }): ReactNodeLike {
  const flagged = props.portals.filter((portal) => portal.cause !== null);
  if (flagged.length === 0) return null;
  return (
    <div className="jsm-portal-banner">
      {flagged.map((portal) => {
        const cause = portal.cause as FailureCause;
        const disabled = !portal.enabled && cause.disabled;
        return (
          <p
            key={portal.sourceId}
            className="jds-card jds-card--sunken jsm-portal-banner__item"
            role={disabled ? "status" : "alert"}
          >
            <span className="jds-eyebrow">{portal.label}</span>{" "}
            {disabled ? <span className="jds-badge">Turned off</span> : null}
            <span>{cause.summary}</span> <span>{cause.nextAction}</span>{" "}
            <span className="jds-hint">{lastWorkedText(portal.lastOkAt)}</span>
          </p>
        );
      })}
    </div>
  );
}

function SearchNowControl(props: { profileId: string; onEnqueued(): void }): ReactNodeLike {
  const [pending, setPending] = useState(false);
  const [outcome, setOutcome] = useState<RunOutcome | null>(null);

  const handleClick = useCallback(() => {
    // Deliberately does not check ../latch.ts's isLatched: that latch exists only to stop the
    // *automatic* per-profile crawl on mount from firing twice (root.tsx's own effect).
    // "Search now" is a deliberate, explicit user action and must enqueue every time it's
    // clicked, latched or not.
    setPending(true);
    runQueue("job-search.crawl-run", "crawl.run", { profileId: props.profileId })
      .then((result) => {
        setPending(false);
        setOutcome(result);
        props.onEnqueued();
      })
      .catch(() => {
        setPending(false);
        setOutcome({ kind: "error", message: "Network error" });
      });
  }, [props]);

  let notice: ReactNodeLike = null;
  if (pending) {
    notice = (
      <p className="jsm-queue-notice" role="status">
        Searching…
      </p>
    );
  } else if (outcome?.kind === "queued") {
    notice = (
      <p className="jsm-queue-notice" role="status">
        Searching now — new matches will appear here as they're scored.
      </p>
    );
  } else if (outcome?.kind === "already-queued") {
    notice = (
      <p className="jsm-queue-notice" role="status">
        Already searching.
      </p>
    );
  } else if (outcome?.kind === "disabled") {
    notice = (
      <p className="jsm-queue-notice" role="status">
        Manual search runs are turned off for this account.
      </p>
    );
  } else if (outcome?.kind === "error") {
    notice = (
      <p className="jsm-queue-notice" role="alert">
        Couldn't start a search: {outcome.message}
      </p>
    );
  }

  return (
    <div className="jsm-search-now">
      {/* Secondary, not primary. The board itself is what the user came for; searching again is a
          refresh. A filled accent button here made the one repeatable maintenance action the
          loudest thing on a page of twenty results. */}
      <button
        type="button"
        className="jds-btn jds-btn--secondary"
        onClick={handleClick}
        disabled={pending}
      >
        Search now
      </button>
      {notice}
    </div>
  );
}

export function BoardScreen(props: BoardScreenProps): ReactNodeLike {
  const { profileId } = props;
  const [matchesState, setMatchesState] = useState<MatchesState>({ status: "loading" });
  const [portals, setPortals] = useState<PortalListItem[]>([]);
  const [sort, setSort] = useState<SortState | null>(null);
  const [bucket, setBucket] = useState<Bucket>("new");
  const [hiddenIds, setHiddenIds] = useState<ReadonlySet<string>>(new Set());
  const [restoreMessage, setRestoreMessage] = useState<string | null>(null);
  const [selectedMatchId, setSelectedMatchId] = useState<string | null>(null);
  const [detailState, setDetailState] = useState<DetailState>({ status: "idle" });
  const { discussing, discuss, close: closeDiscuss } = useDiscuss(props.assistantSurface);

  // The conversation renders full width under the board, which is the right measure for a
  // transcript — but on a twenty-row board that put it about a thousand pixels below the Discuss
  // button, so clicking Discuss appeared to do nothing at all. Same treatment as the inspector's
  // own panel; optional-chained because the unit renderer hands back no real node.
  const discussRef = useRef<{ scrollIntoView?: (opts: unknown) => void } | null>(null);
  useEffect(() => {
    if (discussing === null) return;
    discussRef.current?.scrollIntoView?.({ behavior: "smooth", block: "start" });
  }, [discussing]);

  // Any id still optimistically hidden that comes back from a fresh read still not dismissed
  // means the write never landed — un-hide it and say so plainly rather than leaving it
  // silently missing. IDs that DID land as "dismissed" are already excluded by the render
  // filter below, so they're simply dropped from tracking here.
  const reconcileHidden = useCallback((freshItems: BoardMatch[]): void => {
    setHiddenIds((prev) => {
      if (prev.size === 0) return prev;
      let restored = false;
      for (const id of prev) {
        const fresh = freshItems.find((item) => item.id === id);
        if (fresh && fresh.state !== "dismissed") restored = true;
      }
      if (restored) {
        setRestoreMessage("A dismissal didn't go through — that match is showing again.");
      }
      return new Set();
    });
  }, []);

  const fetchMatches = useCallback(async (): Promise<void> => {
    try {
      const result = (await invokeTool("job-search.matches.list", {
        profileId,
        limit: MATCHES_LIST_MAX_LIMIT
      })) as { items?: BoardMatch[] } | null;
      const items = Array.isArray(result?.items) ? (result!.items as BoardMatch[]) : [];
      reconcileHidden(items);
      setMatchesState({ status: "ready", items });
    } catch (error) {
      setMatchesState({
        status: "error",
        message: error instanceof Error ? error.message : "Couldn't load your matches."
      });
    }
  }, [profileId, reconcileHidden]);

  useEffect(() => {
    void fetchMatches();
  }, [fetchMatches]);

  // Portal health is a banner, not a blocking read — a failed fetch just means no banner this
  // render; the board still works from matches.list alone.
  useEffect(() => {
    invokeTool("job-search.portal.list", { profileId })
      .then((result) => {
        const list = (result as { portals?: PortalListItem[] } | null)?.portals;
        setPortals(Array.isArray(list) ? list : []);
      })
      .catch(() => undefined);
  }, [profileId]);

  // Refetch on window focus — guarded so this is a no-op under the plain-node test environment
  // (see latch.ts's own try/catch precedent for "no window" as an expected, not exceptional,
  // runtime).
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.addEventListener !== "function") return;
    const handler = (): void => {
      void fetchMatches();
    };
    window.addEventListener("focus", handler);
    return () => window.removeEventListener("focus", handler);
  }, [fetchMatches]);

  // #1330: fetches the untruncated detail (fitReason/wantReason, per N39) the instant a row is
  // selected — Inspector never calls invokeTool itself (see that file's header). `cancelled`
  // guards the same kind of race reconcileHidden's id-set tracking guards above: if the
  // selection changes again before this resolves, the stale response must never overwrite the
  // newer selection's state. An unscored match's id never resolves to a real row (#1329), so
  // match.get correctly answers `null` for it — surfaced here as an error state that Inspector
  // simply never reads, since it only renders fit/want reasons for scored matches.
  useEffect(() => {
    if (selectedMatchId === null) {
      setDetailState({ status: "idle" });
      return;
    }
    let cancelled = false;
    const matchId = selectedMatchId;
    setDetailState({ status: "loading", matchId });
    invokeTool("job-search.match.get", { matchId })
      .then((result) => {
        if (cancelled) return;
        const detail = (result as { match?: MatchDetail | null } | null)?.match ?? null;
        if (detail === null) {
          setDetailState({
            status: "error",
            matchId,
            message: "Couldn't load the full detail for this match."
          });
          return;
        }
        setDetailState({ status: "ready", matchId, detail });
      })
      .catch((error) => {
        if (cancelled) return;
        setDetailState({
          status: "error",
          matchId,
          message:
            error instanceof Error ? error.message : "Couldn't load the full detail for this match."
        });
      });
    return () => {
      cancelled = true;
    };
  }, [selectedMatchId]);

  const handleDismiss = useCallback(
    (matchId: string): void => {
      setHiddenIds((prev) => new Set(prev).add(matchId));
      setSelectedMatchId((prev) => (prev === matchId ? null : prev));
      runQueue("job-search.match-state", "match.set-state", { matchId, state: "dismissed" })
        .catch(() => undefined)
        .then(() => fetchMatches());
    },
    [fetchMatches]
  );

  function toggleSort(key: SortKey): void {
    // `prev ?? the effective default`, because the board arrives already sorted. Treating an
    // untouched board as "no sort" meant the first click on the column it was already sorted by
    // re-applied the order that was on screen already, and the header did nothing. Read the
    // default off the rows for the same reason `sortIndicator` does: which column the board
    // opened on depends on whether Fit has anything in it.
    const items = matchesState.status === "ready" ? matchesState.items : [];
    setSort((prev) => {
      const current = prev ?? defaultSortFor(items);
      if (current.key !== key) return { key, dir: "desc" };
      return { key, dir: current.dir === "desc" ? "asc" : "desc" };
    });
  }

  if (matchesState.status === "loading") {
    return (
      <div className="jds-card jds-card--sunken jsm-state" role="status">
        <span className="jds-eyebrow">Job search</span>
        <p>Loading your matches…</p>
      </div>
    );
  }

  if (matchesState.status === "error") {
    return (
      <div className="jds-card jds-card--sunken jsm-state" role="alert">
        <span className="jds-eyebrow">Job search</span>
        <p>Couldn't load your matches: {matchesState.message}</p>
        <button
          type="button"
          className="jds-btn jds-btn--secondary"
          onClick={() => void fetchMatches()}
        >
          Try again
        </button>
      </div>
    );
  }

  // activeItems mirrors the board's pre-bucket semantics exactly — dismissed rows excluded,
  // optimistically-hidden rows excluded — because the hero's role count and "X read and scored"
  // line describe the whole board, not whichever bucket happens to be open. Switching tabs must
  // never move that figure.
  const activeItems = matchesState.items.filter(
    (item) => item.state !== "dismissed" && !hiddenIds.has(item.id)
  );
  const scoredCount = activeItems.filter(isScored).length;
  // Every read row has an empty Fit, which only ever has one cause: no résumé is on file, so
  // there was nothing to judge Fit against. A column of em dashes with no explanation reads as a
  // product that is broken rather than one that is waiting on something, and the fix is a thing
  // only the user can do — so it has to be said, and said with the action in it. Keyed on
  // `every`, not on a profile flag: a résumé added mid-board leaves some rows scored and some
  // not, and the notice must retire itself the moment the first real Fit lands.
  const fitNeedsResume =
    scoredCount > 0 && activeItems.filter(isScored).every((item) => item.fit === null);

  // boardItems is activeItems' opposite number: every non-hidden row INCLUDING dismissed ones, so
  // Passed has something to show. hiddenIds still applies here too — an optimistically dismissed
  // row must vanish from every bucket immediately, not just from New/Saved.
  const boardItems = matchesState.items.filter((item) => !hiddenIds.has(item.id));
  const bucketCounts: Record<Bucket, number> = { new: 0, saved: 0, passed: 0 };
  for (const item of boardItems) bucketCounts[bucketOf(item)] += 1;
  const bucketItems = boardItems.filter((item) => bucketOf(item) === bucket);
  const sorted = sortMatches(bucketItems, sort);
  const selectedMatch = sorted.find((item) => item.id === selectedMatchId) ?? null;

  // Guarded by matchId, not just detailState.status: effects run after render, so there is one
  // render frame where selectedMatchId has already changed but the fetch effect above hasn't
  // fired yet. Without this check, that frame would briefly show the previous row's detail (or
  // error) under the new row's heading.
  const detail =
    detailState.status === "ready" && detailState.matchId === selectedMatchId
      ? detailState.detail
      : null;
  const detailError =
    detailState.status === "error" && detailState.matchId === selectedMatchId
      ? detailState.message
      : null;

  // Discuss needs the full MatchDetail (fitReason/wantReason, per L9) the card and controlContext
  // both depend on, not just the row's BoardMatch — so, like Open posting and Dismiss, it's only
  // offered from the inspector, once a row's detail has loaded, never a bare-row action. Absent
  // assistantSurface, this stays null and Inspector renders no Discuss control at all (discuss.tsx
  // header: "an action that silently does nothing is worse than an action that is not there").
  const onDiscuss = props.assistantSurface && detail ? () => discuss(detail) : null;

  // Surface is the host's real chat view (see onboarding.tsx's identical h(Surface, ...) call) —
  // this module never builds a second chat implementation. Guarded on `discussing === detail.id`,
  // not just `discussing !== null`: selecting a different row nulls `detail` for a render or more
  // before its own fetch resolves, and the guard here (paralleling the detail/detailError guards
  // above) stops that gap from flashing the previous match's card under the new row.
  const Surface = props.assistantSurface?.Surface;
  const discussPanel =
    discussing !== null && detail !== null && discussing === detail.id && Surface ? (
      <div ref={discussRef} className="jds-card jds-card--sunken jsm-discuss-panel">
        {/* A title bar, not two controls jammed together: the eyebrow said "Discussing" and stopped,
            so the only thing naming the role under discussion was the record card further down. */}
        <div className="jsm-discuss-panel__head">
          <span className="jds-eyebrow">Discussing {detail.title}</span>
          <button
            type="button"
            className="jds-btn jds-btn--quiet jds-btn--sm"
            onClick={closeDiscuss}
          >
            Close
          </button>
        </div>
        {
          // localRows are client-only (never enter the transcript, per LocalRow's own contract) —
          // the model's copy of this same record travels separately, in discuss()'s submitTurn
          // controlContext, not through this prop.
          h(Surface, {
            localRows: [
              {
                id: `discuss-${detail.id}`,
                role: "assistant",
                content: <MatchRecordCard detail={detail} />
              }
            ],
            composer: {}
          })
        }
      </div>
    ) : null;

  return (
    <div className="jsm-board-screen">
      <PortalBanner portals={portals} />
      {/* The board's own header row. "Search now" used to sit alone under the view tabs as a third
          stacked row of buttons, with nothing anywhere saying what was on the board or how much of
          it had been read — and "read" matters here, because scoring is budgeted and a run can
          leave most of a crawl unscored. The count says that plainly; the action sits beside it
          rather than above it. */}
      <header className="jsm-hero">
        <div className="jsm-hero__lede">
          <span className="jds-eyebrow">On your board</span>
          {/* The count at display scale, because it is the answer to the only question anyone
              opens this screen with. As a line of prose ("14 roles · 9 scored so far") it had to
              be read before it could be understood, and it sat at body weight beside a button,
              which made the button the loudest thing on a page about opportunities. */}
          <p className="jsm-hero__figure">
            <span className="jds-hero-figure">{activeItems.length}</span>
            <span className="jds-eyebrow">{activeItems.length === 1 ? "role" : "roles"}</span>
          </p>
          <span className="jds-strap" aria-hidden="true" />
          {/* The scoring state as a sentence rather than a second number: how much of the board has
              been read matters, but it is a caveat on the figure above, not a rival to it. No date
              anywhere — the module has no ambient-clock allowance (check:no-ambient-dates), which
              is why the mockup's "Wednesday · July 15" dateline is not reproduced. */}
          <p className="jsm-hero__prose">
            {scoredCount < activeItems.length
              ? `${scoredCount} read and scored so far — the rest are queued.`
              : "Every posting here has been read and scored."}
          </p>
        </div>
        <SearchNowControl profileId={profileId} onEnqueued={() => void fetchMatches()} />
      </header>
      <hr className="jds-divider jds-divider--strong jsm-hero__rule" />
      {restoreMessage ? (
        <p className="jsm-queue-notice" role="status">
          {restoreMessage}
        </p>
      ) : null}
      {/* A bounded surface, not a bare paragraph. This is the one persistent advisory on the
          screen — every Fit column on the board is empty until it is acted on — and as loose text
          directly above the table it read as a caption the eye skips on the way to the rows. The
          eyebrow gives it a name so it is identifiable as a thing to deal with rather than a
          sentence of chrome. */}
      {fitNeedsResume ? (
        <div className="jds-card jds-card--sunken jds-card--pad-sm jsm-notice" role="status">
          <span className="jds-eyebrow">No résumé on file</span>
          <p className="jsm-notice__body">
            Fit is empty because there's no résumé on file — it's the only thing Fit is judged
            against. Paste yours into the chat and these roles get read again with it.
          </p>
        </div>
      ) : null}
      {/* The list and the open match are one two-column region, not a table with a panel dropped
          under it — see `.jsm-board-body` for why. The modifier is what turns the second column on,
          so a closed board still gets the full width for the table. */}
      <div className={`jsm-board-body${selectedMatch ? " jsm-board-body--open" : ""}`}>
        {boardItems.length === 0 ? (
          <div className="jds-card jds-card--sunken jsm-state" role="status">
            <span className="jds-eyebrow">Job search</span>
            <p>No matches yet — check back once your next search run finishes.</p>
          </div>
        ) : (
          <div className="jsm-list">
            {/* Bucket tabs: New / Saved / Passed, counts against the host's own jds-tab__count
                slot — the same jds-tabs/jds-tab markup root.tsx's own view switcher already uses,
                not a new pattern. Filtering is entirely client-side over `boardItems`, which is
                already the ≤25-row page matches.list returned; clicking a tab never re-fetches. */}
            <div className="jds-tabs" role="tablist" aria-label="Match bucket">
              {BUCKETS.map((b) => (
                <button
                  key={b.key}
                  type="button"
                  role="tab"
                  aria-selected={bucket === b.key}
                  className="jds-tab"
                  onClick={() => setBucket(b.key)}
                >
                  {b.label}
                  <span className="jds-tab__count">{bucketCounts[b.key]}</span>
                </button>
              ))}
            </div>

            {/* Sorting used to live in the table's own column headers, which is where a spreadsheet
                puts it. A list of rows has no header row to hang it off, so the two axes become an
                explicit control strip — and saying "Sort" out loud is an improvement regardless:
                clickable column headings are a convention people have to already know. */}
            <div className="jsm-sort">
              <span className="jds-eyebrow">Sort</span>
              <button
                type="button"
                className="jds-chip jds-chip--toggle"
                aria-pressed={sort?.key === "fit"}
                onClick={() => toggleSort("fit")}
              >
                Fit{sortIndicator(sort, "fit", bucketItems)}
              </button>
              <button
                type="button"
                className="jds-chip jds-chip--toggle"
                aria-pressed={sort?.key === "want"}
                onClick={() => toggleSort("want")}
              >
                Want{sortIndicator(sort, "want", bucketItems)}
              </button>
            </div>

            {sorted.length === 0 ? (
              // A bucket can be legitimately empty (nothing Saved yet) while the board as a whole
              // is not — this is scoped to the open tab, not the "No matches yet" empty-board
              // state above, which only fires when boardItems itself is empty.
              <p className="jds-hint" role="status">
                Nothing in {BUCKETS.find((b) => b.key === bucket)?.label ?? "this bucket"} yet.
              </p>
            ) : (
              sorted.map((item, i) => (
                <MatchRow
                  key={item.id}
                  item={item}
                  divided={i > 0}
                  selected={item.id === selectedMatchId}
                  onSelect={setSelectedMatchId}
                  onDismiss={handleDismiss}
                />
              ))
            )}
          </div>
        )}
        <Inspector
          match={selectedMatch}
          detail={detail}
          detailError={detailError}
          onClose={() => setSelectedMatchId(null)}
          onDismiss={(matchId) => handleDismiss(matchId)}
          onDiscuss={onDiscuss}
        />
      </div>
      {discussPanel}
    </div>
  );
}
