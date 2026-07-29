// external-modules/job-search/src/web/screens/match-row.tsx
// K2 (2026-07-28 keyline-restructure plan): one board row, extracted out of board.tsx before
// that file grew past it (board.tsx was already at 697/1000 lines — see this task's own note in
// the plan). Pure presentation, same discipline inspector.tsx already follows: board.tsx owns
// every fetch/sort/dismiss/select decision, this file only renders one BoardMatch it's handed
// and calls back through onSelect/onDismiss. No invokeTool/runQueue here.
//
// Built on KeyRow/FitRail from keyline.tsx (K1) — this file's whole job is composing those two
// primitives into the row anatomy this plan's K2 section draws:
//
//   title (jds-card-title button, opens inspector)
//   company
//   source · location · Posted Jul 15                    ← .jsm-meta, unchanged from before
//                                        FIT ▓▓▓░ 80  WANT ▓▓░░ 70   Dismiss   ← aside
//
// One deliberate departure from the plan's own ASCII sketch: it draws title and company on one
// line. `jds-card-title` (components-core.css) is `display: block; width: 100%` by design — the
// host's own comment says that's deliberate, so a two-line role title never centres itself — and
// fighting that from module CSS (which may not touch color/font/border and shouldn't be turning a
// host primitive's own layout decision into a per-caller override either) isn't a fight worth
// having for a sketch this plan already says was reconstructed from kit vocabulary, not copied
// from a mockup nobody on this plan could read (§2). Title and company stack instead, title first
// since it's still the answer to the question a board opens on.
import { Fragment, h, type ReactNodeLike } from "../runtime";
import { FitRail, formatPostedOn, KeyRow } from "../keyline";
import { isScored, type BoardMatch } from "../board-types";

export interface MatchRowProps {
  /** Not read by this component — board.tsx passes `key={item.id}` on every mapped call the same
   *  way it does for every other list here (settings.tsx's PortalRowView, overview.tsx's
   *  PortalRow/BlockerRow). The custom h() pragma types `key` as an ordinary prop rather than
   *  stripping it the way React's own JSX.IntrinsicAttributes does, so every row-component props
   *  type in this module declares it optionally to keep `key={...}` typechecking on a call site. */
  key?: string;
  item: BoardMatch;
  /** Mirrors KeyRow's own prop — the caller (board.tsx) passes `i > 0` over its mapped list so
   *  the first row opens with no leading rule. */
  divided: boolean;
  /** Whether this row's match is the one open in the inspector — forwarded straight to KeyRow's
   *  own `aria-selected`, not reinterpreted here. */
  selected: boolean;
  onSelect(matchId: string): void;
  onDismiss(matchId: string): void;
}

export function MatchRow(props: MatchRowProps): ReactNodeLike {
  const { item } = props;
  const scored = isScored(item);
  const posted = formatPostedOn(item.postedAt);

  return (
    <KeyRow
      divided={props.divided}
      selected={props.selected}
      // Plain h(Fragment, ...) calls, not <>...</> or <Fragment> JSX shorthand — root.tsx's own
      // comment on BoardPlaceholder explains why: our loosely-typed `Fragment: unknown` import has
      // no call/construct signature for TS's JSX checker to resolve against.
      aside={h(
        Fragment,
        null,
        scored
          ? // Fit and Want are never blended (L9) — two FitRails, never a single combined figure.
            // FitRail itself (keyline.tsx) is what draws the em dash instead of a 0 when
            // `item.fit` is null; this file never special-cases that.
            h(
              Fragment,
              null,
              <FitRail label="Fit" value={item.fit} />,
              <FitRail label="Want" value={item.want} />
            )
          : // Unscored keeps the sentence in place of the axes rather than regressing to two em
            // dashes — a pair of blank instruments reads as a measurement that came back empty,
            // and this posting hasn't been read yet, not measured and found wanting.
            <span className="jds-eyebrow jsm-row__pending">Not read yet</span>,
        // stopPropagation is defensive, not load-bearing here — KeyRow draws no click handler of
        // its own (only the title button below opens the row), but the whole-card click board.tsx
        // used to have is exactly the failure mode this guarded against, and a future row-level
        // click handler landing here without noticing this button exists is cheaper to prevent
        // now than to debug later.
        <button
          type="button"
          className="jds-btn jds-btn--quiet jds-btn--sm"
          onClick={(event?: { stopPropagation?(): void }) => {
            event?.stopPropagation?.();
            props.onDismiss(item.id);
          }}
        >
          Dismiss
        </button>
      )}
    >
      {/* The only click surface left on the row — KeyRow itself takes no onClick (see its own
          header: presentational only), so opening a match now happens exclusively through this
          button, not "anywhere on the row" the old `.jsm-card--interactive` card offered. */}
      <button
        type="button"
        className="jds-card-title"
        onClick={() => props.onSelect(item.id)}
      >
        {item.title}
      </button>
      <span className="jds-eyebrow">{item.company}</span>

      {/* The factual line: where the posting came from, where the job is, when it was posted,
          and — new in K2 — whether it's outside the stated frame. Each pill is omitted when its
          field is empty rather than rendered as a dash (unchanged reasoning from before K2: an
          absent pill reads as "this board doesn't know", which is the truth; a row of
          placeholders reads as broken). The outside-frame flag used to dim the whole card
          (`.jsm-card--outside { opacity: 0.85 }`); it moves here as a chip instead, because a
          dimmed row reads as disabled, which this one is not — it's still shown deliberately. */}
      <div className="jsm-meta">
        {item.outsideFrame ? (
          <span className="jds-badge jds-badge--outline jsm-meta__pill">
            Outside your stated frame
          </span>
        ) : null}
        <span className="jds-eyebrow jsm-meta__pill">{item.source}</span>
        {item.location.length > 0 ? (
          <span className="jds-eyebrow jsm-meta__pill">{item.location}</span>
        ) : null}
        {posted !== null ? <span className="jds-eyebrow jsm-meta__pill">Posted {posted}</span> : null}
      </div>
    </KeyRow>
  );
}
