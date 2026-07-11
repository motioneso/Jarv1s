// tests/unit/external-module-job-search-handlers-profile.test.ts
//
// JS-03 (#932) Task 6: profile handlers (get / save-draft / approve).
// Pins the inferred-stays-inactive rule (spec: inferred values are inactive
// until the user confirms them — approve refuses with a question naming
// field NAMES only, never values), deterministic revision ids for idempotent
// retries, and the get projection (non-active revisions appear as ids only).
import { describe, expect, it } from "vitest";

import {
  canonicalJson,
  contentHash,
  getActiveProfile,
  getOnboardingState
} from "../../external-modules/job-search/src/domain/index.js";
import type { WorkerPorts } from "../../external-modules/job-search/src/worker/ai-port.js";
import {
  approveProfileHandler,
  getProfileHandler,
  saveProfileDraftHandler
} from "../../external-modules/job-search/src/worker/handlers/profile.js";
import { wrap } from "../../external-modules/job-search/src/worker/wrap.js";
import { createMemoryKv } from "./helpers/job-search-memory-kv.js";
import type { MemoryKv } from "./helpers/job-search-memory-kv.js";

const portsFor = (kv: MemoryKv): WorkerPorts => ({
  kv,
  ai: null,
  now: () => new Date("2026-07-11T12:00:00.000Z")
});

const FIELDS = {
  targetTitles: ["Staff Engineer"],
  narrative: "PROFILE-NARRATIVE-MARKER systems generalist"
};

describe("profile.save-draft handler", () => {
  it("rejects an unknown field key, naming the key but never the value", async () => {
    const kv = createMemoryKv();
    const result = await wrap(saveProfileDraftHandler(portsFor(kv)))({
      provenance: "user",
      fields: { targetTitles: ["Staff Engineer"], favoriteColor: "SECRET-VALUE-MARKER" }
    });
    expect(result.status).toBe("error");
    expect(result.code).toBe("invalid_input");
    expect(result.message).toContain("favoriteColor");
    expect(JSON.stringify(result)).not.toContain("SECRET-VALUE-MARKER");
  });

  it("derives a deterministic revision id and retries idempotently", async () => {
    const kv = createMemoryKv();
    const handler = saveProfileDraftHandler(portsFor(kv));
    const first = await handler({ provenance: "user", fields: FIELDS });
    const expectedId = contentHash(`profile\0user\0${canonicalJson(FIELDS)}`);
    expect(first).toEqual({ status: "ok", revisionId: expectedId });
    // Retry with the same fields+provenance is a no-op returning the same id,
    // even if the clock moved (createdAt of the stored revision never churns).
    const later: WorkerPorts = { kv, ai: null, now: () => new Date("2026-07-12T09:00:00.000Z") };
    const second = await saveProfileDraftHandler(later)({ provenance: "user", fields: FIELDS });
    expect(second).toEqual({ status: "ok", revisionId: expectedId });
  });

  it("same fields under different provenance get a different revision id", async () => {
    const kv = createMemoryKv();
    const handler = saveProfileDraftHandler(portsFor(kv));
    const inferred = await handler({ provenance: "inferred", fields: FIELDS });
    const user = await handler({ provenance: "user", fields: FIELDS });
    expect(inferred.revisionId).not.toBe(user.revisionId);
  });
});

describe("profile.approve handler", () => {
  it("refuses an inferred revision with a question naming field names only", async () => {
    const kv = createMemoryKv();
    const ports = portsFor(kv);
    const saved = await saveProfileDraftHandler(ports)({ provenance: "inferred", fields: FIELDS });
    const result = await approveProfileHandler(ports)({ revisionId: saved.revisionId });

    expect(result.status).toBe("question");
    expect(result.fields).toEqual(["narrative", "targetTitles"]);
    expect(typeof result.question).toBe("string");
    // Field VALUES never appear in the refusal.
    expect(JSON.stringify(result)).not.toContain("PROFILE-NARRATIVE-MARKER");
    // Nothing activated, nothing marked complete.
    expect(await getActiveProfile(kv)).toBeNull();
    const state = await getOnboardingState(kv);
    expect(state?.completed.profile).not.toBe(true);
    expect(state?.approvedProfileRevisionId).toBeUndefined();
  });

  it("approves a user-provenance revision: active pointer + onboarding flag", async () => {
    const kv = createMemoryKv();
    const ports = portsFor(kv);
    // Confirm path per spec: re-save the same fields as provenance "user".
    await saveProfileDraftHandler(ports)({ provenance: "inferred", fields: FIELDS });
    const saved = await saveProfileDraftHandler(ports)({ provenance: "user", fields: FIELDS });
    const result = await approveProfileHandler(ports)({ revisionId: saved.revisionId });

    expect(result).toEqual({ status: "ok", revisionId: saved.revisionId });
    expect((await getActiveProfile(kv))?.revisionId).toBe(saved.revisionId);
    const state = await getOnboardingState(kv);
    expect(state?.completed.profile).toBe(true);
    expect(state?.approvedProfileRevisionId).toBe(saved.revisionId);
  });

  it("errors on a missing revision id without activating anything", async () => {
    const kv = createMemoryKv();
    const result = await wrap(approveProfileHandler(portsFor(kv)))({
      revisionId: "does-not-exist"
    });
    expect(result.status).toBe("error");
    expect(result.code).toBe("missing_revision");
    expect(await getActiveProfile(kv)).toBeNull();
  });
});

describe("profile.get handler", () => {
  it("fresh user: no active revision and no drafts", async () => {
    const kv = createMemoryKv();
    const result = await getProfileHandler(portsFor(kv))({});
    expect(result).toEqual({ status: "ok", active: null, draftRevisionIds: [] });
  });

  it("returns the active revision in full and non-active revisions as ids only", async () => {
    const kv = createMemoryKv();
    const ports = portsFor(kv);
    const draft = await saveProfileDraftHandler(ports)({
      provenance: "inferred",
      fields: { narrative: "DRAFT-ONLY-MARKER inferred guess" }
    });
    const active = await saveProfileDraftHandler(ports)({ provenance: "user", fields: FIELDS });
    await approveProfileHandler(ports)({ revisionId: active.revisionId });

    const result = await getProfileHandler(ports)({});
    expect(result.status).toBe("ok");
    expect(result.active).toEqual({
      revisionId: active.revisionId,
      createdAt: "2026-07-11T12:00:00.000Z",
      provenance: "user",
      fields: FIELDS
    });
    expect(result.draftRevisionIds).toEqual([draft.revisionId]);
    // Leak sweep: the draft's field values must not ride along as full records.
    expect(JSON.stringify(result)).not.toContain("DRAFT-ONLY-MARKER");
  });
});
