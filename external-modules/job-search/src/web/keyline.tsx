// external-modules/job-search/src/web/keyline.tsx
//
// K1 (2026-07-28 keyline-restructure plan): the presentational vocabulary every screen after this
// task is built from. `KeyRow` replaces `.jsm-card` everywhere (K2 does the replacing); `FieldPair`
// is the Overview/Profile stat unit (K3/K4); `SectionHead` groups either. Presentational only — no
// fetching, no state, no `invokeTool`. Every value arrives as a prop from the screen that owns the
// read, same discipline `score.tsx` already follows for the same reason (both are imported by more
// than one screen, so neither can live inside a single screen file without the other importing it).
//
// Module CSS is layout-only (styles.css's own header), and that constraint reaches this file too:
// nothing here names a colour, a font, or draws its own hairline. Every rule is a host `jds-*`
// class — `jds-divider` for the rule between rows, `jds-fact` for the rule above a field,
// `jds-eyebrow` for every label. The module CANNOT draw a keyline itself (a hairline is a colour
// declaration); `jds-divider` as a sibling element is the established way around that —
// settings.tsx's `PortalRowView` is the precedent this file follows, not a new idea.
import { Fragment, h, type ReactNodeLike } from "./runtime";
import { Score } from "./score";

// -------------------------------------------------------------------------------------------
// formatPostedOn
//
// Hoisted out of board.tsx's screens/board.tsx, verbatim, so Overview's portal rows (K3) and the
// match rows (K2) share one implementation instead of two copies drifting apart. K2's own task
// removes the original from board.tsx once it imports this one — until then this is a deliberate
// duplicate, not a stray copy (see this task's own instructions).
//
// "Jul 15" off the stored instant, by string arithmetic only. Deliberately not
// `toLocaleDateString` (resolves against the *ambient* locale and timezone, banned in web display
// layers by check:no-ambient-dates) and deliberately not a relative "3 days ago" (needs a clock
// read this module has no allowance for). Returns null rather than a placeholder when the field is
// absent or malformed, so the caller can omit the pill/row entirely — an absent fact reads as "this
// board doesn't know", which is the truth; a dash reads as broken.
// -------------------------------------------------------------------------------------------
const MONTH_LABELS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec"
];

export function formatPostedOn(postedAt: string | null): string | null {
  if (postedAt === null || postedAt.length < 10) return null;
  const month = Number(postedAt.slice(5, 7));
  const day = Number(postedAt.slice(8, 10));
  if (!Number.isInteger(month) || month < 1 || month > 12) return null;
  if (!Number.isInteger(day) || day < 1 || day > 31) return null;
  return `${MONTH_LABELS[month - 1]} ${day}`;
}

// -------------------------------------------------------------------------------------------
// KeyRow
// -------------------------------------------------------------------------------------------
export interface KeyRowProps {
  /** Renders a `jds-divider` sibling above this row when true, then nothing when false/omitted.
   *  Callers pass `divided={i > 0}` over a mapped list so the first row opens with no leading rule
   *  and every row after it gets exactly one — never a border on the row itself, since module CSS
   *  may not name a border colour. */
  divided?: boolean;
  /** Primary content: a title, a meta line, whatever the screen composes. Fills the row's
   *  remaining width (`.jsm-krow__main`). */
  children: ReactNodeLike;
  /** Optional content pinned to the row's own right edge — scores, a dismiss button, a status dot.
   *  Omitted entirely (no empty wrapper in the tree) when a row has nothing to put there, so an
   *  aside-less row never reserves dead space for one. */
  aside?: ReactNodeLike;
  /** Mirrors board.tsx's existing `aria-selected` convention on its cards — carried through
   *  unchanged by this replacement, not reinvented, so the open-row semantics K2 already tests
   *  for keep meaning the same thing after the swap. */
  selected?: boolean;
}

export function KeyRow(props: KeyRowProps): ReactNodeLike {
  return h(
    Fragment,
    null,
    props.divided ? <div className="jds-divider" /> : null,
    <div className="jsm-krow" aria-selected={props.selected}>
      <div className="jsm-krow__main">{props.children}</div>
      {props.aside !== undefined ? <div className="jsm-krow__aside">{props.aside}</div> : null}
    </div>
  );
}

// -------------------------------------------------------------------------------------------
// FitRail
// -------------------------------------------------------------------------------------------
export interface FitRailProps {
  /** The axis label — "Fit" or "Want" today. L9's non-blending rule extends to this component's
   *  own shape: it renders exactly one axis, never a combined figure, so there is no prop for a
   *  second number to blend in. */
  label: string;
  /** `null` means "no basis to score" (e.g. Fit with no résumé on file yet) — never "scored zero".
   *  It renders the em dash below, with no digit anywhere in the subtree. A real zero
   *  (`value={0}`) is a score like any other and must draw the bar at zero width via `Score`
   *  itself, the same clamp path every other value takes — this component never special-cases 0,
   *  only `null`. */
  value: number | null;
}

export function FitRail(props: FitRailProps): ReactNodeLike {
  return (
    <div className="jsm-fit-rail">
      <span className="jds-eyebrow">{props.label}</span>
      {/* Reuses `Score` (score.tsx) for the bar rather than drawing a second one — that file's own
          header explains why a second implementation would drift (clamping, the host's `jds-score`
          classes, the `--jds-score` custom property are all owned there, once). */}
      {props.value === null ? <p className="jsm-fit-rail__empty">—</p> : <Score value={props.value} />}
    </div>
  );
}

// -------------------------------------------------------------------------------------------
// FieldPair
// -------------------------------------------------------------------------------------------
export interface FieldPairProps {
  label: string;
  /** The value itself, as a node rather than a string — Overview's figures (K3) want a
   *  `jds-hero-figure` number here, Profile's résumé stats (K4) want plain text, and a future
   *  criteria field (K6) wants a row of `jds-chip`s. FieldPair only owns the label/hairline
   *  scaffold, never the value's own markup. */
  children: ReactNodeLike;
}

export function FieldPair(props: FieldPairProps): ReactNodeLike {
  return (
    // `jds-fact` is the host's own label-over-value unit with a `border-top` built in (component-
    // jarvis.css) — the hairline above a field, without this module drawing one. Its `__icon` slot
    // is left out entirely: every field this module renders is a plain stat, and an empty icon
    // box would just be 28px of nothing on every row.
    <div className="jds-fact jsm-field">
      <div className="jds-fact__main jsm-field__main">
        <span className="jds-eyebrow">{props.label}</span>
        <p className="jds-fact__text jsm-field__value">{props.children}</p>
      </div>
    </div>
  );
}

// -------------------------------------------------------------------------------------------
// SectionHead
// -------------------------------------------------------------------------------------------
export interface SectionHeadProps {
  label: string;
  /** An optional trailing slot — a count, a control — rendered flush to the section head's own
   *  right edge, past the rule. Omitted entirely when the caller has nothing to put there. */
  children?: ReactNodeLike;
}

export function SectionHead(props: SectionHeadProps): ReactNodeLike {
  return (
    <div className="jsm-sechead">
      <span className="jds-eyebrow">{props.label}</span>
      {/* The rule fills whatever width the label and trailing slot don't use
          (`.jsm-sechead__rule`'s `flex: 1 1 auto`) — a `jds-divider` sized by its own layout rules
          would collapse to zero width here, since it draws its rule via `border-top` rather than
          an intrinsic size. */}
      <div className="jds-divider jsm-sechead__rule" />
      {props.children !== undefined ? (
        <div className="jsm-sechead__aside">{props.children}</div>
      ) : null}
    </div>
  );
}
