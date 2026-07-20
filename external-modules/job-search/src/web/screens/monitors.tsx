// #1197: Park Press monitor health. Board identity comes from sources.list,
// never a hardcoded adapter row. Configuration changes remain conversational;
// the existing run-now queue action reports through Root's polite live region.
import { h, useState, type ReactNodeLike } from "../runtime";
import { runMonitorNow, type RunNowOutcome } from "../api";
import { useToolQuery } from "../store";
import { announce, DisabledState, EmptyState, outcomeGate } from "../states";
import { dueLabel, whenLabel } from "../format";
import { Eyebrow, Meta, SectionHead, Strap } from "../kit";
import type { HostActions } from "../root";
import type { MonitorSummary } from "./overview";

export interface SourceInfo {
  adapterId: string;
  displayName: string;
  enabled: boolean;
  status: string;
}

export type MonitorDetail = MonitorSummary & {
  query?: string;
  lastCheckedAt?: string;
  lastSuccessAt?: string;
};

export function runStateLabel(outcome: RunNowOutcome): string {
  if (outcome.kind === "queued") return "Run queued";
  if (outcome.kind === "already-queued") return "Already queued";
  if (outcome.kind === "disabled") return "Module is turned off";
  return "Could not queue the run";
}

export function RunNowButton(props: { monitorId: string }): ReactNodeLike {
  const [state, setState] = useState<"idle" | "pending" | "settled">("idle");
  const [label, setLabel] = useState("Run now");
  return (
    <button
      type="button"
      className="jds-btn jds-btn--secondary jds-btn--sm"
      disabled={state !== "idle"}
      onClick={() => {
        setState("pending");
        setLabel("Queuing…");
        void runMonitorNow(props.monitorId).then((outcome) => {
          const message = runStateLabel(outcome);
          setState("settled");
          setLabel(message);
          announce(message);
        });
      }}
    >
      {label}
    </button>
  );
}

function SourceGlyph(): ReactNodeLike {
  return (
    <span className="jsm-source-glyph" aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="5" cy="19" r="1" />
        <path d="M4 11a9 9 0 0 1 9 9" />
        <path d="M4 4a16 16 0 0 1 16 16" />
      </svg>
    </span>
  );
}

function MonitorRow(props: {
  monitor: MonitorDetail;
  source: SourceInfo;
  hostActions: HostActions;
  key?: string;
}): ReactNodeLike {
  const monitor = props.monitor;
  const prompt = (action: string) =>
    `${action} job monitor ${monitor.monitorId}. Show me the proposed change before applying it.`;
  return (
    <li className="jds-card jsm-monitor-card">
      <div className="jsm-monitor-card__head">
        <div className="jsm-source-title">
          <SourceGlyph />
          <div>
            <h3>{props.source.displayName}</h3>
            <p>{monitor.query ?? "Configured job-board monitor"}</p>
          </div>
        </div>
        <span
          className={`jds-badge ${monitor.enabled ? "jds-badge--forest" : "jds-badge--neutral"}`}
        >
          {monitor.enabled ? "Enabled" : "Paused"}
        </span>
      </div>
      <dl className="jsm-monitor-meta">
        <div>
          <dt className="jds-eyebrow">Schedule</dt>
          <dd>{dueLabel(monitor.dueTime, monitor.timezone)}</dd>
        </div>
        <div>
          <dt className="jds-eyebrow">Last checked</dt>
          <dd>{whenLabel(monitor.lastCheckedAt)}</dd>
        </div>
        <div>
          <dt className="jds-eyebrow">Last success</dt>
          <dd>{whenLabel(monitor.lastSuccessAt)}</dd>
        </div>
        <div>
          <dt className="jds-eyebrow">Source status</dt>
          <dd>{props.source.enabled ? "Available" : props.source.status}</dd>
        </div>
      </dl>
      <div className="jsm-button-row">
        <RunNowButton monitorId={monitor.monitorId} />
        <button
          type="button"
          className="jds-btn jds-btn--quiet jds-btn--sm"
          onClick={() =>
            props.hostActions.openAssistant({
              starterPrompt: prompt(monitor.enabled ? "Pause" : "Enable")
            })
          }
        >
          {monitor.enabled ? "Pause" : "Enable"}
        </button>
        <button
          type="button"
          className="jds-btn jds-btn--quiet jds-btn--sm"
          onClick={() =>
            props.hostActions.openAssistant({ starterPrompt: prompt("Edit the query for") })
          }
        >
          Edit query
        </button>
      </div>
    </li>
  );
}

function MonitorsLayout(props: {
  count: number;
  enabled: number;
  nextRun: string;
  hostActions: HostActions;
  children?: unknown;
}): ReactNodeLike {
  return (
    <div className="jsm-screen">
      <section className="jsm-monitor-hero" aria-labelledby="jsm-monitors-title">
        <div>
          <Eyebrow tone="gold">{`Daily discovery · next run ${props.nextRun}`}</Eyebrow>
          <h2 id="jsm-monitors-title" className="jsm-display jsm-display--compact">
            Monitors
          </h2>
          <Strap />
          <p className="jsm-hero__copy">
            I check these boards every morning and only surface what clears your bar. Nothing is
            applied on your behalf.
          </p>
        </div>
        <button
          type="button"
          className="jds-btn jds-btn--primary"
          onClick={() =>
            props.hostActions.openAssistant({
              starterPrompt: "Help me add a job monitor. Show me the setup before enabling it."
            })
          }
        >
          Add a monitor
        </button>
      </section>
      <div className="jsm-rule" aria-hidden="true" />
      <section aria-labelledby="jsm-watched-boards-title">
        <SectionHead
          trailing={<Meta>{`${props.enabled} enabled · ${props.count} configured`}</Meta>}
        >
          <span id="jsm-watched-boards-title">Watched boards</span>
        </SectionHead>
        {props.children}
        <p className="jsm-source-note">
          Sources are keyless public job-board APIs. Jarvis reads postings — it never submits
          anything.
        </p>
      </section>
    </div>
  );
}

export function MonitorsView(props: {
  monitors: MonitorDetail[];
  sources: SourceInfo[];
  hostActions: HostActions;
}): ReactNodeLike {
  const sources = new Map(props.sources.map((source) => [source.adapterId, source]));
  // Unknown adapter ids are not invented into the UI. The registry read is the
  // source of truth, which also keeps the nonexistent Workday adapter absent.
  const monitors = props.monitors.filter((monitor) => sources.has(monitor.adapterId));
  const enabled = monitors.filter((monitor) => monitor.enabled);
  const nextRun = enabled[0] ? dueLabel(enabled[0].dueTime, enabled[0].timezone) : "not scheduled";
  return (
    <MonitorsLayout
      count={monitors.length}
      enabled={enabled.length}
      nextRun={nextRun}
      hostActions={props.hostActions}
    >
      {monitors.length === 0 ? (
        <EmptyState
          title="No monitors yet"
          body="Monitors are set up in a conversation with Jarvis."
        />
      ) : (
        <ul className="jsm-card-list" aria-label="Job monitors">
          {monitors.map((monitor) => (
            <MonitorRow
              key={monitor.monitorId}
              monitor={monitor}
              source={sources.get(monitor.adapterId)!}
              hostActions={props.hostActions}
            />
          ))}
        </ul>
      )}
    </MonitorsLayout>
  );
}

function MonitorDetailRow(props: {
  summary: MonitorSummary;
  source: SourceInfo;
  hostActions: HostActions;
  key?: string;
}): ReactNodeLike {
  const detail = useToolQuery<Record<string, unknown>>("job-search.monitor.get", {
    monitorId: props.summary.monitorId
  });
  if (detail.status === "loading") {
    return (
      <MonitorRow monitor={props.summary} source={props.source} hostActions={props.hostActions} />
    );
  }
  const outcome = detail.outcome;
  if (outcome.kind === "disabled") return <DisabledState />;
  if (outcome.kind !== "ok" || (outcome.result as { status?: unknown }).status !== "ok") {
    return (
      <MonitorRow monitor={props.summary} source={props.source} hostActions={props.hostActions} />
    );
  }
  const result = outcome.result as {
    query?: string;
    cursor?: { lastCheckedAt?: string; lastSuccessAt?: string };
  };
  return (
    <MonitorRow
      monitor={{
        ...props.summary,
        query: result.query,
        lastCheckedAt: result.cursor?.lastCheckedAt,
        lastSuccessAt: result.cursor?.lastSuccessAt
      }}
      source={props.source}
      hostActions={props.hostActions}
    />
  );
}

export function MonitorsScreen(props: { hostActions: HostActions }): ReactNodeLike {
  // Independent reads start in the same render; neither waits for the other.
  const monitors = useToolQuery<{ monitors: MonitorSummary[] } & Record<string, unknown>>(
    "job-search.monitor.list"
  );
  const sources = useToolQuery<{ sources: SourceInfo[] } & Record<string, unknown>>(
    "job-search.sources.list"
  );
  return outcomeGate(
    monitors,
    (monitorResult) =>
      outcomeGate(
        sources,
        (sourceResult) => {
          const sourceMap = new Map(
            (sourceResult.sources ?? []).map((source) => [source.adapterId, source])
          );
          const summaries = (monitorResult.monitors ?? []).filter((summary) =>
            sourceMap.has(summary.adapterId)
          );
          const enabled = summaries.filter((summary) => summary.enabled);
          const nextRun = enabled[0]
            ? dueLabel(enabled[0].dueTime, enabled[0].timezone)
            : "not scheduled";
          return (
            <MonitorsLayout
              count={summaries.length}
              enabled={enabled.length}
              nextRun={nextRun}
              hostActions={props.hostActions}
            >
              {summaries.length === 0 ? (
                <EmptyState
                  title="No monitors yet"
                  body="Monitors are set up in a conversation with Jarvis."
                />
              ) : (
                <ul className="jsm-card-list" aria-label="Job monitors">
                  {summaries.map((summary) => (
                    <MonitorDetailRow
                      key={summary.monitorId}
                      summary={summary}
                      source={sourceMap.get(summary.adapterId)!}
                      hostActions={props.hostActions}
                    />
                  ))}
                </ul>
              )}
            </MonitorsLayout>
          );
        },
        { loadingLabel: "Loading job sources" }
      ),
    { loadingLabel: "Loading monitors" }
  );
}
