import { describe, expect, it } from "vitest";

import { buildTourSections } from "../../apps/web/src/onboarding/section-tour-model.js";
import type { ModuleDto } from "@jarv1s/shared";

describe("member onboarding section tour", () => {
  it("omits manifest navigation for frontend routes that are not served by the app", () => {
    const sections = buildTourSections(
      [
        moduleWithNav("tasks", "Tasks", "/tasks"),
        moduleWithNav("briefings", "Briefings", "/briefings"),
        moduleWithNav("calendar", "Calendar", "/calendar")
      ],
      []
    );

    expect(sections.map((section) => section.path)).toEqual(["/tasks", "/calendar", "/settings"]);
  });

  it("still respects per-user disabled modules for routable sections", () => {
    const sections = buildTourSections(
      [
        moduleWithNav("tasks", "Tasks", "/tasks"),
        moduleWithNav("wellness", "Wellness", "/wellness")
      ],
      ["wellness"]
    );

    expect(sections.map((section) => section.path)).toEqual(["/tasks", "/settings"]);
  });
});

function moduleWithNav(id: string, label: string, path: string): ModuleDto {
  return {
    id,
    name: label,
    version: "0.0.0",
    lifecycle: "optional",
    navigation: [{ id, label, path, icon: "house", order: 10 }],
    settings: []
  };
}
