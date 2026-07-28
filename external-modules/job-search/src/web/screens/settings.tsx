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
import { Fragment, h, useEffect, useState, type ReactNodeLike } from "../runtime";
import { invokeTool, runQueue } from "../api";
import type { Profile } from "../use-profiles";
import type { BriefingDetail } from "../../domain/store-port.js";

// Queue names follow root.tsx's existing job-search.crawl-run / crawl.run precedent: queue name
// dashes the tool's last two path segments, jobKind keeps the tool's own dotted handler name.
// Exported (along with PORTAL_LIST_TOOL below) so
// tests/unit/job-search-manifest-conformance.test.ts can assert these exact literals — not a
// retyped copy — are declared in the committed manifest with the right shape (worker.queues
// entry + allowManualRun for the two below, assistantTools entry + risk:"read" for the tool).
export const PORTAL_SET_ENABLED_QUEUE = "job-search.portal-set-enabled";
export const PROFILE_SET_BRIEFING_DETAIL_QUEUE = "job-search.profile-set-briefing-detail";

// The one tool this screen ever passes to invokeTool. Reads only — a write-risk tool reached
// through invokeTool 403s with confirmation_required before it runs (rulings I3/I4), so this
// being declared risk:"read" in the manifest is load-bearing, not decorative.
export const PORTAL_LIST_TOOL = "job-search.portal.list";

// Read-only, same reason as PORTAL_LIST_TOOL. This screen shows only whether a résumé exists and
// when it was last replaced — never the text, which is the one thing on this surface the user has
// no reason to re-read here and every reason not to have sitting on a settings page.
export const RESUME_GET_TOOL = "job-search.resume.get";

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

// What this screen keeps of a résumé: whether there is one, which version, when it changed, and
// how long it is. Deliberately NOT the text — `resume.get` returns the full content (it is the
// owner's own row, read under their own scope), and this screen drops it on arrival rather than
// holding a copy in component state to render a status line from.
interface ResumeSummary {
  version: number;
  updatedAt: string;
  length: number;
}

type ResumeState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; resume: ResumeSummary | null };

async function fetchResume(profileId: string): Promise<ResumeSummary | null> {
  const result = (await invokeTool(RESUME_GET_TOOL, { profileId })) as {
    resume?: { version: number; content: string; updatedAt: string } | null;
  };
  const resume = result?.resume;
  if (!resume || typeof resume.content !== "string") return null;
  return { version: resume.version, updatedAt: resume.updatedAt, length: resume.content.length };
}

/** The résumé row.
 *
 * Read-only on purpose, and the reason is structural rather than a shortcut: a write from the
 * browser has to go through a declared queue, and the manifest's params vocabulary
 * (packages/module-sdk module-params.ts) has no free-text field type — there is no way to declare a
 * queue that carries a résumé. Chat is the write path, so this row's job is to say what is on file
 * and point at the place that changes it.
 *
 * It exists at all because the board nags about a missing résumé ("Fit is empty because there's no
 * résumé on file") while settings said nothing about résumés whatsoever — the one screen named
 * "settings" had no answer to the one thing the product was asking the user for. */
function ResumeRow(props: { state: ResumeState }): ReactNodeLike {
  const state = props.state;
  let detail: string;
  if (state.status === "loading") {
    detail = "Checking…";
  } else if (state.status === "error") {
    detail = "Couldn't check whether a résumé is on file.";
  } else if (state.resume === null) {
    detail =
      "Nothing on file. Fit stays empty until there is one — it's the only thing Fit is judged " +
      "against. Paste yours into the chat and every role gets read again with it.";
  } else {
    const when = new Date(state.resume.updatedAt).toLocaleDateString();
    detail = `Version ${state.resume.version}, saved ${when}. Paste a new one into the chat to replace it.`;
  }

  return (
    <div className="jsm-rail__row">
      <div className="jsm-rail__main">
        <div className="jsm-rail__label">
          <span className="jds-label">Résumé</span>
          {state.status === "ready" && state.resume === null ? (
            <span className="jds-badge jds-badge--outline">None yet</span>
          ) : null}
        </div>
        <p className="jds-hint">{detail}</p>
      </div>
    </div>
  );
}

export function SettingsScreen(props: { profile: Profile }): ReactNodeLike {
  const { profile } = props;
  const [portals, setPortals] = useState<PortalsState>({ status: "loading" });
  const [briefingDetail, setBriefingDetailState] = useState<BriefingDetail>(
    isBriefingDetail(profile.briefingDetail) ? profile.briefingDetail : "top"
  );
  const [resume, setResume] = useState<ResumeState>({ status: "loading" });

  function refetchPortals(): void {
    fetchPortals(profile.profileId)
      .then((rows) => setPortals({ status: "ready", rows }))
      .catch(() => setPortals({ status: "error" }));
  }

  useEffect(() => {
    refetchPortals();
    setResume({ status: "loading" });
    let cancelled = false;
    fetchResume(profile.profileId)
      .then((summary) => {
        if (!cancelled) setResume({ status: "ready", resume: summary });
      })
      .catch(() => {
        if (!cancelled) setResume({ status: "error" });
      });
    return () => {
      // Switching profiles mid-flight would otherwise land the previous profile's résumé status
      // under the newly selected profile's name.
      cancelled = true;
    };
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
      <div className="jsm-rail">
        {portals.rows.map((row, index) => (
          <PortalRowView key={row.sourceId} row={row} divided={index > 0} onToggle={handleToggle} />
        ))}
      </div>
    );
  }

  // No card. Three controls inside a full-width sunken card left three quarters of a 1100px box
  // empty and read as a container that failed to fill, so the settings sit directly on the page
  // ground at a readable measure (styles.css `.jsm-settings`) instead.
  //
  // Hierarchy is three distinct kinds rather than three sizes of the same kind: a display-font
  // title for the screen, uppercase eyebrows for the groups, and body-weight labels on the rows.
  // Group headings and row labels were both `jds-label` before, which made a parent category and
  // its children look like peers.
  return (
    <div className="jsm-settings">
      <header className="jsm-settings__head">
        <h2 className="jds-section-title">Settings</h2>
        <p className="jds-section-sub">
          Where this search looks, what it knows about you, and how much it says in your briefing.
        </p>
      </header>

      <section className="jsm-settings__group">
        <span className="jds-eyebrow">About you</span>
        <div className="jsm-rail">
          <ResumeRow state={resume} />
        </div>
      </section>

      <section className="jsm-settings__group">
        <span className="jds-eyebrow">Job boards</span>
        {portalsBody}
      </section>

      <section className="jsm-settings__group">
        <span className="jds-eyebrow">Briefing detail</span>
        <div className="jsm-rail">
          <div className="jsm-rail__row">
            <div className="jsm-rail__main">
              <span className="jds-label">How much to include</span>
              <p className="jds-hint">{BRIEFING_DETAIL_LEVELS[briefingDetail].blurb}</p>
            </div>
            <div className="jsm-rail__control">
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
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
