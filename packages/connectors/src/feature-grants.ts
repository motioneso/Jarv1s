import { CALENDAR_SCOPE, GMAIL_SCOPE } from "./sync-jobs.js";

/**
 * Per-account feature access (#482). A feature is usable only when BOTH:
 *   (a) the account's OAuth scope includes it (technical capability), AND
 *   (b) the user has enabled it for that account (user choice — the grant).
 *
 * Grants live in `app.preferences` under key `connector.<accountId>.feature_grants`
 * = `{ email: boolean, calendar: boolean }` (owner-scoped RLS via app.preferences).
 *
 * Default-on parity: a missing pref ROW (null/undefined) means "enabled for every scope
 * the account has" — this preserves today's behavior for fresh connects and for accounts
 * connected before this ships (spec §3). A present record with a feature key present but
 * not-true is an explicit revoke.
 */
export type ConnectorFeature = "email" | "calendar";

export interface FeatureGrants {
  readonly email: boolean;
  readonly calendar: boolean;
}

export function featureGrantsPrefKey(accountId: string): string {
  return `connector.${accountId}.feature_grants`;
}

/**
 * Read a single feature's grant from the stored preference value.
 *
 * `stored` is the raw value from `PreferencesRepository.get`:
 *   - `null`/`undefined`/non-record → default-ON (no pref row = legacy/fresh-connect parity).
 *   - record with `feature: true` → granted.
 *   - record with `feature: false`/non-boolean/missing-key → NOT granted (explicit absence).
 */
export function isFeatureGranted(stored: unknown, feature: ConnectorFeature): boolean {
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) {
    return true; // no/malformed pref row = default-on
  }
  return (stored as Record<string, unknown>)[feature] === true;
}

const GMAIL_READONLY_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
const GMAIL_FULL_SCOPE = "https://mail.google.com/";
const CALENDAR_READONLY_SCOPE = "https://www.googleapis.com/auth/calendar.readonly";

const IMAP_EMAIL_READ_SCOPE = "email.read";

function accountHasEmailScope(scopes: readonly string[]): boolean {
  return (
    scopes.includes(GMAIL_SCOPE) ||
    scopes.includes(GMAIL_READONLY_SCOPE) ||
    scopes.includes(GMAIL_FULL_SCOPE) ||
    scopes.includes("gmail") ||
    scopes.includes("gmail.readonly") ||
    scopes.includes(IMAP_EMAIL_READ_SCOPE)
  );
}

function accountHasCalendarScope(scopes: readonly string[]): boolean {
  return (
    scopes.includes(CALENDAR_SCOPE) ||
    scopes.includes(CALENDAR_READONLY_SCOPE) ||
    scopes.includes("calendar") ||
    scopes.includes("calendar.readonly")
  );
}

/**
 * Resolve the EFFECTIVE per-account grants: a feature is on only when the account has the
 * scope AND the grant is on. Used by the GET route to surface default-on state for scopes
 * the account has when no pref row exists yet.
 */
export function resolveEffectiveGrants(scopes: readonly string[], stored: unknown): FeatureGrants {
  return {
    email: accountHasEmailScope(scopes) && isFeatureGranted(stored, "email"),
    calendar: accountHasCalendarScope(scopes) && isFeatureGranted(stored, "calendar")
  };
}
