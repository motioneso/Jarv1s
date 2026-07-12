// external-modules/job-search/src/web/screens/overview.tsx
// JS-06 (#935): landing route — onboarding completion, approval gates, monitor
// health at a glance. Container fetches; OverviewView is pure for unit tests.
import { h, type ReactNodeLike } from "../runtime";
import { useToolQuery } from "../store";
import { EmptyState, outcomeGate } from "../states";
import { dueLabel, onboardingProgress } from "../format";
import { starterDraftForStep } from "../starter-drafts";
import { ModuleLink } from "../router";
import type { HostActions } from "../root";

export type OnboardingState = {
  step: string;
  completed: Record<string, boolean>;
  gates: { resumeApproved: boolean; profileApproved: boolean; monitorEnabled: boolean };
};

export type MonitorSummary = {
  monitorId: string;
  adapterId: string;
  enabled: boolean;
  timezone: string;
  dueTime: string;
};

function GateBadge(props: { ok: boolean; okLabel: string; pendingLabel: string }): ReactNodeLike {
  return (
    <span className={`jds-badge ${props.ok ? "jds-badge--forest" : "jds-badge--neutral"}`}>
      {props.ok ? props.okLabel : props.pendingLabel}
    </span>
  );
}

export function OverviewView(props: {
  onboarding: OnboardingState;
  monitors: MonitorSummary[];
  hostActions: HostActions;
}): ReactNodeLike {
  const progress = onboardingProgress(props.onboarding.completed);
  const enabled = props.monitors.filter((monitor) => monitor.enabled);
  return (
    <div className="jsm-stack">
      <section className="jds-card jsm-state" aria-labelledby="jsm-ov-onboarding">
        <span className="jds-eyebrow">Onboarding</span>
        {/* Single template literal: renderToString separates adjacent text
            nodes with comment markers, which breaks plain-text assertions. */}
        <h2 id="jsm-ov-onboarding">{`${progress.done} of ${progress.total} steps complete`}</h2>
        <div className="jsm-meta">
          <GateBadge
            ok={props.onboarding.gates.resumeApproved}
            okLabel="Resume approved"
            pendingLabel="Resume pending"
          />
          <GateBadge
            ok={props.onboarding.gates.profileApproved}
            okLabel="Profile approved"
            pendingLabel="Profile pending"
          />
          <GateBadge
            ok={props.onboarding.gates.monitorEnabled}
            okLabel="Monitoring on"
            pendingLabel="Monitoring off"
          />
        </div>
        {props.onboarding.step === "done" ? null : (
          <div className="jsm-row">
            <ModuleLink to="/onboarding" className="jds-btn jds-btn--secondary jds-btn--sm">
              View checkpoints
            </ModuleLink>
            <button
              type="button"
              className="jds-btn jds-btn--primary jds-btn--sm"
              onClick={() =>
                props.hostActions.openAssistant({
                  starterPrompt: starterDraftForStep(props.onboarding.step)
                })
              }
            >
              Continue with Jarvis
            </button>
          </div>
        )}
      </section>
      <section className="jds-card jsm-state" aria-labelledby="jsm-ov-monitors">
        <span className="jds-eyebrow">Monitors</span>
        <h2 id="jsm-ov-monitors">
          {props.monitors.length === 0
            ? "Monitor health"
            : `${enabled.length} enabled of ${props.monitors.length}`}
        </h2>
        {props.monitors.length === 0 ? (
          <EmptyState
            title="No monitors yet"
            body="Set up your first monitor in the onboarding conversation."
            action={
              <button
                type="button"
                className="jds-btn jds-btn--primary jds-btn--sm"
                onClick={() =>
                  props.hostActions.openAssistant({
                    starterPrompt: starterDraftForStep("sources_schedule")
                  })
                }
              >
                Continue with Jarvis
              </button>
            }
          />
        ) : (
          <ul className="jsm-steps">
            {props.monitors.map((monitor) => (
              <li key={monitor.monitorId} className="jsm-step jsm-row">
                <span>
                  {monitor.adapterId} — {dueLabel(monitor.dueTime, monitor.timezone)}
                </span>
                <span
                  className={`jds-badge ${monitor.enabled ? "jds-badge--forest" : "jds-badge--neutral"}`}
                >
                  {monitor.enabled ? "Enabled" : "Paused"}
                </span>
              </li>
            ))}
          </ul>
        )}
        <ModuleLink to="/monitors" className="jds-btn jds-btn--ghost jds-btn--sm">
          Monitor details &amp; run now
        </ModuleLink>
      </section>
    </div>
  );
}

export function OverviewScreen(props: { hostActions: HostActions }): ReactNodeLike {
  const onboarding = useToolQuery<OnboardingState & Record<string, unknown>>(
    "job-search.onboarding.get-state"
  );
  return outcomeGate(
    onboarding,
    (onboardingState) => (
      <OverviewMonitors onboarding={onboardingState} hostActions={props.hostActions} />
    ),
    { loadingLabel: "Loading your job search" }
  );
}

function OverviewMonitors(props: {
  onboarding: OnboardingState;
  hostActions: HostActions;
}): ReactNodeLike {
  const monitors = useToolQuery<{ monitors: MonitorSummary[] } & Record<string, unknown>>(
    "job-search.monitor.list"
  );
  return outcomeGate(
    monitors,
    (result) => (
      <OverviewView
        onboarding={props.onboarding}
        monitors={result.monitors ?? []}
        hostActions={props.hostActions}
      />
    ),
    { loadingLabel: "Loading monitors" }
  );
}
