// tests/unit/external-module-job-search-kv-profile.test.ts
//
// JS-02 (#931) Task 4: profile repo. Revisions are immutable once written
// (byte-identical rewrite is an idempotent no-op; changed content is a
// conflict) and approval only moves the `active` pointer — history is never
// rewritten. Pointer-without-revision reads fail closed.
import { describe, expect, it } from "vitest";

import { JobSearchKvError } from "../../external-modules/job-search/src/domain/errors.js";
import type { ProfileRevision } from "../../external-modules/job-search/src/domain/profile.js";
import {
  approveProfile,
  getActiveProfile,
  listProfileRevisionIds,
  saveProfileRevision
} from "../../external-modules/job-search/src/domain/profile.js";
import { keys } from "../../external-modules/job-search/src/domain/keys.js";
import { NS } from "../../external-modules/job-search/src/domain/kv-port.js";
import { createMemoryKv } from "./helpers/job-search-memory-kv.js";

const APPROVED_AT = new Date("2026-07-11T10:00:00.000Z");

function revision(id: string, fields: Record<string, unknown>): ProfileRevision {
  return {
    schemaVersion: 1,
    revisionId: id,
    createdAt: "2026-07-11T09:00:00.000Z",
    provenance: "user",
    fields
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

describe("profile repo", () => {
  it("round-trips a revision and lists revision ids (pointer excluded)", async () => {
    const kv = createMemoryKv();
    await saveProfileRevision(kv, revision("p1", { title: "Engineer" }));
    await saveProfileRevision(kv, revision("p2", { title: "Senior Engineer" }));
    await approveProfile(kv, "p1", APPROVED_AT);
    expect(await listProfileRevisionIds(kv)).toEqual(["p1", "p2"]);
  });

  it("treats a byte-identical re-save as an idempotent no-op", async () => {
    const kv = createMemoryKv();
    await saveProfileRevision(kv, revision("p1", { title: "Engineer" }));
    await expect(
      saveProfileRevision(kv, revision("p1", { title: "Engineer" }))
    ).resolves.toBeUndefined();
  });

  it("rejects re-saving an existing revision with different content", async () => {
    const kv = createMemoryKv();
    await saveProfileRevision(kv, revision("p1", { title: "Engineer" }));
    await expectKvError(
      saveProfileRevision(kv, revision("p1", { title: "CTO" })),
      "immutable_revision_conflict"
    );
  });

  it("is key-order insensitive when judging identical re-saves", async () => {
    const kv = createMemoryKv();
    await saveProfileRevision(kv, revision("p1", { a: 1, b: 2 }));
    // Same content, different insertion order — must be a no-op, not a conflict.
    await expect(saveProfileRevision(kv, revision("p1", { b: 2, a: 1 }))).resolves.toBeUndefined();
  });

  it("rejects approving an unknown revision with missing_revision", async () => {
    const kv = createMemoryKv();
    await expectKvError(approveProfile(kv, "ghost", APPROVED_AT), "missing_revision");
  });

  it("approve flips only the pointer; old revisions stay readable", async () => {
    const kv = createMemoryKv();
    await saveProfileRevision(kv, revision("p1", { title: "Engineer" }));
    await saveProfileRevision(kv, revision("p2", { title: "Senior Engineer" }));
    await approveProfile(kv, "p1", APPROVED_AT);
    expect((await getActiveProfile(kv))?.revisionId).toBe("p1");

    await approveProfile(kv, "p2", APPROVED_AT);
    const active = await getActiveProfile(kv);
    expect(active?.revisionId).toBe("p2");
    expect(active?.fields).toEqual({ title: "Senior Engineer" });
    // p1 is untouched history.
    expect(await listProfileRevisionIds(kv)).toEqual(["p1", "p2"]);
  });

  it("returns null before any approval", async () => {
    const kv = createMemoryKv();
    await saveProfileRevision(kv, revision("p1", { title: "Engineer" }));
    expect(await getActiveProfile(kv)).toBeNull();
  });

  it("fails closed when the pointer references a missing revision", async () => {
    const kv = createMemoryKv();
    // Plant a dangling pointer directly (simulates an interrupted delete or
    // corrupted state) — must throw, never silently return null.
    await kv.set(NS.profile, keys.profileActive, {
      schemaVersion: 1,
      revisionId: "gone",
      approvedAt: APPROVED_AT.toISOString()
    });
    await expectKvError(getActiveProfile(kv), "missing_active_pointer");
  });

  it("validates the revision id", async () => {
    const kv = createMemoryKv();
    await expectKvError(saveProfileRevision(kv, revision("bad id", {})), "invalid_record");
    await expectKvError(approveProfile(kv, "bad id", APPROVED_AT), "invalid_record");
  });
});
