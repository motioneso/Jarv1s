import { describe, expect, it } from "vitest";

import {
  CALENDAR_SCOPE,
  featureGrantsPrefKey,
  GMAIL_SCOPE,
  isFeatureGranted,
  resolveEffectiveGrants
} from "@jarv1s/connectors";

describe("featureGrantsPrefKey", () => {
  it("builds the owner-scoped preference key for an account", () => {
    expect(featureGrantsPrefKey("acct-123")).toBe("connector.acct-123.feature_grants");
  });
});

describe("isFeatureGranted", () => {
  it("defaults ON when no preference row is stored (null)", () => {
    expect(isFeatureGranted(null, "email")).toBe(true);
    expect(isFeatureGranted(null, "calendar")).toBe(true);
  });

  it("defaults ON when the stored value is undefined", () => {
    expect(isFeatureGranted(undefined, "email")).toBe(true);
  });

  it("defaults ON when the stored value is malformed (not a record)", () => {
    expect(isFeatureGranted("not-an-object", "email")).toBe(true);
    expect(isFeatureGranted(42, "calendar")).toBe(true);
    expect(isFeatureGranted([], "email")).toBe(true);
    expect(isFeatureGranted(true, "calendar")).toBe(true);
  });

  it("returns the stored boolean when the feature key is present", () => {
    expect(isFeatureGranted({ email: false, calendar: true }, "email")).toBe(false);
    expect(isFeatureGranted({ email: false, calendar: true }, "calendar")).toBe(true);
    expect(isFeatureGranted({ email: true, calendar: false }, "calendar")).toBe(false);
  });

  it("treats a present-but-non-boolean feature value as NOT granted", () => {
    expect(isFeatureGranted({ email: "true", calendar: 1 }, "email")).toBe(false);
    expect(isFeatureGranted({ email: "true", calendar: 1 }, "calendar")).toBe(false);
  });

  it("treats a missing feature key (inside a record) as NOT granted", () => {
    // A stored record that omits a feature key is an explicit absence, NOT default-on.
    // Only a missing/row-at-all defaults on; a present record with a missing key is explicit-off.
    expect(isFeatureGranted({ calendar: true }, "email")).toBe(false);
    expect(isFeatureGranted({ email: true }, "calendar")).toBe(false);
  });
});

describe("resolveEffectiveGrants", () => {
  it("returns scope-AND-grant effective state, defaulting ON when no pref row", () => {
    const bothScopes = [GMAIL_SCOPE, CALENDAR_SCOPE];
    expect(resolveEffectiveGrants(bothScopes, null)).toEqual({ email: true, calendar: true });
  });

  it("returns false for a feature the account lacks the scope for, regardless of grant", () => {
    expect(resolveEffectiveGrants([CALENDAR_SCOPE], null)).toEqual({
      email: false,
      calendar: true
    });
    expect(resolveEffectiveGrants([GMAIL_SCOPE], null)).toEqual({
      email: true,
      calendar: false
    });
  });

  it("returns false for a feature whose grant is explicitly revoked", () => {
    const bothScopes = [GMAIL_SCOPE, CALENDAR_SCOPE];
    expect(resolveEffectiveGrants(bothScopes, { email: false, calendar: true })).toEqual({
      email: false,
      calendar: true
    });
    expect(resolveEffectiveGrants(bothScopes, { email: true, calendar: false })).toEqual({
      email: true,
      calendar: false
    });
  });

  it("recognizes the short-form scope aliases (gmail / calendar)", () => {
    expect(resolveEffectiveGrants(["gmail", "calendar"], null)).toEqual({
      email: true,
      calendar: true
    });
  });

  it("defaults ON for an empty-scope account with no pref (vacuously both off)", () => {
    expect(resolveEffectiveGrants([], null)).toEqual({ email: false, calendar: false });
  });
});
