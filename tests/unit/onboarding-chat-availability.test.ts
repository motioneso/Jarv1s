import { describe, expect, it } from "vitest";

import type { OnboardingStatusResponse } from "@jarv1s/shared";
import {
  hasConnectedProvider,
  isNoActiveChatModelError
} from "../../apps/web/src/onboarding/chat-availability.js";
import { ApiError } from "../../apps/web/src/api/client.js";

const founder = (providers: readonly { installState?: string }[]): OnboardingStatusResponse => ({
  role: "founder",
  state: "pending",
  steps: {
    multiplexer: { done: true, selected: "tmux", tmuxUsable: true, herdrUsable: false },
    cliAuth: {
      done: providers.length > 0,
      providers: providers.map((p) => ({
        kind: "anthropic" as const,
        cliPresent: true,
        ...(p.installState ? { installState: p.installState as never } : {})
      }))
    },
    connectors: { done: false }
  }
});

const member: OnboardingStatusResponse = {
  role: "member",
  completed: false,
  steps: { apiKeyOptOut: { done: false }, connectors: { done: false } }
};

describe("hasConnectedProvider", () => {
  it("is true when at least one provider is in the ready install state", () => {
    expect(hasConnectedProvider(founder([{ installState: "ready" }]))).toBe(true);
  });

  it("is true when one of several providers is ready", () => {
    expect(
      hasConnectedProvider(founder([{ installState: "needs_login" }, { installState: "ready" }]))
    ).toBe(true);
  });

  it("is false when no provider has reached the ready state", () => {
    expect(hasConnectedProvider(founder([{ installState: "needs_login" }]))).toBe(false);
    expect(hasConnectedProvider(founder([{ installState: "installed" }]))).toBe(false);
    expect(hasConnectedProvider(founder([{}]))).toBe(false);
    expect(hasConnectedProvider(founder([]))).toBe(false);
  });

  it("is false (conservative) for the member status — member chat availability is not derivable here", () => {
    expect(hasConnectedProvider(member)).toBe(false);
  });

  it("is false when status is undefined", () => {
    expect(hasConnectedProvider(undefined)).toBe(false);
  });

  it("does not hardcode a single provider — any provider kind counts when ready", () => {
    const google: OnboardingStatusResponse = {
      role: "founder",
      state: "pending",
      steps: {
        multiplexer: { done: true, selected: "tmux", tmuxUsable: true, herdrUsable: false },
        cliAuth: {
          done: true,
          providers: [{ kind: "google", cliPresent: true, installState: "ready" }]
        },
        connectors: { done: false }
      }
    };
    expect(hasConnectedProvider(google)).toBe(true);
  });
});

describe("isNoActiveChatModelError", () => {
  it("matches the 400 ApiError the chat turn route returns for no active model", () => {
    expect(
      isNoActiveChatModelError(new ApiError(400, "No active chat-capable model is configured."))
    ).toBe(true);
  });

  it("matches case-insensitively", () => {
    expect(isNoActiveChatModelError(new ApiError(400, "no active chat-capable model"))).toBe(true);
  });

  it("does not match a different 400 error", () => {
    expect(isNoActiveChatModelError(new ApiError(400, "Some other validation error"))).toBe(false);
  });

  it("does not match a 500 with the same message (config errors are 400 only)", () => {
    expect(
      isNoActiveChatModelError(new ApiError(500, "No active chat-capable model is configured."))
    ).toBe(false);
  });

  it("does not match non-ApiError values", () => {
    expect(isNoActiveChatModelError(new Error("No active chat-capable model"))).toBe(false);
    expect(isNoActiveChatModelError("No active chat-capable model")).toBe(false);
    expect(isNoActiveChatModelError(undefined)).toBe(false);
  });
});
