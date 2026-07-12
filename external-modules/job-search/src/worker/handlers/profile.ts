// external-modules/job-search/src/worker/handlers/profile.ts
//
// JS-03 (#932) Task 6: profile tools. Two rules do the heavy lifting:
// (1) inferred-stays-inactive — approve refuses `provenance:"inferred"`
//     revisions with a question naming field NAMES only (spec: inferred
//     values are inactive until the user confirms; the confirm path is a
//     re-save under provenance "user", which by construction gets a new
//     revision id, then approve);
// (2) deterministic revision ids — contentHash over provenance + canonical
//     fields, so assistant retries are idempotent instead of piling up
//     duplicate revisions or tripping the JS-02 immutability conflict.
import type { ProfileRevision } from "../../domain/index.js";
import {
  JobSearchKvError,
  NS,
  approveProfile,
  assertId,
  canonicalJson,
  contentHash,
  getActiveProfile,
  keys,
  listProfileRevisionIds,
  readRecord,
  saveProfileRevision
} from "../../domain/index.js";
import type { WorkerPorts } from "../ai-port.js";
import { InputError, readEnum, readPlainObject, readString } from "../validate.js";
import { updateOnboarding } from "./flow.js";

// Allowed profile field keys (module-design §profile). Empty arrays mean
// "no preference"; anything outside this list is rejected by name so a
// mistyped assistant payload can't smuggle arbitrary records into the vault.
export const PROFILE_FIELD_KEYS = [
  "targetTitles",
  "adjacentTitles",
  "industries",
  "seniority",
  "skillsDemonstrated",
  "skillsDeveloping",
  "compensation",
  "locations",
  "remotePreference",
  "employmentTypes",
  "needsSponsorship",
  "mustHaves",
  "dealbreakers",
  "preferredCompanies",
  "excludedCompanies",
  "narrative"
] as const;

const ALLOWED_FIELD_KEYS: ReadonlySet<string> = new Set(PROFILE_FIELD_KEYS);

function readProfileFields(input: Record<string, unknown>): Record<string, unknown> {
  const fields = readPlainObject(input, "fields", { required: true });
  for (const key of Object.keys(fields)) {
    if (!ALLOWED_FIELD_KEYS.has(key)) {
      // The key is named (it identifies the mistake); the value never is.
      throw new InputError(`fields.${key} is not an allowed profile field`);
    }
  }
  return fields;
}

export function saveProfileDraftHandler(ports: WorkerPorts) {
  return async (input: Record<string, unknown>): Promise<Record<string, unknown>> => {
    const provenance = readEnum(input, "provenance", ["user", "inferred"] as const, {
      required: true
    });
    const fields = readProfileFields(input);
    const revisionId = contentHash(`profile\0${provenance}\0${canonicalJson(fields)}`);
    const existing = await readRecord(ports.kv, NS.profile, keys.profileRevision(revisionId));
    // The id already commits to provenance+fields, so an existing record IS
    // this draft — skip the write to keep retries idempotent even when the
    // clock moved (a rewrite with a fresh createdAt would trip the JS-02
    // immutable-revision conflict).
    if (existing === null) {
      const revision: ProfileRevision = {
        schemaVersion: 1,
        revisionId,
        createdAt: ports.now().toISOString(),
        provenance,
        fields
      };
      await saveProfileRevision(ports.kv, revision);
    }
    return { status: "ok", revisionId };
  };
}

export function approveProfileHandler(ports: WorkerPorts) {
  return async (input: Record<string, unknown>): Promise<Record<string, unknown>> => {
    const revisionId = readString(input, "revisionId", { required: true });
    assertId(revisionId);
    const revision = (await readRecord(
      ports.kv,
      NS.profile,
      keys.profileRevision(revisionId)
    )) as ProfileRevision | null;
    if (revision === null) {
      throw new JobSearchKvError("missing_revision", `profile revision ${revisionId} not found`);
    }
    if (revision.provenance === "inferred") {
      const fieldNames = Object.keys(revision.fields).sort();
      return {
        status: "question",
        question:
          `These profile values were inferred rather than confirmed by you: ` +
          `${fieldNames.join(", ")}. Review them, save the corrected profile with ` +
          `provenance "user", then approve that revision.`,
        fields: fieldNames
      };
    }
    await approveProfile(ports.kv, revisionId, ports.now());
    await updateOnboarding(ports.kv, {
      complete: ["profile"],
      approvedProfileRevisionId: revisionId
    });
    return { status: "ok", revisionId };
  };
}

export function getProfileHandler(ports: WorkerPorts) {
  return async (_input: Record<string, unknown>): Promise<Record<string, unknown>> => {
    const active = await getActiveProfile(ports.kv);
    const allIds = await listProfileRevisionIds(ports.kv);
    return {
      status: "ok",
      // The active revision is user-approved truth — full fields are fine.
      // Every other revision surfaces as an id only (no draft/inferred
      // content rides along in a read that only asked for current state).
      active:
        active === null
          ? null
          : {
              revisionId: active.revisionId,
              createdAt: active.createdAt,
              provenance: active.provenance,
              fields: active.fields
            },
      draftRevisionIds: allIds.filter((id) => id !== active?.revisionId)
    };
  };
}
