// external-modules/job-search/src/web/screens/board.tsx
// Task 20 (#1304): the match board. Every read after onboarding goes through
// job-search.matches.list (risk:read, so invokeTool works from the browser); every write 403s
// on that same route (packages/ai/src/routes.ts's confirmation_required gate on risk:write), so
// dismiss and "Search now" both go through runQueue's manual-run queues instead (Task 18's
// api.ts). runQueue resolves to "queued", not "done" — a dismiss is therefore optimistic: hide
// the row immediately, then reconcile against the next matches.list read, restoring the row
// with a plain message if it comes back still not-dismissed (the write never actually landed).
import { h, useCallback, useEffect, useState, type ReactNodeLike } from "../runtime";
import { invokeTool, runQueue, type RunOutcome } from "../api";
import type { FailureCause } from "../../domain/records.js";
import { Inspector } from "./inspector";
import { isScored, type BoardMatch, type PortalListItem } from "../board-types";

// worker/handlers/matches.ts's MATCHES_LIST_MAX_LIMIT: the tool has no default, so an omitted
// limit throws rather than silently defaulting to an unbounded read. Passing the max shows the
// whole board in one page — Task 20 was never asked to build pagination.
const MATCHES_LIMIT = 40;

type MatchesState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; items: BoardMatch[] };

type SortKey = "fit" | "want";
interface SortState {
  key: SortKey;
  dir: "asc" | "desc";
}

export interface BoardScreenProps {
  profileId: string;
}

// Unscored rows sort last regardless of direction (the part file's explicit rule); scored rows
// compare only by the active key's own numeric value. Never blends fit and want into one
// comparator — sorting by one must never reorder by the other (L9's fit/want non-blending,
// extended to sort behavior, not just display).
function sortMatches(items: BoardMatch[], sort: SortState | null): BoardMatch[] {
  if (sort === null) return items;
  const { key, dir } = sort;
  const scored = items.filter(isScored);
  const unscored = items.filter((item) => !isScored(item));
  scored.sort((a, b) => {
    const av = (key === "fit" ? a.fit : a.want) as number;
    const bv = (key === "fit" ? b.fit : b.want) as number;
    return dir === "asc" ? av - bv : bv - av;
  });
  return [...scored, ...unscored];
}

function sortIndicator(sort: SortState | null, key: SortKey): string {
  if (sort === null || sort.key !== key) return "";
  return sort.dir === "asc" ? " ▲" : " ▼";
}

// lastOkAt is an ISO timestamp or null (never crawled to a success yet); this is deliberately a
// plain date, not a relative "3 days ago" phrase — the module has no ambient-clock allowance
// (check:no-ambient-dates) and a raw ISO slice needs none, unlike a relative-time computation.
function lastWorkedText(lastOkAt: string | null): string {
  return lastOkAt ? `Last worked ${lastOkAt.slice(0, 10)}.` : "Has never completed a search.";
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
      <button
        type="button"
        className="jds-btn jds-btn--primary"
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
  const [hiddenIds, setHiddenIds] = useState<ReadonlySet<string>>(new Set());
  const [restoreMessage, setRestoreMessage] = useState<string | null>(null);
  const [selectedMatchId, setSelectedMatchId] = useState<string | null>(null);

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
        limit: MATCHES_LIMIT
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
    setSort((prev) => {
      if (prev === null || prev.key !== key) return { key, dir: "desc" };
      return { key, dir: prev.dir === "desc" ? "asc" : "desc" };
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

  const visibleItems = matchesState.items.filter(
    (item) => item.state !== "dismissed" && !hiddenIds.has(item.id)
  );
  const sorted = sortMatches(visibleItems, sort);
  const selectedMatch = sorted.find((item) => item.id === selectedMatchId) ?? null;

  return (
    <div className="jsm-board-screen">
      <PortalBanner portals={portals} />
      <SearchNowControl profileId={profileId} onEnqueued={() => void fetchMatches()} />
      {restoreMessage ? (
        <p className="jsm-queue-notice" role="status">
          {restoreMessage}
        </p>
      ) : null}
      {sorted.length === 0 ? (
        <div className="jds-card jds-card--sunken jsm-state" role="status">
          <span className="jds-eyebrow">Job search</span>
          <p>No matches yet — check back once your next search run finishes.</p>
        </div>
      ) : (
        <table className="jds-table jsm-board">
          <thead>
            <tr>
              <th>Role</th>
              <th>
                <button
                  type="button"
                  className="jds-btn jds-btn--tertiary"
                  onClick={() => toggleSort("fit")}
                >
                  Fit{sortIndicator(sort, "fit")}
                </button>
              </th>
              <th>
                <button
                  type="button"
                  className="jds-btn jds-btn--tertiary"
                  onClick={() => toggleSort("want")}
                >
                  Want{sortIndicator(sort, "want")}
                </button>
              </th>
              <th />
            </tr>
          </thead>
          <tbody>
            {sorted.map((item) => (
              <tr key={item.id} className={item.outsideFrame ? "jsm-board-row--outside" : ""}>
                <td>
                  <button
                    type="button"
                    className="jds-btn jds-btn--tertiary"
                    onClick={() => setSelectedMatchId(item.id)}
                  >
                    {item.title}
                  </button>
                  <div>{item.company}</div>
                  {item.outsideFrame ? (
                    <span className="jds-badge">Outside your stated frame</span>
                  ) : null}
                </td>
                <td>{isScored(item) ? item.fit : "—"}</td>
                <td>{isScored(item) ? item.want : "—"}</td>
                <td>
                  {!isScored(item) ? <span className="jds-badge">Not read yet</span> : null}
                  <button
                    type="button"
                    className="jds-btn jds-btn--secondary"
                    onClick={() => handleDismiss(item.id)}
                  >
                    Dismiss
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <Inspector
        match={selectedMatch}
        onClose={() => setSelectedMatchId(null)}
        onDismiss={(matchId) => handleDismiss(matchId)}
      />
    </div>
  );
}
