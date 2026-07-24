import { describe, expect, it } from "vitest";

import {
  buildShellNavigation,
  resolvePageHeading,
  webRoutes
} from "../../apps/web/src/app-route-metadata.js";
import { CORE_APP_SCREENS, type ModuleDto } from "@jarv1s/shared";

describe("web route metadata", () => {
  it("keeps shell navigation policy in route metadata instead of AppShell conditionals", () => {
    const modules: ModuleDto[] = [
      moduleWithNav("tasks", "Tasks", "/tasks", "check-square", 20),
      moduleWithNav("chat", "Chat", "/chat", "message-square", 30),
      moduleWithNav("settings", "Settings", "/settings", "settings", 40),
      moduleWithNav("wellness", "Wellness", "/wellness", "heart-pulse", 50)
    ];

    const sections = buildShellNavigation(modules, []);
    expect(sections.map((section) => section.key)).toEqual(["__top", "Plan", "You"]);
    expect(sections[0]?.items.map((item) => item.id)).toEqual(["today"]);
    expect(sections.flatMap((section) => section.items.map((item) => item.id))).toEqual([
      "today",
      "tasks",
      "wellness"
    ]);
  });

  it("places external-module navigation in a Modules section after You", () => {
    const modules: ModuleDto[] = [
      moduleWithNav("tasks", "Tasks", "/tasks", "check-square", 20),
      moduleWithNav("wellness", "Wellness", "/wellness", "heart-pulse", 50),
      moduleWithNav("job-search", "Job Search", "/m/job-search", "briefcase", 0, true)
    ];

    const sections = buildShellNavigation(modules, []);
    expect(sections.map((section) => section.key)).toEqual(["__top", "Plan", "You", "Modules"]);
    const modulesSection = sections.find((section) => section.key === "Modules");
    expect(modulesSection?.label).toBe("Modules");
    expect(modulesSection?.items).toEqual([
      { id: "job-search", label: "Job Search", path: "/m/job-search", icon: "briefcase", order: 0 }
    ]);
  });

  it("never lets an external module's entry consult SECTION_OF even if its id collides with a built-in section key", () => {
    const modules: ModuleDto[] = [
      moduleWithNav("wellness", "Fake Wellness", "/m/wellness", "briefcase", 0, true)
    ];
    const sections = buildShellNavigation(modules, []);
    const you = sections.find((section) => section.key === "You");
    const modulesSection = sections.find((section) => section.key === "Modules");
    expect(you).toBeUndefined();
    expect(modulesSection?.items.map((item) => item.id)).toEqual(["wellness"]);
  });

  it("derives page headings from the same route table", () => {
    expect(resolvePageHeading("/today", new Date("2026-06-14T16:42:00Z")).title).toBe("Today");
    expect(resolvePageHeading("/settings", new Date("2026-06-14T16:42:00Z"))).toMatchObject({
      title: "Settings & permissions",
      subtitle: ""
    });
  });

  it("uses a runtime external module label for its embedded route heading", () => {
    expect(
      resolvePageHeading("/m/job-search/onboarding", new Date("2026-06-14T16:42:00Z"), undefined, [
        moduleWithNav("job-search", "Job Search", "/m/job-search", "briefcase", 0, true)
      ])
    ).toEqual({ title: "Job Search", subtitle: "" });
  });

  it("defines concrete app routes without synthetic shell-only entries", () => {
    expect(webRoutes.map((route) => route.path)).toEqual([
      "/today",
      "/tasks",
      "/notifications",
      "/calendar",
      "/wellness",
      "/news",
      "/sports",
      "/settings"
    ]);
  });

  it("keeps every core app-map screen reachable by web route metadata", () => {
    const routeIds = new Set(webRoutes.map((route) => route.id));
    expect(CORE_APP_SCREENS.map((surface) => surface.id).filter((id) => !routeIds.has(id))).toEqual(
      []
    );
  });
});

function moduleWithNav(
  id: string,
  label: string,
  path: string,
  icon: string,
  order: number,
  external = false
): ModuleDto {
  return {
    id,
    name: label,
    version: "0.0.0",
    lifecycle: "optional",
    navigation: [{ id, label, path, icon, order }],
    settings: [],
    ...(external ? { external: true } : {})
  };
}
