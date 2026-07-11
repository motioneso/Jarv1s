// external-modules/job-search/src/web/screens/monitors.tsx
// JS-06 (#935): monitor configuration + health + run-now. Run-now reports
// queued state from the 202 response alone — jobId:null means the manual
// singleton already holds a queued run (no polling of private job output,
// spec). Outcomes are pushed to the Root's polite live region.
import { h, useState, type ReactNodeLike } from "../runtime";
import { runMonitorNow, type RunNowOutcome } from "../api";
import { useToolQuery } from "../store";
import { announce, DisabledState, EmptyState, outcomeGate } from "../states";
import { dueLabel, whenLabel } from "../format";
import type { MonitorSummary } from "./overview";

export type MonitorDetail = MonitorSummary & {
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
  const disabled = state !== "idle";
  return (
    <button
      type="button"
      className="jds-btn jds-btn--secondary jds-btn--sm"
      disabled={disabled}
      onClick={() => {
        setState("pending");
        setLabel("Queuing…");
        void runMonitorNow(props.monitorId).then((outcome) => {
          const message = runStateLabel(outcome);
          setState("settled");
          setLabel(message);
          announce(message); // aria-live status announcement (spec a11y)
        });
      }}
    >
      {label}
    </button>
  );
}

// `key?` mirrors ModuleLink: the runtime's loose JSX typing has no implicit
// React key slot on custom components, so list callers declare it explicitly.
function MonitorRow(props: { monitor: MonitorDetail; key?: string }): ReactNodeLike {
  const monitor = props.monitor;
  return (
    <li className="jds-card jds-card--flush jsm-state">
      <div className="jsm-row">
        <h3>{monitor.adapterId}</h3>
        <span
          className={`jds-badge ${monitor.enabled ? "jds-badge--forest" : "jds-badge--neutral"}`}
        >
          {monitor.enabled ? "Enabled" : "Paused"}
        </span>
      </div>
      <dl className="jsm-meta">
        <dt className="jds-eyebrow">Schedule</dt>
        <dd>{dueLabel(monitor.dueTime, monitor.timezone)}</dd>
        <dt className="jds-eyebrow">Last checked</dt>
        <dd>{whenLabel(monitor.lastCheckedAt)}</dd>
        <dt className="jds-eyebrow">Last success</dt>
        <dd>{whenLabel(monitor.lastSuccessAt)}</dd>
      </dl>
      <div className="jsm-row">
        <RunNowButton monitorId={monitor.monitorId} />
      </div>
    </li>
  );
}

export function MonitorsView(props: { monitors: MonitorDetail[] }): ReactNodeLike {
  if (props.monitors.length === 0) {
    return (
      <EmptyState
        title="No monitors yet"
        body="Monitors are set up in the onboarding conversation with Jarvis."
      />
    );
  }
  return (
    <ul className="jsm-steps" aria-label="Job monitors">
      {props.monitors.map((monitor) => (
        <MonitorRow key={monitor.monitorId} monitor={monitor} />
      ))}
    </ul>
  );
}

// Per-monitor detail fetch: a single failing monitor.get degrades that row
// only (safe error state), never the whole screen.
function MonitorDetailRow(props: { summary: MonitorSummary; key?: string }): ReactNodeLike {
  const detail = useToolQuery<Record<string, unknown>>("job-search.monitor.get", {
    monitorId: props.summary.monitorId
  });
  if (detail.status === "loading") {
    return <MonitorRow monitor={props.summary} />;
  }
  const outcome = detail.outcome;
  if (outcome.kind === "disabled") return <DisabledState />;
  if (outcome.kind !== "ok" || (outcome.result as { status?: unknown }).status !== "ok") {
    return <MonitorRow monitor={props.summary} />;
  }
  const cursor = (outcome.result as { cursor?: { lastCheckedAt?: string; lastSuccessAt?: string } })
    .cursor;
  return (
    <MonitorRow
      monitor={{
        ...props.summary,
        lastCheckedAt: cursor?.lastCheckedAt,
        lastSuccessAt: cursor?.lastSuccessAt
      }}
    />
  );
}

export function MonitorsScreen(): ReactNodeLike {
  const monitors = useToolQuery<{ monitors: MonitorSummary[] } & Record<string, unknown>>(
    "job-search.monitor.list"
  );
  return outcomeGate(
    monitors,
    (result) => {
      const summaries = result.monitors ?? [];
      if (summaries.length === 0) return <MonitorsView monitors={[]} />;
      return (
        <ul className="jsm-steps" aria-label="Job monitors">
          {summaries.map((summary) => (
            <MonitorDetailRow key={summary.monitorId} summary={summary} />
          ))}
        </ul>
      );
    },
    { loadingLabel: "Loading monitors" }
  );
}
