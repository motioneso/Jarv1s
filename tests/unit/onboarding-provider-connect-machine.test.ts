import { describe, expect, it } from "vitest";

import type { OnboardingCliProviderDto } from "@jarv1s/shared";

import {
  deriveCardModel,
  IDLE_LOGIN,
  interpretLoginResponse,
  shouldAutoLogin
} from "../../apps/web/src/onboarding/provider-connect-machine.js";

const provider = (over: Partial<OnboardingCliProviderDto>): OnboardingCliProviderDto => ({
  kind: "anthropic",
  cliPresent: false,
  ...over
});

describe("deriveCardModel", () => {
  it("non-installable provider ⇒ unavailable, non-blocking", () => {
    const m = deriveCardModel({
      provider: provider({ kind: "google", installable: false }),
      login: IDLE_LOGIN,
      installing: false,
      busy: false
    });
    expect(m.status).toBe("unavailable");
  });

  it("installable + no install row ⇒ not_installed (offer Connect)", () => {
    const m = deriveCardModel({
      provider: provider({ installable: true }),
      login: IDLE_LOGIN,
      installing: false,
      busy: false
    });
    expect(m.status).toBe("not_installed");
  });

  it("installing flag ⇒ installing + inFlight", () => {
    const m = deriveCardModel({
      provider: provider({ installable: true, installState: "installing" }),
      login: IDLE_LOGIN,
      installing: true,
      busy: false
    });
    expect(m.status).toBe("installing");
    expect(m.inFlight).toBe(true);
  });

  it("installState needs_login (idle login) ⇒ needs_login", () => {
    const m = deriveCardModel({
      provider: provider({ installable: true, installState: "needs_login" }),
      login: IDLE_LOGIN,
      installing: false,
      busy: false
    });
    expect(m.status).toBe("needs_login");
  });

  it("installState installed (idle login) ⇒ needs_login (prompt to log in)", () => {
    const m = deriveCardModel({
      provider: provider({ installable: true, installState: "installed" }),
      login: IDLE_LOGIN,
      installing: false,
      busy: false
    });
    expect(m.status).toBe("needs_login");
  });

  it("awaiting_token login session ⇒ logging_in, exposes url + paste field", () => {
    const m = deriveCardModel({
      provider: provider({ installable: true, installState: "needs_login" }),
      login: { phase: "awaiting_token", loginId: "L1", authorizationUrl: "https://x" },
      installing: false,
      busy: false
    });
    expect(m.status).toBe("logging_in");
    expect(m.awaitingToken).toBe(true);
    expect(m.authorizationUrl).toBe("https://x");
  });

  it("no_url login phase ⇒ no_login (codex headless degraded)", () => {
    const m = deriveCardModel({
      provider: provider({
        kind: "openai-compatible",
        installable: true,
        installState: "needs_login"
      }),
      login: { phase: "no_url", loginId: "L1" },
      installing: false,
      busy: false
    });
    expect(m.status).toBe("no_login");
  });

  it("installState ready ⇒ ready", () => {
    const m = deriveCardModel({
      provider: provider({ installable: true, installState: "ready" }),
      login: IDLE_LOGIN,
      installing: false,
      busy: false
    });
    expect(m.status).toBe("ready");
  });

  it("busy is surfaced orthogonally (503 single-active-user)", () => {
    const m = deriveCardModel({
      provider: provider({ installable: true }),
      login: IDLE_LOGIN,
      installing: false,
      busy: true
    });
    expect(m.busy).toBe(true);
  });

  it("error message flows from the login session", () => {
    const m = deriveCardModel({
      provider: provider({ installable: true, installState: "error" }),
      login: { phase: "idle", error: "login smoke check failed" },
      installing: false,
      busy: false
    });
    expect(m.status).toBe("error");
    expect(m.errorMessage).toBe("login smoke check failed");
  });

  it("a login failure keeps status needs_login but still exposes errorMessage (B1)", () => {
    // A failed login leaves the persisted installState at needs_login while the transient session
    // carries the error — the model must surface BOTH so the UI never swallows the failure.
    const m = deriveCardModel({
      provider: provider({ installable: true, installState: "needs_login" }),
      login: { phase: "idle", error: "Login smoke check failed." },
      installing: false,
      busy: false
    });
    expect(m.status).toBe("needs_login");
    expect(m.errorMessage).toBe("Login smoke check failed.");
  });
});

describe("shouldAutoLogin", () => {
  it("auto-advances to login from installed / needs_login", () => {
    expect(shouldAutoLogin("installed")).toBe(true);
    expect(shouldAutoLogin("needs_login")).toBe(true);
  });
  it("does not auto-login from error / ready / not_installed", () => {
    expect(shouldAutoLogin("error")).toBe(false);
    expect(shouldAutoLogin("ready")).toBe(false);
    expect(shouldAutoLogin("not_installed")).toBe(false);
  });
});

describe("interpretLoginResponse", () => {
  const base = {
    providerKind: "anthropic" as const,
    loginId: "L1",
    installState: "needs_login" as const
  };

  it("begin with authorizationUrl ⇒ awaiting_token", () => {
    const next = interpretLoginResponse(
      { ...base, status: "awaiting_token", authorizationUrl: "https://x" },
      "begin"
    );
    expect(next).toEqual({ kind: "awaiting_token", loginId: "L1", authorizationUrl: "https://x" });
  });

  it("Codex device auth displays its code and polls for completion", () => {
    const next = interpretLoginResponse(
      {
        ...base,
        providerKind: "openai-compatible",
        status: "awaiting_authorization",
        authorizationUrl: "https://auth.openai.com/codex/device",
        userCode: "ABCD-EFGHI"
      },
      "begin"
    );
    expect(next).toEqual({
      kind: "awaiting_authorization",
      loginId: "L1",
      authorizationUrl: "https://auth.openai.com/codex/device",
      userCode: "ABCD-EFGHI"
    });
  });

  it("begin with NO url ⇒ no_url (codex headless)", () => {
    const next = interpretLoginResponse({ ...base, status: "awaiting_token" }, "begin");
    expect(next).toEqual({ kind: "no_url", loginId: "L1" });
  });

  it("ready status ⇒ ready (any phase)", () => {
    expect(
      interpretLoginResponse({ ...base, status: "ready", installState: "ready" }, "submit")
    ).toEqual({ kind: "ready" });
  });

  it("error status ⇒ error with message", () => {
    expect(
      interpretLoginResponse({ ...base, status: "error", message: "bad code" }, "submit")
    ).toEqual({ kind: "error", message: "bad code" });
  });

  it("submit still awaiting ⇒ poll", () => {
    expect(interpretLoginResponse({ ...base, status: "awaiting_token" }, "submit")).toEqual({
      kind: "poll",
      loginId: "L1"
    });
  });

  it("poll still awaiting ⇒ poll (continue)", () => {
    expect(interpretLoginResponse({ ...base, status: "awaiting_authorization" }, "poll")).toEqual({
      kind: "poll",
      loginId: "L1"
    });
  });
});
