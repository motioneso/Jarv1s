import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router";

import { ConnectProviderEmpty } from "../../apps/web/src/chat/connect-provider-empty.js";

function render(props: { isFounder: boolean }): string {
  return renderToString(
    createElement(MemoryRouter, null, createElement(ConnectProviderEmpty, props))
  );
}

describe("ConnectProviderEmpty (rendered)", () => {
  it("shows the connect-a-provider explainer, not the raw backend error", () => {
    const html = render({ isFounder: true });
    expect(html.toLowerCase()).toContain("connect a provider to start chatting");
    expect(html).not.toContain("No active chat-capable model is configured");
  });

  it("renders a direct link to the assistant/AI settings (deep-linked) for any user", () => {
    const html = render({ isFounder: false });
    // Deep-link carries the assistant section so the user lands on Assistant & AI, not Profile.
    expect(html).toContain("/settings?section=assistant");
  });

  it("offers a connect link for the founder too", () => {
    const html = render({ isFounder: true });
    expect(html).toContain("/settings?section=assistant");
    expect(html.toLowerCase()).toContain("connect");
  });
});
