// external-modules/job-search/src/web/screens/overview.tsx
// K3 (2026-07-28 keyline-restructure plan): "what is this search doing for me" — a standing
// answer to the question the board itself never sits still long enough to answer (the board is
// sorted, filterable, and one row at a time; this screen is the fixed summary above it).
//
// Redrawn (2026-07-28, mockup-alignment pass) against the Claude Design mockup
// (docs/superpowers/specs/job-search-mockup/JobsOverview.jsx): a two-column hero (setup progress
// + readiness gates) over a second split (setup checkpoints + monitor health), closed by an ink
// rule, with the existing "board at a glance" / "where it's looking" / "what's missing" sections
// carried forward underneath — those three predate the mockup and aren't in it, but they're real
// functionality this screen already had, so they're restyled in place rather than dropped. Two
// translations apply throughout, per the mockup's own README: mono labels become sans +
// tabular-nums (mono retired 2026-07-08, `.jds-eyebrow`/`.jds-hero-figure` already are), and every
// inline `var(--token)` in the mockup's source becomes a `jds-*` host class — this file's own
// stylesheet (styles-screens.css) carries zero design tokens, only grid/gap/spacing layout.
//
// What the mockup draws that this pass does NOT build, and why:
//   - The mockup's primary "Review new matches →" button needs a way to switch this screen's
//     parent to the Matches tab. `OverviewScreenProps` has no such callback and root.tsx (outside
//     this task's file ownership) doesn't pass one — building the button would wire it to nothing.
//   - The mockup's four fixture STEPS (profile/résumé/sources/review) and three fixture GATES
//     (Profile/Resume/Monitoring, each with invented copy) are fiction. "Setup checkpoints" below
//     is real: it walks the actual 5-step `ONBOARDING_STEPS` (role/want/where/comp/sources,
//     domain/criteria.ts) against `profile.completedSteps`. The readiness gates are also real,
//     each backed by a field already fetched on this screen (`profile.readyToCrawl`, whether a
//     résumé exists, whether any board is enabled).
//   - The mockup's "Monitor health" grid shows Schedule/Last checked/Found today figures that
//     don't exist on any wire this screen can read (settings.tsx's own header documents the same
//     gap for job-search.portal.list) — the grid below reports only board counts and a real
//     cross-portal last-success timestamp, never a fabricated schedule or "found today" count.
//
// Composed entirely from reads that already exist (§4 of the original plan: "Overview needs
// nothing new"). Three independent fetches, same idiom as board.tsx/settings.tsx (invokeTool,
// risk:read only — a write from the browser 403s before it runs, so this screen has nothing to
// write and no queue calls at all):
//   - job-search.matches.list  → the figures row and the "read and scored" / "new" / "passed"
//     counts. This is deliberately the SAME read board.tsx makes, through the same paged helper
//     (web/read-board.ts), so the two screens can never disagree about how many roles are on the
//     board — they used to both stop at the tool's 25-row page and call that a board.
//   - job-search.portal.list   → "Where it's looking" and "Monitor health".
//   - job-search.resume.get    → the résumé blocker and the résumé readiness gate. The content is
//     dropped the instant it arrives; this screen only ever needs to know whether a résumé exists.
import { h, useEffect, useState, type ReactNodeLike } from "../runtime";
import { invokeTool } from "../api";
import { readWholeBoard } from "../read-board";
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
// Instrument — a small local building block for the mockup's label-over-value stat unit, built
// straight from the host's `.jds-instrument` class rather than imported from keyline.tsx: that
// file's own `FieldPair` predates this class and draws a `jds-fact` hairline-above-field instead,
// which this task keeps using below for the sections that already existed. This one is only for
// the two brand-new sections (readiness gates' figures are text, not this — Setup checkpoints and
// Monitor health use it for their own reasons below).
// -------------------------------------------------------------------------------------------
function Instrument(props: { label: string; children: ReactNodeLike }): ReactNodeLike {
  return (
    <div className="jds-instrument jds-instrument--unruled">
      <p className="jds-instrument__label">{props.label}</p>
      {props.children}
    </div>
  );
}

// -------------------------------------------------------------------------------------------
// Readiness gates — the mockup's three-gate aside, backed by real fields this screen already
// fetches (no new reads).
// -------------------------------------------------------------------------------------------
type MatchesState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; items: BoardMatch[] };

type PortalsState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; portals: PortalListItem[] };

// Three separate members, not `{ status: "loading" | "error" }` combined into one — the combined
// form doesn't narrow through sequential `resume.status === "loading" ? ... : resume.status ===
// "error" ? ... : resume.hasResume` ternaries (TS keeps the whole two-literal member type until
// both literals are individually excluded, and a member that still carries "error" alongside
// "loading" never loses it that way), same discriminated-union shape MatchesState/PortalsState
// already use above.
type ResumeState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; hasResume: boolean };

interface Gate {
  key: string;
  label: string;
  modifier: "ready" | "idle";
  text: string;
}

function buildGates(profile: Profile, resume: ResumeState, portals: PortalsState): Gate[] {
  const enabledCount =
    portals.status === "ready" ? portals.portals.filter((portal) => portal.enabled).length : 0;
  return [
    {
      key: "profile",
      label: "Profile",
      modifier: profile.readyToCrawl ? "ready" : "idle",
      text: profile.readyToCrawl ? "Ready to search" : "Still finishing setup"
    },
    {
      key: "resume",
      label: "Résumé",
      modifier: resume.status === "ready" && resume.hasResume ? "ready" : "idle",
      text:
        resume.status === "loading"
          ? "Checking…"
          : resume.status === "error"
            ? "Couldn't check"
            : resume.hasResume
              ? "On file"
              : "Not on file yet"
    },
    {
      key: "monitoring",
      label: "Monitoring",
      modifier: portals.status === "ready" && enabledCount > 0 ? "ready" : "idle",
      text:
        portals.status === "loading"
          ? "Checking…"
          : portals.status === "error"
            ? "Couldn't check"
            : enabledCount > 0
              ? `Watching ${enabledCount} board${enabledCount === 1 ? "" : "s"}`
              : "No boards on"
    }
  ];
}

function GatesAside(props: { gates: Gate[] }): ReactNodeLike {
  return (
    <aside className="jsm-ov-gates">
      <span className="jds-eyebrow">Readiness gates</span>
      {props.gates.map((gate) => (
        <div key={gate.key} className="jsm-ov-gate">
          <span className={`jds-indicator jds-indicator--${gate.modifier}`}>
            <span className="jds-indicator__dot" />
          </span>
          <span className="jds-eyebrow">{gate.label}</span>
          <span className="jds-hint">{gate.text}</span>
        </div>
      ))}
    </aside>
  );
}

// -------------------------------------------------------------------------------------------
// Setup checkpoints — the mockup's step list, walking the real ONBOARDING_STEPS against the
// real profile.completedSteps rather than the mockup's own fictional 4-step list.
// -------------------------------------------------------------------------------------------
const STEP_LABELS: Record<(typeof ONBOARDING_STEPS)[number], string> = {
  role: "Role",
  want: "What you want",
  where: "Where",
  comp: "Pay",
  sources: "Job boards"
};

// One honest line per step, describing exactly what `completedSteps` (domain/criteria.ts) checks
// for that step — not marketing copy, a plain restatement of the real gate.
const STEP_HINTS: Record<(typeof ONBOARDING_STEPS)[number], string> = {
  role: "At least one target job title.",
  want: "A sentence about what you actually want.",
  where: "A location, or remote required.",
  comp: "A pay floor — optional, but recommended.",
  sources: "At least one job board turned on."
};

interface Checkpoint {
  step: (typeof ONBOARDING_STEPS)[number];
  label: string;
  hint: string;
  status: "done" | "now" | "todo";
}

function buildCheckpoints(profile: Profile): Checkpoint[] {
  let sawCurrent = false;
  return ONBOARDING_STEPS.map((step) => {
    const done = profile.completedSteps.includes(step);
    let status: Checkpoint["status"];
    if (done) {
      status = "done";
    } else if (!sawCurrent) {
      status = "now";
      sawCurrent = true;
    } else {
      status = "todo";
    }
    return { step, label: STEP_LABELS[step], hint: STEP_HINTS[step], status };
  });
}

function CheckpointRow(props: { key?: string; checkpoint: Checkpoint }): ReactNodeLike {
  const { checkpoint } = props;
  const railTone =
    checkpoint.status === "done" ? "accent" : checkpoint.status === "now" ? "gold" : "line";
  const word =
    checkpoint.status === "done" ? "Done" : checkpoint.status === "now" ? "Now" : "To do";
  return (
    <div className="jds-rail-row jsm-ov-step-row">
      <span className={`jds-rail jds-rail--${railTone}`} />
      <div className="jsm-ov-step-main">
        <span className="jds-eyebrow">{checkpoint.label}</span>
        <p className="jds-hint">{checkpoint.hint}</p>
      </div>
      {/* The mockup tints only the "Done" word with the accent colour — jds-eyebrow--accent
          (added to the host after this screen was first drawn) is exactly that tint, applied
          only to the done state so "Now"/"To do" stay neutral. */}
      <span className={`jds-eyebrow${checkpoint.status === "done" ? " jds-eyebrow--accent" : ""}`}>
        {word}
      </span>
    </div>
  );
}

// -------------------------------------------------------------------------------------------
// Monitor health — the mockup's fact grid, reduced to the facts that are actually on the wire
// (see this file's header: no schedule, no "last checked" distinct from last success, no "found
// today" anywhere on job-search.portal.list's response).
// -------------------------------------------------------------------------------------------
interface HealthFigures {
  boards: number;
  enabled: number;
  needsAttention: number;
  lastSuccess: string | null;
}

function healthFrom(portals: PortalListItem[]): HealthFigures {
  const enabledRows = portals.filter((portal) => portal.enabled);
  const needsAttention = enabledRows.filter((portal) => portal.cause !== null).length;
  // Latest lastOkAt across every portal, by plain string comparison (ISO-8601 instants sort
  // lexically) — never a Date object, same discipline formatPostedOn itself follows.
  let latest: string | null = null;
  for (const portal of portals) {
    if (portal.lastOkAt !== null && (latest === null || portal.lastOkAt > latest)) {
      latest = portal.lastOkAt;
    }
  }
  return {
    boards: portals.length,
    enabled: enabledRows.length,
    needsAttention,
    lastSuccess: formatPostedOn(latest)
  };
}

function healthStatusLine(portals: PortalListItem[]): string {
  if (portals.length === 0) return "No boards configured yet.";
  const enabled = portals.filter((portal) => portal.enabled);
  if (enabled.length === 0) return "No boards enabled.";
  const needsAttention = enabled.filter((portal) => portal.cause !== null).length;
  if (needsAttention === 0) return "All watched boards are healthy.";
  return `${needsAttention} board${needsAttention === 1 ? "" : "s"} need${
    needsAttention === 1 ? "s" : ""
  } attention.`;
}

function HealthSection(props: { state: PortalsState }): ReactNodeLike {
  const { state } = props;
  if (state.status === "loading") {
    return (
      <p className="jds-hint" role="status">
        Checking your boards…
      </p>
    );
  }
  if (state.status === "error") {
    return (
      <p className="jds-hint" role="alert">
        Couldn&rsquo;t check your boards.
      </p>
    );
  }
  const figures = healthFrom(state.portals);
  return (
    <div>
      <div className="jsm-ov-health-grid">
        {/* Values render as `jds-label` text, not `jds-hero-figure` — that class is reserved for
            the "board at a glance" figures below; reusing it here would make this secondary grid
            compete with the primary one for visual weight it isn't meant to have. */}
        <Instrument label="Boards">
          <span className="jds-label">{figures.boards}</span>
        </Instrument>
        <Instrument label="Enabled">
          <span className="jds-label">{figures.enabled}</span>
        </Instrument>
        <Instrument label="Needs attention">
          <span className="jds-label">{figures.needsAttention}</span>
        </Instrument>
        {/* Omitted, not dashed, when no portal has ever succeeded — same "an absent fact reads as
            this board doesn't know" rule formatPostedOn's own header documents. */}
        {figures.lastSuccess !== null ? (
          <Instrument label="Last success">
            <span className="jds-label">{figures.lastSuccess}</span>
          </Instrument>
        ) : null}
      </div>
      <p className="jds-hint">{healthStatusLine(state.portals)}</p>
    </div>
  );
}

// -------------------------------------------------------------------------------------------
// Figures row ("Your board at a glance") — unchanged from the pre-mockup implementation; the
// mockup doesn't draw this section (it's specific to this module's own board), so only its
// section head is restyled to match the new page below, not its internal logic.
// -------------------------------------------------------------------------------------------
async function fetchMatches(profileId: string): Promise<BoardMatch[]> {
  const { items } = await readWholeBoard(profileId);
  return items;
}

// One figure per stat, computed over the same rows the board itself renders — every page of them,
// which is what makes these figures the board's real counts rather than a claim about its first
// 25 rows. Still not a lifetime total: a dismissed role stays on the board and a removed posting
// leaves it, so "on your board" means exactly that.
function figuresFrom(items: BoardMatch[]): {
  onBoard: number;
  readScored: number;
  newCount: number;
  passedCount: number;
} {
  return {
    onBoard: items.length,
    // "Read and scored" reuses board-types.ts's own `isScored` predicate rather than re-deriving
    // "non-null want" here a second time, so the two screens can't drift.
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
      {/* These are what is on the board now, not what the search has found over its lifetime. */}
      <p className="jds-hint jsm-overview__figures-note">
        Counts reflect what is on your board now — not a running total.
      </p>
    </div>
  );
}

// -------------------------------------------------------------------------------------------
// Where it's looking — unchanged from the pre-mockup implementation, same reasoning as the
// figures row above.
// -------------------------------------------------------------------------------------------
async function fetchPortals(profileId: string): Promise<PortalListItem[]> {
  const result = (await invokeTool("job-search.portal.list", { profileId })) as {
    portals?: PortalListItem[];
  } | null;
  return Array.isArray(result?.portals) ? result.portals : [];
}

function PortalRow(props: {
  key?: string;
  portal: PortalListItem;
  divided: boolean;
}): ReactNodeLike {
  const { portal, divided } = props;
  const lastOk = formatPostedOn(portal.lastOkAt);
  return (
    <KeyRow
      divided={divided}
      aside={
        <span className={`jds-indicator jds-indicator--${portal.enabled ? "ready" : "idle"}`}>
          <span className="jds-indicator__dot" />
        </span>
      }
    >
      <div className="jsm-overview__portal-main">
        <span className="jds-eyebrow">{portal.label}</span>
        {lastOk !== null ? <p className="jds-hint">Last worked {lastOk}</p> : null}
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
// What's missing — unchanged from the pre-mockup implementation, same reasoning.
// -------------------------------------------------------------------------------------------
interface Blocker {
  key: string;
  text: string;
}

async function fetchResume(profileId: string): Promise<boolean> {
  const result = (await invokeTool("job-search.resume.get", { profileId })) as {
    resume?: { content?: unknown } | null;
  } | null;
  // Existence only — the content is never assigned to any variable this function returns, let
  // alone held in this screen's own state.
  return typeof result?.resume?.content === "string";
}

// The honest blocker list. Every check here is something ONLY the user can fix; a check for
// something the module itself should be doing does not belong in this list, because there is no
// action here for the user to take against it.
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
    if (missing.length > 0) {
      blockers.push({
        key: "steps",
        text: `Still setting up — needs: ${missing.map((step) => STEP_LABELS[step]).join(", ")}.`
      });
    }
  }

  if (
    portals.status === "ready" &&
    portals.portals.length > 0 &&
    portals.portals.every((p) => !p.enabled)
  ) {
    blockers.push({
      key: "portals",
      text: "Every job board is turned off — nothing will be searched until at least one is back on."
    });
  }

  return blockers;
}

function BlockerRow(props: { key?: string; blocker: Blocker; divided: boolean }): ReactNodeLike {
  return (
    <KeyRow divided={props.divided}>
      <p className="jsm-overview__blocker">{props.blocker.text}</p>
    </KeyRow>
  );
}

function MissingSection(props: { blockers: Blocker[] }): ReactNodeLike {
  // Render nothing at all, not an empty "all good" panel — a section that only ever has bad news
  // to report should not occupy space to say there isn't any.
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
  const gates = buildGates(profile, resume, portals);
  const checkpoints = buildCheckpoints(profile);
  const completedCount = profile.completedSteps.length;

  return (
    <div className="jsm-overview">
      <section className="jsm-ov-hero">
        <div className="jsm-ov-hero-grid">
          <div className="jsm-ov-hero-main">
            <span className="jds-eyebrow jds-eyebrow--gold">
              Setup · {completedCount} of {ONBOARDING_STEPS.length} complete
            </span>
            <h1 className="jds-display jds-display--lg">
              Your search is
              <br />
              <span className="jds-display__accent">
                {profile.readyToCrawl ? "ready to run" : "getting set up"}
              </span>
            </h1>
            <span className="jds-strap jds-strap--gold" aria-hidden="true" />
            <p className="jds-hint jsm-ov-lede">
              What&rsquo;s set up, what&rsquo;s still open, and how your boards are doing.
            </p>
          </div>
          <GatesAside gates={gates} />
        </div>
      </section>

      {/* `.jds-divider` zeroes out `<hr>`'s own browser default border (`border: none` in its
          base rule) before applying its own `border-top` — same element type existing `<hr>`-free
          call sites never needed to reach for, but the reset makes it safe here. */}
      <hr className="jds-divider jds-divider--ink" />

      <section className="jsm-ov-body-grid">
        <div>
          <SectionHead label="Setup checkpoints" />
          <div>
            {checkpoints.map((checkpoint) => (
              <CheckpointRow key={checkpoint.step} checkpoint={checkpoint} />
            ))}
          </div>
        </div>
        <div>
          <SectionHead label="Monitor health" />
          <HealthSection state={portals} />
        </div>
      </section>

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
