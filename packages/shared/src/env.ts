/**
 * Parse a positive-integer environment variable, failing closed to `fallback`.
 *
 * `Number(env)` yields `NaN` for an operator typo, an empty string, or a
 * non-numeric value. For rate-limit knobs that `NaN` is dangerous: Fastify's
 * rate-limit plugin treats a `NaN`/`0`/negative `max` as "no limit", so a single
 * typo would silently disable a brute-force or abuse limiter (#169). Returning
 * the fallback on any non-positive-integer input keeps the limit in force.
 *
 * Pure and node-free so it lives in the browser-bundled @jarv1s/shared package.
 */
export function parsePositiveIntEnv(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === "") {
    return fallback;
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}
