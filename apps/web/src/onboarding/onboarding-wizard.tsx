import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { OnboardingStatusResponse } from "@jarv1s/shared";

import { completeOnboarding, getOnboardingStatus, skipOnboarding } from "../api/client";
import { queryKeys } from "../api/query-keys";
import { CliAuthStep } from "./cli-auth-step";
import { ConnectorStep } from "./connector-step";
import { MultiplexerStep } from "./multiplexer-step";
import { OnboardingChatOverlay } from "./onboarding-chat-overlay";
import { WelcomeStep } from "./welcome-step";
import { STEP_KEYS, firstIncompleteStepIndex, isOverlayEnabled } from "./resume";

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

  const [stepIndex, setStepIndex] = useState(() => firstIncompleteStepIndex(props.initialStatus));
  const [resumed, setResumed] = useState(false);

  // If the first server refresh arrives, resume once at the first not-done step.
  useEffect(() => {
    if (statusQuery.isSuccess && !resumed) {
      setStepIndex(firstIncompleteStepIndex(statusQuery.data));
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
  const steps = statusQuery.data.steps;
  const overlayEnabled = isOverlayEnabled(statusQuery.data);

  const currentKey = STEP_KEYS[stepIndex];
  const isLast = stepIndex === STEP_KEYS.length - 1;

  return (
    <main className="onboarding-shell center-screen">
      <section className="onboarding-panel">
        <header className="onboarding-header">
          <h1>Set up Jarv1s</h1>
          <p className="form-hint">
            Step {stepIndex + 1} of {STEP_KEYS.length}
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
          {currentKey === "welcome" ? <WelcomeStep onSkipAll={() => skip.mutate()} /> : null}
          {currentKey === "multiplexer" ? (
            <MultiplexerStep step={steps.multiplexer} onRecheck={invalidateStatus} />
          ) : null}
          {currentKey === "cliAuth" ? (
            <CliAuthStep step={steps.cliAuth} onRecheck={invalidateStatus} />
          ) : null}
          {currentKey === "connectors" ? <ConnectorStep done={steps.connectors.done} /> : null}
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
            onClick={() =>
              isLast ? finish.mutate() : setStepIndex((i) => Math.min(STEP_KEYS.length - 1, i + 1))
            }
          >
            Skip this step
          </button>
          {isLast ? (
            <button className="primary-button" type="button" onClick={() => finish.mutate()}>
              Finish
            </button>
          ) : (
            <button
              className="primary-button"
              type="button"
              onClick={() => setStepIndex((i) => Math.min(STEP_KEYS.length - 1, i + 1))}
            >
              Next
            </button>
          )}
        </footer>

        <OnboardingChatOverlay enabled={Boolean(overlayEnabled)} />
      </section>
    </main>
  );
}
