// tests/unit/external-module-job-search-kv-records.test.ts
//
// JS-02 (#931) Task 1: record envelope + caps + typed errors. Every domain
// read/write goes through writeRecord/readRecord; these tests pin the
// fail-closed contract: strict 65_535-byte value cap (one below the DB's
// 65_536 check so the domain always rejects first), schemaVersion: 1
// enforcement on both directions, and null-on-absent semantics.
import { describe, expect, it } from "vitest";

import { JobSearchKvError } from "../../external-modules/job-search/src/domain/errors.js";
import { KV_VALUE_MAX_BYTES } from "../../external-modules/job-search/src/domain/limits.js";
import { NS } from "../../external-modules/job-search/src/domain/kv-port.js";
import { readRecord, writeRecord } from "../../external-modules/job-search/src/domain/records.js";
import { createMemoryKv } from "./helpers/job-search-memory-kv.js";

// Build a record whose JSON serialization is EXACTLY `targetBytes` long by
// padding an ASCII string field (1 byte per char, so sizing is linear).
function recordOfExactSize(targetBytes: number): Record<string, unknown> {
  const base = { schemaVersion: 1, pad: "" };
  const overhead = Buffer.byteLength(JSON.stringify(base), "utf8");
  const record = { schemaVersion: 1, pad: "x".repeat(targetBytes - overhead) };
  expect(Buffer.byteLength(JSON.stringify(record), "utf8")).toBe(targetBytes);
  return record;
}

async function expectKvError(promise: Promise<unknown>, code: string): Promise<JobSearchKvError> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e
  );
  expect(error).toBeInstanceOf(JobSearchKvError);
  expect((error as JobSearchKvError).code).toBe(code);
  return error as JobSearchKvError;
}

describe("job-search KV record envelope", () => {
  it("writes a value at exactly the 65_535-byte domain cap", async () => {
    const kv = createMemoryKv();
    const record = recordOfExactSize(KV_VALUE_MAX_BYTES);
    await writeRecord(kv, NS.profile, "cap-test", record);
    expect(await readRecord(kv, NS.profile, "cap-test")).toEqual(record);
  });

  it("rejects a 65_536-byte value with oversize_value BEFORE the fake's DB check would pass it", async () => {
    const kv = createMemoryKv();
    // 65_536 satisfies the DB check (<= 65536) — the memory fake would accept
    // it. Only the strictly-tighter domain cap can reject it, proving the
    // domain fires first.
    const record = recordOfExactSize(KV_VALUE_MAX_BYTES + 1);
    await expectKvError(writeRecord(kv, NS.profile, "cap-test", record), "oversize_value");
    expect(await readRecord(kv, NS.profile, "cap-test")).toBeNull();
  });

  it("scrubs record content from the oversize error message", async () => {
    const kv = createMemoryKv();
    const secret = "SECRET-RESUME-CONTENT";
    const record = {
      schemaVersion: 1,
      pad: secret + "x".repeat(KV_VALUE_MAX_BYTES)
    };
    const error = await expectKvError(
      writeRecord(kv, NS.resume, "scrub-test", record),
      "oversize_value"
    );
    expect(error.message).not.toContain(secret);
  });

  it("rejects writing a record without schemaVersion: 1 as invalid_record", async () => {
    const kv = createMemoryKv();
    await expectKvError(
      writeRecord(kv, NS.onboarding, "state", { schemaVersion: 2, step: "x" }),
      "invalid_record"
    );
    await expectKvError(writeRecord(kv, NS.onboarding, "state", { step: "x" }), "invalid_record");
  });

  it("rejects writing a non-plain-object record as invalid_record", async () => {
    const kv = createMemoryKv();
    await expectKvError(
      writeRecord(kv, NS.onboarding, "state", [1, 2, 3] as unknown as Record<string, unknown>),
      "invalid_record"
    );
    await expectKvError(
      writeRecord(kv, NS.onboarding, "state", null as unknown as Record<string, unknown>),
      "invalid_record"
    );
  });

  it("fails closed on stored schemaVersion drift: reads schemaVersion 2 as invalid_schema_version", async () => {
    const kv = createMemoryKv();
    // Plant a future-versioned record directly, bypassing the domain writer —
    // simulates data written by a newer module version after a rollback.
    await kv.set(NS.profile, "active", { schemaVersion: 2, revisionId: "r1" });
    await expectKvError(readRecord(kv, NS.profile, "active"), "invalid_schema_version");
  });

  it("fails closed on stored non-object garbage: reads an array as invalid_record", async () => {
    const kv = createMemoryKv();
    await kv.set(NS.feed, "active", [1, 2] as unknown as Record<string, unknown>);
    await expectKvError(readRecord(kv, NS.feed, "active"), "invalid_record");
  });

  it("returns null for an absent key", async () => {
    const kv = createMemoryKv();
    expect(await readRecord(kv, NS.runs, "run/m1/never-written")).toBeNull();
  });

  it("memory fake failAfterSets injects one failure then heals on retry", async () => {
    const kv = createMemoryKv();
    const record = { schemaVersion: 1, value: "v" };
    kv.failAfterSets(1);
    await expect(writeRecord(kv, NS.monitors, "monitor/m1", record)).rejects.toThrow(
      /injected write failure/
    );
    expect(await readRecord(kv, NS.monitors, "monitor/m1")).toBeNull();
    // Retry heals — the injection disarms after firing.
    await writeRecord(kv, NS.monitors, "monitor/m1", record);
    expect(await readRecord(kv, NS.monitors, "monitor/m1")).toEqual(record);
  });

  it("memory fake failAfterSets(2) lets the first set through", async () => {
    const kv = createMemoryKv();
    kv.failAfterSets(2);
    await writeRecord(kv, NS.runs, "run/m1/r1", { schemaVersion: 1, n: 1 });
    await expect(writeRecord(kv, NS.runs, "run/m1/r2", { schemaVersion: 1, n: 2 })).rejects.toThrow(
      /injected write failure/
    );
    expect(await readRecord(kv, NS.runs, "run/m1/r1")).toEqual({ schemaVersion: 1, n: 1 });
  });
});
