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
// Isolation: this module reads approval state through the domain barrel only;
// it must never import the resume/profile handlers or the confirmations
// machinery (enforced by a source-grep test). The adapters barrel is module-
// internal shared code, not a sibling handler — importing it is fine.
import { getSourceAdapter, listSourceAdapters } from "../../adapters/index.js";
import type { MonitorConfig } from "../../domain/index.js";
import {
  JobSearchKvError,
  assertId,
  getActiveProfile,
  getActiveResume,
  getMonitor,
  getMonitorCursor,
  listMonitorIds,
  saveMonitor
} from "../../domain/index.js";
import type { WorkerPorts } from "../ai-port.js";
import { readBool, readPlainObject, readString } from "../validate.js";
import { updateOnboarding } from "./flow.js";

export function saveMonitorHandler(ports: WorkerPorts) {
  return async (input: Record<string, unknown>): Promise<Record<string, unknown>> => {
    const monitorId = readString(input, "monitorId", { required: true });
    assertId(monitorId);
    const adapterId = readString(input, "adapterId", { required: true });
    assertId(adapterId);
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
    const query = adapter.validateConfig(readPlainObject(input, "query", { required: true }));
    const enabled = readBool(input, "enabled") ?? false;

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
    const existing = await getMonitor(ports.kv, monitorId);
    const config: MonitorConfig = {
      schemaVersion: 1,
      monitorId,
      adapterId,
      enabled,
      // Spread: BoardConfig is an interface (no index signature), and this
      // also decouples the stored document from the adapter's return value.
      query: { ...query },
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    };
    await saveMonitor(ports.kv, config);
    await updateOnboarding(ports.kv, {
      complete: enabled ? ["sources_schedule", "review_enable"] : ["sources_schedule"]
    });
    return { status: "ok", monitorId, enabled };
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
