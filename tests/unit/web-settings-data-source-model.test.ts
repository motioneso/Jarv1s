import { describe, expect, it } from "vitest";

import {
  sourceBehaviorStatus,
  type DataSourceBehavior
} from "../../apps/web/src/settings/settings-data-source-model.js";

describe("settings data source model", () => {
  it("keeps default-on placeholder state distinct from coming-soon work", () => {
    const behavior: DataSourceBehavior = {
      id: "briefings",
      name: "Include in briefings",
      description: "Surface today's events in the morning reading.",
      status: "default-on"
    };

    expect(sourceBehaviorStatus(behavior)).toEqual({ tone: "pine", label: "Default on" });
  });

  it("keeps default-off placeholder state distinct from coming-soon work", () => {
    const behavior: DataSourceBehavior = {
      id: "summaries",
      name: "Thread summaries",
      description: "Condense long threads before you open them.",
      status: "default-off"
    };

    expect(sourceBehaviorStatus(behavior)).toEqual({ tone: "neutral", label: "Default off" });
  });

  it("renders unbuilt behaviors as coming soon explicitly", () => {
    const behavior: DataSourceBehavior = {
      id: "send",
      name: "Send on my behalf",
      description: "Draft and send replies, with your approval.",
      status: "coming-soon"
    };

    expect(sourceBehaviorStatus(behavior)).toEqual({ tone: "steel", label: "Coming soon" });
  });
});
