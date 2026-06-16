import { describe, expect, it } from "vitest";

import type { SourceBehaviorDto } from "@jarv1s/shared";
import { sourceBehaviorStatus } from "../../apps/web/src/settings/settings-data-source-model.js";

describe("settings data source model", () => {
  it("labels enabled live behaviors as on", () => {
    const behavior: SourceBehaviorDto = {
      id: "calendar.briefings",
      sourceId: "calendar",
      name: "Include in briefings",
      description: "Surface today's events in the morning reading.",
      kind: "include-in-briefings",
      default: "default-on",
      enabled: true,
      toggleable: true
    };

    expect(sourceBehaviorStatus(behavior)).toEqual({ tone: "pine", label: "On" });
  });

  it("labels disabled live behaviors as off", () => {
    const behavior: SourceBehaviorDto = {
      id: "email.briefings",
      sourceId: "email",
      name: "Thread summaries",
      description: "Condense long threads before you open them.",
      kind: "include-in-briefings",
      default: "default-on",
      enabled: false,
      toggleable: true
    };

    expect(sourceBehaviorStatus(behavior)).toEqual({ tone: "neutral", label: "Off" });
  });

  it("renders unbuilt behaviors as coming soon explicitly", () => {
    const behavior: SourceBehaviorDto = {
      id: "email.send-on-behalf",
      sourceId: "email",
      name: "Send on my behalf",
      description: "Draft and send replies, with your approval.",
      kind: "send-on-behalf",
      default: "coming-soon",
      enabled: false,
      toggleable: false
    };

    expect(sourceBehaviorStatus(behavior)).toEqual({ tone: "steel", label: "Coming soon" });
  });
});
