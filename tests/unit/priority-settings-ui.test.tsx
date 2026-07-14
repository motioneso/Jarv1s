import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import {
  PrioritySettings,
  priorityDraftValidation,
  prioritySourceIncluded,
  priorityWeightLabel
} from "@jarv1s/settings-ui";

describe("PrioritySettings", () => {
  it("maps stored weights and source exclusions to user language", () => {
    expect(priorityWeightLabel(-2)).toBe("Much lower");
    expect(priorityWeightLabel(0)).toBe("Neutral");
    expect(priorityWeightLabel(2)).toBe("Much higher");
    const model = {
      version: 1 as const,
      mode: "balanced" as const,
      anchors: [],
      mutedSources: ["email" as const],
      updatedAt: "now"
    };
    expect(prioritySourceIncluded(model, "tasks")).toBe(true);
    expect(prioritySourceIncluded(model, "email")).toBe(false);
    expect(
      priorityDraftValidation({
        ...model,
        anchors: [
          {
            id: "1",
            kind: "project",
            label: " ",
            aliases: [],
            weight: 1,
            enabled: true,
            createdAt: "now",
            updatedAt: "now"
          }
        ]
      })
    ).toContain("label");
  });

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

    expect(html).toContain("Sources Jarvis may prioritize");
    expect(html).toContain(
      "These choices affect ranking only; they do not change source access or data visibility."
    );
    expect(html).toContain("Tasks");
    expect(html).toContain("Notes");
    expect(html).not.toContain("Memory");
    expect(html).not.toContain("Wellness");
    expect(html).not.toContain("Anchor kind");
    expect(html).not.toContain('value="-2"');
  });
});
