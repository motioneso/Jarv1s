// tests/unit/job-search-failure-cause.test.ts
//
// Task 5 (#1289): pins the deterministic copy `describeFailure` builds for every
// `FailureKind`. The copy is the deliverable — a substring assertion would pass against a
// summary that also leaked a model sentence, so the load-bearing cases assert exact
// equality (spec test cases 1-2), not `toContain`.
import { describe, expect, it } from "vitest";

import {
  describeFailure,
  type FailureKind
} from "../../external-modules/job-search/src/domain/records.js";

describe("job-search describeFailure (#1289)", () => {
  it("a rate-limit cause says what was retrieved, when it last worked, and what happens next", () => {
    const cause = describeFailure({
      kind: "rate_limited",
      sourceId: "linkedin",
      sourceLabel: "LinkedIn",
      retrieved: 112,
      expected: 190,
      lastOkAt: "2026-07-26T09:00:00.000Z",
      retryAt: "2026-07-27T10:40:00.000Z"
    });

    // Exact rather than substring: the copy is the deliverable, and a substring assertion
    // passes against a summary that also leaked a model sentence.
    expect(cause.summary).toBe(
      "LinkedIn rate-limited us after 112 of about 190 postings. Retrying at 10:40."
    );
    expect(cause.nextAction).toBe("Retrying at 10:40.");
    expect(cause.disabled).toBe(false);
  });

  it("a login-walled portal disables itself and schedules no retry", () => {
    const cause = describeFailure({
      kind: "login_required",
      sourceId: "freehire",
      sourceLabel: "freehire.me",
      retrieved: 4,
      expected: null,
      lastOkAt: "2026-07-25T18:00:00.000Z",
      // Deliberately pass a retryAt to prove the implementation overrides it, rather than
      // just happening to pass because the caller supplied null.
      retryAt: "2026-07-27T12:00:00.000Z"
    });

    expect(cause.disabled).toBe(true);
    expect(cause.retryAt).toBeNull();
    // Fails against an implementation that treats login_required as transient — the exact
    // regression the no-paywall ruling exists to prevent.
    expect(cause.summary).toContain("I will not sign in");
  });

  it("a parse failure keeps the portal enabled since our fix, not a retry, is what unblocks it (N16)", () => {
    const cause = describeFailure({
      kind: "parse_failed",
      sourceId: "linkedin",
      sourceLabel: "LinkedIn",
      retrieved: 84,
      expected: 190,
      lastOkAt: "2026-07-26T09:00:00.000Z",
      retryAt: "2026-07-27T11:00:00.000Z"
    });

    // N16 revises L14: disabling here would leave the user's search permanently narrower
    // than they asked for, with nothing to notice, until they manually re-enable it — the
    // exact silent-loss class the design fights. A parse failure self-heals on our next
    // release, so the portal stays enabled and degraded, not disabled.
    expect(cause.disabled).toBe(false);
    expect(cause.retryAt).toBe("2026-07-27T11:00:00.000Z");
    expect(cause.nextAction).toBe("This needs a fix on our side. Retrying at 11:00.");
  });

  it("a network failure keeps the portal enabled (N16: not terminal, self-heals)", () => {
    const cause = describeFailure({
      kind: "network",
      sourceId: "linkedin",
      sourceLabel: "LinkedIn",
      retrieved: 30,
      expected: 190,
      lastOkAt: "2026-07-26T09:00:00.000Z",
      retryAt: "2026-07-27T11:30:00.000Z"
    });

    expect(cause.disabled).toBe(false);
    expect(cause.retryAt).toBe("2026-07-27T11:30:00.000Z");
  });

  it("no kind produces an empty summary", () => {
    const kinds: FailureKind[] = [
      "rate_limited",
      "login_required",
      "parse_failed",
      "network",
      "deadline"
    ];

    for (const kind of kinds) {
      const cause = describeFailure({
        kind,
        sourceId: "source-under-test",
        sourceLabel: "Test Portal",
        retrieved: 7,
        expected: 20,
        lastOkAt: "2026-07-26T09:00:00.000Z",
        retryAt: "2026-07-27T08:15:00.000Z"
      });

      // Catches a switch that gained a union member and not a case — which is exactly
      // what happened when "deadline" was added (round 6, finding 12).
      expect(cause.summary.length, `kind=${kind}`).toBeGreaterThan(20);
      expect(cause.nextAction.length, `kind=${kind}`).toBeGreaterThan(0);
    }
  });

  it("deadline keeps the portal alive", () => {
    const cause = describeFailure({
      kind: "deadline",
      sourceId: "linkedin",
      sourceLabel: "LinkedIn",
      retrieved: 58,
      expected: 190,
      lastOkAt: "2026-07-26T09:00:00.000Z",
      retryAt: "2026-07-27T14:30:00.000Z"
    });

    // Fails against the obvious wrong implementation — routing "deadline" through the
    // "network" branch — which would read as a source outage to the user and would
    // eventually get a working portal disabled.
    expect(cause.disabled).toBe(false);
    expect(cause.retryAt).toBe("2026-07-27T14:30:00.000Z");
    expect(cause.summary.toLowerCase()).not.toMatch(/broken|unreachable|down/);
  });
});
