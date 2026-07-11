// external-modules/job-search/src/web/screens/onboarding.tsx
// JS-06 (#935): checkpoint progress + "Continue with Jarvis" (#916 editable
// starter draft, never auto-submitted — the host owns sanitize+focus).
import { h, type ReactNodeLike } from "../runtime";
import { useToolQuery } from "../store";
import { outcomeGate } from "../states";
import { STEP_LABELS } from "../format";
import { starterDraftForStep } from "../starter-drafts";
import { ModuleLink } from "../router";
import type { HostActions } from "../root";
import type { OnboardingState } from "./overview";

function stepStatus(state: OnboardingState, step: string): "done" | "current" | "todo" {
  if (state.completed[step] === true) return "done";
  return state.step === step ? "current" : "todo";
}

const STATUS_BADGE: Record<string, { className: string; label: string }> = {
  done: { className: "jds-badge--forest", label: "Done" },
  current: { className: "jds-badge--amber", label: "Current" },
  todo: { className: "jds-badge--neutral", label: "To do" }
};

export function OnboardingView(props: {
  state: OnboardingState;
  hostActions: HostActions;
}): ReactNodeLike {
  const complete = props.state.step === "done";
  return (
    <section className="jds-card jsm-state" aria-labelledby="jsm-onboarding-title">
      <span className="jds-eyebrow">Onboarding</span>
      <h2 id="jsm-onboarding-title">
        {complete ? "Onboarding complete" : "Set up your job search"}
      </h2>
      <ol className="jsm-steps">
        {Object.entries(STEP_LABELS).map(([step, label]) => {
          const status = stepStatus(props.state, step);
          const badge = STATUS_BADGE[status];
          return (
            <li key={step} className="jsm-step jsm-row">
              <span>{label}</span>
              <span className={`jds-badge ${badge.className}`}>{badge.label}</span>
            </li>
          );
        })}
      </ol>
      {complete ? (
        <ModuleLink to="/monitors" className="jds-btn jds-btn--secondary jds-btn--sm">
          Go to monitors
        </ModuleLink>
      ) : (
        <button
          type="button"
          className="jds-btn jds-btn--primary"
          onClick={() =>
            props.hostActions.openAssistant({
              starterPrompt: starterDraftForStep(props.state.step)
            })
          }
        >
          Continue with Jarvis
        </button>
      )}
    </section>
  );
}

export function OnboardingScreen(props: { hostActions: HostActions }): ReactNodeLike {
  const snapshot = useToolQuery<OnboardingState & Record<string, unknown>>(
    "job-search.onboarding.get-state"
  );
  return outcomeGate(
    snapshot,
    (state) => <OnboardingView state={state} hostActions={props.hostActions} />,
    { loadingLabel: "Loading onboarding" }
  );
}
