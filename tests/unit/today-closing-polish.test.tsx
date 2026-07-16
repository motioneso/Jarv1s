import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";

import { ProactiveCards } from "../../apps/web/src/today/proactive-cards.js";
import { shortDate } from "../../apps/web/src/today/today-labels.js";

describe("Today closing polish", () => {
  it("keeps proactive card content and dismiss affordance without the priority pill", () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(["proactive-monitoring", "cards"], {
      cards: [
        {
          id: "card-1",
          source: "tasks",
          stableKey: "task:card-1",
          title: "Renew passport",
          summary: "Due soon",
          signalType: "due_soon",
          priorityBand: "high",
          priorityReasons: ["due soon"],
          status: "active",
          occurredAt: null,
          targetAt: "2026-07-17T00:00:00Z",
          deferredUntil: null,
          firstSeenAt: "2026-07-16T00:00:00Z",
          lastSeenAt: "2026-07-16T00:00:00Z",
          createdAt: "2026-07-16T00:00:00Z"
        }
      ]
    });

    const html = renderToString(
      createElement(
        QueryClientProvider,
        { client: queryClient },
        createElement(ProactiveCards)
      )
    );

    expect(html).toContain("Renew passport");
    expect(html).toContain("Tasks");
    expect(html).toContain("Due soon");
    expect(html).toContain("Dismiss: Renew passport");
    expect(html).not.toContain(">high<");
  });

  it("formats a boundary instant in the persisted user timezone", () => {
    expect(
      shortDate("2026-07-17T00:30:00.000Z", {
        timezone: "America/Los_Angeles",
        region: "en-US",
        dateFormat: "24"
      })
    ).toBe("Jul 16");
  });
});
