// Operational summary for one active or paused Job Search profile. This screen reads the same
// paged board, portal health, and résumé state as the surrounding screens; it adds no write path
// and invents no schedule metadata.
import { h, useEffect, useState, type ReactNodeLike } from "../runtime";
import { invokeTool } from "../api";
import { readWholeBoard } from "../read-board";
import { ONBOARDING_STEPS } from "../../domain/criteria.js";
import { FieldPair, KeyRow, SectionHead, formatPostedOn } from "../keyline";
import { isScored, matchBucket, type BoardMatch, type PortalListItem } from "../board-types";
import type { Profile } from "../use-profiles";

export interface OverviewScreenProps {
  profileId: string;
  profile: Profile;
  onReviewUnreviewed(): void;
}

type MatchesState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; items: BoardMatch[] };

type PortalsState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; portals: PortalListItem[] };

type ResumeState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; hasResume: boolean };

async function fetchMatches(profileId: string): Promise<BoardMatch[]> {
  return (await readWholeBoard(profileId)).items;
}

async function fetchPortals(profileId: string): Promise<PortalListItem[]> {
  const result = (await invokeTool("job-search.portal.list", { profileId })) as {
    portals?: PortalListItem[];
  } | null;
  return Array.isArray(result?.portals) ? result.portals : [];
}

async function fetchResume(profileId: string): Promise<boolean> {
  const result = (await invokeTool("job-search.resume.get", { profileId })) as {
    resume?: { content?: unknown } | null;
  } | null;
  return typeof result?.resume?.content === "string";
}

function boardFigures(items: BoardMatch[]): {
  unreviewed: number;
  scored: number;
  queued: number;
} {
  return {
    unreviewed: items.filter((item) => matchBucket(item) === "unreviewed").length,
    scored: items.filter(isScored).length,
    queued: items.filter((item) => item.state === "unscored").length
  };
}

function sourceFigures(portals: PortalListItem[]): {
  issues: number;
  lastSuccess: string;
} {
  let latest: string | null = null;
  let issues = 0;
  for (const portal of portals) {
    if (portal.cause !== null) issues++;
    if (portal.lastOkAt !== null && (latest === null || portal.lastOkAt > latest)) {
      latest = portal.lastOkAt;
    }
  }
  return { issues, lastSuccess: formatPostedOn(latest) ?? "Not yet" };
}

function StatusFacts(props: {
  matches: MatchesState;
  portals: PortalsState;
  onReviewUnreviewed(): void;
}): ReactNodeLike {
  if (props.matches.status === "loading" || props.portals.status === "loading") {
    return (
      <p className="jds-hint" role="status">
        Loading search status…
      </p>
    );
  }
  if (props.matches.status === "error" || props.portals.status === "error") {
    return (
      <p className="jds-hint" role="alert">
        Couldn&rsquo;t load search status.
      </p>
    );
  }

  const board = boardFigures(props.matches.items);
  const sources = sourceFigures(props.portals.portals);
  return (
    <div className="jsm-overview__status">
      <div className="jsm-fields">
        <FieldPair label="Unreviewed">
          <span className="jds-hero-figure">{board.unreviewed}</span>
        </FieldPair>
        <FieldPair label="Scored">
          <span className="jds-hero-figure">{board.scored}</span>
        </FieldPair>
        <FieldPair label="Queued">
          <span className="jds-hero-figure">{board.queued}</span>
        </FieldPair>
        <FieldPair label="Last successful check">{sources.lastSuccess}</FieldPair>
        <FieldPair label="Source issues">
          <span className="jds-hero-figure">{sources.issues}</span>
        </FieldPair>
      </div>
      <button
        type="button"
        className="jds-btn jds-btn--primary jds-btn--sm"
        onClick={props.onReviewUnreviewed}
      >
        Review unreviewed roles
      </button>
    </div>
  );
}

function PortalRow(props: {
  key?: string;
  portal: PortalListItem;
  divided: boolean;
}): ReactNodeLike {
  const lastSuccess = formatPostedOn(props.portal.lastOkAt);
  return (
    <KeyRow
      divided={props.divided}
      aside={
        <span className={`jds-indicator jds-indicator--${props.portal.enabled ? "ready" : "idle"}`}>
          <span className="jds-indicator__dot" />
          <span className="jds-eyebrow">{props.portal.enabled ? "Enabled" : "Paused"}</span>
        </span>
      }
    >
      <span className="jds-label">{props.portal.label}</span>
      {lastSuccess ? <p className="jds-hint">Last successful check {lastSuccess}</p> : null}
      {props.portal.cause ? (
        <p className="jds-hint">
          {props.portal.cause.summary} {props.portal.cause.nextAction}
        </p>
      ) : null}
    </KeyRow>
  );
}

function SourcesSection(props: { state: PortalsState }): ReactNodeLike {
  if (props.state.status === "loading") {
    return (
      <p className="jds-hint" role="status">
        Checking sources…
      </p>
    );
  }
  if (props.state.status === "error") {
    return (
      <p className="jds-hint" role="alert">
        Couldn&rsquo;t check sources.
      </p>
    );
  }
  if (props.state.portals.length === 0) {
    return <p className="jds-hint">No job boards configured yet.</p>;
  }
  return (
    <div>
      {props.state.portals.map((portal, index) => (
        <PortalRow key={portal.sourceId} portal={portal} divided={index > 0} />
      ))}
    </div>
  );
}

interface Blocker {
  key: string;
  text: string;
}

const STEP_LABELS: Record<(typeof ONBOARDING_STEPS)[number], string> = {
  role: "role",
  want: "what you want",
  where: "location",
  comp: "pay",
  sources: "job boards"
};

function blockersFor(profile: Profile, resume: ResumeState, portals: PortalsState): Blocker[] {
  const blockers: Blocker[] = [];
  if (resume.status === "ready" && !resume.hasResume) {
    blockers.push({
      key: "resume",
      text: "No résumé on file — Fit stays empty until you add one in Profile."
    });
  }
  if (!profile.readyToCrawl) {
    const missing = ONBOARDING_STEPS.filter((step) => !profile.completedSteps.includes(step));
    if (missing.length > 0) {
      blockers.push({
        key: "setup",
        text: `Setup still needs: ${missing.map((step) => STEP_LABELS[step]).join(", ")}.`
      });
    }
  }
  if (
    portals.status === "ready" &&
    portals.portals.length > 0 &&
    portals.portals.every((portal) => !portal.enabled)
  ) {
    blockers.push({
      key: "sources",
      text: "Every job board is paused — enable one in Monitors to resume checks."
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

function Blockers(props: { blockers: Blocker[] }): ReactNodeLike {
  if (props.blockers.length === 0) return null;
  return (
    <section className="jsm-overview__section">
      <SectionHead label="Needs attention" />
      <div>
        {props.blockers.map((blocker, index) => (
          <BlockerRow key={blocker.key} blocker={blocker} divided={index > 0} />
        ))}
      </div>
    </section>
  );
}

export function OverviewScreen(props: OverviewScreenProps): ReactNodeLike {
  const [matches, setMatches] = useState<MatchesState>({ status: "loading" });
  const [portals, setPortals] = useState<PortalsState>({ status: "loading" });
  const [resume, setResume] = useState<ResumeState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    setMatches({ status: "loading" });
    fetchMatches(props.profileId)
      .then((items) => {
        if (!cancelled) setMatches({ status: "ready", items });
      })
      .catch(() => {
        if (!cancelled) setMatches({ status: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [props.profileId]);

  useEffect(() => {
    let cancelled = false;
    setPortals({ status: "loading" });
    fetchPortals(props.profileId)
      .then((rows) => {
        if (!cancelled) setPortals({ status: "ready", portals: rows });
      })
      .catch(() => {
        if (!cancelled) setPortals({ status: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [props.profileId]);

  useEffect(() => {
    let cancelled = false;
    setResume({ status: "loading" });
    fetchResume(props.profileId)
      .then((hasResume) => {
        if (!cancelled) setResume({ status: "ready", hasResume });
      })
      .catch(() => {
        if (!cancelled) setResume({ status: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [props.profileId]);

  const setupStatus =
    props.profile.state === "paused"
      ? "Search paused · Setup complete."
      : props.profile.readyToCrawl
        ? "Setup complete · Checks automatically."
        : "Setup incomplete · Checks automatically once setup is complete.";

  return (
    <div className="jsm-overview">
      <header className="jsm-overview__head">
        <span className="jds-eyebrow">Overview</span>
        <h2 className="jds-section-title">Search status</h2>
        <p className="jds-hint">{setupStatus}</p>
      </header>

      <section className="jsm-overview__section">
        <SectionHead label="Board and sources" />
        <StatusFacts
          matches={matches}
          portals={portals}
          onReviewUnreviewed={props.onReviewUnreviewed}
        />
      </section>

      <section className="jsm-overview__section">
        <SectionHead label="Sources" />
        <p className="jds-hint">Checks automatically.</p>
        <SourcesSection state={portals} />
      </section>

      <Blockers blockers={blockersFor(props.profile, resume, portals)} />
    </div>
  );
}
