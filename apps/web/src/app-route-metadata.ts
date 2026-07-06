import type { LocaleSettingsDto, ModuleDto, ModuleNavigationEntryDto } from "@jarv1s/shared";

import { DEFAULT_LOCALE, formatDate } from "./locale/locale-format.js";

const TOP_SECTION = "__top";
const SECTION_ORDER: readonly string[] = [TOP_SECTION, "Plan", "You"];
const SECTION_OF: Record<string, string> = {
  tasks: "Plan",
  calendar: "Plan",
  wellness: "You",
  sports: "You"
};
const HIDDEN_NAV_IDS = new Set(["chat", "briefings", "settings", "notifications"]);

export interface WebRouteMeta {
  readonly id:
    | "today"
    | "tasks"
    | "notifications"
    | "calendar"
    | "wellness"
    | "sports"
    | "settings";
  readonly path: string;
  readonly title: string;
  readonly subtitle: (now: Date, locale: LocaleSettingsDto) => string;
  readonly match: (pathname: string) => boolean;
}

export interface NavSection {
  readonly key: string;
  readonly label: string | null;
  readonly items: readonly ModuleNavigationEntryDto[];
}

export const todayNavEntry: ModuleNavigationEntryDto = {
  id: "today",
  label: "Today",
  path: "/today",
  icon: "house",
  order: -1
};

export const webRoutes: readonly WebRouteMeta[] = [
  {
    id: "today",
    path: "/today",
    title: "Today",
    // Date + time live in the Today masthead (dateline + clock) — keep them out of the topbar.
    subtitle: () => "",
    match: (pathname) => pathname === "/" || pathname.startsWith("/today")
  },
  {
    id: "tasks",
    path: "/tasks",
    title: "Tasks",
    subtitle: dateEyebrow,
    match: (pathname) => pathname === "/tasks"
  },
  {
    id: "notifications",
    path: "/notifications",
    title: "Notifications",
    subtitle: () => "",
    match: (pathname) => pathname.startsWith("/notifications")
  },
  {
    id: "calendar",
    path: "/calendar",
    title: "Calendar",
    subtitle: monthEyebrow,
    match: (pathname) => pathname.startsWith("/calendar")
  },
  {
    id: "wellness",
    path: "/wellness",
    title: "Wellness",
    subtitle: dateEyebrow,
    match: (pathname) => pathname.startsWith("/wellness")
  },
  {
    id: "sports",
    path: "/sports",
    title: "Sports",
    subtitle: () => "FOLLOWED",
    match: (pathname) => pathname.startsWith("/sports")
  },
  {
    id: "settings",
    path: "/settings",
    title: "Settings & permissions",
    subtitle: () => "",
    match: (pathname) => pathname.startsWith("/settings")
  }
];

export function webRoutePath(id: WebRouteMeta["id"]): string {
  const route = webRoutes.find((item) => item.id === id);
  if (!route) throw new Error(`Unknown web route: ${id}`);
  return route.path;
}

export function buildShellNavigation(
  modules: readonly ModuleDto[],
  disabledModuleIds: readonly string[]
): NavSection[] {
  const disabled = new Set(disabledModuleIds);
  const entries = modules
    .filter((module) => !disabled.has(module.id))
    .flatMap((module) => module.navigation)
    .filter((entry) => !HIDDEN_NAV_IDS.has(entry.id))
    .sort((left, right) => {
      const leftOrder = left.order ?? Number.MAX_SAFE_INTEGER;
      const rightOrder = right.order ?? Number.MAX_SAFE_INTEGER;
      return leftOrder - rightOrder || left.label.localeCompare(right.label);
    });

  const bySection = new Map<string, ModuleNavigationEntryDto[]>();
  bySection.set(TOP_SECTION, [todayNavEntry]);
  for (const entry of entries) {
    const section = SECTION_OF[entry.id] ?? TOP_SECTION;
    const bucket = bySection.get(section) ?? [];
    bucket.push(entry);
    bySection.set(section, bucket);
  }

  const orderedKeys = [
    ...SECTION_ORDER.filter((key) => bySection.has(key)),
    ...[...bySection.keys()].filter((key) => !SECTION_ORDER.includes(key))
  ];

  return orderedKeys.map((key) => ({
    key,
    label: key === TOP_SECTION ? null : key,
    items: bySection.get(key) ?? []
  }));
}

export function resolvePageHeading(
  pathname: string,
  now = new Date(),
  locale: LocaleSettingsDto = DEFAULT_LOCALE
): { title: string; subtitle: string } {
  const route = webRoutes.find((item) => item.match(pathname)) ?? webRoutes[0];
  if (!route) throw new Error("At least one web route must be defined");
  return { title: route.title, subtitle: route.subtitle(now, locale) };
}

function dateEyebrow(now: Date, locale: LocaleSettingsDto): string {
  const weekday = formatDate(now, locale, { weekday: "short" });
  const month = formatDate(now, locale, { month: "short" });
  const day = formatDate(now, locale, { day: "numeric" });
  return `${weekday} · ${month} ${day}`.toUpperCase();
}

function monthEyebrow(now: Date, locale: LocaleSettingsDto): string {
  return formatDate(now, locale, { month: "long", year: "numeric" }).toUpperCase();
}
