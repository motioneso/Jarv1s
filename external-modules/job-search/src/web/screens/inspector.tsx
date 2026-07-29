// external-modules/job-search/src/web/screens/inspector.tsx
//
// Mockup rewrite (2026-07-29, task #100): the opportunity detail screen — JobsMatches.jsx's
// DetailView, a full view-swap (board.tsx's own comment on this, task #99) in place of the old
// 26rem side panel this file used to render. Same file, same export, same prop-shape discipline —
// pure presentation, no invokeTool/runQueue, board.tsx still owns every fetch/write decision and
// hands this file the result — but the render tree below is new top to bottom: a back link,
// display-scale title, a meta line, a 3px rule, then the mockup's 1.35fr/1fr split — the posting on
// the left, "Jarvis's read" on the right, wrapped in the host's `.jds-governor*` block
// (components-jarvis.css) until a decision is made. There is no in-repo precedent for that block —
// grepped clean across every .tsx/.ts file before writing this — so its markup below is built
// directly off the CSS class semantics, not copied from an existing caller.
//
// Two structural rules this screen still exists to honor, carried over unchanged from the old side
// panel:
// - L9 (fit/want non-blending): Fit and Want stay two separately labeled values with their own
//   reasons, never summed, averaged, or folded into one "summary" paragraph — even though the
//   mockup's own DetailView wraps a single `o.summary` string in the Governor block. This board has
//   no summary field, only `fitReason`/`wantReason` (board-types.ts), and forcing them into one
//   paragraph would be exactly the "force fit/want like we have it" this rewrite was told not to do
//   — so both axes ride inside the one Governor block instead, kept apart the same way they always
//   have been.
// - Unscored visibility: a queued (not-yet-scored) match still opens here and says so plainly —
//   "queued for scoring", never "dropped" or a generic error, because it hasn't failed, it just
//   hasn't been read yet.
//
// Data the mockup's DetailView draws that this board cannot — omitted, not fabricated (the task's
// own rule): `desc` (no posting body ever reaches the wire — not "truncated", never stored),
// `recommendation` (no verdict field), `summary` (see L9 above), `evidence`/`blockers`/`gaps`/
// `prefMatch`/`prefConflict`/`unknowns` (no structured arrays exist, only the two reason strings),
// the `Profile rev … · resume rev …` provenance line (no revision concept on the wire), `workMode`/
// `comp` (BoardMatch/MatchDetail carry neither). The mockup's own fallback-copy idiom for a missing
// description ("Ask Jarvis for the full description…") is adapted, not reused verbatim, because it
// specifically claims the copy "was truncated at capture" — untrue here, since no description is
// ever captured at all.
import { Fragment, h, useEffect, useRef, type ReactNodeLike } from "../runtime";
import { Score } from "../score";
import { FIT_BAND_EYEBROW, FIT_BAND_LABEL, SectionHead, fitBand, formatPostedOn } from "../keyline";
import { isScored, type BoardMatch, type MatchDetail } from "../board-types";

export interface InspectorProps {
  match: BoardMatch | null;
  // #1330: fetched by board.tsx via job-search.match.get on selection, never by this file (see
  // header). null while the fetch is in flight or hasn't started, regardless of `detailError` — the
  // two are mutually exclusive states board.tsx guarantees, not asserted again here.
  detail: MatchDetail | null;
  detailError: string | null;
  onClose(): void;
  onDismiss(matchId: string): void;
  // #100: the board's other settable state — worker/handlers/matches.ts's SETTABLE_STATES already
  // allows "seen" through the same queue path Dismiss uses, so this is real, already-wired
  // functionality, not new plumbing. Save was never reachable from the old side panel, which only
  // ever offered Dismiss; both now live together in this screen's one decision block, the same
  // single-action-surface discipline tasks-design.md already rules for a task's own action row,
  // applied here to an opportunity instead.
  onSave(matchId: string): void;
  // Task 20/#1304: null hides the control entirely rather than rendering it disabled — board.tsx is
  // null here whenever assistantSurface is absent OR detail hasn't loaded yet.
  onDiscuss: (() => void) | null;
}

// Host equivalent of the mockup's `GovernorWrapper` (a harness-only component off
// `window.JarvisParkPressDesignSystem_0501fa` — not something this repo can import). The outer
// block carries a hatched border until `is-confirmed`, `__content` sits at reduced opacity until
// then too, and `__tag` is the small icon+label line naming what's inside as unconfirmed AI output.
// The mockup's `actions={false}` on every DetailView call site means the wrapper itself never grows
// a button row — Save/Pass/Discuss live in the decision block below instead, so no
// `.jds-governor__actions` markup exists in this file at all. The tag's own copy ("read against
// your profile and résumé — nothing is sent anywhere") is the mockup's authored `reason` string,
// reused verbatim per the same discipline board.tsx's BUCKET_EMPTY already applies — authored UI
// copy, not fabricated data.
function GovernorBlock(props: { confirmed: boolean; children: ReactNodeLike }): ReactNodeLike {
  return (
    <div className={props.confirmed ? "jds-governor is-confirmed" : "jds-governor"}>
      <div className="jds-governor__tag">
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="9" />
          <path d="M12 8v4M12 16h.01" />
        </svg>
        Read against your profile and résumé — nothing is sent anywhere.
      </div>
      <div className="jds-governor__content">{props.children}</div>
    </div>
  );
}

export function Inspector(props: InspectorProps): ReactNodeLike {
  const { match, detail, detailError } = props;

  // Same scroll-into-view precaution the old side panel used, retargeted at this screen's own
  // root: opening a match near the bottom of a long list still swaps the whole view in from the
  // top, but a page already scrolled deep into that list can leave the new content starting off the
  // fold depending on where the click landed. Optional-chained throughout: the unit renderer has no
  // real DOM nodes to hand back through the ref.
  const rootRef = useRef<{ scrollIntoView?: (opts: unknown) => void } | null>(null);
  const openId = match?.id ?? null;
  useEffect(() => {
    if (openId === null) return;
    rootRef.current?.scrollIntoView?.({ behavior: "smooth", block: "start" });
  }, [openId]);

  if (match === null) {
    return null;
  }

  const scored = isScored(match);
  const band = scored && match.fit !== null ? fitBand(match.fit) : null;
  const posted = formatPostedOn(match.postedAt);
  // Read off match.state, not a local optimistic flag — the same choice the old panel's
  // "Dismissed." status line already made, so reopening a Saved or Passed match from its own bucket
  // shows the real, current decision rather than whatever this component last rendered.
  const decided = match.state === "seen" || match.state === "dismissed";

  return (
    <article ref={rootRef} className="jsm-detail" aria-label={`Details for ${match.title}`}>
      <button
        type="button"
        className="jds-btn jds-btn--quiet jds-btn--sm jsm-detail__back"
        onClick={props.onClose}
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M19 12H5M12 19l-7-7 7-7" />
        </svg>
        Back to matches
      </button>

      <header className="jsm-detail__header">
        {/* The identity line: company, source, and when it was posted — plain text over
            jds-meta-sep, never bullets or slashes (match-row.tsx's own rule for the same kind of
            line). Posted is omitted entirely rather than shown as a dash when the field is empty or
            malformed, same honesty formatPostedOn already gives the board rows. */}
        <div className="jsm-detail__eyebrow">
          <span className="jds-eyebrow">{match.company}</span>
          <span className="jds-meta-sep" aria-hidden="true" />
          <span className="jds-eyebrow">{match.source}</span>
          {posted !== null
            ? h(
                Fragment,
                null,
                <span className="jds-meta-sep" aria-hidden="true" />,
                <span className="jds-eyebrow">Posted {posted}</span>
              )
            : null}
        </div>

        <h1 className="jds-display jds-display--md">{match.title}</h1>

        <div className="jsm-detail__meta">
          {scored ? (
            <span className={band !== null ? FIT_BAND_EYEBROW[band] : "jds-eyebrow jds-eyebrow--muted"}>
              {band !== null ? FIT_BAND_LABEL[band] : "—"}
            </span>
          ) : (
            <span className="jds-eyebrow jds-eyebrow--muted">Not read yet</span>
          )}
          {match.location.length > 0
            ? h(
                Fragment,
                null,
                <span className="jds-meta-sep" aria-hidden="true" />,
                <span className="jds-eyebrow">{match.location}</span>
              )
            : null}
          <span className="jds-meta-sep" aria-hidden="true" />
          {/* Real per-row data (url is BoardMatch's own field, per N39), so this works the instant
              the screen opens — it never waits on the match.get round trip the reasons below depend
              on. Inline in the meta line, not a standalone button: on a full-page detail view this
              is one fact among several, not the loudest thing on the screen the way it had to be in
              the cramped 26rem side panel. */}
          <a className="jds-eyebrow jsm-detail__link" href={match.url} target="_blank" rel="noopener noreferrer">
            View original posting
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
              <path d="M15 3h6v6" />
              <path d="M10 14L21 3" />
            </svg>
          </a>
        </div>
      </header>

      <hr className="jds-divider jds-divider--ink jsm-detail__rule" />

      {/* Gold, not a badge — see match-row.tsx's own comment for the ruling; the same annotation
          must not change shape between the row and this screen. */}
      {match.outsideFrame ? (
        <span className="jds-eyebrow jds-eyebrow--gold">Outside your stated frame</span>
      ) : null}

      <div className="jsm-detail__grid">
        {/* LEFT — the posting. No description field ever reaches this wire (board-types.ts's
            MatchDetail has no `desc`), so there is nothing to render here but an honest explanation
            of why, plus the two ways to actually read the posting. */}
        <div className="jsm-detail__role">
          <SectionHead label="The role" />
          <p className="jsm-detail__role-body">
            This board doesn't store the full posting text. Open the original posting above to read
            it, or ask Jarvis about it in the conversation.
          </p>
        </div>

        {/* RIGHT — Jarvis's read, governed until a decision is made. */}
        <aside className="jsm-detail__read">
          <SectionHead label="Jarvis's read" />
          {scored ? (
            <GovernorBlock confirmed={decided}>
              <div className="jsm-detail-axes">
                <div className="jsm-detail-axis">
                  <span className="jds-eyebrow">Fit</span>
                  {/* K-D1 (superseded): Fit never draws as a bar, percentage or pill anywhere in
                      this module — a band word only, the same rail-less word already shown in the
                      header meta line above and at row level (match-row.tsx). Reusing `band` here
                      (not re-deriving it) is the same "two screens computing the same thing must
                      not drift" reasoning keyline.tsx's own header gives fitBand.
                      An em dash, not a band, when Fit has no basis at all (fit-zero-without-resume
                      is a known, separate bug — see this task's own report). */}
                  {match.fit === null ? (
                    <p className="jsm-detail-axis__value">—</p>
                  ) : (
                    <span className={band !== null ? FIT_BAND_EYEBROW[band] : "jds-eyebrow jds-eyebrow--muted"}>
                      {band !== null ? FIT_BAND_LABEL[band] : "—"}
                    </span>
                  )}
                  {detail ? (
                    <p>{detail.fitReason}</p>
                  ) : detailError ? (
                    <p role="alert">{detailError}</p>
                  ) : (
                    <p role="status">Loading the reason…</p>
                  )}
                </div>
                <div className="jsm-detail-axis">
                  <span className="jds-eyebrow">Want</span>
                  <Score value={match.want} size="lg" />
                  {detail ? (
                    <p>{detail.wantReason}</p>
                  ) : detailError ? (
                    <p role="alert">{detailError}</p>
                  ) : (
                    <p role="status">Loading the reason…</p>
                  )}
                </div>
              </div>
            </GovernorBlock>
          ) : (
            // Not a spinner, not an error: this posting is sitting in the scoring queue, which can
            // legitimately run behind a crawl. Saying so plainly is the whole point.
            <p role="status">
              Not read yet — this posting is queued for scoring, not dropped. Fit and Want will
              appear here once it's been read.
            </p>
          )}

          {/* The decision block — Save, Pass and (when available) Discuss all live here together,
              the one action surface for this screen, rather than scattered across a top action row
              and a bottom one the way the old side panel split them. */}
          <div className="jsm-detail-decision">
            <hr className="jds-divider jds-divider--ink jsm-detail__rule" />
            <span className="jds-eyebrow">Your decision</span>
            {decided ? (
              <div className="jsm-detail-decision__current">
                <span className={match.state === "seen" ? "jds-badge jds-badge--forest" : "jds-badge jds-badge--neutral"}>
                  {match.state === "seen" ? "Saved" : "Passed"}
                </span>
              </div>
            ) : null}
            <div className="jsm-detail-decision__actions">
              <button
                type="button"
                className="jds-btn jds-btn--primary jds-btn--sm"
                onClick={() => props.onSave(match.id)}
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
                </svg>
                Save
              </button>
              <button
                type="button"
                className="jds-btn jds-btn--secondary jds-btn--sm"
                onClick={() => props.onDismiss(match.id)}
              >
                Pass
              </button>
              {props.onDiscuss ? (
                <button type="button" className="jds-btn jds-btn--quiet jds-btn--sm" onClick={props.onDiscuss}>
                  Discuss
                </button>
              ) : null}
            </div>
          </div>
        </aside>
      </div>
    </article>
  );
}
