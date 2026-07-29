// external-modules/job-search/src/web/screens/overview.tsx
// K3 (2026-07-28 keyline-restructure plan): "what is this search doing for me" — a standing
// answer to the question the board itself never sits still long enough to answer (the board is
// sorted, filterable, and one row at a time; this screen is the fixed summary above it). Not
// mounted anywhere yet — K5 wires this into the four-tab shell later (root.tsx stays untouched
// by this task, per the coordinator's file-ownership split).
//
// Composed entirely from reads that already exist (§4 of the plan: "Overview needs nothing
// new"). Three independent fetches, same idiom as board.tsx/settings.tsx (invokeTool, risk:read
// only — a write from the browser 403s before it runs, so this screen has nothing to write and
// no queue calls at all):
//   - job-search.matches.list  → the figures row and the "read and scored" / "new" / "passed"
//     counts. This is deliberately the SAME read board.tsx makes, not a derived total — see the
//     module comment on MATCHES_LIST_MAX_LIMIT below for why "on your board" cannot mean more
//     than the capped 25 rows the tool is willing to return. Plan §4 notes this could in
//     principle share a single fetch with the board screen once both are mounted together (K5);
//     until then each screen owns its own read, the same way board.tsx and settings.tsx already
//     fetch independently of each other.
//   - job-search.portal.list   → "Where it's looking".
//   - job-search.resume.get    → the résumé blocker in "What's missing". The content is dropped
//     the instant it arrives; this screen only ever needs to know whether a résumé exists, never
//     what it says (settings.tsx's ResumeRow is the existing precedent for this exact discipline
//     — see its own header for why: "the one thing on this surface the user has no reason to
//     re-read here").
import { h, useEffect, useState, type ReactNodeLike } from "../runtime";
import { invokeTool } from "../api";
import { MATCHES_LIST_MAX_LIMIT } from "../../domain/records.js";
import { ONBOARDING_STEPS } from "../../domain/criteria.js";
import { FieldPair, KeyRow, SectionHead, formatPostedOn } from "../keyline";
import { isScored, type BoardMatch, type PortalListItem } from "../board-types";
import type { Profile } from "../use-profiles";

export interface OverviewScreenProps {
  profileId: string;
  // The already-fetched record, same idiom SettingsScreen already takes (`profile: Profile`) —
  // Root/ActiveProfilePanel has this in hand from useProfiles before either screen mounts, so
  // there is no reason for this screen to re-derive `readyToCrawl`/`completedSteps` from a
  // second profile.list read of its own.
  profile: Profile;
}

// -------------------------------------------------------------------------------------------
// Figures row
// -------------------------------------------------------------------------------------------
type MatchesState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; items: BoardMatch[] };

async function fetchMatches(profileId: string): Promise<BoardMatch[]> {
  const result = (await invokeTool("job-search.matches.list", {
    profileId,
    limit: MATCHES_LIST_MAX_LIMIT
  })) as { items?: BoardMatch[] } | null;
  return Array.isArray(result?.items) ? (result!.items as BoardMatch[]) : [];
}

// One figure per stat, computed over the same ≤25 rows the board itself renders. Deliberately
// NOT a total: matches.list has a hard cap (see MATCHES_LIST_MAX_LIMIT's own header in
// domain/records.ts — the 16 000-char render cap the browser REST route enforces, above which
// the board would render zero rows rather than a short list). A count over these rows is
// therefore a claim about "the board right now", never "everything this search has ever found" —
// the caption under the row says that explicitly rather than leaving it implied.
function figuresFrom(items: BoardMatch[]): { onBoard: number; readScored: number; newCount: number; passedCount: number } {
  return {
    onBoard: items.length,
    // "Read and scored" reuses board-types.ts's own `isScored` predicate rather than re-deriving
    // "non-null want" here a second time — the plan names it as a parenthetical definition, but
    // isScored is the one place that definition is allowed to live so the two screens can't drift
    // (the same reasoning K1's header gives for hoisting formatPostedOn out of board.tsx).
    readScored: items.filter(isScored).length,
    newCount: items.filter((item) => item.state === "new").length,
    passedCount: items.filter((item) => item.state === "dismissed").length
  };
}

function FiguresSection(props: { state: MatchesState }): ReactNodeLike {
  const { state } = props;
  if (state.status === "loading") {
    return (
      <p className="jds-hint" role="status">
        Loading your board…
      </p>
    );
  }
  if (state.status === "error") {
    return (
      <p className="jds-hint" role="alert">
        Couldn&rsquo;t load your board counts.
      </p>
    );
  }
  const figures = figuresFrom(state.items);
  return (
    <div className="jsm-overview__figures">
      <div className="jsm-fields">
        <FieldPair label="On your board">
          <span className="jds-hero-figure">{figures.onBoard}</span>
        </FieldPair>
        <FieldPair label="Read and scored">
          <span className="jds-hero-figure">{figures.readScored}</span>
        </FieldPair>
        <FieldPair label="New">
          <span className="jds-hero-figure">{figures.newCount}</span>
        </FieldPair>
        <FieldPair label="Passed">
          <span className="jds-hero-figure">{figures.passedCount}</span>
        </FieldPair>
      </div>
      {/* The caveat every figure above needs: matches.list is capped at MATCHES_LIST_MAX_LIMIT
          rows, so these are board counts, never lifetime totals — a search that has actually
          seen 80 postings still reads "25" here, and saying so plainly beats letting the number
          imply something the tool can't back up. */}
      <p className="jds-hint jsm-overview__figures-note">
        Counts reflect the {MATCHES_LIST_MAX_LIMIT} matches currently on your board — not a
        running total.
      </p>
    </div>
  );
}

// -------------------------------------------------------------------------------------------
// Where it's looking
// -------------------------------------------------------------------------------------------
type PortalsState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; portals: PortalListItem[] };

async function fetchPortals(profileId: string): Promise<PortalListItem[]> {
  const result = (await invokeTool("job-search.portal.list", { profileId })) as {
    portals?: PortalListItem[];
  } | null;
  return Array.isArray(result?.portals) ? result.portals : [];
}

// `key` is declared explicitly on the props type (not just passed at the call site) — a bare JSX
// `key` attribute on a custom component whose props type doesn't list it fails typecheck under
// this module's own JSX pragma (no real React.FC typing to special-case `key` for us); settings.tsx's
// PortalRowView is the existing precedent for declaring it this way rather than working around it.
function PortalRow(props: { key?: string; portal: PortalListItem; divided: boolean }): ReactNodeLike {
  const { portal, divided } = props;
  const lastOk = formatPostedOn(portal.lastOkAt);
  return (
    <KeyRow
      divided={divided}
      aside={
        // The modifier lives on the wrapper, not the dot itself (components-core.css:
        // `.jds-indicator--ready .jds-indicator__dot`) — the dot element carries no colour class
        // of its own.
        <span className={`jds-indicator jds-indicator--${portal.enabled ? "ready" : "idle"}`}>
          <span className="jds-indicator__dot" />
        </span>
      }
    >
      <div className="jsm-overview__portal-main">
        <span className="jds-eyebrow">{portal.label}</span>
        {/* Omitted, not dashed, when there's no successful run yet — same "an absent fact reads
            as this board doesn't know" rule keyline.tsx's own formatPostedOn documents. */}
        {lastOk !== null ? <p className="jds-hint">Last worked {lastOk}</p> : null}
        {/* Verbatim, never composed here — cause.summary/nextAction are the single authored voice
            for a failure (records.ts's describeFailure, board.tsx's PortalBanner precedent). This
            screen adds no sentence of its own about WHY a portal is off; the dot above already
            says whether it's on. */}
        {portal.cause !== null ? (
          <p className="jds-hint jsm-overview__portal-cause">
            {portal.cause.summary} {portal.cause.nextAction}
          </p>
        ) : null}
      </div>
    </KeyRow>
  );
}

function PortalsSection(props: { state: PortalsState }): ReactNodeLike {
  const { state } = props;
  if (state.status === "loading") {
    return (
      <p className="jds-hint" role="status">
        Loading your job boards…
      </p>
    );
  }
  if (state.status === "error") {
    return (
      <p className="jds-hint" role="alert">
        Couldn&rsquo;t load your job boards.
      </p>
    );
  }
  if (state.portals.length === 0) {
    return <p className="jds-hint">No job boards configured yet.</p>;
  }
  return (
    <div className="jsm-overview__portals">
      {state.portals.map((portal, index) => (
        <PortalRow key={portal.sourceId} portal={portal} divided={index > 0} />
      ))}
    </div>
  );
}

// -------------------------------------------------------------------------------------------
// What's missing
// -------------------------------------------------------------------------------------------

/** What each onboarding step is called on screen — mirrors onboarding.tsx's own STEP_LABELS
 *  verbatim (that file's header explains the chip wording). Kept as its own small literal here
 *  rather than imported: onboarding.tsx doesn't export it, and a five-entry copy/paste is a
 *  smaller risk than reaching into another screen file for a constant not on its public surface
 *  (this module's screens don't import each other — see board.tsx/inspector.tsx's own split for
 *  why, restated in keyline.tsx's header). Typed as a total record over the step union so a step
 *  added to the domain list is a compile error here, not a silently un-labelled blocker line. */
const STEP_LABELS: Record<(typeof ONBOARDING_STEPS)[number], string> = {
  role: "Role",
  want: "What you want",
  where: "Where",
  comp: "Pay",
  sources: "Job boards"
};

interface Blocker {
  key: string;
  text: string;
}

type ResumeState = { status: "loading" | "error" } | { status: "ready"; hasResume: boolean };

async function fetchResume(profileId: string): Promise<boolean> {
  const result = (await invokeTool("job-search.resume.get", { profileId })) as {
    resume?: { content?: unknown } | null;
  } | null;
  // Existence only — the content is never assigned to any variable this function returns, let
  // alone held in this screen's own state (see this file's header). typeof-checked rather than
  // just `Boolean(result?.resume)` so a malformed/empty-string content still counts as "no résumé
  // on file", matching settings.tsx's fetchResume same-shape guard.
  return typeof result?.resume?.content === "string";
}

// The honest blocker list, and the reason this section earns its place on the screen at all —
// see the plan's own framing. Every check here is something ONLY the user can fix; a check for
// something the module itself should be doing (like "no matches yet, try again later") does not
// belong in this list, because there is no action here for the user to take against it.
function buildBlockers(profile: Profile, resume: ResumeState, portals: PortalsState): Blocker[] {
  const blockers: Blocker[] = [];

  if (resume.status === "ready" && !resume.hasResume) {
    blockers.push({
      key: "resume",
      text:
        "No résumé on file — Fit stays empty until there is one. Paste yours into the chat to " +
        "get started."
    });
  }

  if (!profile.readyToCrawl) {
    const missing = ONBOARDING_STEPS.filter((step) => !profile.completedSteps.includes(step));
    // readyToCrawl false with an empty missing list would be a contradiction the record itself
    // shouldn't produce, but this component still renders nothing rather than an empty "Still
    // needs:" sentence if it ever does — an empty list here is a bug to notice, not a blocker to
    // announce.
    if (missing.length > 0) {
      blockers.push({
        key: "steps",
        text: `Still setting up — needs: ${missing.map((step) => STEP_LABELS[step]).join(", ")}.`
      });
    }
  }

  if (portals.status === "ready" && portals.portals.length > 0 && portals.portals.every((p) => !p.enabled)) {
    blockers.push({
      key: "portals",
      text: "Every job board is turned off — nothing will be searched until at least one is back on."
    });
  }

  return blockers;
}

// A thin keyed wrapper around KeyRow (imported from keyline.tsx, which this task doesn't own and
// can't add a `key` prop to) — same reasoning as PortalRow above: a bare JSX `key` on a component
// whose own props type doesn't declare it fails typecheck under this module's JSX pragma.
function BlockerRow(props: { key?: string; blocker: Blocker; divided: boolean }): ReactNodeLike {
  return (
    <KeyRow divided={props.divided}>
      <p className="jsm-overview__blocker">{props.blocker.text}</p>
    </KeyRow>
  );
}

function MissingSection(props: { blockers: Blocker[] }): ReactNodeLike {
  // Render nothing at all, not an empty "all good" panel — the plan's own instruction: a section
  // that only ever has bad news to report should not occupy space to say there isn't any.
  if (props.blockers.length === 0) return null;
  return (
    <section className="jsm-overview__section">
      <SectionHead label="What's missing" />
      <div className="jsm-overview__blockers">
        {props.blockers.map((blocker, index) => (
          <BlockerRow key={blocker.key} blocker={blocker} divided={index > 0} />
        ))}
      </div>
    </section>
  );
}

// -------------------------------------------------------------------------------------------
// OverviewScreen
// -------------------------------------------------------------------------------------------
export function OverviewScreen(props: OverviewScreenProps): ReactNodeLike {
  const { profileId, profile } = props;
  const [matches, setMatches] = useState<MatchesState>({ status: "loading" });
  const [portals, setPortals] = useState<PortalsState>({ status: "loading" });
  const [resume, setResume] = useState<ResumeState>({ status: "loading" });

  // Three independent effects, each guarded against a stale write the same way board.tsx's
  // detail fetch and settings.tsx's resume fetch already are: a profile switch mid-flight must
  // never let the PREVIOUS profile's response land under the newly selected one's screen.
  useEffect(() => {
    let cancelled = false;
    setMatches({ status: "loading" });
    fetchMatches(profileId)
      .then((items) => {
        if (!cancelled) setMatches({ status: "ready", items });
      })
      .catch(() => {
        if (!cancelled) setMatches({ status: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [profileId]);

  useEffect(() => {
    let cancelled = false;
    setPortals({ status: "loading" });
    fetchPortals(profileId)
      .then((list) => {
        if (!cancelled) setPortals({ status: "ready", portals: list });
      })
      .catch(() => {
        if (!cancelled) setPortals({ status: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [profileId]);

  useEffect(() => {
    let cancelled = false;
    setResume({ status: "loading" });
    fetchResume(profileId)
      .then((hasResume) => {
        if (!cancelled) setResume({ status: "ready", hasResume });
      })
      .catch(() => {
        if (!cancelled) setResume({ status: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [profileId]);

  const blockers = buildBlockers(profile, resume, portals);

  return (
    <div className="jsm-overview">
      <section className="jsm-overview__section">
        <SectionHead label="Your board at a glance" />
        <FiguresSection state={matches} />
      </section>

      <section className="jsm-overview__section">
        <SectionHead label="Where it's looking" />
        <PortalsSection state={portals} />
      </section>

      <MissingSection blockers={blockers} />
    </div>
  );
}
