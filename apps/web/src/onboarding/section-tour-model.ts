import { webRoutePath } from "../app-route-metadata.js";
import type { ModuleDto } from "@jarv1s/shared";

export interface TourSection {
  readonly path: string;
  readonly label: string;
  readonly blurb: string;
  readonly icon: "House" | "ListChecks" | "CalendarDays" | "HeartPulse" | "Settings";
}

// One line each for the now-real product sections. A section is shown only if its
// route is enabled for this member and is a frontend route the app actually serves.
// A function of assistantName, not a module-scope constant: two blurbs name the assistant,
// and a hook can't be called at module scope — the caller passes useAssistantName() in.
function allSections(assistantName: string): readonly TourSection[] {
  return [
    {
      path: webRoutePath("today"),
      label: "Today",
      blurb: "Start here to review your morning dashboard, priorities, and overnight changes.",
      icon: "House"
    },
    {
      path: webRoutePath("tasks"),
      label: "Tasks",
      blurb: `Track your tasks ordered by priority. ${assistantName} logs items automatically, but you remain in control.`,
      icon: "ListChecks"
    },
    {
      path: webRoutePath("calendar"),
      label: "Calendar",
      blurb: `View your schedule. ${assistantName} plans tasks around your existing calendar events.`,
      icon: "CalendarDays"
    },
    {
      path: webRoutePath("wellness"),
      label: "Wellness",
      blurb: "Optional and private. Check in to adjust your daily workload based on how you feel.",
      icon: "HeartPulse"
    },
    {
      path: webRoutePath("settings"),
      label: "Settings",
      blurb: "Connect accounts, AI, and manage your profile.",
      icon: "Settings"
    }
  ];
}

export function buildTourSections(
  modules: readonly ModuleDto[],
  disabledModuleIds: readonly string[],
  assistantName: string
): readonly TourSection[] {
  const disabled = new Set(disabledModuleIds);
  const enabledPaths = new Set<string>([webRoutePath("today"), webRoutePath("settings")]);
  for (const mod of modules) {
    if (disabled.has(mod.id)) continue;
    for (const nav of mod.navigation) {
      enabledPaths.add(nav.path);
    }
  }
  return allSections(assistantName).filter((section) => enabledPaths.has(section.path));
}
