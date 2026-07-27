// external-modules/job-search/src/worker/handlers/profile.ts
//
// Task 16 (#1300): the conversation/profile tools — job-search.profile.create,
// job-search.profile.list, job-search.criteria.set, job-search.profile.set-context, and
// job-search.profile.set-briefing-detail.
//
// Every handler here is the same four steps: validate the input, call the store, shape a
// record, return it. No handler builds a sentence and no handler decides policy —
// `completedSteps`/`isReadyToCrawl` (Task 10) are called, never reimplemented.
//
// `validateProfileInput` (Task 13) only accepts an input whose ONLY field is `profileId` — it
// throws `unknown key` on anything else, so it is used verbatim only by the profileId-only
// tools in resume.ts/portal.ts. A tool that needs more than `profileId` (criteria.set,
// set-context, set-briefing-detail here; resume.set/portal.set-enabled in their own files)
// calls `stripEnvelope` directly and validates its own extra fields with the helpers below,
// in the same throw-naming-the-key style. `profile.create` (no profileId yet) and
// `profile.list` (no fields at all) do the same.
import type { ModuleWorkerContext } from "@jarv1s/module-sdk/worker";

import {
  completedSteps,
  isReadyToCrawl,
  parseContextSummary,
  parseCriteria
} from "../../domain/criteria.js";
import type { BriefingDetail, JobSearchStore } from "../../domain/store-port.js";
import { InputError, stripEnvelope } from "../validate.js";

/** Shared by every handler in this module (profile.ts, resume.ts, portal.ts): rejects any key
 * not in the tool's own allow-list, naming the offending key — never the value — matching
 * `validate.ts`'s house style. */
export function requireNoUnknownKeys(
  input: Record<string, unknown>,
  allowed: ReadonlySet<string>
): void {
  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) {
      throw new InputError(`unknown key: ${key}`);
    }
  }
}

/** `validateProfileInput` cannot be reused here because it rejects any field beyond
 * `profileId` — every tool below needs at least one more. This is the same profileId check,
 * available to a handler that also has other fields to validate. */
export function requireProfileId(input: Record<string, unknown>): string {
  const value = input.profileId;
  if (typeof value !== "string" || value.length === 0) {
    throw new InputError("profileId is required");
  }
  return value;
}

export function requireString(input: Record<string, unknown>, field: string): string {
  const value = input[field];
  if (typeof value !== "string" || value.length === 0) {
    throw new InputError(`${field} is required`);
  }
  return value;
}

const PROFILE_CREATE_FIELDS = new Set(["name"]);
const NO_FIELDS = new Set<string>();
const CRITERIA_SET_FIELDS = new Set(["profileId", "criteria"]);
const SET_CONTEXT_FIELDS = new Set(["profileId", "summary"]);
const SET_BRIEFING_DETAIL_FIELDS = new Set(["profileId", "detail"]);
const BRIEFING_DETAIL_VALUES = new Set<BriefingDetail>(["count", "top", "full"]);

function requireBriefingDetail(input: Record<string, unknown>): BriefingDetail {
  const value = input.detail;
  if (typeof value !== "string" || !BRIEFING_DETAIL_VALUES.has(value as BriefingDetail)) {
    throw new InputError("detail must be one of count, top, full");
  }
  return value as BriefingDetail;
}

/** How many of a profile's portals are enabled — the one `completedSteps`/`isReadyToCrawl`
 * input that lives outside the criteria object (Task 10's `criteria.ts`). */
async function countEnabledPortals(store: JobSearchStore, profileId: string): Promise<number> {
  const portals = await store.listPortals(profileId);
  return portals.filter((portal) => portal.enabled).length;
}

export function createProfileCreateHandler(store: JobSearchStore) {
  return async (ctx: ModuleWorkerContext): Promise<Record<string, unknown>> => {
    const input = stripEnvelope(ctx.input);
    requireNoUnknownKeys(input, PROFILE_CREATE_FIELDS);
    const name = requireString(input, "name");

    const profile = await store.createProfile(name);

    return {
      profileId: profile.id,
      name: profile.name,
      state: profile.state
    };
  };
}

export function createProfileListHandler(store: JobSearchStore) {
  return async (ctx: ModuleWorkerContext): Promise<Record<string, unknown>> => {
    const input = stripEnvelope(ctx.input);
    requireNoUnknownKeys(input, NO_FIELDS);

    const profiles = await store.listProfiles();
    const shaped = await Promise.all(
      profiles.map(async (profile) => {
        const enabledPortals = await countEnabledPortals(store, profile.id);
        return {
          profileId: profile.id,
          name: profile.name,
          state: profile.state,
          briefingDetail: profile.briefingDetail,
          completedSteps: completedSteps(profile.criteria, enabledPortals),
          readyToCrawl: isReadyToCrawl(profile.criteria, enabledPortals)
        };
      })
    );

    return { profiles: shaped };
  };
}

export function createCriteriaSetHandler(store: JobSearchStore) {
  return async (ctx: ModuleWorkerContext): Promise<Record<string, unknown>> => {
    const input = stripEnvelope(ctx.input);
    requireNoUnknownKeys(input, CRITERIA_SET_FIELDS);
    const profileId = requireProfileId(input);
    const criteria = parseCriteria(input.criteria);

    const profile = await store.getProfile(profileId);
    if (!profile) {
      throw new InputError("profileId not found");
    }

    await store.updateCriteria(profileId, criteria);

    const enabledPortals = await countEnabledPortals(store, profileId);
    const steps = completedSteps(criteria, enabledPortals);
    const readyToCrawl = isReadyToCrawl(criteria, enabledPortals);

    // A handler calls the store; it does not enqueue (test 1). The first crawl starts when the
    // browser calls the crawl-run queue's run endpoint after this tool returns. Only an
    // in_conversation profile is auto-activated — a paused profile is a deliberate user pause,
    // not something a criteria edit should silently undo.
    const activates = readyToCrawl && profile.state === "in_conversation";
    if (activates) {
      await store.setProfileState(profileId, "active");
    }

    return {
      profileId,
      state: activates ? "active" : profile.state,
      completedSteps: steps,
      readyToCrawl
    };
  };
}

export function createSetContextHandler(store: JobSearchStore) {
  return async (ctx: ModuleWorkerContext): Promise<Record<string, unknown>> => {
    const input = stripEnvelope(ctx.input);
    requireNoUnknownKeys(input, SET_CONTEXT_FIELDS);
    const profileId = requireProfileId(input);
    // Bounds, refresh-not-append, and provenance are `parseContextSummary`'s job (Task 10). This
    // is the confirmed tool call that gives it provenance — the only writer of context_summary.
    const summary = parseContextSummary(input.summary);

    const profile = await store.getProfile(profileId);
    if (!profile) {
      throw new InputError("profileId not found");
    }

    await store.setProfileContext(profileId, summary);

    return { profileId, contextSummary: summary };
  };
}

export function createSetBriefingDetailHandler(store: JobSearchStore) {
  return async (ctx: ModuleWorkerContext): Promise<Record<string, unknown>> => {
    const input = stripEnvelope(ctx.input);
    requireNoUnknownKeys(input, SET_BRIEFING_DETAIL_FIELDS);
    const profileId = requireProfileId(input);
    const detail = requireBriefingDetail(input);

    const profile = await store.getProfile(profileId);
    if (!profile) {
      throw new InputError("profileId not found");
    }

    await store.setBriefingDetail(profileId, detail);

    return { profileId, briefingDetail: detail };
  };
}
