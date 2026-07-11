// external-modules/job-search/src/web/api.ts
// JS-06 (#935): module-local request helpers. Deliberately NOT
// @jarv1s/module-web-sdk requestJson — the invoke contract carries its payload
// ({invocation:{blockedReason,...}}) on 403, and requestJson throws away
// non-2xx bodies. Only risk:read tools are ever invoked here; write tools go
// through the assistant confirm flow, never this client (Coordinator ruling).
export type ToolOutcome<T> =
  | { kind: "ok"; result: T }
  | { kind: "blocked"; reason: string }
  | { kind: "disabled" }
  | { kind: "error"; message: string };

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

export async function invokeTool<T extends Record<string, unknown>>(
  name: string,
  input?: Record<string, unknown>
): Promise<ToolOutcome<T>> {
  let response: { ok: boolean; status: number; json: () => Promise<unknown> };
  try {
    response = await fetch(`/api/ai/assistant-tools/${encodeURIComponent(name)}/invoke`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ input: input ?? {} })
    });
  } catch {
    return { kind: "error", message: "Network error" };
  }
  // 404 = tool not declared = module disabled/uninstalled server-side. A stale
  // browser session must fail closed to the disabled state (spec).
  if (response.status === 404) return { kind: "disabled" };
  const body = (await parseJson(response)) as InvocationBody | null;
  const invocation = body?.invocation;
  if (response.ok && invocation?.status === "succeeded") {
    return { kind: "ok", result: (invocation.result ?? {}) as T };
  }
  if (invocation?.status === "blocked") {
    return { kind: "blocked", reason: invocation.blockedReason ?? "blocked" };
  }
  return { kind: "error", message: `Request failed (${response.status})` };
}

export type RunNowOutcome =
  | { kind: "queued" }
  | { kind: "already-queued" }
  | { kind: "disabled" }
  | { kind: "error"; message: string };

export async function runMonitorNow(monitorId: string): Promise<RunNowOutcome> {
  let response: { status: number; json: () => Promise<unknown> };
  try {
    response = await fetch("/api/modules/job-search/queues/job-search.monitor-run/run", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      // Metadata-only job payload (CLAUDE.md hard invariant): the id, nothing else.
      body: JSON.stringify({ jobKind: "job-search.monitor-run-now", params: { monitorId } })
    });
  } catch {
    return { kind: "error", message: "Network error" };
  }
  if (response.status === 202) {
    const body = (await parseJson(response)) as { jobId?: string | null } | null;
    // jobId:null = the manual singleton for this actor is already queued —
    // report queued state without polling (spec: no duplicate activation).
    return body && body.jobId ? { kind: "queued" } : { kind: "already-queued" };
  }
  if (response.status === 404) return { kind: "disabled" };
  return { kind: "error", message: `Request failed (${response.status})` };
}
