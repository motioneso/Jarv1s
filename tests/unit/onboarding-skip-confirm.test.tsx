import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";

import type { OnboardingStatusResponse } from "@jarv1s/shared";
import { SkipConfirmDialog, needsSkipConfirm } from "../../apps/web/src/onboarding/skip-confirm.js";

const noop = () => undefined;

const founderReady: OnboardingStatusResponse = {
  role: "founder",
  state: "pending",
  steps: {
    multiplexer: { done: true, selected: "tmux", tmuxUsable: true, herdrUsable: false },
    cliAuth: {
      done: true,
      providers: [{ kind: "anthropic", cliPresent: true, installState: "ready" }]
    },
    connectors: { done: false }
  }
};

const founderNoProvider: OnboardingStatusResponse = {
  role: "founder",
  state: "pending",
  steps: {
    multiplexer: { done: true, selected: "tmux", tmuxUsable: true, herdrUsable: false },
    cliAuth: {
      done: false,
      providers: [{ kind: "anthropic", cliPresent: true, installState: "needs_login" }]
    },
    connectors: { done: false }
  }
};

describe("needsSkipConfirm", () => {
  it("requires confirmation when no provider is connected", () => {
    expect(needsSkipConfirm(founderNoProvider)).toBe(true);
  });

  it("does NOT require confirmation once a provider is connected (chat will work)", () => {
    expect(needsSkipConfirm(founderReady)).toBe(false);
  });
});

describe("SkipConfirmDialog (rendered)", () => {
  function render(over?: { onConfirm?: () => void; onCancel?: () => void }): string {
    return renderToString(
      createElement(SkipConfirmDialog, {
        onConfirm: over?.onConfirm ?? noop,
        onCancel: over?.onCancel ?? noop,
        pending: false
      })
    );
  }

  it("states the consequence: chat won't work until a provider is connected", () => {
    const html = render().toLowerCase();
    expect(html).toContain("chat won");
    expect(html).toContain("provider");
    expect(html).toContain("settings");
  });

  it("offers both a confirm (skip anyway) and a cancel affordance", () => {
    const html = render().toLowerCase();
    expect(html).toContain("skip");
    expect(html).toContain("cancel");
  });

  it("does not leak the raw backend error string", () => {
    expect(render()).not.toContain("No active chat-capable model is configured");
  });
});
