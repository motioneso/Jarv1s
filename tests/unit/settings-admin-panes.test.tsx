import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";

import { queryKeys } from "../../apps/web/src/api/query-keys.js";
import { HostPane, IdentityPane } from "../../apps/web/src/settings/settings-admin-panes.js";
import { FeedbackProvider } from "../../apps/web/src/settings/settings-feedback.js";

function renderWithQuery(
  node: React.ReactNode,
  client = new QueryClient({
    defaultOptions: { queries: { retry: false } }
  })
): string {
  return renderToString(
    createElement(QueryClientProvider, { client }, createElement(FeedbackProvider, null, node))
  );
}

describe("settings admin panes", () => {
  it("hides sign-in methods until alternate methods are wired", () => {
    const html = renderWithQuery(createElement(IdentityPane));

    expect(html).toContain("Identity &amp; registration");
    expect(html).toContain("Registration");
    expect(html).not.toContain("Sign-in methods");
    expect(html).not.toContain("No sign-in methods configured");
  });

  it("shows herdr availability as a status badge, with no install action", () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(queryKeys.settings.chatMultiplexer, {
      multiplexer: "auto",
      available: { tmux: true, herdr: false }
    });

    const html = renderWithQuery(createElement(HostPane), client);

    expect(html).toContain("tmux available");
    expect(html).toContain("herdr available");
    expect(html).not.toContain("Install Herdr");
  });

  it("has no deployment mode, restart-command copy rows, or restart action", () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(queryKeys.settings.chatMultiplexer, {
      multiplexer: "auto",
      available: { tmux: true, herdr: true }
    });

    const html = renderWithQuery(createElement(HostPane), client);

    expect(html).not.toContain("Deployment mode");
    expect(html).not.toContain("Restart command");
    expect(html).not.toContain("Operator-managed");
    expect(html).not.toContain("Restart API");
  });
});
