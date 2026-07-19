import type {
  OnboardingCliProviderDto,
  OnboardingProviderLoginResponse,
  ProviderInstallState
} from "@jarv1s/shared";

// ---------------------------------------------------------------------------
// #365 provider-connect: the PURE state machine behind the onboarding "02 Assistant" step.
// All decision logic lives here (no React, no DOM, no I/O) so it is unit-testable directly;
// the component (cli-auth-step.tsx) wires these to the client methods + renders the result.
// ---------------------------------------------------------------------------

/**
 * The transient, CLIENT-ONLY login session — never persisted. Resume relies entirely on the
 * persisted `installState` (`needs_login` ⇒ re-initiate login). The pasted code is held in the
 * component's input state, NOT here, and is never logged.
 */
export type LoginPhase =
  | "idle"
  | "beginning"
  | "awaiting_token"
  | "awaiting_authorization"
  | "submitting"
  | "polling"
  | "no_url";

export interface LoginSession {
  readonly phase: LoginPhase;
  readonly loginId?: string;
  readonly authorizationUrl?: string;
  readonly userCode?: string;
  readonly error?: string;
}

export const IDLE_LOGIN: LoginSession = { phase: "idle" };

export type CardStatus =
  | "unavailable"
  | "not_installed"
  | "installing"
  | "needs_login"
  | "logging_in"
  | "no_login"
  | "ready"
  | "error";

export interface CardModel {
  readonly status: CardStatus;
  readonly busy: boolean;
  readonly errorMessage?: string;
  readonly authorizationUrl?: string;
  readonly userCode?: string;
  readonly awaitingToken: boolean;
  readonly inFlight: boolean;
}

const ACTIVE_LOGIN: ReadonlySet<LoginPhase> = new Set([
  "beginning",
  "awaiting_token",
  "awaiting_authorization",
  "submitting",
  "polling"
]);

/** Pure: derive the per-card UI model from the persisted lifecycle + transient login session. */
export function deriveCardModel(args: {
  readonly provider: OnboardingCliProviderDto;
  readonly login: LoginSession;
  readonly installing: boolean;
  readonly busy: boolean;
  readonly errorMessage?: string;
}): CardModel {
  const { provider, login, installing, busy } = args;
  const errorMessage = login.error ?? args.errorMessage;
  const inFlight =
    installing ||
    login.phase === "beginning" ||
    login.phase === "submitting" ||
    login.phase === "polling";
  const base = {
    busy,
    awaitingToken: login.phase === "awaiting_token",
    authorizationUrl: ACTIVE_LOGIN.has(login.phase) ? login.authorizationUrl : undefined,
    userCode: ACTIVE_LOGIN.has(login.phase) ? login.userCode : undefined,
    inFlight,
    ...(errorMessage !== undefined ? { errorMessage } : {})
  };

  if (provider.installable === false) return { ...base, status: "unavailable" };
  if (installing) return { ...base, status: "installing" };
  if (login.phase === "no_url") return { ...base, status: "no_login" };
  if (ACTIVE_LOGIN.has(login.phase)) return { ...base, status: "logging_in" };

  switch (provider.installState) {
    case "ready":
      return { ...base, status: "ready" };
    case "error":
      return { ...base, status: "error" };
    case "needs_login":
    case "installed":
      return { ...base, status: "needs_login" };
    case "installing":
      return { ...base, status: "installing" };
    default:
      return { ...base, status: "not_installed" };
  }
}

/** After an install POST settles, should we chain straight into login? */
export function shouldAutoLogin(installState: ProviderInstallState): boolean {
  return installState === "installed" || installState === "needs_login";
}

export type LoginNext =
  | { readonly kind: "awaiting_token"; readonly loginId: string; readonly authorizationUrl: string }
  | {
      readonly kind: "awaiting_authorization";
      readonly loginId: string;
      readonly authorizationUrl: string;
      readonly userCode?: string;
    }
  | { readonly kind: "no_url"; readonly loginId: string }
  | { readonly kind: "poll"; readonly loginId: string }
  | { readonly kind: "ready" }
  | { readonly kind: "error"; readonly message: string };

/** Pure: map a login response to the next client action. */
export function interpretLoginResponse(
  resp: OnboardingProviderLoginResponse,
  phase: "begin" | "submit" | "poll"
): LoginNext {
  if (resp.status === "ready") return { kind: "ready" };
  if (resp.status === "error") return { kind: "error", message: resp.message ?? "Login failed." };
  // awaiting_authorization | awaiting_token (not settled)
  if (phase === "begin") {
    if (!resp.authorizationUrl) return { kind: "no_url", loginId: resp.loginId };
    if (resp.status === "awaiting_authorization") {
      return {
        kind: "awaiting_authorization",
        loginId: resp.loginId,
        authorizationUrl: resp.authorizationUrl,
        ...(resp.userCode !== undefined ? { userCode: resp.userCode } : {})
      };
    }
    return {
      kind: "awaiting_token",
      loginId: resp.loginId,
      authorizationUrl: resp.authorizationUrl
    };
  }
  return { kind: "poll", loginId: resp.loginId };
}
