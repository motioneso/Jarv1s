// external-modules/job-search/src/web/score.tsx
//
// A 0-100 score rendered as the number plus the host's `jds-score` bar. Lives in its own file
// because both the board table and the detail panel render one, and board.tsx already imports
// inspector.tsx — putting it in either would make the two import each other.
//
// Twenty rows of bare digits all weigh the same on the page, so an 88 and an 8 are equally loud
// and finding the strong matches means reading every row instead of seeing them. The bar is what
// makes the column scannable, and in the panel it is what stops the number reading as a stray
// digit above a paragraph.
//
// All the styling lives in the host primitive (module CSS is layout-only by contract). The only
// thing passed from here is the value itself, as a 0-1 fraction on a custom property — the one
// case where an inline style is right, because the number *is* the data.
import { h, type ReactNodeLike } from "./runtime";

export interface ScoreProps {
  value: number;
  /** "lg" is the host's detail-panel variant: display type and a full-width track, for a score
   *  that heads a paragraph of reasoning rather than sitting in a column of other scores. */
  size?: "sm" | "lg";
}

export function Score(props: ScoreProps): ReactNodeLike {
  // Clamped because a score is authored by the model via a record and this is a render path — a
  // value outside 0-100 must draw a wrong-looking bar, never a bar that overflows its track.
  const fraction = Math.min(1, Math.max(0, props.value / 100));
  const className = props.size === "lg" ? "jds-score jds-score--lg" : "jds-score";
  return (
    <span className={className}>
      {props.value}
      <span className="jds-score__track" aria-hidden="true">
        <span className="jds-score__fill" style={{ "--jds-score": String(fraction) }} />
      </span>
    </span>
  );
}
