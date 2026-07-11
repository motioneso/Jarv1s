// tests/unit/external-module-job-search-truth-guard.test.ts
//
// JS-03 (#932) Tasks 2-3: the resume truth guard and its confirmation
// records. Confirmations are the ONLY way an unquoted material claim may
// survive the guard, so their identity derivation and owner-namespace
// round-trip are security surface, not plumbing: a forged or colliding
// confirmation id would let unverified AI output become ground truth.
import { describe, expect, it } from "vitest";

import {
  CONFIRMATION_TEXT_MAX_CHARS,
  confirmationIdFor,
  listConfirmationIds,
  saveConfirmation,
  type ConfirmationRecord
} from "../../external-modules/job-search/src/domain/confirmations.js";
import { JobSearchKvError } from "../../external-modules/job-search/src/domain/errors.js";
import { keys } from "../../external-modules/job-search/src/domain/keys.js";
import { NS } from "../../external-modules/job-search/src/domain/kv-port.js";
import { createMemoryKv } from "./helpers/job-search-memory-kv.js";

const HEX_32 = /^[0-9a-f]{32}$/;

function record(overrides: Partial<ConfirmationRecord> = {}): ConfirmationRecord {
  const claimKind = overrides.claimKind ?? "employer";
  const claimText = overrides.claimText ?? "Worked at Acme Corp 2019-2023";
  return {
    schemaVersion: 1,
    confirmationId: confirmationIdFor(claimKind, claimText),
    claimKind,
    claimText,
    confirmedAt: "2026-07-11T00:00:00.000Z",
    ...overrides
  };
}

describe("confirmationIdFor", () => {
  it("is deterministic 32-hex for the same kind + text", () => {
    const a = confirmationIdFor("employer", "Acme");
    const b = confirmationIdFor("employer", "Acme");
    expect(a).toMatch(HEX_32);
    expect(a).toBe(b);
  });

  it("differs across claim kinds for the same text", () => {
    expect(confirmationIdFor("employer", "Acme")).not.toBe(confirmationIdFor("role", "Acme"));
  });

  it("differs across texts for the same kind", () => {
    expect(confirmationIdFor("skill", "TypeScript")).not.toBe(confirmationIdFor("skill", "Rust"));
  });
});

describe("saveConfirmation / listConfirmationIds", () => {
  it("round-trips under confirmation/<id> in the resume namespace", async () => {
    const kv = createMemoryKv();
    const rec = record();
    await saveConfirmation(kv, rec);
    const stored = kv.dump().get(`${NS.resume} ${keys.resumeConfirmation(rec.confirmationId)}`);
    expect(stored).toEqual(rec);
  });

  it("re-saving the same confirmation is idempotent", async () => {
    const kv = createMemoryKv();
    const rec = record();
    await saveConfirmation(kv, rec);
    await saveConfirmation(kv, rec);
    expect(kv.dump().size).toBe(1);
    const ids = await listConfirmationIds(kv);
    expect([...ids]).toEqual([rec.confirmationId]);
  });

  it("rejects claimText over the cap naming the cap, never the text", async () => {
    const kv = createMemoryKv();
    const longText = "x".repeat(CONFIRMATION_TEXT_MAX_CHARS + 1);
    const rec = record({
      claimText: longText,
      confirmationId: confirmationIdFor("employer", longText)
    });
    let error: unknown = null;
    try {
      await saveConfirmation(kv, rec);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(JobSearchKvError);
    expect((error as JobSearchKvError).code).toBe("invalid_record");
    expect((error as JobSearchKvError).message).toContain("500");
    expect((error as JobSearchKvError).message).not.toContain("x".repeat(20));
    expect(kv.dump().size).toBe(0);
  });

  it("rejects a confirmationId that does not match the (kind, text) derivation", async () => {
    // A caller-supplied id must not be able to alias a different claim —
    // the id IS the claim identity the truth guard checks against.
    const kv = createMemoryKv();
    const rec = record({ confirmationId: confirmationIdFor("employer", "Different Claim") });
    let error: unknown = null;
    try {
      await saveConfirmation(kv, rec);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(JobSearchKvError);
    expect((error as JobSearchKvError).code).toBe("invalid_record");
    expect(kv.dump().size).toBe(0);
  });

  it("lists confirmation ids only, ignoring revision/* keys in the namespace", async () => {
    const kv = createMemoryKv();
    const a = record();
    const b = record({
      claimKind: "metric",
      claimText: "Cut latency 40%",
      confirmationId: confirmationIdFor("metric", "Cut latency 40%")
    });
    await saveConfirmation(kv, a);
    await saveConfirmation(kv, b);
    await kv.set(NS.resume, "revision/0", { schemaVersion: 1, kind: "original" });
    const ids = await listConfirmationIds(kv);
    expect(ids.size).toBe(2);
    expect(ids.has(a.confirmationId)).toBe(true);
    expect(ids.has(b.confirmationId)).toBe(true);
  });

  it("returns an empty set on a fresh namespace", async () => {
    const kv = createMemoryKv();
    const ids = await listConfirmationIds(kv);
    expect(ids.size).toBe(0);
  });
});
