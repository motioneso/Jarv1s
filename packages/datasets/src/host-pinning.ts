/**
 * SSRF-hardening host-pinning fetch wrapper (docs/superpowers/specs/2026-07-04-module-dataset-
 * connector-sdk.md, "SSRF notes"). Named after the v0.1.0 audit's `web.read` SSRF chain
 * (cautionary precedent: unpinned outbound fetches let a redirect escape to internal/private
 * hosts, e.g. `[::]`) — every dataset-runtime fetch must re-validate the target host on EVERY
 * hop, not just the initial URL.
 *
 * Adapters never call global `fetch` directly; they receive the wrapped fetchFn produced here
 * via `ExternalSourceAdapterContext.fetchFn`.
 */

const MAX_REDIRECTS = 5;

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/**
 * Thrown when a dataset-runtime fetch (initial request or any redirect hop) targets a host
 * outside the source's declared `fetchHosts`, or downgrades off https. Distinct from ordinary
 * fetch/network failures so `client.ts` can log the SSRF-allowlist rejection distinctly instead
 * of folding it into silent degrade (#832).
 */
export class HostPinningViolationError extends Error {
  readonly host: string;

  constructor(host: string, message: string) {
    super(message);
    this.name = "HostPinningViolationError";
    this.host = host;
  }
}

/**
 * True when `host` is safe to add to a source's `fetchHosts`/`imageHosts`: lowercase, non-empty,
 * no port, and not a bare IPv4/IPv6 literal (host pinning is meaningless against a literal IP —
 * the whole point is naming a specific external service by hostname).
 */
export function isPinnableHost(host: string): boolean {
  if (host.length === 0) return false;
  if (host !== host.toLowerCase()) return false;
  if (host.includes(":")) return false; // no port, no bracketed IPv6 literal
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return false; // no bare IPv4 literal
  return true;
}

/**
 * Registration-time validation shared by the dataset runtime (host-pinning below) and the
 * module-registry composition root's `assertModuleRegistryConsistency` — one hostname-validation
 * rule, not two copies that can drift.
 */
export function assertValidFetchHosts(sourceId: string, hosts: readonly string[]): void {
  if (hosts.length === 0) {
    throw new Error(`External source "${sourceId}" declares no fetchHosts`);
  }
  for (const host of hosts) {
    if (!isPinnableHost(host)) {
      throw new Error(
        `External source "${sourceId}" declares an invalid fetchHost "${host}" ` +
          "(must be a lowercase hostname, no port, no IP literal)"
      );
    }
  }
}

function resolveUrl(input: RequestInfo | URL, base?: URL): URL {
  if (input instanceof URL) return input;
  if (typeof input === "string") return base ? new URL(input, base) : new URL(input);
  return new URL(input.url);
}

/**
 * Headers stripped the moment a redirect hop changes hostname (#833) — a value set for host A
 * (e.g. an auth token) must never reach allowlisted host B just because both are pinned.
 * Extend this list when the deferred api-key credential slice (connector-SDK spec Architecture
 * §4) lands and defines its header name. `Headers` matching is case-insensitive by spec, so
 * casing here doesn't matter.
 */
const SENSITIVE_REDIRECT_HEADER_NAMES = ["authorization"];

function stripSensitiveHeaders(init: RequestInit | undefined): RequestInit | undefined {
  if (!init?.headers) return init;
  const headers = new Headers(init.headers);
  for (const name of SENSITIVE_REDIRECT_HEADER_NAMES) {
    headers.delete(name);
  }
  return { ...init, headers };
}

/**
 * True when a redirect hop must downgrade to GET with no body: always for 303 (See Other, the
 * canonical "redo as GET" status), and for 301/302 only when the current method isn't already
 * GET/HEAD (legacy browser behavior downgrades those two; RFC 7231 leaves 301/302 method
 * preservation to client discretion but the safe, expected behavior is to downgrade like a
 * browser would). 307/308 must never downgrade — they exist specifically to guarantee
 * method+body preservation across a redirect (#836).
 */
function shouldDowngradeToGet(status: number, method: string): boolean {
  if (status === 303) return true;
  if (status === 301 || status === 302) return method !== "GET" && method !== "HEAD";
  return false;
}

/** Drops `method`/`body` from `init` and forces a bodyless GET for the next redirect hop. */
function downgradeToGet(init: RequestInit | undefined): RequestInit {
  const { body: _body, method: _method, ...rest } = init ?? {};
  return { ...rest, method: "GET" };
}

function assertHttpsAndAllowed(url: URL, allowed: ReadonlySet<string>): void {
  if (url.protocol !== "https:") {
    throw new HostPinningViolationError(
      url.hostname,
      `Dataset runtime host pinning: only https is allowed, got "${url.protocol}" for ${url.hostname}`
    );
  }
  if (!allowed.has(url.hostname.toLowerCase())) {
    throw new HostPinningViolationError(
      url.hostname,
      `Dataset runtime host pinning: host "${url.hostname}" is not in the allowed list`
    );
  }
}

/**
 * Wraps `fetchFn` so every request (and every redirect hop) is re-validated against
 * `allowedHosts` (exact hostname match, case-insensitive, https-only). Redirects are followed
 * manually (bounded to {@link MAX_REDIRECTS} hops) so a same-host response redirecting to a
 * disallowed host can never be silently followed by the underlying fetch implementation.
 */
export const DEFAULT_FETCH_TIMEOUT_MS = 15_000;

export function createHostPinnedFetch(
  allowedHosts: readonly string[],
  fetchFn: typeof fetch,
  timeoutMs: number = DEFAULT_FETCH_TIMEOUT_MS
): typeof fetch {
  const allowed = new Set(allowedHosts.map((host) => host.toLowerCase()));

  return (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    let currentUrl = resolveUrl(input);
    assertHttpsAndAllowed(currentUrl, allowed);

    const controller = new AbortController();
    const timer: ReturnType<typeof setTimeout> = setTimeout(() => controller.abort(), timeoutMs);
    try {
      let currentInit: RequestInit | undefined = { ...init, signal: controller.signal };
      let currentMethod = (init?.method ?? "GET").toUpperCase();
      let response = await fetchFn(currentUrl.toString(), { ...currentInit, redirect: "manual" });
      let hops = 0;

      while (REDIRECT_STATUSES.has(response.status) && hops < MAX_REDIRECTS) {
        const location = response.headers.get("location");
        if (!location) break;
        const previousHost = currentUrl.hostname.toLowerCase();
        currentUrl = resolveUrl(location, currentUrl);
        assertHttpsAndAllowed(currentUrl, allowed);
        if (currentUrl.hostname.toLowerCase() !== previousHost) {
          currentInit = stripSensitiveHeaders(currentInit);
        }
        if (shouldDowngradeToGet(response.status, currentMethod)) {
          currentInit = downgradeToGet(currentInit);
          currentMethod = "GET";
        }
        response = await fetchFn(currentUrl.toString(), { ...currentInit, redirect: "manual" });
        hops += 1;
      }

      if (REDIRECT_STATUSES.has(response.status)) {
        throw new Error(`Dataset runtime host pinning: exceeded ${MAX_REDIRECTS} redirects`);
      }

      return response;
    } finally {
      clearTimeout(timer);
    }
  }) as typeof fetch;
}
