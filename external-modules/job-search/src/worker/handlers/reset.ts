import {
  NS,
  RESET_MARKER_KEY,
  type JobSearchKv
} from "../../domain/kv-port.js";

export interface ResetResult {
  readonly status: "ok";
  readonly resetDone: true;
  readonly deleted: number;
}

/** #1232 / JS-01 Task 1: remove stale user data once, then leave a replay-safe marker. */
export async function resetJob(kv: JobSearchKv): Promise<ResetResult> {
  const marker = await kv.get(NS.meta, RESET_MARKER_KEY);
  if (marker?.resetDone === true) return { status: "ok", resetDone: true, deleted: 0 };

  let deleted = 0;
  for (const namespace of Object.values(NS)) {
    for (const key of await kv.list(namespace)) {
      if (namespace === NS.meta && key === RESET_MARKER_KEY) continue;
      if (await kv.delete(namespace, key)) deleted += 1;
    }
  }
  await kv.set(NS.meta, RESET_MARKER_KEY, { resetDone: true });
  return { status: "ok", resetDone: true, deleted };
}

