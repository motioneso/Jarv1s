// #1197: Park Press overview over durable onboarding and monitor reads.
import { h, type ReactNodeLike } from "../runtime";
import { useToolQuery } from "../store";
import { EmptyState, outcomeGate } from "../states";
import { dueLabel } from "../format";
import { Eyebrow, Meta, SectionHead, Strap } from "../kit";
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

const CHECKPOINTS = [
  {
    id: "profile",
    label: "Build your search profile",
    body: "Target titles, locations, comp floor, and dealbreakers."
  },
  {
    id: "resume_approval",
    label: "Add & critique your resume",
    body: "Jarvis reads it, flags gaps, and stores an approved revision."
  },
  {
    id: "sources_schedule",
    label: "Choose sources & schedule",
    body: "Which boards to watch and when the daily run happens."
  },
  {
    id: "review",
    label: "Review your first matches",
    body: "Confirm a save or pass so Jarvis learns your taste."
  }
] as const;

function GateRow(props: {
  label: string;
  ok: boolean;
  okLabel: string;
  pending: string;
}): ReactNodeLike {
  return (
    <div className="jsm-gate">
      <span>{props.label}</span>
      <span className={`jds-badge ${props.ok ? "jds-badge--forest" : "jds-badge--neutral"}`}>
        {props.ok ? props.okLabel : props.pending}
      </span>
    </div>
  );
}

export function OverviewView(props: {
  onboarding: OnboardingState;
  monitors: MonitorSummary[];
  hostActions: HostActions;
}): ReactNodeLike {
  const complete = CHECKPOINTS.filter(
    (step) => step.id !== "review" && props.onboarding.completed[step.id] === true
  ).length;
  const enabled = props.monitors.filter((monitor) => monitor.enabled);
  const nextRun = enabled[0] ? dueLabel(enabled[0].dueTime, enabled[0].timezone) : "Not scheduled";
  return (
    <div className="jsm-screen">
      <section className="jsm-hero" aria-labelledby="jsm-overview-title">
        <div>
          <Eyebrow tone="gold">{`Setup · ${complete} of 4 complete`}</Eyebrow>
          <h2 id="jsm-overview-title" className="jsm-display">
            Almost
            <br />
            <span className="jsm-display__accent">ready to go</span>
          </h2>
          <Strap />
          <p className="jsm-hero__copy">
            Your profile and resume are approved and monitoring is live. One thing left — review
            your first batch of matches so I can learn what you&apos;re drawn to.
          </p>
          <p>
            <ModuleLink to="/matches" className="jds-btn jds-btn--primary">
              Review new matches
            </ModuleLink>
          </p>
        </div>
        <div className="jds-card">
          <SectionHead>Readiness gates</SectionHead>
          <div className="jsm-gates">
            <GateRow
              label="Profile"
              ok={props.onboarding.gates.profileApproved}
              okLabel="Approved"
              pending="Pending"
            />
            <GateRow
              label="Resume"
              ok={props.onboarding.gates.resumeApproved}
              okLabel="Approved"
              pending="Pending"
            />
            <GateRow
              label="Monitoring"
              ok={props.onboarding.gates.monitorEnabled}
              okLabel="On"
              pending="Off"
            />
          </div>
        </div>
      </section>
      <div className="jsm-rule" aria-hidden="true" />
      <div className="jsm-overview-grid">
        <section aria-labelledby="jsm-checkpoints-title">
          <SectionHead>
            <span id="jsm-checkpoints-title">Setup checkpoints</span>
          </SectionHead>
          <ol className="jds-card jsm-checkpoints">
            {CHECKPOINTS.map((step, index) => {
              const done = step.id !== "review" && props.onboarding.completed[step.id] === true;
              const current = step.id === "review";
              return (
                <li key={step.id} className="jsm-checkpoint">
                  <span className="jsm-checkpoint__number">{index + 1}</span>
                  <div>
                    <p className="jsm-checkpoint__title">{step.label}</p>
                    <p className="jsm-checkpoint__body">{step.body}</p>
                  </div>
                  <span
                    className={`jds-badge ${done ? "jds-badge--forest" : current ? "jds-badge--amber" : "jds-badge--neutral"}`}
                  >
                    {done ? "Done" : current ? "Now" : "To do"}
                  </span>
                </li>
              );
            })}
          </ol>
        </section>
        <section aria-labelledby="jsm-monitor-health-title">
          <SectionHead trailing={<Meta>{`${enabled.length} enabled`}</Meta>}>
            <span id="jsm-monitor-health-title">Monitor health</span>
          </SectionHead>
          {props.monitors.length === 0 ? (
            <EmptyState
              title="No monitors yet"
              body="Set up your first monitor in a conversation with Jarvis."
              action={
                <button
                  type="button"
                  className="jds-btn jds-btn--primary jds-btn--sm"
                  onClick={() =>
                    props.hostActions.openAssistant({
                      starterPrompt: "Help me pick job sources and set up a monitoring schedule."
                    })
                  }
                >
                  Continue with Jarvis
                </button>
              }
            />
          ) : (
            <div className="jds-card jsm-stack">
              <div className="jsm-stats">
                <div>
                  <span className="jds-eyebrow">Boards</span>
                  <div className="jsm-stat__value">{props.monitors.length}</div>
                </div>
                <div>
                  <span className="jds-eyebrow">Enabled</span>
                  <div className="jsm-stat__value">{enabled.length}</div>
                </div>
                <div>
                  <span className="jds-eyebrow">Next run</span>
                  <div className="jsm-stat__value">{nextRun}</div>
                </div>
                <div>
                  <span className="jds-eyebrow">Status</span>
                  <div className="jsm-stat__value">{`${enabled.length} enabled`}</div>
                </div>
              </div>
              <p className="jsm-card-copy">
                {enabled.length === props.monitors.length
                  ? "All monitors healthy."
                  : `${props.monitors.length - enabled.length} monitors paused.`}
              </p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

export function OverviewScreen(props: { hostActions: HostActions }): ReactNodeLike {
  const onboarding = useToolQuery<OnboardingState & Record<string, unknown>>(
    "job-search.onboarding.get-state"
  );
  return outcomeGate(
    onboarding,
    (state) => <OverviewMonitors onboarding={state} hostActions={props.hostActions} />,
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
