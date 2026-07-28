// external-modules/job-search/src/web/screens/inspector.tsx
// Task 20 (#1304): the per-match detail panel opened from a board row. Pure presentation —
// board.tsx owns every fetch/sort/dismiss decision; this file never calls invokeTool/runQueue
// and never computes a score, only renders what it's handed.
//
// Two structural rules this screen exists to honor:
// - L9 (fit/want non-blending): Fit and Want are rendered as two separate labeled values with
//   their own reasons, never summed, averaged, or displayed as a single number. There is no
//   "overall" anywhere in this file.
// - Unscored visibility: a queued (not-yet-scored) match still opens here and says so plainly —
//   "queued for scoring", never "dropped" or a generic error, because it hasn't failed, it just
//   hasn't been read yet.
import { h, type ReactNodeLike } from "../runtime";
import { isScored, type BoardMatch, type MatchDetail } from "../board-types";

export interface InspectorProps {
  match: BoardMatch | null;
  // #1330: fetched by board.tsx via job-search.match.get on selection, never by this file (see
  // header). null while the fetch is in flight or hasn't started, regardless of `detailError` —
  // the two are mutually exclusive states board.tsx guarantees, not asserted again here, since
  // this file only renders what it's handed.
  detail: MatchDetail | null;
  detailError: string | null;
  onClose(): void;
  onDismiss(matchId: string): void;
  // Task 20/#1304: null hides the control entirely rather than rendering it disabled — board.tsx
  // is null here whenever assistantSurface is absent OR detail hasn't loaded yet (Discuss needs
  // the full MatchDetail the card and controlContext both read from, same as the reasons below).
  onDiscuss: (() => void) | null;
}

export function Inspector(props: InspectorProps): ReactNodeLike {
  const { match, detail, detailError } = props;
  if (match === null) {
    return null;
  }

  const scored = isScored(match);

  return (
    <aside
      className="jds-card jds-card--sunken jsm-inspector"
      role="dialog"
      aria-label={`Details for ${match.title}`}
    >
      <div className="jsm-inspector__head">
        <span className="jds-eyebrow">{match.company}</span>
        <h3 className="jsm-inspector__title">{match.title}</h3>
        <button type="button" className="jds-btn jds-btn--secondary" onClick={props.onClose}>
          Close
        </button>
      </div>

      {match.outsideFrame ? (
        <span className="jds-badge jsm-inspector__flag">Outside your stated frame</span>
      ) : null}

      {/* #1330: url is BoardMatch's own field (real per-row data, never detail-only prose per
          N39), so the link works the instant a row opens — it never waits on the match.get
          round trip the reasons below depend on. */}
      <a
        className="jds-btn jds-btn--secondary"
        href={match.url}
        target="_blank"
        rel="noopener noreferrer"
      >
        Open posting ↗
      </a>

      {props.onDiscuss ? (
        <button type="button" className="jds-btn jds-btn--secondary" onClick={props.onDiscuss}>
          Discuss
        </button>
      ) : null}

      {scored ? (
        <div className="jsm-inspector__axes">
          <div className="jsm-inspector__axis">
            <span className="jds-eyebrow">Fit</span>
            <p className="jsm-inspector__value">{match.fit}</p>
            {detail ? (
              <p>{detail.fitReason}</p>
            ) : detailError ? (
              <p role="alert">{detailError}</p>
            ) : (
              <p role="status">Loading the reason…</p>
            )}
          </div>
          <div className="jsm-inspector__axis">
            <span className="jds-eyebrow">Want</span>
            <p className="jsm-inspector__value">{match.want}</p>
            {detail ? (
              <p>{detail.wantReason}</p>
            ) : detailError ? (
              <p role="alert">{detailError}</p>
            ) : (
              <p role="status">Loading the reason…</p>
            )}
          </div>
        </div>
      ) : (
        // Not a spinner, not an error: this posting is sitting in the scoring queue, which can
        // legitimately run behind a crawl. Saying so plainly is the whole point (part file's own
        // wording: "the posting has not been dropped").
        <p role="status">
          Not read yet — this posting is queued for scoring, not dropped. Fit and Want will appear
          here once it's been read.
        </p>
      )}

      {match.state === "dismissed" ? (
        <p role="status">Dismissed.</p>
      ) : (
        <button
          type="button"
          className="jds-btn jds-btn--secondary"
          onClick={() => props.onDismiss(match.id)}
        >
          Dismiss
        </button>
      )}
    </aside>
  );
}
