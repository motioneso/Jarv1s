/**
 * The platform's module-API version. The single source of truth a module's
 * `compatibility.jarv1s` range is gated against at registration (ADR 0009 §3).
 * Bump this when the module contract changes in a way a module could declare
 * incompatibility with.
 */
export const CORE_VERSION = "0.1.0";

/** A parsed major.minor.patch triple. */
interface SemVer {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
  readonly prerelease: readonly string[];
}

const VERSION_RE = /^(\d+)\.(\d+)\.(\d+)$/;
const JARVIS_VERSION_RE = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?$/;

function parseVersion(value: string): SemVer | null {
  const match = VERSION_RE.exec(value.trim());
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: []
  };
}

function parseJarvisVersion(value: string): SemVer | null {
  const match = JARVIS_VERSION_RE.exec(value.trim());
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2] ?? 0),
    patch: Number(match[3] ?? 0),
    prerelease: match[4]?.split(".") ?? []
  };
}

/** Returns negative if a<b, 0 if equal, positive if a>b. */
function compare(a: SemVer, b: SemVer): number {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  if (a.patch !== b.patch) return a.patch - b.patch;
  if (a.prerelease.length === 0 && b.prerelease.length === 0) return 0;
  if (a.prerelease.length === 0) return 1;
  if (b.prerelease.length === 0) return -1;
  const len = Math.max(a.prerelease.length, b.prerelease.length);
  for (let i = 0; i < len; i++) {
    const av = a.prerelease[i];
    const bv = b.prerelease[i];
    if (av === undefined) return -1;
    if (bv === undefined) return 1;
    const an = /^\d+$/.test(av) ? Number(av) : null;
    const bn = /^\d+$/.test(bv) ? Number(bv) : null;
    if (an !== null && bn !== null && an !== bn) return an - bn;
    if (an !== null && bn === null) return -1;
    if (an === null && bn !== null) return 1;
    if (av !== bv) return av < bv ? -1 : 1;
  }
  return 0;
}

export function compareJarvisVersions(a: string, b: string): number {
  const pa = parseJarvisVersion(a);
  const pb = parseJarvisVersion(b);
  if (!pa || !pb) return 0;
  return compare(pa, pb);
}

/**
 * Does `range` admit `version` (defaults to CORE_VERSION)? Supports exactly the
 * forms in use plus the small set a near-future module needs: a bare exact version
 * ("0.1.0"), the wildcard "*", and the comparator forms >=, >, <=, <, = against a
 * single major.minor.patch. This is deliberately NOT full node-semver — ADR 0009 §5
 * skips per-module semver ranges. Unparseable or unsupported ranges return false
 * (fail closed).
 */
export function satisfiesCoreVersion(range: string, version: string = CORE_VERSION): boolean {
  const target = parseVersion(version);
  if (!target) return false;

  const trimmed = range.trim();
  if (trimmed === "*") return true;

  const comparatorMatch = /^(>=|<=|>|<|=)\s*(.+)$/.exec(trimmed);
  if (comparatorMatch) {
    const operator = comparatorMatch[1];
    const operand = parseVersion(comparatorMatch[2]!);
    if (!operand) return false;
    const cmp = compare(target, operand);
    switch (operator) {
      case ">=":
        return cmp >= 0;
      case "<=":
        return cmp <= 0;
      case ">":
        return cmp > 0;
      case "<":
        return cmp < 0;
      case "=":
        return cmp === 0;
      default:
        return false;
    }
  }

  // Bare exact version.
  const bare = parseVersion(trimmed);
  if (bare) return compare(target, bare) === 0;

  return false;
}
