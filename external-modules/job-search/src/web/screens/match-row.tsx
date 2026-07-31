// external-modules/job-search/src/web/screens/match-row.tsx
//
// Mockup rewrite (2026-07-29, task #98): replaces the old `KeyRow`+`FitRail` anatomy with the
// mockup's own `OppRow` (`docs/superpowers/specs/job-search-mockup/JobsMatches.jsx`), verbatim in
// structure: a single `3px 1fr auto` button, hairline-ruled on top, with a leading fit-band rail,
// a title+company+meta main column, and a trailing fit word + chevron. No cards, no score bars,
// Save/Pass sit beside undecided real rows so triage does not require opening every inspector.
//
// Still pure presentation, same discipline as before: board.tsx owns the fetch/sort/select
// decision, this file only renders one `BoardMatch` it's handed and calls back through props.
// No invokeTool/runQueue here.
import { Fragment, h, type ReactNodeLike } from "../runtime";
import {
  FIT_BAND_EYEBROW,
  FIT_BAND_LABEL,
  FIT_BAND_RAIL,
  fitBand,
  formatPostedOn
} from "../keyline";
import { isScored, type BoardMatch } from "../board-types";

export interface MatchRowProps {
  /** Not read by this component — board.tsx passes `key={item.id}` on every mapped call the same
   *  way it does for every other list here. The custom h() pragma types `key` as an ordinary prop
   *  rather than stripping it the way React's own JSX.IntrinsicAttributes does, so every row-
   *  component props type in this module declares it optionally to keep `key={...}` typechecking
   *  on a call site. */
  key?: string;
  item: BoardMatch;
  /** Opens the opportunity-detail view (a full view-swap, not a drawer or side panel — see
   *  board.tsx's own header once #99 lands). The whole row is the click surface, matching the
   *  mockup's `<button onClick={() => onOpen(o.id)}>` — there is no separate title button inside
   *  it the way the old two-button row had. */
  onOpen(matchId: string): void;
  onSave(matchId: string): void;
  onPass(matchId: string): void;
}

export function MatchRow(props: MatchRowProps): ReactNodeLike {
  const { item } = props;
  const scored = isScored(item);
  // Fit is judged against the résumé and can be null even on a scored row (Want is always
  // answerable — see board-types.ts's isScored header); a null Fit renders as an em dash here,
  // never a band, the same "no basis to score" honesty the retired FitRail drew.
  const band = scored && item.fit !== null ? fitBand(item.fit) : null;
  const posted = formatPostedOn(item.postedAt);

  return (
    <div className="jsm-row-shell">
      <hr className="jds-divider jsm-row-shell__rule" />
      <button
        id={`job-search-match-${item.id}`}
        data-match-id={item.id}
        type="button"
        className="jds-hairline-row jsm-row"
        onClick={() => props.onOpen(item.id)}
      >
        {/* The leading rail — band-coloured when Fit has an answer, the quietest tone otherwise.
            Never a border on the row itself (see jds-rail's own header in components-keyline.css). */}
        <span
          className={`jds-rail ${band !== null ? FIT_BAND_RAIL[band] : "jds-rail--line"}`}
          aria-hidden="true"
        />
        <span className="jsm-row__main">
          <span className="jsm-row__heading">
            <span className="jds-card-title jds-card-title--heavy">{item.title}</span>
            <span className="jds-section-sub">{item.company}</span>
          </span>
          {/* The factual line: source, location, when it was posted — plain text separated by the
              host's 1x9 hairline (jds-meta-sep), never bullets, slashes or an outline pill (the
              mockup's own rule for this line). Each item is omitted entirely when its field is
              empty rather than rendered as a dash — an absent item reads as "this board doesn't
              know", which is the truth; a placeholder reads as broken. */}
          <span className="jsm-row__meta">
            <span className="jds-eyebrow">{item.source}</span>
            {item.location.length > 0
              ? h(
                  Fragment,
                  null,
                  <span className="jds-meta-sep" aria-hidden="true" />,
                  <span className="jds-eyebrow">{item.location}</span>
                )
              : null}
            {posted !== null
              ? h(
                  Fragment,
                  null,
                  <span className="jds-meta-sep" aria-hidden="true" />,
                  <span className="jds-eyebrow">Posted {posted}</span>
                )
              : null}
            {/* Gold, not a badge — the mockup's own caution register (its Stale meta line and
                NoteList items both render as plain coloured text, never a filled pill) and the
                meta line's own rule above ("never bullets, slashes or an outline pill"). Team
                ruling: jds-eyebrow--gold reads as amber here the same way jds-rail--gold would on a
                rail, without a raw colour or an invented class. */}
            {item.outsideFrame
              ? h(
                  Fragment,
                  null,
                  <span className="jds-meta-sep" aria-hidden="true" />,
                  <span className="jds-eyebrow jds-eyebrow--gold">Outside your stated frame</span>
                )
              : null}
          </span>
        </span>
        <span className="jsm-row__aside">
          {scored ? (
            <span
              className={band !== null ? FIT_BAND_EYEBROW[band] : "jds-eyebrow jds-eyebrow--muted"}
            >
              {band !== null ? FIT_BAND_LABEL[band] : "—"}
            </span>
          ) : (
            <span className="jds-eyebrow jds-eyebrow--muted">Not read yet</span>
          )}
          {/* No shared icon library reaches a module bundle (verified: nothing under apps/web/src
              exports one) — an inline stroke SVG, following finance's reports.tsx precedent, is the
              established way a module draws a glyph. */}
          <span className="jsm-row__chevron" aria-hidden="true">
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M9 6l6 6-6 6" />
            </svg>
          </span>
        </span>
      </button>
      {item.state === "new" ? (
        <div className="jsm-row__actions" aria-label={`Decide on ${item.title}`}>
          <button
            type="button"
            className="jds-btn jds-btn--quiet jds-btn--sm"
            aria-label={`Save ${item.title}`}
            onClick={() => props.onSave(item.id)}
          >
            Save
          </button>
          <button
            type="button"
            className="jds-btn jds-btn--quiet jds-btn--sm"
            aria-label={`Pass on ${item.title}`}
            onClick={() => props.onPass(item.id)}
          >
            Pass
          </button>
        </div>
      ) : null}
    </div>
  );
}
