import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { PrioritySettings } from "@jarv1s/settings-ui";

describe("PrioritySettings", () => {
  it("renders its loading state inside a query client", () => {
    const queryClient = new QueryClient();

    const html = renderToString(
      <QueryClientProvider client={queryClient}>
        <PrioritySettings />
      </QueryClientProvider>
    );

    expect(html).toContain("Loading priority settings");
    expect(html).toContain("pane__title");
    expect(html).toContain("pane__card");
    expect(html).not.toContain('class="loading"');
  });

  it("labels unwired muted sources as having no effect yet", () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(["priority-model"], {
      version: 1,
      mode: "balanced",
      anchors: [],
      mutedSources: [],
      updatedAt: "2026-07-01T00:00:00Z"
    });

    const html = renderToString(
      <QueryClientProvider client={queryClient}>
        <PrioritySettings />
      </QueryClientProvider>
    );

    expect(html).toContain("Exclude this source from priority ranking.");
    expect(html).toContain("Nothing feeds this source into ranking yet, so muting has no effect.");
    // Wired sources keep the active copy; the two unwired ones get the explainer.
    const activeCopy = html.split("Exclude this source from priority ranking.").length - 1;
    const unwiredCopy =
      html.split("Nothing feeds this source into ranking yet, so muting has no effect.").length - 1;
    expect(activeCopy).toBe(4);
    expect(unwiredCopy).toBe(2);
  });
});
