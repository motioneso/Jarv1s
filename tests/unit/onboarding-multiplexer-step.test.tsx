import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import type { OnboardingMultiplexerStepDto } from "@jarv1s/shared";

import { MultiplexerStep } from "../../apps/web/src/onboarding/multiplexer-step.js";

// This repo ships no DOM test environment (no jsdom/happy-dom, no
// @testing-library/react), so per the project's testing conventions we exercise
// the REAL <MultiplexerStep/> by rendering it to an HTML string with
// react-dom/server (already in the dependency tree) and asserting on its output.
function renderStep(step: OnboardingMultiplexerStepDto): string {
  const client = new QueryClient();
  return renderToString(
    createElement(
      QueryClientProvider,
      { client },
      createElement(MultiplexerStep, { step, onRecheck: () => undefined })
    )
  );
}

const usableTmuxStep: OnboardingMultiplexerStepDto = {
  done: true,
  selected: "tmux",
  tmuxUsable: true,
  herdrUsable: false
};

describe("MultiplexerStep (rendered component)", () => {
  it("does not render herdr anywhere in the onboarding step", () => {
    const html = renderStep(usableTmuxStep);

    expect(html.toLowerCase()).not.toContain("herdr");
  });

  it("renders Auto and tmux as selectable option cards", () => {
    const html = renderStep(usableTmuxStep);

    // Each option renders as a <button class="onb-opt"> with its name inside
    // <span class="onb-opt__name">; selecting a card is the only way to choose.
    expect(html).toContain("onb-opt__name");
    expect(html).toContain("Auto");
    expect(html).toContain("tmux");
    // Cards are enabled (not disabled) in the steady state, i.e. selectable.
    expect(html).not.toContain("disabled");
  });

  it("still links to the tmux install but offers no herdr install link", () => {
    const html = renderStep(usableTmuxStep);

    expect(html).toContain("https://github.com/tmux/tmux");
    expect(html).not.toContain("herdr.dev");
  });
});
