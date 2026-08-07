// external-modules/job-search/src/worker/handlers/profile.ts
//
// Task 16 (#1300): the conversation/profile tools — job-search.profile.create,
// job-search.profile.list, job-search.criteria.set, job-search.profile.set-context, and
// job-search.profile.set-briefing-detail.
//
// Handlers validate input, use existing domain/store operations, and return records rather than
// prose. Queued `criteria.set` writes commit quickly; scoring is handled by the existing
// crawl-sweep continuation so later edits are never blocked by stale AI work.
//
// `validateProfileInput` (Task 13) only accepts an input whose ONLY field is `profileId` — it
// throws `unknown key` on anything else, so it is used verbatim only by the profileId-only
// tools in resume.ts/portal.ts. A tool that needs more than `profileId` (criteria.set,
// set-context, set-briefing-detail here; resume.set/portal.set-enabled in their own files)
// calls `stripEnvelope` directly and validates its own extra fields with the helpers below,
// in the same throw-naming-the-key style. `profile.create` (no profileId yet) and
// `profile.list` (no fields at all) do the same.
import type { ModuleWorkerContext } from "@moss/module-sdk/worker";

import {
  completedSteps,
  isReadyToCrawl,
  parseContextSummary,
  parseCriteriaPatch
} from "../../domain/criteria.js";
import type { SearchCriteria } from "../../domain/records.js";
import type { BriefingDetail, JobSearchStore, ProfileState } from "../../domain/store-port.js";
import { looksLikeJobEnvelope, parseJobEnvelope } from "../job-input.js";
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
const PROFILE_GET_FIELDS = new Set(["profileId"]);
const PROFILE_RENAME_FIELDS = new Set(["profileId", "name"]);
const CRITERIA_SET_FIELDS = new Set(["profileId", "criteria"]);
const QUEUED_CRITERIA_SET_FIELDS = new Set(["profileId", "criteria", "rescoreOnly"]);
const SET_CONTEXT_FIELDS = new Set(["profileId", "summary"]);
const SET_BRIEFING_DETAIL_FIELDS = new Set(["profileId", "detail"]);
const BRIEFING_DETAIL_VALUES = new Set<BriefingDetail>(["count", "top", "full"]);
const SET_LIKE_CRITERIA_FIELDS = [
  "titles",
  "seniority",
  "locations",
  "excludeCompanies",
  "mustHave",
  "niceToHave",
  "dealbreakers"
] as const;

function sameStringSet(left: readonly string[], right: readonly string[]): boolean {
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  return leftSet.size === rightSet.size && [...leftSet].every((value) => rightSet.has(value));
}

function sameCriteria(left: SearchCriteria, right: SearchCriteria): boolean {
  return (
    left.remote === right.remote &&
    left.compFloorCents === right.compFloorCents &&
    left.wantNarrative === right.wantNarrative &&
    SET_LIKE_CRITERIA_FIELDS.every((field) => sameStringSet(left[field], right[field]))
  );
}

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

/** Re-decides whether a profile has everything it needs to start crawling, and flips it to
 * `active` if so.
 *
 * `isReadyToCrawl` reads two independent records — the criteria object and the profile's enabled
 * portals — which are written by two different tools. When only `criteria.set` ran this check, the
 * profile activated ONLY if the boards were already on when the criteria landed. A live run saved
 * complete criteria first and enabled freehire second, and the profile sat in `in_conversation`
 * with every onboarding step visibly complete and no board ever appearing. Readiness is a property
 * of the profile, not of whichever tool happened to write last, so both writers call this.
 *
 * Only an `in_conversation` profile is auto-activated — a paused profile is a deliberate user
 * pause, and neither a criteria edit nor a board toggle should silently undo it. */
export async function activateIfReady(
  store: JobSearchStore,
  profile: { id: string; state: ProfileState },
  criteria: Partial<SearchCriteria>
): Promise<{ state: ProfileState; steps: ReturnType<typeof completedSteps>; ready: boolean }> {
  const enabledPortals = await countEnabledPortals(store, profile.id);
  const steps = completedSteps(criteria, enabledPortals);
  const ready = isReadyToCrawl(criteria, enabledPortals);

  // A handler calls the store; it does not enqueue (test 1). The first crawl starts when the
  // browser calls the crawl-run queue's run endpoint after this tool returns.
  const activates = ready && profile.state === "in_conversation";
  if (activates) {
    await store.setProfileState(profile.id, "active");
  }

  return { state: activates ? "active" : profile.state, steps, ready };
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
      state: profile.state,
      statusText: "Job search created"
    };
  };
}

/** The first-run bootstrap, reached ONLY from the `job-search.profile-bootstrap` queue — never
 * from an assistant tool. It exists because the module's empty state had no way to produce its
 * own first record: the browser cannot invoke a write tool (packages/ai/src/routes.ts 403s every
 * risk:"write" tool on the REST path, deliberately and un-bypassably), so the only other writer
 * was the model, and asking it in prose to call `profile.create` is a coin flip — on a live
 * instance it opened an interview instead, and the module polled `profile.list` forever against a
 * table that stayed empty. A declared worker queue is the module's own sanctioned write path
 * (`allowManualRun`, actor-scoped, consented at install), so the button now writes the row
 * deterministically and the conversation starts framed by `buildSeedPrompt` rather than having to
 * bootstrap itself.
 *
 * Idempotent on purpose: it returns the actor's existing first profile rather than creating a
 * second one. The queue's 5s manual singleton (apps/api/src/external-module-jobs.ts) covers a
 * double-click but not the panel's "Try again", nor a pg-boss retry, and a duplicate empty
 * profile would leave the user staring at a switcher they never asked for. Takes no params: the
 * empty state has no name field, so the first name is fixed here and can be changed later in
 * Profile. */
const BOOTSTRAP_PROFILE_NAME = "My job search";

export function createProfileBootstrapHandler(store: JobSearchStore) {
  return async (ctx: ModuleWorkerContext): Promise<Record<string, unknown>> => {
    // Queue-only, so the input is always a job envelope ({actorUserId, jobKind, idempotencyKey,
    // params}), never a flat tool input — `stripEnvelope` would let `jobKind` through and the
    // unknown-key check would then reject the host's own protocol field. No `looksLikeJobEnvelope`
    // branch here for the same reason: unlike portal.set-enabled, nothing in `assistantTools`
    // names this handler, so there is no second shape to tell apart.
    requireNoUnknownKeys(parseJobEnvelope(ctx.input).params, NO_FIELDS);

    const existing = await store.listProfiles();
    const profile = existing[0] ?? (await store.createProfile(BOOTSTRAP_PROFILE_NAME));

    return {
      profileId: profile.id,
      name: profile.name,
      state: profile.state,
      created: existing.length === 0
    };
  };
}

/** Starts a SECOND (or third, or tenth) job search, reached only from the
 * `job-search.profile-new` queue.
 *
 * `profile.bootstrap` above cannot serve this: it is deliberately idempotent and hands back the
 * actor's existing first profile, which is exactly right for a first-run button clicked twice and
 * exactly wrong for a button whose whole meaning is "another one". Two queues rather than one
 * queue with a flag because bootstrap and "new" have different idempotency rules.
 *
 * The name is generated and can be changed directly from Profile. Numbered off the current count,
 * so the second search is "Job search 2" and reads as a sibling of the
 * first rather than as a duplicate of it. The count can collide after a delete ("Job search 2"
 * twice) — nothing keys on the name and the switcher shows both, so a duplicate label is a
 * cosmetic annoyance the user can rename away, not a broken state worth a uniqueness loop over. */
export function createProfileNewHandler(store: JobSearchStore) {
  return async (ctx: ModuleWorkerContext): Promise<Record<string, unknown>> => {
    // Queue-only, same envelope-not-tool-input reasoning as the bootstrap handler above.
    requireNoUnknownKeys(parseJobEnvelope(ctx.input).params, NO_FIELDS);

    const existing = await store.listProfiles();
    const profile = await store.createProfile(`Job search ${existing.length + 1}`);

    return { profileId: profile.id, name: profile.name, state: profile.state };
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
          readyToCrawl: isReadyToCrawl(profile.criteria, enabledPortals),
          // Task 17 (#1301) deviation fix: the chat surface binds by surfaceKey, not the row id
          // (rulings ledger), so this is the only field the wire type gained solely to make that
          // binding possible from the browser.
          surfaceKey: profile.surfaceKey
        };
      })
    );

    return { profiles: shaped };
  };
}

/** K6 (2026-07-28 keyline-restructure plan): the one read tool that returns what a profile's
 * criteria actually say, not just how many onboarding steps are answered. `profile.list` already
 * shapes `completedSteps`/`readyToCrawl` for the switcher; this is a second, deliberately separate
 * shape for the Profile screen alone — one record, not the 15-25-row list `matches.list` shapes,
 * so it is exempt from that file's render-cap/truncation arithmetic (same exemption `MatchDetail`
 * documents for `match.get` in matches.ts). Nothing here truncates `contextSummary` or any
 * criteria field for that reason.
 *
 * Returns exactly `{profileId, name, criteria, contextSummary}` — never the rest of the `Profile`
 * record (state, schedule, surfaceKey, ...). Secrets never escape a handler by accident,
 * but the more common leak is a whole-record return where a field nobody meant to expose rides
 * along; naming every returned key here is what test `10` in
 * job-search-profile-handler.test.ts checks for. */
export function createProfileGetHandler(store: JobSearchStore) {
  return async (ctx: ModuleWorkerContext): Promise<Record<string, unknown>> => {
    const input = stripEnvelope(ctx.input);
    requireNoUnknownKeys(input, PROFILE_GET_FIELDS);
    const profileId = requireProfileId(input);

    // Matches this file's own idiom (criteria.set / set-context below), not resume.ts's/
    // matches.ts's "return {..., x: null}" — both idioms exist in this codebase and the task
    // asked for whichever one the handler's own file already uses.
    const profile = await store.getProfile(profileId);
    if (!profile) {
      throw new InputError("profileId not found");
    }

    return {
      profileId,
      name: profile.name,
      criteria: profile.criteria,
      contextSummary: profile.contextSummary,
      briefingDetail: profile.briefingDetail
    };
  };
}

export function createProfileRenameHandler(store: JobSearchStore) {
  return async (ctx: ModuleWorkerContext): Promise<Record<string, unknown>> => {
    const input = parseJobEnvelope(ctx.input).params;
    requireNoUnknownKeys(input, PROFILE_RENAME_FIELDS);
    const profileId = requireProfileId(input);
    const name = requireString(input, "name").trim();
    if (name.length === 0 || name.length > 80) {
      throw new InputError("name must be between 1 and 80 characters");
    }
    if (!(await store.getProfile(profileId))) throw new InputError("profileId not found");
    await store.renameProfile(profileId, name);
    return { profileId, name, statusText: "Search renamed" };
  };
}

export function createCriteriaSetHandler(store: JobSearchStore) {
  return async (ctx: ModuleWorkerContext): Promise<Record<string, unknown>> => {
    const queueInvocation = looksLikeJobEnvelope(ctx.input);
    const input = queueInvocation
      ? (() => {
          const params = parseJobEnvelope(ctx.input).params;
          requireNoUnknownKeys(params, new Set(["profileId", "criteriaJson", "rescoreOnly"]));
          if (params.rescoreOnly !== undefined && typeof params.rescoreOnly !== "boolean") {
            throw new InputError("rescoreOnly must be a boolean");
          }
          if (params.rescoreOnly === true && params.criteriaJson === undefined) {
            return { profileId: params.profileId, rescoreOnly: true };
          }
          if (typeof params.criteriaJson !== "string") {
            throw new InputError("criteriaJson is required");
          }
          let criteria: unknown;
          try {
            criteria = JSON.parse(params.criteriaJson);
          } catch {
            throw new InputError("criteriaJson must contain valid JSON");
          }
          return { profileId: params.profileId, criteria, rescoreOnly: params.rescoreOnly };
        })()
      : stripEnvelope(ctx.input);
    requireNoUnknownKeys(input, queueInvocation ? QUEUED_CRITERIA_SET_FIELDS : CRITERIA_SET_FIELDS);
    const profileId = requireProfileId(input);
    const rescoreOnly = queueInvocation && input.rescoreOnly === true;
    // Metadata-only continuations resolve the current criteria from the profile; actual writes
    // still validate before lookup so malformed patches fail on their own terms.
    const patch =
      rescoreOnly && input.criteria === undefined ? null : parseCriteriaPatch(input.criteria);

    const profile = await store.getProfile(profileId);
    if (!profile) {
      throw new InputError("profileId not found");
    }

    // Merge, don't replace. See `parseCriteriaPatch` for why: the interview records one answer at
    // a time, and a replacing write meant each answer erased the last.
    const criteria: SearchCriteria =
      patch === null ? profile.criteria : { ...profile.criteria, ...patch };
    const unchanged = sameCriteria(criteria, profile.criteria);

    // The browser fetched this criteria snapshot immediately before enqueueing a deferred direct
    // chat rescore. If it is already stale, never let the continuation overwrite a newer edit;
    // fail the queue invocation before updateCriteria performs its match invalidation.
    if (rescoreOnly && !unchanged) {
      throw new InputError("rescoreOnly criteria must match the current profile criteria");
    }

    if (!unchanged) {
      await store.updateCriteria(profileId, criteria);
    }

    const outcome = await activateIfReady(store, profile, criteria);
    const rescore: Record<string, unknown> | null =
      !unchanged || rescoreOnly ? { ok: true, attempted: false } : null;

    return {
      profileId,
      state: outcome.state,
      completedSteps: outcome.steps,
      readyToCrawl: outcome.ready,
      unchanged,
      rescore,
      statusText: "Search criteria updated"
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

    return { profileId, contextSummary: summary, statusText: "Search context updated" };
  };
}

/** Task 15 (#1299) addition: also registered as the manual-run queue
 * `job-search.profile-set-briefing-detail` (`jarvis.module.json`) for the same reason as
 * `portal.set-enabled` above — the settings screen's write 403s with `confirmation_required` on
 * the tool-call lane (`packages/ai/src/routes.ts:645-668`), so it goes through the manual-run
 * queue lane instead. See `portal.ts`'s `createPortalSetEnabledHandler` for the fuller version of
 * this comment; the shape-sniff is identical. */
export function createSetBriefingDetailHandler(store: JobSearchStore) {
  return async (ctx: ModuleWorkerContext): Promise<Record<string, unknown>> => {
    const input = looksLikeJobEnvelope(ctx.input)
      ? parseJobEnvelope(ctx.input).params
      : stripEnvelope(ctx.input);
    requireNoUnknownKeys(input, SET_BRIEFING_DETAIL_FIELDS);
    const profileId = requireProfileId(input);
    const detail = requireBriefingDetail(input);

    const profile = await store.getProfile(profileId);
    if (!profile) {
      throw new InputError("profileId not found");
    }

    await store.setBriefingDetail(profileId, detail);

    return { profileId, briefingDetail: detail, statusText: "Briefing detail updated" };
  };
}
