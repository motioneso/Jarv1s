import type { MeResponse, OnboardingStatusResponse } from "@jarv1s/shared";

export const STEP_KEYS = ["welcome", "multiplexer", "cliAuth", "connectors"] as const;
export type StepKey = (typeof STEP_KEYS)[number];

/** Per-step done map. welcome is always "done" for resume purposes; the rest are derived. */
export function doneByStep(status: OnboardingStatusResponse | undefined): Record<StepKey, boolean> {
  const steps = status?.steps;
  return {
    welcome: true,
    multiplexer: steps?.multiplexer.done ?? false,
    cliAuth: steps?.cliAuth.done ?? false,
    connectors: steps?.connectors.done ?? false
  };
}

/** Index of the first not-done step; the last step index when everything is done. */
export function firstIncompleteStepIndex(status: OnboardingStatusResponse | undefined): number {
  const done = doneByStep(status);
  const idx = STEP_KEYS.findIndex((k) => !done[k]);
  return idx === -1 ? STEP_KEYS.length - 1 : idx;
}

/**
 * The optional Jarvis overlay is enabled ONLY when a usable CLI chat path exists:
 * the multiplexer step is DONE (i.e. the chosen multiplexer is USABLE — tmux installed,
 * herdr installed+root-pane, or auto with one usable) AND at least one provider CLI is
 * PRESENT. Gating on `multiplexer.done` (not bare `selected`) honours herdr's root-pane
 * requirement (Codex R1) — a selected-but-unusable herdr does not light the overlay.
 */
export function isOverlayEnabled(status: OnboardingStatusResponse | undefined): boolean {
  if (!status) return false;
  return status.steps.multiplexer.done && status.steps.cliAuth.providers.some((p) => p.cliPresent);
}

/** Bootstrap owner ⇔ instance admin AND bootstrap owner. Used to gate the onboarding fetch+branch. */
export function isBootstrapOwner(me: MeResponse | undefined): boolean {
  return me?.user.isInstanceAdmin === true && me?.user.isBootstrapOwner === true;
}

/**
 * Pure decision the app.tsx branch makes: show the wizard ONLY for a bootstrap owner whose
 * status has loaded successfully with state === "pending". Any other case (non-owner, no data
 * yet, error/timeout, or a terminal state) ⇒ false ⇒ render the app shell. This guarantees a
 * fresh instance always boots and a non-owner never sees the wizard.
 */
export function shouldShowOnboarding(
  me: MeResponse | undefined,
  status: OnboardingStatusResponse | undefined
): boolean {
  return isBootstrapOwner(me) && status?.state === "pending";
}
