import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";

import { FinishStep } from "../../apps/web/src/onboarding/onboarding-wizard.js";

const noop = () => undefined;

function render(over?: {
  role?: "founder" | "member";
  chatAvailable?: boolean;
  onAskJarvis?: () => void;
  onFinish?: (destination: "today" | "settings") => void;
}): string {
  return renderToString(
    createElement(FinishStep, {
      role: over?.role ?? "founder",
      skippedSteps: new Set<string>(),
      pending: false,
      onFinish: over?.onFinish ?? noop,
      chatAvailable: over?.chatAvailable ?? false,
      onAskJarvis: over?.onAskJarvis ?? noop
    })
  );
}

describe("FinishStep — Ask Jarvis affordance (#368)", () => {
  it("renders the 'Ask Jarvis' action when chat is available", () => {
    expect(render({ chatAvailable: true })).toContain("Ask Jarvis");
  });

  it("does NOT render 'Ask Jarvis' when chat is unavailable (no dead button)", () => {
    expect(render({ chatAvailable: false })).not.toContain("Ask Jarvis");
  });

  it("keeps the normal go-to-Today path regardless of chat availability", () => {
    expect(render({ chatAvailable: true })).toContain("Open today");
    expect(render({ chatAvailable: false })).toContain("Open today");
  });

  it("keeps a settings path reachable in both states", () => {
    expect(render({ chatAvailable: true }).toLowerCase()).toContain("settings");
    expect(render({ chatAvailable: false }).toLowerCase()).toContain("settings");
  });

  it("is hidden for members even when the flag is somehow false (member chat not derivable here)", () => {
    // hasConnectedProvider is conservative-false for members, so chatAvailable is false in practice.
    expect(render({ role: "member", chatAvailable: false })).not.toContain("Ask Jarvis");
  });
});
