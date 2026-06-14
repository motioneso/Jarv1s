import { webRoutePath } from "../app-route-metadata.js";
import type { ModuleDto } from "@jarv1s/shared";

export interface TourSection {
  readonly path: string;
  readonly label: string;
  readonly blurb: string;
}

// One line each for the now-real product sections. A section is shown only if its
// route is enabled for this member and is a frontend route the app actually serves.
const ALL_SECTIONS: readonly TourSection[] = [
  {
    path: webRoutePath("tasks"),
    label: "Tasks",
    blurb: "Your single action surface — todos, commitments, and plans."
  },
  {
    path: webRoutePath("calendar"),
    label: "Calendar",
    blurb: "Events synced from your connected accounts."
  },
  {
    path: webRoutePath("wellness"),
    label: "Wellness",
    blurb: "Your private well-being check-ins."
  },
  {
    path: webRoutePath("settings"),
    label: "Settings",
    blurb: "Connect accounts, AI, and manage your profile."
  }
];

export function buildTourSections(
  modules: readonly ModuleDto[],
  disabledModuleIds: readonly string[]
): readonly TourSection[] {
  const disabled = new Set(disabledModuleIds);
  const enabledPaths = new Set<string>([webRoutePath("settings")]);
  for (const mod of modules) {
    if (disabled.has(mod.id)) continue;
    for (const nav of mod.navigation) {
      enabledPaths.add(nav.path);
    }
  }
  return ALL_SECTIONS.filter((section) => enabledPaths.has(section.path));
}
