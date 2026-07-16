import { createElement, type ReactElement } from "react";
import { renderToString } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";

import type { MeResponse } from "@jarv1s/shared";

const me: MeResponse = {
  user: {
    id: "u1",
    email: "u@example.test",
    emailVerified: true,
    name: "U",
    status: "active",
    isInstanceAdmin: false,
    isBootstrapOwner: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z"
  },
  profilePrefs: { addressed: null },
  hasPasswordCredential: true
};

describe("ProfilePane merged Account & preferences", () => {
  it("renders locale and quiet hours alongside identity/account", async () => {
    const html = await renderProfilePane();
    expect(html).toContain("Account &amp; preferences");
    expect(html).toContain("Quiet hours");
    expect(html).not.toContain("Auth provider configuration");
  });

  it("renders Data export before Danger zone and does not claim export is unavailable", async () => {
    const html = await renderProfilePane();
    const exportIndex = html.indexOf("Your data");
    const dangerIndex = html.indexOf("Danger zone");
    expect(exportIndex).toBeGreaterThan(-1);
    expect(dangerIndex).toBeGreaterThan(-1);
    expect(exportIndex).toBeLessThan(dangerIndex);
    expect(html).not.toContain("Data export isn't available yet");
  });
});

async function renderProfilePane(): Promise<string> {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { FeedbackProvider } = await import("../../apps/web/src/settings/settings-feedback.js");
  const { ProfilePane } = await import("../../apps/web/src/settings/settings-personal-panes.js");
  return renderToString(
    createElement(
      FeedbackProvider,
      null,
      createElement(
        QueryClientProvider,
        { client },
        createElement(ProfilePane, { me, onNavigate: () => {} }) as ReactElement
      )
    )
  );
}
