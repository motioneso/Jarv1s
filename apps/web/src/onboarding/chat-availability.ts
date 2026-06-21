import type { OnboardingStatusResponse } from "@jarv1s/shared";

import { ApiError } from "../api/client.js";

/**
 * #369 — chat-availability signal, derived from the SAME onboarding status #365 added.
 *
 * "A provider is connected" ⇔ at least one CLI provider has reached the persisted `ready`
 * lifecycle state (install → login → ready). Anything earlier (not_installed, installing,
 * installed, needs_login, error) is NOT chat-capable. This is provider-AGNOSTIC: it counts
 * any provider kind that is ready, never a specific provider/model.
 *
 * The member status variant carries no per-provider install state (member chat availability is
 * derived from other module endpoints, not here), so this conservatively returns false for it —
 * the empty-chat explainer then still offers the connect path, which is the safe default.
 */
export function hasConnectedProvider(status: OnboardingStatusResponse | undefined): boolean {
  if (status === undefined || status.role !== "founder") return false;
  return status.steps.cliAuth.providers.some((provider) => provider.installState === "ready");
}

/**
 * True iff `error` is the 400 the chat-turn route returns when no active chat-capable model is
 * configured (packages/chat live-routes maps the thrown config error to this stable 400). We
 * branch on the typed {@link ApiError} status + a tolerant message match so the UI can render the
 * friendly "connect a provider" explainer INSTEAD of surfacing the raw backend string.
 */
export function isNoActiveChatModelError(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    error.status === 400 &&
    /no active chat-capable model/i.test(error.message)
  );
}
