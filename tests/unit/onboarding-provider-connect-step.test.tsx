import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";

import type { CardModel } from "../../apps/web/src/onboarding/provider-connect-machine.js";
import { ProviderCard } from "../../apps/web/src/onboarding/cli-auth-step.js";

// This repo ships no DOM test environment — exercise the REAL presentational <ProviderCard/> by
// rendering each derived CardModel to an HTML string (mirrors onboarding-multiplexer-step.test.tsx).
const noop = () => undefined;
function render(model: CardModel, label = "Claude"): string {
  return renderToString(
    createElement(ProviderCard, {
      model,
      label,
      onConnect: noop,
      onLogin: noop,
      onSubmitToken: noop,
      tokenValue: "",
      onTokenChange: noop
    })
  );
}
const baseModel = (over: Partial<CardModel>): CardModel => ({
  status: "not_installed",
  busy: false,
  awaitingToken: false,
  inFlight: false,
  ...over
});

describe("ProviderCard (rendered)", () => {
  it("not_installed shows a Connect affordance", () => {
    expect(render(baseModel({ status: "not_installed" })).toLowerCase()).toContain("connect");
  });

  it("ready shows the connected / chat-ready confirmation", () => {
    const html = render(baseModel({ status: "ready" })).toLowerCase();
    expect(html).toContain("connected");
    expect(html).toContain("chat");
  });

  it("logging_in awaiting token shows the auth URL link and a paste-code field", () => {
    const html = render(
      baseModel({
        status: "logging_in",
        awaitingToken: true,
        authorizationUrl: "https://claude.ai/oauth/x"
      })
    );
    expect(html).toContain("https://claude.ai/oauth/x");
    expect(html.toLowerCase()).toContain("paste");
  });

  it("no_login (codex headless) shows the degraded, non-blocking message", () => {
    expect(render(baseModel({ status: "no_login" }), "Codex").toLowerCase()).toContain("headless");
  });

  it("unavailable shows a not-available message and no Connect button", () => {
    const html = render(baseModel({ status: "unavailable" }), "Antigravity").toLowerCase();
    expect(html).toContain("not");
    expect(html).not.toContain(">connect<");
  });

  it("busy surfaces an inline one-at-a-time notice", () => {
    expect(render(baseModel({ status: "not_installed", busy: true })).toLowerCase()).toContain(
      "busy"
    );
  });

  it("error surfaces the message", () => {
    expect(render(baseModel({ status: "error", errorMessage: "verify failed" }))).toContain(
      "verify failed"
    );
  });

  it("surfaces a login failure even while status is needs_login (errorMessage is orthogonal) — B1", () => {
    // The bug: a login/connect failure leaves installState at needs_login while setting an
    // errorMessage. The error must still be visible (not swallowed behind a bare Log in button).
    const html = render(
      baseModel({ status: "needs_login", errorMessage: "Login smoke check failed." })
    );
    expect(html).toContain("Login smoke check failed.");
    expect(html.toLowerCase()).toContain("log in"); // retry affordance still present
  });

  it("never renders a token/secret label leak", () => {
    const html = render(
      baseModel({ status: "logging_in", awaitingToken: true, authorizationUrl: "https://x" })
    );
    expect(html).not.toMatch(/secret|password|credential/i);
  });
});
