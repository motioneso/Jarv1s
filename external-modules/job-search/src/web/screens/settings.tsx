// external-modules/job-search/src/web/screens/settings.tsx
// Task 20 (#1304, settings half); trimmed by K4 (2026-07-28 keyline-restructure plan). Originally
// this screen owned three groups — résumé, job boards, briefing detail. K4 moved the first and
// third to the new profile.tsx (this file's own header used to explain why a résumé status line
// and a briefing-detail control lived on a screen named "Settings"; that reasoning now lives in
// profile.tsx instead). What's left is exactly one job: which job boards are enabled. K5 renames
// this screen's tab to "Monitors" without touching what it renders.
//
// The board/inspector and root wiring are chat-surface's half of the original task; this file
// owns no root wiring of its own (root.tsx stays exclusively K5's for this move).
//
// Reads and writes take different transports, and the split is forced (rulings I3/I4): reading
// job-search.portal.list is risk:"read" so it goes straight through invokeTool from the browser.
// job-search.portal.set-enabled is risk:"write" — invokeTool on a write tool 403s with
// confirmation_required before the tool ever runs (packages/ai/src/routes.ts:645-668) — so it
// goes through the manual-run queue (runQueue) instead. runQueue only ever reports "queued" or
// "already-queued", never "done" (I5), so the write below applies optimistically to local state
// and is reconciled by re-fetching job-search.portal.list, not assumed to have succeeded.
import { Fragment, h, useEffect, useState, type ReactNodeLike } from "../runtime";
import { invokeTool, runQueue } from "../api";
import type { Profile } from "../use-profiles";

// Queue name follows root.tsx's existing job-search.crawl-run / crawl.run precedent: queue name
// dashes the tool's last two path segments, jobKind keeps the tool's own dotted handler name.
// Exported (along with PORTAL_LIST_TOOL below) so
// tests/unit/job-search-manifest-conformance.test.tsx can assert these exact literals — not a
// retyped copy — are declared in the committed manifest with the right shape (worker.queues
// entry + allowManualRun for the queue, assistantTools entry + risk:"read" for the tool).
// PROFILE_SET_BRIEFING_DETAIL_QUEUE moved to profile.tsx along with the control that calls it —
// the conformance test now imports that literal from there.
export const PORTAL_SET_ENABLED_QUEUE = "job-search.portal-set-enabled";

// The one tool this screen ever passes to invokeTool. Reads only — a write-risk tool reached
// through invokeTool 403s with confirmation_required before it runs (rulings I3/I4), so this
// being declared risk:"read" in the manifest is load-bearing, not decorative.
export const PORTAL_LIST_TOOL = "job-search.portal.list";

// Wire shape of job-search.portal.list's result (worker/handlers/portal.ts
// createPortalListHandler) — defined fresh here rather than imported from the domain layer,
// the same wire-shape-not-domain-shape split use-profiles.ts's header documents for
// job-search.profile.list. cause is read as FailureCause.summary/nextAction/disabled; this
// screen never composes its own sentence for why a portal is off (constraint: a self-disabled
// portal reads as disabled-with-a-reason, not as an error or a user choice).
//
// PortalCause below is deliberately narrower than what's actually on the wire: the handler
// forwards the full 9-field domain FailureCause unmodified (portal.ts's `cause: portal.cause`),
// but this screen only ever reads these 3 fields, so only these 3 are declared — same
// wire-type-not-domain-type reasoning as above, applied a second time to say "this is all we
// use" rather than "this is all there is."
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
  const result = (await invokeTool(PORTAL_LIST_TOOL, { profileId })) as {
    portals?: PortalRow[];
  };
  return Array.isArray(result?.portals) ? result.portals : [];
}

/** One rail row: what it is on the left, the control that changes it flush right.
 *
 * The row used to be a `jsm-switcher` — a plain left-to-right flex with a 0.5rem gap — so the
 * toggle sat immediately after the label text and every row ended at a different horizontal
 * position. Nothing lined up, and a column of controls that doesn't line up reads as unfinished
 * however carefully everything else is spaced. */
function PortalRowView(props: {
  key?: string;
  row: PortalRow;
  divided: boolean;
  onToggle(sourceId: string, enabled: boolean): void;
}): ReactNodeLike {
  const { row } = props;
  // A self-disabled portal (cause.disabled, e.g. login_required) is not a user choice — it must
  // read as "this went off and here's why," not as an ordinary off toggle.
  const selfDisabled = row.cause !== null && row.cause.disabled;
  return h(
    Fragment,
    null,
    // Rendered as a sibling rather than as a border on the row, because module CSS is layout-only
    // (styles.css header) and a rule the colour of a hairline is a colour declaration. `jds-divider`
    // is the host's own hairline, so the module never names a colour.
    props.divided ? <div className="jds-divider" /> : null,
    <div className="jsm-rail__row">
      <div className="jsm-rail__main">
        <div className="jsm-rail__label">
          <span className="jds-label">{row.label}</span>
          {selfDisabled ? <span className="jds-badge jds-badge--outline">Disabled</span> : null}
        </div>
        {row.cause ? (
          <p className={selfDisabled ? "jds-hint jds-hint--error" : "jds-hint"}>
            {row.cause.summary} {row.cause.nextAction}
          </p>
        ) : null}
      </div>
      <div className="jsm-rail__control">
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
    </div>
  );
}

export function SettingsScreen(props: { profile: Profile }): ReactNodeLike {
  const { profile } = props;
  const [portals, setPortals] = useState<PortalsState>({ status: "loading" });

  function refetchPortals(): void {
    fetchPortals(profile.profileId)
      .then((rows) => setPortals({ status: "ready", rows }))
      .catch(() => setPortals({ status: "error" }));
  }

  useEffect(() => {
    refetchPortals();
    // Deliberately omits refetchPortals from deps: it's a plain closure
    // redefined every render (not memoized) that only reads profile.profileId,
    // so keying this effect on the function reference would refetch on every
    // render instead of just when the profile changes.
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

  let portalsBody: ReactNodeLike;
  if (portals.status === "loading") {
    portalsBody = <p className="jds-hint">Loading your job boards…</p>;
  } else if (portals.status === "error") {
    portalsBody = <p className="jds-hint">Couldn&rsquo;t load your job boards.</p>;
  } else if (portals.rows.length === 0) {
    portalsBody = <p className="jds-hint">No job boards yet.</p>;
  } else {
    portalsBody = (
      <div className="jsm-rail">
        {portals.rows.map((row, index) => (
          <PortalRowView key={row.sourceId} row={row} divided={index > 0} onToggle={handleToggle} />
        ))}
      </div>
    );
  }

  // No card. A lone control inside a full-width sunken card left three quarters of a 1100px box
  // empty and read as a container that failed to fill, so the group sits directly on the page
  // ground at a readable measure (styles.css `.jsm-settings`) instead — same reasoning as before
  // K4 moved the other two groups out, just with one group left to make it.
  //
  // Title still says "Settings" here: this screen's own tab label rename to "Monitors" is K5's
  // task (it also decides whether "custom sources" gets a second group on this same screen), not
  // a rename K4 should make ahead of that wiring. The subtitle below was rewritten because it
  // described three groups this screen no longer has — leaving stale copy describing content
  // that moved elsewhere would be its own defect.
  return (
    <div className="jsm-settings">
      <header className="jsm-settings__head">
        <h2 className="jds-section-title">Settings</h2>
        <p className="jds-section-sub">Which job boards this search crawls.</p>
      </header>

      <section className="jsm-settings__group">
        <span className="jds-eyebrow">Job boards</span>
        {portalsBody}
      </section>
    </div>
  );
}
