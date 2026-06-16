import { describe, expect, it } from "vitest";

import { sourceBehaviorStatus } from "../../apps/web/src/settings/settings-data-source-model.js";

describe("settings data source model", () => {
  it("labels enabled live behaviors as on", () => {
    const behavior = {
      id: "calendar.briefings",
      name: "Include in briefings",
      description: "Surface today's events in the morning reading.",
      default: "default-on",
      enabled: true,
      toggleable: true
    };

    expect(sourceBehaviorStatus(behavior)).toEqual({ tone: "pine", label: "On" });
  });

  it("labels disabled live behaviors as off", () => {
    const behavior = {
      id: "email.briefings",
      name: "Thread summaries",
      description: "Condense long threads before you open them.",
      default: "default-on",
      enabled: false,
      toggleable: true
    };

    expect(sourceBehaviorStatus(behavior)).toEqual({ tone: "neutral", label: "Off" });
  });

  it("renders unbuilt behaviors as coming soon explicitly", () => {
    const behavior = {
      id: "email.send-on-behalf",
      name: "Send on my behalf",
      description: "Draft and send replies, with your approval.",
      default: "coming-soon",
      enabled: false,
      toggleable: false
    };

    expect(sourceBehaviorStatus(behavior)).toEqual({ tone: "steel", label: "Coming soon" });
  });
});
