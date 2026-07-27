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
import { isScored, type BoardMatch } from "../board-types";

export interface InspectorProps {
  match: BoardMatch | null;
  onClose(): void;
  onDismiss(matchId: string): void;
}

export function Inspector(props: InspectorProps): ReactNodeLike {
  const { match } = props;
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

      {scored ? (
        <div className="jsm-inspector__axes">
          <div className="jsm-inspector__axis">
            <span className="jds-eyebrow">Fit</span>
            <p className="jsm-inspector__value">{match.fit}</p>
            <p>{match.fitReason}</p>
          </div>
          <div className="jsm-inspector__axis">
            <span className="jds-eyebrow">Want</span>
            <p className="jsm-inspector__value">{match.want}</p>
            <p>{match.wantReason}</p>
          </div>
        </div>
      ) : (
        // Not a spinner, not an error: this posting is sitting in the scoring queue, which can
        // legitimately run behind a crawl. Saying so plainly is the whole point (part file's own
        // wording: "the posting has not been dropped").
        <p role="status">
          Not read yet — this posting is queued for scoring, not dropped. Fit and Want will
          appear here once it's been read.
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
