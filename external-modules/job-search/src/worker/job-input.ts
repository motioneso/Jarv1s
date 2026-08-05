// external-modules/job-search/src/worker/job-input.ts
//
// Task 15 (#1299): the queue-envelope parser. `ctx.input` for a queued job (crawl.run,
// crawl.sweep, crawl.run-now) is `{actorUserId, jobKind, idempotencyKey, params}` — a different
// shape from a tool call's input (`validate.ts`'s `stripEnvelope`/`validateProfileInput`), which
// is the tool's own fields with `actorUserId` spread on top by the host. A queue envelope's
// `actorUserId` is one of its OWN four fields, not something to strip — so this file does not
// reuse `stripEnvelope`, it validates the envelope shape directly, in the same
// throw-naming-the-key style as `validate.ts`.
import { InputError } from "./validate.js";

export interface JobEnvelope {
  readonly actorUserId: string;
  readonly jobKind: string;
  readonly idempotencyKey: string;
  readonly params: Record<string, unknown>;
}

const JOB_ENVELOPE_KEYS = new Set(["actorUserId", "jobKind", "idempotencyKey", "params"]);

/** Cheap shape sniff for a handler registered under one name that serves BOTH a tool call and a
 * queue job (`match.set-state`, `portal.set-enabled`, `profile.set-briefing-detail` — each named
 * directly by a manual-run queue's `handler` field as well as by an `assistantTools` entry, and
 * `packages/module-sdk/src/worker.ts:234` resolves both out of the same flat handler record, so
 * the SAME function receives either shape and must tell them apart itself). A queue envelope
 * always carries `jobKind` and a nested `params` object; a tool call's input is flat, with at most
 * `actorUserId` spread on top by the host, which never has a `jobKind` field. This is a sniff
 * only, not a validator — callers still run the matched shape through `parseJobEnvelope` or
 * `stripEnvelope` for real validation and error messages. */
export function looksLikeJobEnvelope(raw: unknown): boolean {
  return (
    typeof raw === "object" &&
    raw !== null &&
    !Array.isArray(raw) &&
    "params" in raw &&
    "jobKind" in raw
  );
}

/** Reads exactly the four fields the queue path sends and returns them unchanged. Never coerces,
 * never defaults — a malformed envelope is a host/protocol bug, not something to paper over. */
export function parseJobEnvelope(raw: unknown): JobEnvelope {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new InputError("input must be an object");
  }
  const input = raw as Record<string, unknown>;

  for (const key of Object.keys(input)) {
    if (!JOB_ENVELOPE_KEYS.has(key)) {
      throw new InputError(`unknown key: ${key}`);
    }
  }

  const actorUserId = input.actorUserId;
  if (typeof actorUserId !== "string" || actorUserId.length === 0) {
    throw new InputError("actorUserId is required");
  }

  const jobKind = input.jobKind;
  if (typeof jobKind !== "string" || jobKind.length === 0) {
    throw new InputError("jobKind is required");
  }

  const idempotencyKey = input.idempotencyKey;
  if (typeof idempotencyKey !== "string" || idempotencyKey.length === 0) {
    throw new InputError("idempotencyKey is required");
  }

  const params = input.params;
  if (typeof params !== "object" || params === null || Array.isArray(params)) {
    throw new InputError("params must be an object");
  }

  return { actorUserId, jobKind, idempotencyKey, params: params as Record<string, unknown> };
}
