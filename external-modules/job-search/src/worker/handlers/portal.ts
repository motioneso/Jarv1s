// external-modules/job-search/src/worker/handlers/portal.ts
//
// Task 16 (#1300): job-search.portal.set-enabled and job-search.portal.list. Ruling N6 is why
// `portal.list` exists at all — nothing in the original plan could read portal state for the
// two screens (settings, board) that need to render it; the point of the tool is that the
// browser has no other way to reach `listPortals(profileId)`.
//
// `set-enabled`, not `toggle`: the tool names the state it writes, not the transition, so a
// retry or a double-click is idempotent instead of flipping the portal back off.
import type { ModuleWorkerContext } from "@jarv1s/module-sdk/worker";

import type { PortalState } from "../../domain/records.js";
import type { JobSearchStore } from "../../domain/store-port.js";
import { looksLikeJobEnvelope, parseJobEnvelope } from "../job-input.js";
import { InputError, stripEnvelope, validateProfileInput } from "../validate.js";
import { requireNoUnknownKeys, requireProfileId } from "./profile.js";

const PORTAL_SET_ENABLED_FIELDS = new Set(["profileId", "sourceId", "enabled"]);

function requireSourceId(input: Record<string, unknown>): string {
  const value = input.sourceId;
  if (typeof value !== "string" || value.length === 0) {
    throw new InputError("sourceId is required");
  }
  return value;
}

function requireEnabled(input: Record<string, unknown>): boolean {
  const value = input.enabled;
  if (typeof value !== "boolean") {
    throw new InputError("enabled must be a boolean");
  }
  return value;
}

// Display names for the module's built-in adapters (currently just freehire.ts — Task 11).
// No shared source registry exists yet (Task 24's "sources" part is a plan stub, not landed
// code, and Task 16 does not depend on Task 11's adapters), so this is a deliberately small,
// self-contained stopgap: an unrecognized sourceId (a custom source once Task 24 lands, or a
// future built-in adapter added here later) falls back to the raw id rather than failing.
const BUILT_IN_PORTAL_LABELS: Record<string, string> = {
  freehire: "freehire.me"
};

function labelFor(sourceId: string): string {
  return BUILT_IN_PORTAL_LABELS[sourceId] ?? sourceId;
}

/** Task 15 (#1299) addition: also registered as the manual-run queue `job-search.portal-set-enabled`
 * (`jarvis.module.json`), because the browser settings screen's toggle is a write and a `write`
 * tool 403s with `confirmation_required` before `execute` (`packages/ai/src/routes.ts:645-668`) —
 * the UI reaches this write through the manual-run queue lane instead of the tool-call lane, same
 * pattern as `job-search.match-state`/`match.set-state`. One handler, two shapes in on purpose:
 * `packages/module-sdk/src/worker.ts:234` resolves a queue's `handler` name out of the same flat
 * record a tool's `handler` name resolves from, so the queue and the tool share this exact
 * function rather than each getting their own. */
export function createPortalSetEnabledHandler(store: JobSearchStore) {
  return async (ctx: ModuleWorkerContext): Promise<Record<string, unknown>> => {
    const input = looksLikeJobEnvelope(ctx.input)
      ? parseJobEnvelope(ctx.input).params
      : stripEnvelope(ctx.input);
    requireNoUnknownKeys(input, PORTAL_SET_ENABLED_FIELDS);
    const profileId = requireProfileId(input);
    const sourceId = requireSourceId(input);
    const enabled = requireEnabled(input);

    const profile = await store.getProfile(profileId);
    if (!profile) {
      throw new InputError("profileId not found");
    }

    // setPortalState is a read-modify-write by design (Task 13: PortalState already carries
    // `enabled`, so there is no separate setPortalEnabled). A portal never crawled yet gets a
    // fresh row; one already tracked keeps its lastOkAt/cause untouched by a settings toggle.
    const portals = await store.listPortals(profileId);
    const existing = portals.find((portal) => portal.sourceId === sourceId);
    const next: PortalState = existing
      ? { ...existing, enabled }
      : { sourceId, enabled, lastOkAt: null, cause: null };

    await store.setPortalState(profileId, next);

    return {
      profileId,
      sourceId: next.sourceId,
      label: labelFor(next.sourceId),
      enabled: next.enabled,
      lastOkAt: next.lastOkAt,
      cause: next.cause
    };
  };
}

export function createPortalListHandler(store: JobSearchStore) {
  return async (ctx: ModuleWorkerContext): Promise<Record<string, unknown>> => {
    const { profileId } = validateProfileInput(ctx.input);

    const portals = await store.listPortals(profileId);

    return {
      portals: portals.map((portal) => ({
        sourceId: portal.sourceId,
        label: labelFor(portal.sourceId),
        enabled: portal.enabled,
        lastOkAt: portal.lastOkAt,
        // Structured cause, rendered verbatim by Task 20 — never summarized or re-worded here.
        cause: portal.cause
      }))
    };
  };
}
