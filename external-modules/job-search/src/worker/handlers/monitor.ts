// external-modules/job-search/src/worker/handlers/monitor.ts
//
// JS-03 (#932) Task 10: monitor config tools. The load-bearing rule is the
// enable gate — a monitor may only be saved enabled once BOTH an approved
// resume and an approved profile exist (active-pointer truth, the same
// derivation onboarding.get-state uses — never the stored flags). Disabling
// is always allowed. Responses are scrub-by-construction: monitor.list is
// metadata-only (the query document never leaves via list) and monitor.get
// exposes cursor TIMESTAMPS only, never the cursor document itself.
//
// JS-04 (#933) Task 10: monitor.save validates adapterId against the source-
// adapter registry (unknown/disabled → question naming the enabled ids, so
// the assistant can self-correct) and persists the adapter-NORMALIZED board
// config — adapter.validateConfig is the single gate deciding what a query
// may contain, so extra keys never reach storage.
//
// JS-10 (#1229): a submitted `query.kind === "broad"` routes to the discovery
// sibling instead — getDiscoveryProvider/parseBroadQuery — before the board
// adapter is ever consulted. The stored document then carries an explicit
// `kind: "broad"` discriminator (run.ts:branches on this same field) so a
// board config and a broad config are never ambiguous once persisted. Missing
// `kind` (or any value other than "broad") is the existing board path,
// byte-for-byte unchanged — this is additive, no data migration needed.
//
// Isolation: this module reads approval state through the domain barrel only;
// it must never import the resume/profile handlers or the confirmations
// machinery (enforced by a source-grep test). The adapters barrel is module-
// internal shared code, not a sibling handler — importing it is fine.
import {
  getDiscoveryProvider,
  getSourceAdapter,
  listDiscoveryProviders,
  listSourceAdapters,
  parseBroadQuery
} from "../../adapters/index.js";
import type { MonitorConfig } from "../../domain/index.js";
import {
  DEFAULT_DUE_TIME,
  DEFAULT_TIMEZONE,
  DUE_TIME_PATTERN,
  JobSearchKvError,
  assertId,
  getActiveProfile,
  getActiveResume,
  getMonitor,
  getMonitorCursor,
  isValidTimeZone,
  listMonitorIds,
  saveMonitor
} from "../../domain/index.js";
import type { WorkerPorts } from "../ai-port.js";
import { InputError, readBool, readPlainObject, readString } from "../validate.js";
import { updateOnboarding } from "./flow.js";

export function saveMonitorHandler(ports: WorkerPorts) {
  return async (input: Record<string, unknown>): Promise<Record<string, unknown>> => {
    const monitorId = readString(input, "monitorId", { required: true });
    assertId(monitorId);
    const adapterId = readString(input, "adapterId", { required: true });
    assertId(adapterId);
    const rawQuery = readPlainObject(input, "query", { required: true });

    // JS-10 (#1229): a submitted query.kind of "broad" routes to the discovery
    // registry/validator instead of the board adapter — read BEFORE either
    // registry lookup so the branch decision itself never touches storage.
    // Anything other than the literal "broad" (including absent) is the
    // pre-existing board path below, unchanged.
    let query: Record<string, unknown>;
    if (rawQuery.kind === "broad") {
      // Same fail-closed shape as the board branch: unknown/disabled provider
      // is a question naming the enabled discovery ids, not an error.
      const provider = getDiscoveryProvider(adapterId);
      if (provider === null) {
        const available = listDiscoveryProviders()
          .filter((p) => p.enabled)
          .map((p) => p.adapterId)
          .join(", ");
        return {
          status: "question",
          question: `Unknown or disabled discovery provider. Available providers: ${available}.`
        };
      }
      // parseBroadQuery is the single gate deciding what a broad query may
      // contain (titles/locations/remote/country/maxResults only) — the
      // explicit kind:"broad" discriminator is added back on persist so
      // run.ts (and a future monitor.get reader) can tell the two config
      // shapes apart without inspecting adapterId.
      const parsed = parseBroadQuery(rawQuery);
      query = { kind: "broad", ...parsed };
    } else {
      // Registry gate: only compliance-allowed, non-kill-switched adapters may
      // back a monitor. A question (not an error) so the assistant can present
      // the valid choices instead of dead-ending.
      const adapter = getSourceAdapter(adapterId);
      if (adapter === null) {
        const available = listSourceAdapters()
          .filter((a) => a.enabled)
          .map((a) => a.adapterId)
          .join(", ");
        return {
          status: "question",
          question: `Unknown or disabled source adapter. Available adapters: ${available}.`
        };
      }
      // The adapter owns the config shape: validateConfig throws InputError on
      // anything malformed and returns the normalized document — that exact
      // shape is what persists (extra keys are dropped here, by construction).
      query = { ...adapter.validateConfig(rawQuery) };
    }
    const enabled = readBool(input, "enabled") ?? false;

    // JS-05 (#934): schedule fields. Omitted on update → preserve, else
    // default. The `existing` lookup lives up here (before the enable gate)
    // because the preserve fallback needs it; the gate itself writes nothing.
    // Error messages name key + constraint only — never the submitted value.
    const existing = await getMonitor(ports.kv, monitorId);
    const timezoneInput = readString(input, "timezone");
    if (timezoneInput !== undefined && !isValidTimeZone(timezoneInput)) {
      throw new InputError("timezone must be a valid IANA time zone");
    }
    const dueTimeInput = readString(input, "dueTime");
    if (dueTimeInput !== undefined && !DUE_TIME_PATTERN.test(dueTimeInput)) {
      throw new InputError("dueTime must be HH:MM (24-hour)");
    }
    const timezone = timezoneInput ?? existing?.timezone ?? DEFAULT_TIMEZONE;
    const dueTime = dueTimeInput ?? existing?.dueTime ?? DEFAULT_DUE_TIME;

    // Enable gate BEFORE any write: the question names only what's missing,
    // and nothing is persisted while the gate holds.
    if (enabled) {
      const missing: string[] = [];
      if ((await getActiveResume(ports.kv)) === null) {
        missing.push("an approved resume");
      }
      if ((await getActiveProfile(ports.kv)) === null) {
        missing.push("an approved profile");
      }
      if (missing.length > 0) {
        return {
          status: "question",
          question:
            `Enabling a monitor requires ${missing.join(" and ")}. ` +
            "Complete the approval first, then enable the monitor."
        };
      }
    }

    const now = ports.now().toISOString();
    const config: MonitorConfig = {
      schemaVersion: 1,
      monitorId,
      adapterId,
      enabled,
      // Spread: `query` is already a plain object (board branch: BoardConfig
      // has no index signature; broad branch: {kind, ...DiscoveryQuery}) —
      // this copy just decouples the stored document from either source.
      query: { ...query },
      timezone,
      dueTime,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    };
    await saveMonitor(ports.kv, config);
    await updateOnboarding(ports.kv, {
      complete: enabled ? ["sources_schedule", "review_enable"] : ["sources_schedule"]
    });
    return { status: "ok", monitorId, enabled, timezone, dueTime };
  };
}

export function listMonitorsHandler(ports: WorkerPorts) {
  return async (_input: Record<string, unknown>): Promise<Record<string, unknown>> => {
    const monitors: Record<string, unknown>[] = [];
    for (const monitorId of await listMonitorIds(ports.kv)) {
      const config = await getMonitor(ports.kv, monitorId);
      if (config === null) {
        continue;
      }
      // Metadata only — the query document stays out of list responses.
      monitors.push({
        monitorId: config.monitorId,
        adapterId: config.adapterId,
        enabled: config.enabled,
        timezone: config.timezone ?? DEFAULT_TIMEZONE,
        dueTime: config.dueTime ?? DEFAULT_DUE_TIME,
        createdAt: config.createdAt,
        updatedAt: config.updatedAt
      });
    }
    return { status: "ok", monitors };
  };
}

export function getMonitorHandler(ports: WorkerPorts) {
  return async (input: Record<string, unknown>): Promise<Record<string, unknown>> => {
    const monitorId = readString(input, "monitorId", { required: true });
    const config = await getMonitor(ports.kv, monitorId);
    if (config === null) {
      throw new JobSearchKvError("missing_record", `monitor ${monitorId} not found`);
    }
    const response: Record<string, unknown> = {
      status: "ok",
      monitorId: config.monitorId,
      adapterId: config.adapterId,
      enabled: config.enabled,
      query: config.query,
      timezone: config.timezone ?? DEFAULT_TIMEZONE,
      dueTime: config.dueTime ?? DEFAULT_DUE_TIME,
      createdAt: config.createdAt,
      updatedAt: config.updatedAt
    };
    const cursor = await getMonitorCursor(ports.kv, monitorId);
    if (cursor !== null) {
      // Timestamps only — cursor.cursor is adapter scan state, never exposed.
      const timestamps: Record<string, unknown> = { lastCheckedAt: cursor.lastCheckedAt };
      if (cursor.lastSuccessAt !== undefined) {
        timestamps.lastSuccessAt = cursor.lastSuccessAt;
      }
      response.cursor = timestamps;
    }
    return response;
  };
}
