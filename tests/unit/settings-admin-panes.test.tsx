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

  it("offers a Herdr install action when tmux is the only available multiplexer", () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(queryKeys.settings.chatMultiplexer, {
      multiplexer: "auto",
      available: { tmux: true, herdr: false }
    });

    const html = renderWithQuery(createElement(HostPane), client);

    expect(html).toContain("tmux available");
    expect(html).toContain("Install Herdr");
  });

  it("renders a direct restart action without deployment mode or command copy rows", () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(queryKeys.settings.chatMultiplexer, {
      multiplexer: "auto",
      available: { tmux: true, herdr: true }
    });

    const html = renderWithQuery(createElement(HostPane), client);

    expect(html).toContain("Restart API");
    expect(html).not.toContain("Deployment mode");
    expect(html).not.toContain("Restart command");
    expect(html).not.toContain("Operator-managed");
  });
});
