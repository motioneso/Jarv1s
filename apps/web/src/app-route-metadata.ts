import type { ModuleDto, ModuleNavigationEntryDto } from "@jarv1s/shared";

const TOP_SECTION = "__top";
const SECTION_ORDER: readonly string[] = [TOP_SECTION, "Plan", "You"];
const SECTION_OF: Record<string, string> = {
  tasks: "Plan",
  calendar: "Plan",
  wellness: "You"
};
const HIDDEN_NAV_IDS = new Set(["chat", "briefings", "settings", "notifications"]);

export interface WebRouteMeta {
  readonly id:
    | "today"
    | "tasks"
    | "notifications"
    | "calendar"
    | "wellness"
    | "settings";
  readonly path: string;
  readonly title: string;
  readonly subtitle: (now: Date) => string;
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
    subtitle: (now) => `${dateEyebrow(now)} · ${timeEyebrow(now)}`,
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
    subtitle: () => "PRIVATE",
    match: (pathname) => pathname.startsWith("/wellness")
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
  now = new Date()
): { title: string; subtitle: string } {
  const route = webRoutes.find((item) => item.match(pathname)) ?? webRoutes[0];
  if (!route) throw new Error("At least one web route must be defined");
  return { title: route.title, subtitle: route.subtitle(now) };
}

function dateEyebrow(now: Date): string {
  const weekday = now.toLocaleDateString("en-US", { weekday: "short" });
  const month = now.toLocaleDateString("en-US", { month: "short" });
  return `${weekday} · ${month} ${now.getDate()}`.toUpperCase();
}

function timeEyebrow(now: Date): string {
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit", hour12: true })
    .format(now)
    .replace(/\s?[AP]M$/i, "");
}

function monthEyebrow(now: Date): string {
  return now.toLocaleDateString("en-US", { month: "long", year: "numeric" }).toUpperCase();
}
