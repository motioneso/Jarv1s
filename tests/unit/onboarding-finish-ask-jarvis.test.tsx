import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";

import { FinishStep } from "../../apps/web/src/onboarding/onboarding-wizard.js";

const noop = () => undefined;

function render(over?: { role?: "founder" | "member"; onFinish?: () => void }): string {
  return renderToString(
    createElement(FinishStep, {
      role: over?.role ?? "founder",
      skippedSteps: new Set<string>(),
      pending: false,
      onFinish: over?.onFinish ?? noop
    })
  );
}

describe("FinishStep", () => {
  it("offers one truthful finish action", () => {
    const html = render();
    expect(html).toContain("Finish setup");
    expect(html).not.toContain("Ask Jarvis");
    expect(html.match(/<button/g)).toHaveLength(1);
  });
});
