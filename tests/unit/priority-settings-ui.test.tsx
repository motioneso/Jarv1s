import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { PrioritySettings } from "@jarv1s/settings-ui";
import type { PriorityModelPreferenceV1 } from "@jarv1s/priority";

const model: PriorityModelPreferenceV1 = {
  version: 1,
  mode: "balanced",
  anchors: [
    {
      id: "a1",
      kind: "project",
      label: "Launch plan",
      aliases: ["ship"],
      weight: 2,
      enabled: true,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z"
    }
  ],
  mutedSources: ["email"],
  updatedAt: "2026-01-01T00:00:00.000Z"
};

describe("PrioritySettings", () => {
  it("renders its loading state inside a query client", () => {
    const queryClient = new QueryClient();

    const html = renderToString(
      <QueryClientProvider client={queryClient}>
        <PrioritySettings />
      </QueryClientProvider>
    );

    expect(html).toContain("Loading priority settings");
  });

  it("renders with shared settings design primitives", () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(["priority-model"], model);

    const html = renderToString(
      <QueryClientProvider client={queryClient}>
        <PrioritySettings />
      </QueryClientProvider>
    );

    expect(html).toContain("pane__head");
    expect(html).toContain("pane__card");
    expect(html).toContain("set-row");
    expect(html).toContain("jds-btn");
    expect(html).toContain("jds-input");
    expect(html).toContain("jds-switch");
    expect(html).toContain("Launch plan");
    expect(html).not.toContain("priority-settings");
    expect(html).not.toContain("anchor-row");
  });
});
