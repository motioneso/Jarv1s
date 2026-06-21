// Pure helper for deriving the better-auth trusted origins written into the prod env file.
// Extracted from setup-prod.ts so it is unit-testable WITHOUT triggering that script's
// eager secret generation + file write (importing setup-prod.ts runs it). See #379: a real
// deploy is reached over LAN / tailnet / domain, NOT localhost, so the trusted-origins list
// must include the deploy host or better-auth rejects signup with "Invalid origin".

export interface DeriveTrustedOriginsInput {
  /** The chosen web port (JARVIS_WEB_PORT) — the localhost origin always uses this. */
  readonly webPort: string;
  /**
   * The host public origin detected/overridden by install.sh on the HOST (which can see the LAN
   * IP; the setup container cannot). A full origin (`https://jarvis.example.com`,
   * `http://192.168.1.50:5173`) is used as-is; a bare host/IP (`192.168.1.50`, `jarvis.lan`) is
   * normalized to `http://<host>:<webPort>`. Empty/undefined ⇒ localhost-only (current behavior).
   */
  readonly publicOrigin?: string;
  /**
   * An explicit JARVIS_AUTH_TRUSTED_ORIGINS operator override. When set (non-empty), it WINS
   * verbatim — the operator has taken full control of the list (back-compat with the prior
   * behavior where this env value was used as-is).
   */
  readonly override?: string;
}

/** True for a string that already looks like a full origin (has a scheme). */
function hasScheme(value: string): boolean {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(value);
}

/**
 * Normalize a publicOrigin token to a full origin. A value WITH a scheme is trusted as-is
 * (minus any trailing slash); a bare host/IP becomes `http://<host>:<webPort>`. install.sh is
 * expected to pass a full origin, but we normalize defensively in case a bare host slips through.
 */
function normalizeOrigin(value: string, webPort: string): string {
  const trimmed = value.trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  if (hasScheme(trimmed)) return trimmed;
  return `http://${trimmed}:${webPort}`;
}

/**
 * Build the comma-joined JARVIS_AUTH_TRUSTED_ORIGINS value.
 *
 * - An explicit `override` wins verbatim (operator took control).
 * - Otherwise: `http://localhost:<webPort>` + the normalized `publicOrigin` (if any), DEDUPED
 *   in first-seen order (so a publicOrigin equal to the localhost origin collapses). The
 *   localhost origin is always present so an on-box / port-forward reach still works.
 *
 * The result is parsed back at runtime by `readTrustedOrigins` (packages/auth), which
 * comma-splits / trims / filters — so a comma-joined list is exactly the right shape.
 */
export function deriveTrustedOrigins(input: DeriveTrustedOriginsInput): string {
  const override = input.override?.trim();
  if (override) return override;

  const origins: string[] = [`http://localhost:${input.webPort}`];
  if (input.publicOrigin) {
    const normalized = normalizeOrigin(input.publicOrigin, input.webPort);
    if (normalized) origins.push(normalized);
  }
  // Dedup, first-seen order.
  return [...new Set(origins)].join(",");
}
