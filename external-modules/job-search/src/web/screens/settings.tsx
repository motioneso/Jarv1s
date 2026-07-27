// external-modules/job-search/src/web/screens/settings.tsx
// Task 20 (#1304, settings half): per-profile settings — which job boards are enabled and how
// much this profile contributes to the daily briefing. The board/inspector and root wiring are
// chat-surface's half of this task; this file owns no root wiring of its own (root.tsx stays
// exclusively chat-surface's for this task — see rulings ledger N32).
//
// Reads and writes take different transports, and the split is forced (rulings I3/I4): reading
// job-search.portal.list is risk:"read" so it goes straight through invokeTool from the browser.
// job-search.portal.set-enabled and job-search.profile.set-briefing-detail are risk:"write" —
// invokeTool on a write tool 403s with confirmation_required before the tool ever runs
// (packages/ai/src/routes.ts:645-668) — so both go through the manual-run queue (runQueue)
// instead. runQueue only ever reports "queued" or "already-queued", never "done" (I5), so every
// write below applies optimistically to local state and is reconciled by re-fetching
// job-search.portal.list, not assumed to have succeeded.
import { h, useEffect, useState, type ReactNodeLike } from "../runtime";
import { invokeTool, runQueue } from "../api";
import type { Profile } from "../use-profiles";
import type { BriefingDetail } from "../../domain/store-port.js";

// Queue names follow root.tsx's existing job-search.crawl-run / crawl.run precedent: queue name
// dashes the tool's last two path segments, jobKind keeps the tool's own dotted handler name.
// worker.queues in jarvis.module.json is still `[]` as of this task — task #49 (coordinator)
// reconciles the manifest entries (name + allowManualRun + paramsSchema) against these names.
const PORTAL_SET_ENABLED_QUEUE = "job-search.portal-set-enabled";
const PROFILE_SET_BRIEFING_DETAIL_QUEUE = "job-search.profile-set-briefing-detail";

// Wire shape of job-search.portal.list's result (worker/handlers/portal.ts
// createPortalListHandler) — defined fresh here rather than imported from the domain layer,
// the same wire-shape-not-domain-shape split use-profiles.ts's header documents for
// job-search.profile.list. cause is FailureCause.summary/nextAction/disabled verbatim; this
// screen never composes its own sentence for why a portal is off (constraint: a self-disabled
// portal reads as disabled-with-a-reason, not as an error or a user choice).
interface PortalCause {
  summary: string;
  nextAction: string;
  disabled: boolean;
}

interface PortalRow {
  sourceId: string;
  label: string;
  enabled: boolean;
  lastOkAt: string | null;
  cause: PortalCause | null;
}

type PortalsState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; rows: PortalRow[] };

async function fetchPortals(profileId: string): Promise<PortalRow[]> {
  const result = (await invokeTool("job-search.portal.list", { profileId })) as {
    portals?: PortalRow[];
  };
  return Array.isArray(result?.portals) ? result.portals : [];
}

// Exhaustive over BriefingDetail by construction: TS rejects this object literal if the union
// (domain/store-port.ts) ever gains or drops a member, since every key must be exactly one of
// "count" | "top" | "full" and all three are required — the two-directional compile-time guard
// against a fourth level (store-port.ts exports only the type, no runtime array to check against).
const BRIEFING_DETAIL_LEVELS: Record<BriefingDetail, { label: string; blurb: string }> = {
  count: { label: "Count only", blurb: "Say how many new matches there are, nothing else." },
  top: { label: "Top matches", blurb: "Include the best few, with why each one matched." },
  full: { label: "Full detail", blurb: "Include everything about every new match." }
};

const BRIEFING_DETAIL_ORDER: BriefingDetail[] = ["count", "top", "full"];

function isBriefingDetail(value: string | null): value is BriefingDetail {
  return value === "count" || value === "top" || value === "full";
}

function PortalRowView(props: {
  key?: string;
  row: PortalRow;
  onToggle(sourceId: string, enabled: boolean): void;
}): ReactNodeLike {
  const { row } = props;
  // A self-disabled portal (cause.disabled, e.g. login_required) is not a user choice — it must
  // read as "this went off and here's why," not as an ordinary off toggle.
  const selfDisabled = row.cause !== null && row.cause.disabled;
  return (
    <div className="jds-field">
      <div className="jsm-switcher">
        <span className="jds-label">{row.label}</span>
        {selfDisabled ? <span className="jds-badge jds-badge--outline">Disabled</span> : null}
        <label className="jds-switch">
          <input
            type="checkbox"
            checked={row.enabled}
            onChange={(event: { target: { checked: boolean } }) =>
              props.onToggle(row.sourceId, event.target.checked)
            }
          />
          <span className="jds-switch__track">
            <span className="jds-switch__thumb" />
          </span>
        </label>
      </div>
      {row.cause ? (
        <p className={selfDisabled ? "jds-hint jds-hint--error" : "jds-hint"}>
          {row.cause.summary} {row.cause.nextAction}
        </p>
      ) : null}
    </div>
  );
}

export function SettingsScreen(props: { profile: Profile }): ReactNodeLike {
  const { profile } = props;
  const [portals, setPortals] = useState<PortalsState>({ status: "loading" });
  const [briefingDetail, setBriefingDetailState] = useState<BriefingDetail>(
    isBriefingDetail(profile.briefingDetail) ? profile.briefingDetail : "top"
  );

  function refetchPortals(): void {
    fetchPortals(profile.profileId)
      .then((rows) => setPortals({ status: "ready", rows }))
      .catch(() => setPortals({ status: "error" }));
  }

  useEffect(() => {
    refetchPortals();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile.profileId]);

  function handleToggle(sourceId: string, enabled: boolean): void {
    // Optimistic: flip the row immediately, then reconcile against the next portal.list once the
    // queued job has had a chance to land — runQueue only ever reports "queued", never "done".
    setPortals((current) =>
      current.status === "ready"
        ? {
            status: "ready",
            rows: current.rows.map((row) => (row.sourceId === sourceId ? { ...row, enabled } : row))
          }
        : current
    );
    runQueue(PORTAL_SET_ENABLED_QUEUE, "portal.set-enabled", {
      profileId: profile.profileId,
      sourceId,
      enabled
    })
      .then(refetchPortals)
      .catch(refetchPortals);
  }

  function handleBriefingDetail(next: BriefingDetail): void {
    setBriefingDetailState(next);
    runQueue(PROFILE_SET_BRIEFING_DETAIL_QUEUE, "profile.set-briefing-detail", {
      profileId: profile.profileId,
      detail: next
    }).catch(() => {
      // Optimistic; a failed queue call corrects itself the next time this profile's record is
      // re-read — this screen doesn't duplicate profile.list's own poll cadence.
    });
  }

  let portalsBody: ReactNodeLike;
  if (portals.status === "loading") {
    portalsBody = <p className="jds-hint">Loading your job boards…</p>;
  } else if (portals.status === "error") {
    portalsBody = <p className="jds-hint">Couldn&rsquo;t load your job boards.</p>;
  } else if (portals.rows.length === 0) {
    portalsBody = <p className="jds-hint">No job boards yet.</p>;
  } else {
    portalsBody = (
      <div className="jds-field">
        {portals.rows.map((row) => (
          <PortalRowView key={row.sourceId} row={row} onToggle={handleToggle} />
        ))}
      </div>
    );
  }

  return (
    <div className="jds-card jds-card--sunken jsm-state">
      <span className="jds-eyebrow">Job search settings</span>

      <div className="jds-field">
        <span className="jds-label">Job boards</span>
        {portalsBody}
      </div>

      <div className="jds-field">
        <span className="jds-label">Briefing detail</span>
        <div className="jds-segmented" role="group" aria-label="Briefing detail">
          {BRIEFING_DETAIL_ORDER.map((level) => (
            <button
              key={level}
              type="button"
              className="jds-segmented__opt"
              aria-pressed={briefingDetail === level}
              onClick={() => handleBriefingDetail(level)}
            >
              {BRIEFING_DETAIL_LEVELS[level].label}
            </button>
          ))}
        </div>
        <p className="jds-hint">{BRIEFING_DETAIL_LEVELS[briefingDetail].blurb}</p>
      </div>
    </div>
  );
}
