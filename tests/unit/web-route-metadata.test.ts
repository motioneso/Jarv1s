import { describe, expect, it } from "vitest";

import {
  buildShellNavigation,
  resolvePageHeading,
  webRoutes
} from "../../apps/web/src/app-route-metadata.js";
import type { ModuleDto } from "@jarv1s/shared";

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

  it("derives page headings from the same route table", () => {
    expect(resolvePageHeading("/today", new Date("2026-06-14T16:42:00Z")).title).toBe("Today");
    expect(resolvePageHeading("/settings", new Date("2026-06-14T16:42:00Z"))).toMatchObject({
      title: "Settings & permissions",
      subtitle: ""
    });
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
});

function moduleWithNav(
  id: string,
  label: string,
  path: string,
  icon: string,
  order: number
): ModuleDto {
  return {
    id,
    name: label,
    version: "0.0.0",
    lifecycle: "optional",
    navigation: [{ id, label, path, icon, order }],
    settings: []
  };
}
