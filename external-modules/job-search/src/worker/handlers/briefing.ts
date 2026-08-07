// external-modules/job-search/src/worker/handlers/briefing.ts
//
// Task 15 (#1299): the thin wrapper `jarvis.module.json`'s `briefing.handler` names
// (`briefing.contribute`). All shaping already happened in Task 10
// (`domain/surface.ts#buildBriefingContribution`) and Task 15's own
// `stages/score.ts#contributeToBriefing`, which "reads the store and delegates entirely to
// `buildBriefingContribution` — no string assembly in the handler" (spec, verbatim). This file
// adds nothing but the envelope parse and the one judgment call the store-level function itself
// cannot make: which `BriefingDetail` to render at, given that setting lives per-profile
// (`Profile.briefingDetail`) but `contributeToBriefing` renders the actor's active profiles
// together at a single shared level.
//
// Invoked the same way a queue job is (`apps/worker/src/external-module-invoke.ts`'s
// `createExternalBriefingInvoker`: `runtime.invoke(discovery, handler, {actorUserId, jobKind:
// "briefing", idempotencyKey, params: {section}}, …)`) — so `ctx.input` is the four-field job
// envelope, not the tool shape, even though this is reached from the briefing composer rather
// than a queue.
import type { ModuleWorkerContext } from "@moss/module-sdk/worker";

import type { BriefingDetail, JobSearchStore } from "../../domain/store-port.js";
import { parseJobEnvelope } from "../job-input.js";
import { contributeToBriefing } from "../stages/score.js";

/** Most-generous-wins, not first-active-profile-wins: a briefing built by silently picking one
 * profile's conservative "count" setting would suppress detail the OTHER active profile's own
 * user explicitly asked to see. `full` shows the most, so it never hides an item another level
 * would have shown; the reverse is not true. Defaults to "count" when there are no active
 * profiles, matching `contributeToBriefing`'s own no-op-but-not-error return for that case. */
const DETAIL_RANK: Readonly<Record<BriefingDetail, number>> = { count: 0, top: 1, full: 2 };

function mostGenerousDetail(
  profiles: readonly { briefingDetail: BriefingDetail }[]
): BriefingDetail {
  let chosen: BriefingDetail = "count";
  for (const profile of profiles) {
    if (DETAIL_RANK[profile.briefingDetail] > DETAIL_RANK[chosen]) {
      chosen = profile.briefingDetail;
    }
  }
  return chosen;
}

export function createBriefingContributeHandler(store: JobSearchStore) {
  return async (ctx: ModuleWorkerContext): Promise<Record<string, unknown>> => {
    // Parsed and validated even though the section itself does not change what this module
    // contributes (job-search briefs the same active-profile summary morning or evening) — an
    // envelope this handler cannot recognise is the same host/protocol bug it would be for any
    // other queue-shaped invocation, and silently accepting an unrecognised shape hides it.
    parseJobEnvelope(ctx.input);

    const activeProfiles = (await store.listProfiles()).filter(
      (profile) => profile.state === "active"
    );
    const detail = mostGenerousDetail(activeProfiles);

    const contribution = await contributeToBriefing({ store, detail });
    return { headline: contribution.headline, items: contribution.items };
  };
}
