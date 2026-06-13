import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { OnboardingStatusResponse } from "@jarv1s/shared";

import { completeOnboarding, getOnboardingStatus, skipOnboarding } from "../api/client";
import { queryKeys } from "../api/query-keys";
import { ApiKeyOptOutStep } from "./api-key-opt-out-step";
import { CliAuthStep } from "./cli-auth-step";
import { ConnectorStep } from "./connector-step";
import { MemberConnectorStep } from "./member-connector-step";
import { MemberWelcomeStep } from "./member-welcome-step";
import { MultiplexerStep } from "./multiplexer-step";
import { OnboardingChatOverlay } from "./onboarding-chat-overlay";
import { SectionTourStep } from "./section-tour-step";
import { WelcomeStep } from "./welcome-step";
import { STEP_KEYS, firstIncompleteStepIndex, isOverlayEnabled } from "./resume";

/** The member wizard has a fixed, client-derived step array (welcome / API-key opt-out / connector / tour). */
const MEMBER_STEP_COUNT = 4;

/**
 * Resume index. Founders resume at their first not-done spine step. Members always start at the
 * welcome step (0): member step "done" flags are derived client-side per step, not from the
 * server status, so there is nothing to resume against — the whole member flow is skippable.
 */
function resumeStepIndex(status: OnboardingStatusResponse): number {
  return status.role === "member" ? 0 : firstIncompleteStepIndex(status);
}

export function OnboardingWizard(props: {
  readonly onDone: () => void;
  /** The status app.tsx already fetched — seeds the query so the wizard shows NO second loader. */
  readonly initialStatus: OnboardingStatusResponse;
}) {
  const queryClient = useQueryClient();
  const statusQuery = useQuery({
    queryKey: queryKeys.onboarding.status,
    queryFn: getOnboardingStatus,
    retry: false,
    initialData: props.initialStatus // never a fresh-load spinner inside the wizard
  });

  const [stepIndex, setStepIndex] = useState(() => resumeStepIndex(props.initialStatus));
  const [resumed, setResumed] = useState(false);

  // If the first server refresh arrives, resume once at the first not-done step.
  useEffect(() => {
    if (statusQuery.isSuccess && !resumed) {
      setStepIndex(resumeStepIndex(statusQuery.data));
      setResumed(true);
    }
  }, [statusQuery.isSuccess, statusQuery.data, resumed]);

  const invalidateStatus = () =>
    queryClient.invalidateQueries({ queryKey: queryKeys.onboarding.status });

  const finish = useMutation({
    mutationFn: completeOnboarding,
    onSuccess: async () => {
      await invalidateStatus();
      props.onDone();
    }
  });
  const skip = useMutation({
    mutationFn: skipOnboarding,
    onSuccess: async () => {
      await invalidateStatus();
      props.onDone();
    }
  });

  // No isLoading branch: initialData guarantees data is present from the first render
  // (app.tsx already waited). A background refetch error never blanks the wizard.
  // Phase 4: the status is a role union — narrow to the founder variant for the founder steps;
  // the member step array is selected below (Task 8). One wizard, parameterized by role.
  const founderSteps = statusQuery.data.role === "founder" ? statusQuery.data.steps : undefined;
  const isMember = statusQuery.data.role === "member";
  const overlayEnabled = isOverlayEnabled(statusQuery.data);

  // Phase 4: the member wizard mounts its OWN step array (no multiplexer/CLI-auth — ADR 0007 §4
  // members inherit the shared host CLI). Every step is optional/skippable; Finish and "Skip
  // setup" both POST to /complete and /skip, which Task-5 routes to setMemberOnboardingComplete.
  const stepCount = isMember ? MEMBER_STEP_COUNT : STEP_KEYS.length;
  const goNext = () => setStepIndex((i) => Math.min(stepCount - 1, i + 1));
  const memberSteps = isMember
    ? [
        <MemberWelcomeStep key="welcome" onSkipAll={() => skip.mutate()} />,
        <ApiKeyOptOutStep key="apikey" onSkipStep={goNext} />,
        <MemberConnectorStep key="connector" onSkipStep={goNext} />,
        <SectionTourStep key="tour" onDone={() => finish.mutate()} />
      ]
    : [];

  const currentKey = STEP_KEYS[stepIndex];
  const isLast = stepIndex === stepCount - 1;

  return (
    <main className="onboarding-shell center-screen">
      <section className="onboarding-panel">
        <header className="onboarding-header">
          <h1>Set up Jarv1s</h1>
          <p className="form-hint">
            Step {stepIndex + 1} of {stepCount}
          </p>
          <button className="ghost-button" type="button" onClick={() => skip.mutate()}>
            Skip setup
          </button>
        </header>

        {statusQuery.isError ? (
          <p className="form-error">
            Couldn&apos;t refresh setup status. You can still skip and configure later.
          </p>
        ) : null}

        <div className="onboarding-step">
          {isMember ? (
            memberSteps[stepIndex]
          ) : (
            <>
              {currentKey === "welcome" ? <WelcomeStep onSkipAll={() => skip.mutate()} /> : null}
              {currentKey === "multiplexer" && founderSteps ? (
                <MultiplexerStep step={founderSteps.multiplexer} onRecheck={invalidateStatus} />
              ) : null}
              {currentKey === "cliAuth" && founderSteps ? (
                <CliAuthStep step={founderSteps.cliAuth} onRecheck={invalidateStatus} />
              ) : null}
              {currentKey === "connectors" && founderSteps ? (
                <ConnectorStep done={founderSteps.connectors.done} />
              ) : null}
            </>
          )}
        </div>

        <footer className="onboarding-footer">
          <button
            className="ghost-button"
            type="button"
            disabled={stepIndex === 0}
            onClick={() => setStepIndex((i) => Math.max(0, i - 1))}
          >
            Back
          </button>
          <button
            className="ghost-button"
            type="button"
            onClick={() => (isLast ? finish.mutate() : goNext())}
          >
            Skip this step
          </button>
          {isLast ? (
            <button className="primary-button" type="button" onClick={() => finish.mutate()}>
              Finish
            </button>
          ) : (
            <button className="primary-button" type="button" onClick={goNext}>
              Next
            </button>
          )}
        </footer>

        <OnboardingChatOverlay enabled={Boolean(overlayEnabled)} />
      </section>
    </main>
  );
}
