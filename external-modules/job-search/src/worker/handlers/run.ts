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
//   - Freshness (JS-07 #936) mutates opportunities ONLY after a successful
//     fetch, scoped to this run's (adapterId, board) sourceKey — records have
//     no monitorId, so absence is only meaningful per board, and fetch
//     failure never implies stale.
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
  DEFAULT_DUE_TIME,
  DEFAULT_TIMEZONE,
  contentHash,
  getMonitor,
  getMonitorCursor,
  getOpportunity,
  getScheduleState,
  isDue,
  listMonitorIds,
  localDateAndTime,
  markFreshnessAfterRun,
  opportunityIdentity,
  rebuildFeed,
  recordRun,
  runRetentionPass,
  saveMonitorCursor,
  saveScheduleState,
  sourceKey,
  upsertOpportunity
} from "../../domain/index.js";
import type { WorkerPorts } from "../ai-port.js";
import { runEvaluationSweep } from "../evaluate.js";
import { InputError, readPlainObject, readString } from "../validate.js";

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

/**
 * Map a normalized posting into the opportunities repo input shape. JS-07:
 * carries the adapter's structured facts through (already sanitized/capped at
 * normalize time) and binds the record to its (adapterId, board) sourceKey so
 * freshness marking can scope absence to the board actually fetched.
 */
export function postingToOpportunity(
  adapterId: string,
  board: string,
  posting: NormalizedPosting
): OpportunityInput {
  return {
    adapterId,
    externalId: posting.externalId,
    canonicalUrl: posting.canonicalUrl,
    sourceKey: sourceKey(adapterId, board),
    posting: {
      title: posting.title,
      company: posting.company,
      ...(posting.locations.length > 0
        ? { location: sanitizeInlineField(posting.locations.join("; "), LOCATION_MAX_CHARS) }
        : {}),
      url: posting.canonicalUrl,
      description: posting.description,
      ...(posting.publishedAt !== undefined ? { publishedAt: posting.publishedAt } : {}),
      ...(posting.workMode !== undefined ? { workMode: posting.workMode } : {}),
      ...(posting.employmentType !== undefined ? { employmentType: posting.employmentType } : {}),
      ...(posting.compensation !== undefined ? { compensation: posting.compensation } : {})
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
  const seenIdentityHashes = new Set<string>();
  for (const posting of fetched.postings) {
    const input = postingToOpportunity(adapter.id, boardConfig.board, posting);
    // Every posting in a successful fetch counts as "seen" for freshness —
    // including tombstone-suppressed ones (the board still lists them; the
    // user deleted them, which is a status decision, not a liveness fact).
    seenIdentityHashes.add(opportunityIdentity(input));
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

  // JS-07 pipeline (order is load-bearing):
  //  1. Freshness BEFORE retention/gate — absence-from-this-fetch must be
  //     stamped so retention ages stale records and the gate excludes them
  //     this run, not next run. Only reached on a successful fetch (failure
  //     paths returned above), scoped to this board's sourceKey.
  //  2. Retention BEFORE evaluation — never spend daily AI budget on records
  //     the retention pass is about to evict.
  //  3. Evaluation, then one more feed rebuild — runRetentionPass ends with
  //     its own rebuild, but that one predates this run's evaluations; the
  //     second rebuild is cheap (in-memory sort over the survivors) and makes
  //     fresh fit bands rank the feed this run.
  const freshness = await markFreshnessAfterRun(kv, {
    sourceKey: sourceKey(adapter.id, boardConfig.board),
    seenIdentityHashes,
    now: ports.now()
  });
  await runRetentionPass(kv, ports.now());
  const evaluation = await runEvaluationSweep(ports);
  await rebuildFeed(kv, ports.now());

  const counts = {
    fetched: fetched.postings.length,
    ingested,
    suppressed,
    skipped: fetched.evidence.skippedCount,
    // Counts only — the run record is a metadata surface (no content).
    staleMarked: freshness.staleMarked,
    gateExcluded: evaluation.gateExcluded,
    evaluated: evaluation.evaluated,
    evalPending: evaluation.evalPending
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

/**
 * The "monitor.run" queue tool. ctx.input (per #915 worker delivery) is
 * { actorUserId, jobKind, idempotencyKey, params } — actorUserId is ignored
 * here because ports.kv is already pinned to the acting user's scope.
 */
export function monitorRunHandler(ports: WorkerPorts) {
  return async (input: Record<string, unknown>): Promise<Record<string, unknown>> => {
    const jobKind = readString(input, "jobKind", { required: true });
    const idempotencyKey = readString(input, "idempotencyKey", { required: true });
    if (jobKind === SWEEP_JOB_KIND) return sweep(ports, idempotencyKey);
    if (jobKind === RUN_NOW_JOB_KIND) {
      return runNow(ports, idempotencyKey, readPlainObject(input, "params") ?? {});
    }
    throw new InputError("jobKind is not supported");
  };
}

async function sweep(ports: WorkerPorts, idempotencyKey: string): Promise<Record<string, unknown>> {
  const now = ports.now();
  let checked = 0;
  let ran = 0;
  let skipped = 0;
  let failed = 0;
  for (const monitorId of await listMonitorIds(ports.kv)) {
    // Per-monitor isolation: a corrupt record or adapter bug in one monitor
    // must never abort the rest of the sweep.
    try {
      const config = await getMonitor(ports.kv, monitorId);
      if (config === null || !config.enabled) continue;
      checked += 1;
      const state = await getScheduleState(ports.kv, monitorId);
      const due = isDue({
        now,
        timeZone: config.timezone ?? DEFAULT_TIMEZONE,
        dueTime: config.dueTime ?? DEFAULT_DUE_TIME,
        ...(state?.lastCompletedLocalDate !== undefined
          ? { lastCompletedLocalDate: state.lastCompletedLocalDate }
          : {})
      });
      if (!due) {
        skipped += 1;
        continue;
      }
      const outcome = await runMonitorDiscovery(ports, config, {
        runId: deriveRunId(idempotencyKey, monitorId),
        consumeSlot: true
      });
      if (outcome.ran) ran += 1;
      else if (outcome.reason === "error") failed += 1;
      else skipped += 1;
    } catch {
      // Unexpected (non-fetch-layer) failure: counted only — never rethrown
      // and never echoed; the message could derive from stored bytes.
      failed += 1;
    }
  }
  // Counts only: the sweep response is a metadata surface.
  return { status: "ok", jobKind: SWEEP_JOB_KIND, checked, ran, skipped, failed };
}

async function runNow(
  ports: WorkerPorts,
  idempotencyKey: string,
  params: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const monitorId = readString(params, "monitorId", { required: true });
  const config = await getMonitor(ports.kv, monitorId);
  if (config === null) {
    return { status: "error", code: "monitor_not_found", message: "monitor not found" };
  }
  if (!config.enabled) {
    return { status: "error", code: "monitor_disabled", message: "monitor is not enabled" };
  }
  const outcome = await runMonitorDiscovery(ports, config, {
    runId: deriveRunId(idempotencyKey, monitorId),
    // Run-now is additive: it NEVER consumes the scheduled local-day slot.
    consumeSlot: false
  });
  if (outcome.ran) {
    return { status: "ok", ran: true, runId: outcome.runId, counts: outcome.counts };
  }
  if (outcome.reason === "courtesy_not_due") {
    return { status: "ok", ran: false, reason: "courtesy_not_due" };
  }
  return { status: "error", code: outcome.errorCode, message: "monitor run failed" };
}
