// external-modules/job-search/src/web/board-types.ts
// Task 20 (#1304): wire-shape types for job-search.matches.list and job-search.portal.list,
// shared between screens/board.tsx and screens/inspector.tsx so neither screen file imports the
// other (the 1000-line file-size cap is why board and inspector are two files at all — see
// check:file-size). Mirrors use-profiles.ts's own stance: these describe what actually crosses
// the wire, not the domain's Match/PortalState directly. The matches.list handler
// (worker/handlers/matches.ts's BoardMatch) drops fields the board never needs (profileId,
// postingId, scoredAt) and adds two it does (title/company, joined in from Posting) — so
// re-declaring the shape here, rather than importing domain Match, is deliberate.
import type { FailureCause } from "../domain/records.js";

export type MatchState = "unscored" | "new" | "seen" | "dismissed";

// N39: no fitReason/wantReason here — board.tsx's table never renders them (a field belongs on
// the list row only if the list renders it), so they don't belong on this wire shape at all, not
// merely truncated. `url` stays: it's per-row real data the row uses directly (the inspector's
// "Open posting" link), not detail-only prose. The full reasons live on `MatchDetail` below,
// fetched separately by job-search.match.get when a row is opened.
export interface BoardMatch {
  id: string;
  title: string;
  company: string;
  fit: number | null;
  want: number | null;
  outsideFrame: boolean;
  state: MatchState;
  url: string;
}

// #1330: mirrors worker/handlers/matches.ts's MatchDetail — the untruncated record behind
// job-search.match.get, fetched by board.tsx when a row is selected and handed to the inspector
// as its own prop (never fetched by the inspector itself; see that file's header for why). A
// separate type from BoardMatch, not BoardMatch-plus-fields, because it's exempt from the
// render-cap/row-count arithmetic that shapes the list row — this is always exactly one record.
export interface MatchDetail {
  id: string;
  title: string;
  company: string;
  url: string;
  fit: number | null;
  want: number | null;
  fitReason: string;
  wantReason: string;
  outsideFrame: boolean;
  state: MatchState;
}

// portal.list's result (worker/handlers/portal.ts's createPortalListHandler) — `cause` is the
// real domain FailureCause, unmodified end to end, which is exactly why it's safe to reuse that
// type here instead of re-declaring it: the handler returns `portal.cause` verbatim.
export interface PortalListItem {
  sourceId: string;
  label: string;
  enabled: boolean;
  lastOkAt: string | null;
  cause: FailureCause | null;
}

// A type predicate rather than a plain boolean so callers that render or compare the numbers get
// them as `number` instead of re-asserting non-null at every use — the guard already proves it,
// and a `!` at the use site would be an unchecked claim sitting next to a checked one.
export function isScored(item: BoardMatch): item is BoardMatch & { fit: number; want: number } {
  return item.state !== "unscored" && item.fit !== null && item.want !== null;
}
