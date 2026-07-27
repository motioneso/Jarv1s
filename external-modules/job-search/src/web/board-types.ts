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

export interface BoardMatch {
  id: string;
  title: string;
  company: string;
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

export function isScored(item: BoardMatch): boolean {
  return item.state !== "unscored" && item.fit !== null && item.want !== null;
}
