import { describe, it, expect } from "vitest";
import type { MeResponse, OnboardingStatusResponse } from "@jarv1s/shared";

import {
  STEP_KEYS,
  firstIncompleteStepIndex,
  isBootstrapOwner,
  isOverlayEnabled,
  shouldShowOnboarding
} from "../../apps/web/src/onboarding/resume.js";

function status(
  overrides: Partial<OnboardingStatusResponse["steps"]> = {}
): OnboardingStatusResponse {
  return {
    state: "pending",
    steps: {
      multiplexer: { done: false, selected: null, tmuxUsable: false, herdrUsable: false },
      cliAuth: {
        done: false,
        providers: [
          { kind: "anthropic", cliPresent: false },
          { kind: "openai-compatible", cliPresent: false },
          { kind: "google", cliPresent: false }
        ]
      },
      connectors: { done: false },
      ...overrides
    }
  };
}

describe("firstIncompleteStepIndex", () => {
  it("returns the multiplexer step (index 1) when nothing is done", () => {
    expect(firstIncompleteStepIndex(status())).toBe(STEP_KEYS.indexOf("multiplexer"));
  });

  it("skips done steps and resumes at the first not-done", () => {
    const s = status({
      multiplexer: { done: true, selected: "tmux", tmuxUsable: true, herdrUsable: false }
    });
    expect(firstIncompleteStepIndex(s)).toBe(STEP_KEYS.indexOf("cliAuth"));
  });

  it("returns the last step index when every derived step is done", () => {
    const s = status({
      multiplexer: { done: true, selected: "auto", tmuxUsable: true, herdrUsable: false },
      cliAuth: {
        done: true,
        providers: [
          { kind: "anthropic", cliPresent: true },
          { kind: "openai-compatible", cliPresent: false },
          { kind: "google", cliPresent: false }
        ]
      },
      connectors: { done: true }
    });
    expect(firstIncompleteStepIndex(s)).toBe(STEP_KEYS.length - 1);
  });
});

describe("isOverlayEnabled", () => {
  it("is false when no multiplexer is usable", () => {
    expect(isOverlayEnabled(status())).toBe(false);
  });

  it("is false when a multiplexer is usable but no CLI is present", () => {
    const s = status({
      multiplexer: { done: true, selected: "tmux", tmuxUsable: true, herdrUsable: false }
    });
    expect(isOverlayEnabled(s)).toBe(false);
  });

  it("is true only when the multiplexer step is done (usable) AND a CLI is present", () => {
    const s = status({
      multiplexer: { done: true, selected: "tmux", tmuxUsable: true, herdrUsable: false },
      cliAuth: {
        done: true,
        providers: [
          { kind: "anthropic", cliPresent: true },
          { kind: "openai-compatible", cliPresent: false },
          { kind: "google", cliPresent: false }
        ]
      }
    });
    expect(isOverlayEnabled(s)).toBe(true);
  });

  it("is false for a null status (still-loading / error)", () => {
    expect(isOverlayEnabled(undefined)).toBe(false);
  });
});

function me(isInstanceAdmin: boolean, isBootstrapOwner: boolean): MeResponse {
  // Build the minimal MeResponse the predicate reads; match the real shape (fill required
  // fields per platform-api.ts — only user.isInstanceAdmin / user.isBootstrapOwner are read).
  return { user: { isInstanceAdmin, isBootstrapOwner } } as unknown as MeResponse;
}

describe("shouldShowOnboarding", () => {
  it("is false for a non-owner even with a pending status", () => {
    expect(shouldShowOnboarding(me(false, false), status())).toBe(false);
    expect(shouldShowOnboarding(me(true, false), status())).toBe(false); // admin but not bootstrap owner
  });
  it("is true for a bootstrap owner with state=pending", () => {
    expect(shouldShowOnboarding(me(true, true), status())).toBe(true);
  });
  it("is false for a bootstrap owner once state is terminal", () => {
    expect(shouldShowOnboarding(me(true, true), { ...status(), state: "completed" })).toBe(false);
    expect(shouldShowOnboarding(me(true, true), { ...status(), state: "skipped" })).toBe(false);
  });
  it("is false when status is undefined (loading/error) — fall through to the shell", () => {
    expect(shouldShowOnboarding(me(true, true), undefined)).toBe(false);
  });
});

describe("isBootstrapOwner", () => {
  it("is true only when instance admin AND bootstrap owner", () => {
    expect(isBootstrapOwner(me(true, true))).toBe(true);
    expect(isBootstrapOwner(me(true, false))).toBe(false);
    expect(isBootstrapOwner(me(false, true))).toBe(false);
    expect(isBootstrapOwner(undefined)).toBe(false);
  });
});
