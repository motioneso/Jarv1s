// external-modules/job-search/src/worker/handlers/resume.ts
//
// Task 16 (#1300): job-search.resume.set and job-search.resume.get.
//
// `resume.get` is `risk: "read"` and DOES return résumé text to the assistant — that is
// intended, the point is letting the user talk about their own résumé. What it must never do
// is reach an adapter: this file imports only the store port and the shared validate helpers,
// nothing from src/adapters/ or worker/ports.ts, so the crawl path has no way to read a
// résumé even by accident.
import type { ModuleWorkerContext } from "@jarv1s/module-sdk/worker";

import type { JobSearchStore } from "../../domain/store-port.js";
import { InputError, stripEnvelope, validateProfileInput } from "../validate.js";
import { requireNoUnknownKeys, requireProfileId } from "./profile.js";

const RESUME_SET_FIELDS = new Set(["profileId", "content"]);

function requireResumeContent(input: Record<string, unknown>): string {
  const value = input.content;
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new InputError("content is required");
  }
  return value;
}

export function createResumeSetHandler(store: JobSearchStore) {
  return async (ctx: ModuleWorkerContext): Promise<Record<string, unknown>> => {
    const input = stripEnvelope(ctx.input);
    requireNoUnknownKeys(input, RESUME_SET_FIELDS);
    const profileId = requireProfileId(input);
    const content = requireResumeContent(input);

    const profile = await store.getProfile(profileId);
    if (!profile) {
      throw new InputError("profileId not found");
    }

    // setResume (Task 13) is the versioned write: it bumps `version` and keeps the prior row,
    // never overwrites it.
    const resume = await store.setResume(profileId, content);

    // Everything scored before this moment has an empty Fit, because Fit is judged against the
    // résumé and there wasn't one. Those rows are past the scoring stage for good unless they
    // are cleared — so saving a résumé would leave the board looking exactly as broken as it
    // did before, which is the opposite of what the user just did. Clearing them puts the
    // postings back in the queue and the next pass fills the column in.
    const rescoring = await store.clearUnfittedMatches(profileId);

    return { profileId, version: resume.version, updatedAt: resume.updatedAt, rescoring };
  };
}

export function createResumeGetHandler(store: JobSearchStore) {
  return async (ctx: ModuleWorkerContext): Promise<Record<string, unknown>> => {
    const { profileId } = validateProfileInput(ctx.input);

    const resume = await store.getLatestResume(profileId);
    if (!resume) {
      return { profileId, resume: null };
    }

    return {
      profileId,
      resume: {
        version: resume.version,
        content: resume.content,
        updatedAt: resume.updatedAt
      }
    };
  };
}
