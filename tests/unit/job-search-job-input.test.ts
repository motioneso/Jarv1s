// tests/unit/job-search-job-input.test.ts
//
// Task 15 (#1299): the queue-envelope parser. `ctx.input` for a queue job is
// `{actorUserId, jobKind, idempotencyKey, params}` — a different shape from a tool call's input
// (`{...toolInput, actorUserId}`), and this file is the one place that tells them apart with a
// real error rather than a handler silently reading `input.profileId` and finding nothing.
import { describe, expect, it } from "vitest";

import { parseJobEnvelope } from "../../external-modules/job-search/src/worker/job-input.js";

describe("parseJobEnvelope", () => {
  it("test 1: reads exactly the four fields the queue path sends and returns them unchanged", () => {
    const raw = {
      actorUserId: "user-1",
      jobKind: "job-search.crawl-run",
      idempotencyKey: "idem-1",
      params: { profileId: "profile-1" }
    };

    expect(parseJobEnvelope(raw)).toEqual(raw);
  });

  it("test 2: accepts the sweep's empty params: {} — empty is valid, absent is not", () => {
    const raw = {
      actorUserId: "user-1",
      jobKind: "job-search.crawl-sweep",
      idempotencyKey: "idem-2",
      params: {}
    };

    expect(parseJobEnvelope(raw)).toEqual(raw);
  });

  it("test 3: rejects an unknown top-level key — the host sends four literals, a fifth means the contract moved", () => {
    const raw = {
      actorUserId: "user-1",
      jobKind: "job-search.crawl-run",
      idempotencyKey: "idem-3",
      params: {},
      extra: "unexpected"
    };

    expect(() => parseJobEnvelope(raw)).toThrow(/unknown key: extra/);
  });

  it("test 4: rejects params that is an array, null, a scalar, or absent", () => {
    const base = { actorUserId: "user-1", jobKind: "job-search.crawl-run", idempotencyKey: "i" };

    // The array case is the one that matters: typeof [] === "object" passes a naive object
    // check, and every later params.profileId read would silently be undefined.
    expect(() => parseJobEnvelope({ ...base, params: [] })).toThrow();
    expect(() => parseJobEnvelope({ ...base, params: null })).toThrow();
    expect(() => parseJobEnvelope({ ...base, params: "profile-1" })).toThrow();
    expect(() => parseJobEnvelope({ ...base })).toThrow();
  });

  it("test 5: rejects a tool-shaped input rather than running against params: undefined and reporting success", () => {
    const raw = { profileId: "profile-1", actorUserId: "user-1" };

    expect(() => parseJobEnvelope(raw)).toThrow(/unknown key: profileId/);
  });

  it("test 6: rejects a missing actorUserId — everything stored is owner-scoped, there is no default", () => {
    const raw = {
      jobKind: "job-search.crawl-run",
      idempotencyKey: "idem-6",
      params: {}
    };

    expect(() => parseJobEnvelope(raw)).toThrow(/actorUserId is required/);
  });
});
