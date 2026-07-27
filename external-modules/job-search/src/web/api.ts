// external-modules/job-search/src/web/api.ts
// Task 18 (#1302): the module's transport, and the ONLY place it talks to the host. Only
// risk:read tools are ever invoked here — the browser REST invoke route 403s writes — so
// every write (profile.create, criteria.set, ...) goes through the assistant conversation
// instead; the sole caller today is the profile.list poll in use-profiles.ts.
//
// invokeTool resolves to the tool's raw result on success and throws on every other outcome
// (disabled/blocked/network/HTTP error). That is deliberately thinner than a discriminated
// union: the only caller polls a read tool repeatedly, so a transient failure is retried on
// the next tick rather than needing its own error-state UI (bound 4 — expiry, not error, is
// the rendered state for a stalled bootstrap).
type InvocationBody = {
  invocation?: {
    status?: string;
    blockedReason?: string | null;
    result?: Record<string, unknown> | null;
  };
};

async function parseJson(response: { json: () => Promise<unknown> }): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export async function invokeTool(name: string, input?: Record<string, unknown>): Promise<unknown> {
  let response: { ok: boolean; status: number; json: () => Promise<unknown> };
  try {
    response = await fetch(`/api/ai/assistant-tools/${encodeURIComponent(name)}/invoke`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ input: input ?? {} })
    });
  } catch {
    throw new Error("Network error");
  }
  // 404 = tool not declared = module disabled/uninstalled server-side. A stale browser
  // session must fail closed rather than treat a missing tool as "no profiles yet."
  if (response.status === 404) {
    throw new Error("disabled");
  }
  const body = (await parseJson(response)) as InvocationBody | null;
  const invocation = body?.invocation;
  if (response.ok && invocation?.status === "succeeded") {
    return invocation.result ?? {};
  }
  if (invocation?.status === "blocked") {
    throw new Error(invocation.blockedReason ?? "blocked");
  }
  throw new Error(`Request failed (${response.status})`);
}

export type RunOutcome =
  | { kind: "queued" }
  | { kind: "already-queued" }
  | { kind: "disabled" }
  | { kind: "error"; message: string };

/**
 * Enqueue a manual run on one of the module's declared queues
 * (POST /api/modules/job-search/queues/:queueName/run — the host route accepts exactly
 * {jobKind, params?}). Mirrors finance's `runQueue` (external-modules/finance/src/web/api.ts:96)
 * exactly — same route shape, same body, same outcome union — because this is a host route
 * with a fixed contract, not a place to be creative.
 */
export async function runQueue(
  queueName: string,
  jobKind: string,
  params?: Record<string, unknown>
): Promise<RunOutcome> {
  let response: { status: number; json: () => Promise<unknown> };
  try {
    response = await fetch(`/api/modules/job-search/queues/${encodeURIComponent(queueName)}/run`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jobKind, ...(params ? { params } : {}) })
    });
  } catch {
    return { kind: "error", message: "Network error" };
  }
  if (response.status === 202) {
    const body = (await parseJson(response)) as { jobId?: string | null } | null;
    // jobId:null = the actor's manual singleton for this queue is already queued — report
    // queued state without duplicating (defensive branch carried from finance/job-search).
    return body && body.jobId ? { kind: "queued" } : { kind: "already-queued" };
  }
  if (response.status === 404) return { kind: "disabled" };
  return { kind: "error", message: `Request failed (${response.status})` };
}
