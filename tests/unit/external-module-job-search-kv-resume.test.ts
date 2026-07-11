// tests/unit/external-module-job-search-kv-resume.test.ts
//
// JS-02 (#931) Task 5: resume repo. The pasted original is immutable history
// at revision/0 (kind "original", retained forever); derived markdown
// revisions may never claim id "0". Both entry points enforce the 48 KB
// input gate BEFORE any write, with the exact user-facing copy from the spec.
import { describe, expect, it } from "vitest";

import { JobSearchKvError } from "../../external-modules/job-search/src/domain/errors.js";
import {
  RESUME_INPUT_MAX_BYTES,
  RESUME_TOO_LARGE_MESSAGE
} from "../../external-modules/job-search/src/domain/limits.js";
import type { ResumeRevision } from "../../external-modules/job-search/src/domain/resume.js";
import {
  approveResume,
  getActiveResume,
  saveOriginalResume,
  saveResumeRevision
} from "../../external-modules/job-search/src/domain/resume.js";
import { keys } from "../../external-modules/job-search/src/domain/keys.js";
import { NS } from "../../external-modules/job-search/src/domain/kv-port.js";
import { createMemoryKv } from "./helpers/job-search-memory-kv.js";

const CREATED_AT = new Date("2026-07-11T09:00:00.000Z");
const APPROVED_AT = new Date("2026-07-11T10:00:00.000Z");

function markdownRevision(id: string, content: string): ResumeRevision {
  return {
    schemaVersion: 1,
    revisionId: id,
    kind: "markdown",
    content,
    parentRevisionId: "0",
    createdAt: CREATED_AT.toISOString()
  };
}

async function expectKvError(promise: Promise<unknown>, code: string): Promise<void> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e
  );
  expect(error).toBeInstanceOf(JobSearchKvError);
  expect((error as JobSearchKvError).code).toBe(code);
}

describe("resume repo", () => {
  it("accepts content at exactly the 49,152-byte boundary on both entry points", async () => {
    const atLimit = "a".repeat(RESUME_INPUT_MAX_BYTES);
    const kv = createMemoryKv();
    await saveOriginalResume(kv, atLimit, CREATED_AT);
    await saveResumeRevision(kv, markdownRevision("r1", atLimit));
    expect((await kv.list(NS.resume)).length).toBe(2);
  });

  it("rejects 49,153 bytes with the exact user-facing message, before any write", async () => {
    // Byte semantics, not char count: multi-byte tail pushes it one octet over.
    const overLimit = "a".repeat(RESUME_INPUT_MAX_BYTES - 1) + "é"; // 49_153 bytes of UTF-8
    expect(Buffer.byteLength(overLimit, "utf8")).toBe(RESUME_INPUT_MAX_BYTES + 1);

    const kv = createMemoryKv();
    for (const attempt of [
      saveOriginalResume(kv, overLimit, CREATED_AT),
      saveResumeRevision(kv, markdownRevision("r1", overLimit))
    ]) {
      const error = await attempt.then(
        () => null,
        (e: unknown) => e
      );
      expect(error).toBeInstanceOf(JobSearchKvError);
      expect((error as JobSearchKvError).code).toBe("resume_input_too_large");
      // Spec contract: copy is surfaced verbatim to the user by JS-03.
      expect((error as JobSearchKvError).message).toBe(RESUME_TOO_LARGE_MESSAGE);
    }
    // Gate fires before any write — the namespace stays empty.
    expect(await kv.list(NS.resume)).toEqual([]);
  });

  it("stores the original at revision/0 with kind original", async () => {
    const kv = createMemoryKv();
    await saveOriginalResume(kv, "My resume", CREATED_AT);
    const stored = await kv.get(NS.resume, keys.resumeRevision("0"));
    expect(stored).toEqual({
      schemaVersion: 1,
      revisionId: "0",
      kind: "original",
      content: "My resume",
      createdAt: CREATED_AT.toISOString()
    });
  });

  it("re-saving the identical original is a no-op; different content conflicts", async () => {
    const kv = createMemoryKv();
    await saveOriginalResume(kv, "My resume", CREATED_AT);
    await expect(saveOriginalResume(kv, "My resume", CREATED_AT)).resolves.toBeUndefined();
    await expectKvError(
      saveOriginalResume(kv, "A different resume", CREATED_AT),
      "immutable_revision_conflict"
    );
    // revision/0 is retained unchanged.
    const stored = await kv.get(NS.resume, keys.resumeRevision("0"));
    expect(stored?.content).toBe("My resume");
  });

  it("refuses a markdown revision claiming revisionId 0", async () => {
    const kv = createMemoryKv();
    await expectKvError(saveResumeRevision(kv, markdownRevision("0", "hijack")), "invalid_record");
  });

  it("treats identical revision re-saves as no-ops and changed content as conflicts", async () => {
    const kv = createMemoryKv();
    await saveResumeRevision(kv, markdownRevision("r1", "draft one"));
    await expect(
      saveResumeRevision(kv, markdownRevision("r1", "draft one"))
    ).resolves.toBeUndefined();
    await expectKvError(
      saveResumeRevision(kv, markdownRevision("r1", "draft two")),
      "immutable_revision_conflict"
    );
  });

  it("approve flips only the pointer; getActiveResume follows it", async () => {
    const kv = createMemoryKv();
    await saveOriginalResume(kv, "My resume", CREATED_AT);
    await saveResumeRevision(kv, markdownRevision("r1", "# My Resume"));
    expect(await getActiveResume(kv)).toBeNull();

    await approveResume(kv, "0", APPROVED_AT);
    expect((await getActiveResume(kv))?.kind).toBe("original");

    await approveResume(kv, "r1", APPROVED_AT);
    const active = await getActiveResume(kv);
    expect(active?.revisionId).toBe("r1");
    expect(active?.content).toBe("# My Resume");
    // Original is untouched history.
    expect(await kv.get(NS.resume, keys.resumeRevision("0"))).not.toBeNull();
  });

  it("rejects approving an unknown revision with missing_revision", async () => {
    const kv = createMemoryKv();
    await expectKvError(approveResume(kv, "ghost", APPROVED_AT), "missing_revision");
  });

  it("fails closed when the pointer references a missing revision", async () => {
    const kv = createMemoryKv();
    await kv.set(NS.resume, keys.resumeActive, {
      schemaVersion: 1,
      revisionId: "gone",
      approvedAt: APPROVED_AT.toISOString()
    });
    await expectKvError(getActiveResume(kv), "missing_active_pointer");
  });

  it("validates revision ids on save and approve", async () => {
    const kv = createMemoryKv();
    await expectKvError(saveResumeRevision(kv, markdownRevision("bad id", "x")), "invalid_record");
    await expectKvError(approveResume(kv, "bad id", APPROVED_AT), "invalid_record");
  });
});
