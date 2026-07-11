interface RobotsRule {
  readonly allow: boolean;
  readonly length: number;
  readonly pattern: RegExp;
}

interface RobotsGroup {
  readonly agents: string[];
  readonly rules: RobotsRule[];
}

export interface RobotsGate {
  isAllowed(
    url: URL,
    fetchText: (robotsUrl: URL) => Promise<{ status: number; body: string } | null>
  ): Promise<boolean>;
}

function compileRule(value: string, allow: boolean): RobotsRule | null {
  if (!value) return null;
  const anchored = value.endsWith("$");
  const source = value
    .slice(0, anchored ? -1 : undefined)
    .split("*")
    .map((part) => part.replace(/[\\^$+?.()|[\]{}]/g, "\\$&"))
    .join(".*");
  return {
    allow,
    length: value.replace(/[*$]/g, "").length,
    pattern: new RegExp(`^${source}${anchored ? "$" : ""}`)
  };
}

export function parseRobots(
  body: string,
  userAgent: string
): { isPathAllowed(path: string): boolean } {
  const groups: RobotsGroup[] = [];
  let agents: string[] = [];
  let rules: RobotsRule[] = [];
  const flush = (): void => {
    if (agents.length > 0) groups.push({ agents, rules });
    agents = [];
    rules = [];
  };

  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) {
      if (rules.length > 0) flush();
      continue;
    }
    const separator = line.indexOf(":");
    if (separator < 0) continue;
    const field = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    if (field === "user-agent") {
      if (rules.length > 0) flush();
      agents.push(value.toLowerCase());
    } else if ((field === "allow" || field === "disallow") && agents.length > 0) {
      const rule = compileRule(value, field === "allow");
      if (rule) rules.push(rule);
    }
  }
  flush();

  const target = userAgent.toLowerCase();
  const specific = groups.filter((group) => group.agents.includes(target));
  const selected = specific.length > 0 ? specific : groups.filter((group) => group.agents.includes("*"));
  const selectedRules = selected.flatMap((group) => group.rules);

  return {
    isPathAllowed(path) {
      const matches = selectedRules.filter((rule) => rule.pattern.test(path));
      if (matches.length === 0) return true;
      matches.sort((left, right) => right.length - left.length || Number(right.allow) - Number(left.allow));
      return matches[0]!.allow;
    }
  };
}

export function createRobotsGate(
  opts: {
    userAgent?: string;
    cacheTtlMs?: number;
    maxEntries?: number;
    now?: () => number;
  } = {}
): RobotsGate {
  const userAgent = opts.userAgent ?? "Jarvis-WebResearch";
  const cacheTtlMs = opts.cacheTtlMs ?? 30 * 60 * 1_000;
  const maxEntries = opts.maxEntries ?? 256;
  const now = opts.now ?? Date.now;
  const cache = new Map<string, { expiresAt: number; allowed: (path: string) => boolean }>();

  return {
    async isAllowed(url, fetchText) {
      const origin = url.origin;
      let entry = cache.get(origin);
      if (!entry || entry.expiresAt <= now()) {
        const response = await fetchText(new URL("/robots.txt", origin));
        let allowed: (path: string) => boolean;
        if (response?.status === 200) {
          allowed = parseRobots(response.body, userAgent).isPathAllowed;
        } else if (response?.status === 404 || response?.status === 410) {
          allowed = () => true;
        } else {
          // Security boundary: unlike a crawler, dynamic reads fail closed when policy is unknown.
          allowed = () => false;
        }
        entry = { expiresAt: now() + cacheTtlMs, allowed };
        cache.delete(origin);
        cache.set(origin, entry);
        if (cache.size > maxEntries) cache.delete(cache.keys().next().value!);
      }
      return entry.allowed(`${url.pathname}${url.search}`);
    }
  };
}
