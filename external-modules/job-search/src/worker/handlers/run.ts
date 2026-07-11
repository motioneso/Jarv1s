// external-modules/job-search/src/worker/handlers/run.ts
//
// JS-05 (#934): the monitor.run queue handler — hourly sweep due-check +
// run-now — and the single discovery core both paths share.
//
// Security posture (security tier, handoff 2026-07-11):
//   - ALL network I/O goes through fetchBoard (JS-04 safe reader: compliance
//     gate, courtesy gate, host re-assert, host-pinned ctx.fetch, fixed
//     error messages). No second fetcher exists in this module.
//   - run records and response envelopes carry ids, counts, and error CODES
//     only — external text (titles, descriptions, URLs, transport errors)
//     never reaches a run record, response, or log line.
//   - JS-05 never mutates opportunity statuses: stale marking is JS-07
//     (#936) — OpportunityRecord has no monitorId, so per-monitor staleness
//     here would cross-contaminate monitors sharing an adapter.
import type { BoardConfig, NormalizedPosting } from "../../adapters/index.js";
import {
  JobSearchFetchError,
  LOCATION_MAX_CHARS,
  fetchBoard,
  getSourceAdapter,
  sanitizeInlineField
} from "../../adapters/index.js";
import type { MonitorConfig, OpportunityInput } from "../../domain/index.js";
import {
  DEFAULT_TIMEZONE,
  contentHash,
  getMonitorCursor,
  getOpportunity,
  localDateAndTime,
  opportunityIdentity,
  recordRun,
  runRetentionPass,
  saveMonitorCursor,
  saveScheduleState,
  upsertOpportunity
} from "../../domain/index.js";
import type { WorkerPorts } from "../ai-port.js";

export const SWEEP_JOB_KIND = "job-search.monitor-sweep";
export const RUN_NOW_JOB_KIND = "job-search.monitor-run-now";

export type DiscoveryOutcome =
  | { readonly ran: true; readonly runId: string; readonly counts: Record<string, number> }
  | { readonly ran: false; readonly reason: "courtesy_not_due" }
  | {
      readonly ran: false;
      readonly reason: "error";
      readonly errorCode: string;
      readonly runId: string;
    };

/**
 * Deterministic run id from the pg-boss delivery's idempotency key: a
 * duplicate delivery converges on the SAME run record instead of minting a
 * second one. 32-hex output always satisfies assertId.
 */
export function deriveRunId(idempotencyKey: string, monitorId: string): string {
  return contentHash(`run ${idempotencyKey} ${monitorId}`);
}

/** Map a normalized posting into the opportunities repo input shape. */
export function postingToOpportunity(
  adapterId: string,
  posting: NormalizedPosting
): OpportunityInput {
  return {
    adapterId,
    externalId: posting.externalId,
    canonicalUrl: posting.canonicalUrl,
    posting: {
      title: posting.title,
      company: posting.company,
      ...(posting.locations.length > 0
        ? { location: sanitizeInlineField(posting.locations.join("; "), LOCATION_MAX_CHARS) }
        : {}),
      url: posting.canonicalUrl,
      description: posting.description
    }
  };
}

/**
 * One discovery run for one monitor. Fetch-layer failures become error run
 * records, never throws — pg-boss retryLimit is reserved for infra crashes,
 * not board failures. Slot consumption (lastCompletedLocalDate) is the LAST
 * write and only on success, so an interrupted or failed run retries on the
 * next hourly tick instead of silently losing the day.
 */
export async function runMonitorDiscovery(
  ports: WorkerPorts,
  config: MonitorConfig,
  opts: { readonly runId: string; readonly consumeSlot: boolean }
): Promise<DiscoveryOutcome> {
  const kv = ports.kv;
  const startedAt = ports.now().toISOString();

  const fail = async (errorCode: string): Promise<DiscoveryOutcome> => {
    await recordRun(kv, {
      schemaVersion: 1,
      monitorId: config.monitorId,
      runId: opts.runId,
      startedAt,
      finishedAt: ports.now().toISOString(),
      status: "error",
      counts: {},
      errorCode
    });
    return { ran: false, reason: "error", errorCode, runId: opts.runId };
  };

  const adapter = getSourceAdapter(config.adapterId);
  if (adapter === null) return fail("adapter_disabled");
  const fetch = ports.fetch ?? null;
  if (fetch === null) return fail("fetch_unavailable");

  // Re-validate the stored query at run time: storage drift must never
  // reach buildUrl (defense in depth on the SSRF boundary).
  let boardConfig: BoardConfig;
  try {
    boardConfig = adapter.validateConfig(config.query);
  } catch {
    return fail("invalid_config");
  }

  const cursor = await getMonitorCursor(kv, config.monitorId);

  let fetched;
  try {
    fetched = await fetchBoard(
      { fetch, now: () => ports.now() },
      adapter,
      boardConfig,
      cursor?.lastCheckedAt
    );
  } catch (error) {
    if (error instanceof JobSearchFetchError) {
      if (error.code === "courtesy_not_due") {
        // Courtesy skip: no run record, no cursor write, slot NOT consumed —
        // the next hourly tick simply retries.
        return { ran: false, reason: "courtesy_not_due" };
      }
      // Board/transport failure: known jobs untouched (stale marking is
      // JS-07), lastCheckedAt advances (the attempt counts for courtesy),
      // lastSuccessAt preserved, slot NOT consumed → retried later today.
      await saveMonitorCursor(kv, {
        schemaVersion: 1,
        monitorId: config.monitorId,
        cursor: cursor?.cursor ?? {},
        lastCheckedAt: ports.now().toISOString(),
        ...(cursor?.lastSuccessAt !== undefined ? { lastSuccessAt: cursor.lastSuccessAt } : {})
      });
      return fail(error.code);
    }
    throw error;
  }

  let ingested = 0;
  let suppressed = 0;
  for (const posting of fetched.postings) {
    const input = postingToOpportunity(adapter.id, posting);
    // upsertOpportunity's `suppressed` flag covers tombstones only; an
    // unchanged re-sighting returns the refreshed record. Counts must
    // distinguish real ingestion (new record or content change) from
    // idempotent re-sightings, so compare contentHash across the upsert.
    const before = await getOpportunity(kv, opportunityIdentity(input));
    const result = await upsertOpportunity(kv, input, ports.now());
    if (result.suppressed || (before !== null && before.contentHash === result.record.contentHash))
      suppressed += 1;
    else ingested += 1;
  }

  const finishedAt = ports.now().toISOString();
  await saveMonitorCursor(kv, {
    schemaVersion: 1,
    monitorId: config.monitorId,
    cursor: cursor?.cursor ?? {},
    lastCheckedAt: finishedAt,
    lastSuccessAt: finishedAt
  });

  // runRetentionPass ends with a feed rebuild — no separate rebuildFeed call.
  await runRetentionPass(kv, ports.now());

  const counts = {
    fetched: fetched.postings.length,
    ingested,
    suppressed,
    skipped: fetched.evidence.skippedCount
  };
  await recordRun(kv, {
    schemaVersion: 1,
    monitorId: config.monitorId,
    runId: opts.runId,
    startedAt,
    finishedAt,
    status: "ok",
    counts
  });

  if (opts.consumeSlot) {
    await saveScheduleState(kv, {
      schemaVersion: 1,
      monitorId: config.monitorId,
      lastCompletedLocalDate: localDateAndTime(ports.now(), config.timezone ?? DEFAULT_TIMEZONE)
        .date
    });
  }

  return { ran: true, runId: opts.runId, counts };
}
