import { createHash } from "node:crypto";
import type { FastifyRequest } from "fastify";

// Better Auth session-token cookie names. The `__Secure-` prefix is added automatically
// when the cookie is issued over TLS (which the app does behind JARVIS_TRUST_PROXY), so a
// browser user's request carries the prefixed form. Both must be recognized or a TLS user
// silently degrades from a per-principal bucket to a shared per-IP one. Kept in sync with
// the global limiter's copy in apps/api (authPrincipalRateLimitKey).
const SESSION_COOKIE_NAMES = [
  "better-auth.session_token=",
  "__Secure-better-auth.session_token="
] as const;

/**
 * Per-principal rate-limit key for a module route's throttle. Prefer the presented
 * credential so each LAN user / bearer client gets its own bucket; otherwise key on the
 * real peer IP.
 *
 * The bearer token and session cookie are session secrets, so each is hashed to a
 * one-way fingerprint — never used raw as a limiter key — keeping it out of the limiter's
 * in-memory store and any error/header output (the discipline #113 established for the
 * global throttle class). Namespaced prefixes prevent a bearer hash from ever colliding
 * with a cookie hash or an IP literal.
 *
 * Unlike the global `authPrincipalRateLimitKey`, this does NOT gate on the token shape:
 * these routes key on any presented credential as the per-session identity and 401 an
 * invalid one in the handler before any AI spend, so a bogus token mints (at worst) a
 * short-lived bucket that never reaches the protected work.
 */
export function sessionRateLimitKey(request: FastifyRequest): string {
  const authorization = request.headers.authorization ?? "";
  if (authorization.startsWith("Bearer ")) {
    const token = authorization.slice("Bearer ".length).trim();
    if (token) {
      return `bearer:${hash(token)}`;
    }
  }

  const cookieParts = (request.headers.cookie ?? "").split(";").map((part) => part.trim());
  for (const name of SESSION_COOKIE_NAMES) {
    const match = cookieParts.find((part) => part.startsWith(name));
    if (match) {
      const value = match.slice(name.length).split(";")[0];
      if (value) {
        return `cookie:${hash(value)}`;
      }
    }
  }

  // When JARVIS_TRUST_PROXY is set, Fastify resolves request.ip from the verified XFF
  // chain; otherwise it is the socket remote address and client-supplied XFF is ignored.
  return `ip:${request.ip}`;
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 32);
}
