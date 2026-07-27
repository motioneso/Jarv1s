// tests/unit/job-search-validate.test.ts
//
// Task 13 (#1297): pins the input-validation contract every tool handler relies on. The load-
// bearing case is #1 — a strict validator that does not know about the host's anti-spoof
// envelope kills every real call with "unknown key: actorUserId" the first time it runs against
// the actual RPC host rather than a test double.
import { describe, expect, it } from "vitest";

import { validateProfileInput } from "../../external-modules/job-search/src/worker/validate.js";

describe("job-search worker/validate.ts (#1297)", () => {
  it("strips the host-injected actorUserId instead of rejecting the call", () => {
    // The host spreads actorUserId onto every external tool input (FIN-04) — this is not
    // optional input a caller chose to send, so it must never be treated as unknown.
    expect(validateProfileInput({ profileId: "p1", actorUserId: "u1" })).toEqual({
      profileId: "p1"
    });
  });

  it("still rejects a genuinely unknown key", () => {
    // A validator that "fixed" case 1 by dropping unknown-key checking altogether passes this
    // for the wrong reason — it would let anything through.
    expect(() => validateProfileInput({ profileId: "p1", sneaky: true })).toThrow(
      "unknown key: sneaky"
    );
  });

  it("rejects a missing profileId", () => {
    expect(() => validateProfileInput({})).toThrow("profileId is required");
  });
});
