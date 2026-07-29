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
//
// Mockup rewrite (2026-07-29, task #98): `FitRail` — the score-bar rendering of Fit/Want — is
// retired here (K-D1 superseded). The mockup (`docs/superpowers/specs/job-search-mockup/
// JobsMatches.jsx`, `kit.jsx`) never draws a bar or a number for Fit: it reads as a 3px keyline
// rail plus a single mono word ("Strong fit" / "Good fit" / "Fair fit" / "Weak fit"), banded off
// the 0-100 score. `fitBand` and its two lookup tables below are that replacement vocabulary,
// hoisted here rather than duplicated in match-row.tsx and the opportunity-detail screen (#100) —
// same reasoning as `formatPostedOn`: two screens computing the same band from the same number
// must not be free to drift apart. `KeyRow`/`FieldPair`/`SectionHead`/`formatPostedOn` are
// unchanged and stay byte-compatible — overview.tsx, profile.tsx and settings.tsx all import them
// and are off-limits to this task.
import { Fragment, h, type ReactNodeLike } from "./runtime";

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
// Fit band — the mockup's `FIT` table (kit.jsx), translated to host classes
// -------------------------------------------------------------------------------------------
// L9's non-blending rule still applies: a band is derived from Fit alone, never from Fit and Want
// combined, and nothing here renders Want at all — Want has no band or rail in the mockup, only
// the mono value in the detail view's meta line.
//
// Thresholds are this task's own judgment call — the real domain scores Fit 0-100 (score.ts) with
// no band concept anywhere in it, so a mapping had to be invented rather than found. Quartered
// evenly; there is no product ruling to check this against, so treat it as a starting point, not
// a locked decision.
export type FitBand = "strong" | "good" | "fair" | "weak";

export function fitBand(value: number): FitBand {
  if (value >= 85) return "strong";
  if (value >= 65) return "good";
  if (value >= 40) return "fair";
  return "weak";
}

// The row rail's colour. `jds-rail`'s own header (components-keyline.css) names this exact
// use — "a fit band on the match board" — as one of the generalized rail's intended callers.
export const FIT_BAND_RAIL: Record<FitBand, string> = {
  strong: "jds-rail--accent",
  good: "jds-rail--steel",
  fair: "jds-rail--line-strong",
  weak: "jds-rail--line"
};

// The FitMark word's colour. kit.jsx's FIT table pins strong/fair/weak to accent/ink-3/ink-3,
// which the host's eyebrow tone modifiers cover exactly; "good" pins to ink-2, which has no
// dedicated eyebrow tone, so it falls back to the bare `jds-eyebrow` (`--text-subtle`) — close in
// register, not a pixel match. Not treated as a platform gap worth reporting: the mockup's own
// four-band ordering (bright -> quiet -> quiet -> quiet) still holds with this substitution.
export const FIT_BAND_EYEBROW: Record<FitBand, string> = {
  strong: "jds-eyebrow--accent",
  good: "jds-eyebrow",
  fair: "jds-eyebrow--muted",
  weak: "jds-eyebrow--muted"
};

export const FIT_BAND_LABEL: Record<FitBand, string> = {
  strong: "Strong fit",
  good: "Good fit",
  fair: "Fair fit",
  weak: "Weak fit"
};

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
        {/*
          A <div>, not a <p>. `children` is explicitly a node — chips, a figure, a hint — and a
          <p> may only contain phrasing content, so a chip row (<div>) or an empty-state hint
          (<p>) nested here is invalid HTML. React said so out loud in the browser console:
          "In HTML, <div> cannot be a descendant of <p>" and "<p> cannot be a descendant of <p>",
          both pointing at this element. `jds-fact__text` is a plain class selector
          (components-jarvis.css), so the element type carries no styling of its own and the row
          looks identical either way.
        */}
        <div className="jds-fact__text jsm-field__value">{props.children}</div>
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
