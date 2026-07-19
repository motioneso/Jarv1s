import { ExternalLink, Info, LoaderCircle, LogIn, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import type { AiProviderConfigDto, AiProviderKind } from "@jarv1s/shared";

import { ApiError } from "../api/client";
import {
  beginOnboardingProviderLogin,
  cancelOnboardingProviderLogin,
  pollOnboardingProviderLogin,
  submitOnboardingProviderLoginToken
} from "../api/onboarding-connect-client";

export type AutomatedLoginProviderKind = Extract<AiProviderKind, "anthropic" | "openai-compatible">;

export type AutomatedLoginProvider = AiProviderConfigDto & {
  readonly providerKind: AutomatedLoginProviderKind;
};

type LoginPhase =
  | "beginning"
  | "awaiting-token"
  | "awaiting-authorization"
  | "submitting"
  | "polling"
  | "success"
  | "error";

interface LoginState {
  readonly phase: LoginPhase;
  readonly loginId?: string;
  readonly authorizationUrl?: string;
  readonly userCode?: string;
  readonly token: string;
  readonly error?: string;
}

const MAX_POLLS = 360; // nine minutes, just below the runner's ten-minute login lifetime
const POLL_INTERVAL_MS = 1500;

const INITIAL_STATE: LoginState = { phase: "beginning", token: "" };

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function errorText(error: unknown): string {
  if (error instanceof ApiError && error.message) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return "Something went wrong. Try again.";
}

export function supportsAutomatedProviderLogin(
  provider: AiProviderConfigDto
): provider is AutomatedLoginProvider {
  return (
    provider.authMethod === "cli" &&
    provider.cliAvailable &&
    (provider.providerKind === "anthropic" || provider.providerKind === "openai-compatible")
  );
}

export function ProviderLoginDialog(props: {
  readonly provider: AutomatedLoginProvider;
  readonly onClose: () => void;
  readonly onSuccess: () => void;
}) {
  const { provider, onSuccess } = props;
  const [state, setState] = useState<LoginState>(INITIAL_STATE);
  const closedRef = useRef(false);
  const sessionRef = useRef<{ providerKind: AutomatedLoginProviderKind; loginId: string } | null>(
    null
  );

  const finish = useCallback(() => {
    sessionRef.current = null;
    setState((current) => ({ ...current, phase: "success", token: "" }));
    onSuccess();
  }, [onSuccess]);

  const pollLogin = useCallback(
    async (loginId: string) => {
      setState((current) => ({ ...current, phase: "polling", loginId }));
      for (let attempt = 0; attempt < MAX_POLLS; attempt++) {
        await delay(POLL_INTERVAL_MS);
        if (closedRef.current) return;
        try {
          const response = await pollOnboardingProviderLogin({
            providerKind: provider.providerKind,
            loginId
          });
          if (response.status === "ready") {
            finish();
            return;
          }
          if (response.status === "error") {
            setState((current) => ({
              ...current,
              phase: "error",
              error: response.message ?? "Login failed.",
              token: ""
            }));
            return;
          }
          setState((current) => ({
            ...current,
            phase: "polling",
            authorizationUrl: response.authorizationUrl ?? current.authorizationUrl,
            userCode: response.userCode ?? current.userCode
          }));
        } catch (error) {
          setState((current) => ({
            ...current,
            phase: "error",
            error: errorText(error),
            token: ""
          }));
          return;
        }
      }
      setState((current) => ({
        ...current,
        phase: "error",
        error: "Login timed out — try again.",
        token: ""
      }));
    },
    [finish, provider.providerKind]
  );

  const beginLogin = useCallback(async () => {
    setState({ phase: "beginning", token: "" });
    try {
      const response = await beginOnboardingProviderLogin({ providerKind: provider.providerKind });
      if (closedRef.current) {
        void cancelOnboardingProviderLogin({
          providerKind: provider.providerKind,
          loginId: response.loginId
        });
        return;
      }
      sessionRef.current = { providerKind: provider.providerKind, loginId: response.loginId };
      if (response.status === "ready") {
        finish();
        return;
      }
      if (response.status === "error") {
        setState({ phase: "error", loginId: response.loginId, token: "", error: response.message });
        return;
      }
      setState({
        phase: response.status === "awaiting_token" ? "awaiting-token" : "awaiting-authorization",
        loginId: response.loginId,
        authorizationUrl: response.authorizationUrl,
        userCode: response.userCode,
        token: ""
      });
      if (response.status === "awaiting_authorization") void pollLogin(response.loginId);
    } catch (error) {
      if (!closedRef.current) setState({ phase: "error", token: "", error: errorText(error) });
    }
  }, [finish, pollLogin, provider.providerKind]);

  useEffect(() => {
    closedRef.current = false;
    void beginLogin();
    return () => {
      closedRef.current = true;
      const session = sessionRef.current;
      sessionRef.current = null;
      if (session) void cancelOnboardingProviderLogin(session);
    };
  }, [beginLogin]);

  const close = () => {
    const session = sessionRef.current;
    sessionRef.current = null;
    if (session) void cancelOnboardingProviderLogin(session);
    props.onClose();
  };

  const submitToken = async () => {
    const loginId = state.loginId;
    const token = state.token;
    if (!loginId || !token) return;
    // Clear auth material before the request starts; it must not linger on success or failure.
    setState((current) => ({ ...current, phase: "submitting", token: "", error: undefined }));
    try {
      const response = await submitOnboardingProviderLoginToken({
        providerKind: provider.providerKind,
        loginId,
        token
      });
      if (response.status === "ready") {
        finish();
      } else if (response.status === "error") {
        setState((current) => ({
          ...current,
          phase: "error",
          error: response.message ?? "Login failed."
        }));
      } else {
        void pollLogin(loginId);
      }
    } catch (error) {
      if (!closedRef.current) {
        setState((current) => ({ ...current, phase: "error", error: errorText(error) }));
      }
    }
  };

  const copyUrl = () => {
    if (state.authorizationUrl) void navigator.clipboard?.writeText(state.authorizationUrl);
  };
  const busy = state.phase === "beginning" || state.phase === "submitting";

  return (
    <div
      className="jds-dialog-scrim"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget && !busy) close();
      }}
    >
      <div
        className="jds-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={`${provider.displayName} sign-in`}
      >
        <div className="jds-dialog__head">
          <div className="jds-dialog__title">Sign in to {provider.displayName}</div>
          <div className="jds-dialog__desc">
            Complete the provider sign-in here; no terminal session or API key is required.
          </div>
        </div>

        <div className="jds-dialog__body">
          {state.phase === "beginning" || state.phase === "submitting" ? (
            <div className="term-modal__prompt">
              <LoaderCircle size={16} className="dexp__spin" aria-hidden="true" />
              {state.phase === "beginning" ? "Starting sign-in…" : "Completing sign-in…"}
            </div>
          ) : null}

          {state.phase === "awaiting-token" ? (
            <>
              <div className="term-modal__prompt">Approve access, then paste the code below.</div>
              {state.authorizationUrl ? (
                <p>
                  <a href={state.authorizationUrl} target="_blank" rel="noreferrer">
                    Open provider sign-in <ExternalLink size={13} aria-hidden="true" />
                  </a>{" "}
                  <button
                    type="button"
                    className="jds-btn jds-btn--quiet jds-btn--sm"
                    onClick={copyUrl}
                  >
                    Copy link
                  </button>
                </p>
              ) : null}
              <input
                className="jds-input"
                type="text"
                inputMode="text"
                autoComplete="off"
                placeholder="Paste sign-in code"
                aria-label="Provider sign-in code"
                value={state.token}
                onChange={(event) =>
                  setState((current) => ({ ...current, token: event.target.value }))
                }
              />
            </>
          ) : null}

          {state.phase === "awaiting-authorization" || state.phase === "polling" ? (
            <>
              <div className="term-modal__prompt">
                <LoaderCircle size={16} className="dexp__spin" aria-hidden="true" />
                Approve access in the provider page; Jarvis is checking for completion.
              </div>
              {state.authorizationUrl ? (
                <p>
                  <a href={state.authorizationUrl} target="_blank" rel="noreferrer">
                    Open provider sign-in <ExternalLink size={13} aria-hidden="true" />
                  </a>{" "}
                  <button
                    type="button"
                    className="jds-btn jds-btn--quiet jds-btn--sm"
                    onClick={copyUrl}
                  >
                    Copy link
                  </button>
                </p>
              ) : null}
              {state.userCode ? (
                <p>
                  Device code: <code>{state.userCode}</code>
                </p>
              ) : null}
            </>
          ) : null}

          {state.phase === "error" ? (
            <div role="alert">
              <p>
                <Info size={15} aria-hidden="true" /> {state.error ?? "Login failed."}
              </p>
              <button
                type="button"
                className="jds-btn jds-btn--secondary jds-btn--sm"
                onClick={() => void beginLogin()}
              >
                Try again
              </button>
            </div>
          ) : null}

          {state.phase === "success" ? (
            <p role="status">Provider connected. Chat is ready.</p>
          ) : null}
        </div>

        <div className="jds-dialog__foot">
          <button type="button" className="jds-btn jds-btn--quiet" onClick={close} disabled={busy}>
            <X size={14} aria-hidden="true" /> Close
          </button>
          {state.phase === "awaiting-token" ? (
            <button
              type="button"
              className="jds-btn jds-btn--primary"
              onClick={() => void submitToken()}
              disabled={!state.token || !state.loginId}
            >
              <LogIn size={14} aria-hidden="true" /> Submit code
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
