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

// React DEV may mount the same module view twice. Share identical reads across those instances so
// a paged board costs one request per page, not two simultaneous copies of every page.
const inFlightReads = new Map<string, Promise<unknown>>();

export function invokeTool(name: string, input?: Record<string, unknown>): Promise<unknown> {
  const requestBody = JSON.stringify({ input: input ?? {} });
  const key = `${name}\n${requestBody}`;
  const existing = inFlightReads.get(key);
  if (existing) return existing;

  const request = (async () => {
    let response: { ok: boolean; status: number; json: () => Promise<unknown> };
    try {
      response = await fetch(`/api/ai/assistant-tools/${encodeURIComponent(name)}/invoke`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: requestBody
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
  })();
  const tracked = request.finally(() => {
    if (inFlightReads.get(key) === tracked) inFlightReads.delete(key);
  });
  inFlightReads.set(key, tracked);
  return tracked;
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

/**
 * Task #108 (text) / #112 (binary): the first half of the résumé-save transport, shared by both
 * draft kinds resume-save.ts's ResumeDraft can carry. Uploads to the user's own vault via the
 * existing chat-attachments route — never a job payload, never the DB (packages/chat/src/
 * attachments-routes.ts's own comment: bytes flow request -> ChatAttachmentsService -> vault
 * only). Returns the attachment id, which is all resume-save.ts then hands to runQueue — two
 * small id strings, not the résumé's content, so the queue payload stays metadata-only.
 *
 * `body: string | ArrayBuffer`, never a `Uint8Array`: this tsconfig has no explicit "lib" key, so
 * TypeScript falls back to ES2022's default lib set, which DOES include DOM — `fetch`/`BodyInit`
 * are in scope. But `BodyInit`'s `BufferSource = ArrayBufferView<ArrayBuffer> | ArrayBuffer` pins
 * its generic to plain `ArrayBuffer`, while a bare `Uint8Array` annotation defaults its generic to
 * `ArrayBufferLike` (TS 5.7+) — those don't structurally match, so a `Uint8Array` body fails to
 * typecheck even though it's spec-valid at runtime. Taking `ArrayBuffer` directly (what a File's
 * own .arrayBuffer() already returns, see resume-editor.tsx) sidesteps the mismatch with no cast.
 */
async function uploadAttachment(
  mimeType: string,
  fileName: string,
  body: string | ArrayBuffer
): Promise<string> {
  let response: { ok: boolean; status: number; json: () => Promise<unknown> };
  try {
    response = await fetch("/api/chat/attachments", {
      method: "POST",
      credentials: "include",
      headers: {
        "content-type": "application/octet-stream",
        "x-jarvis-mime-type": mimeType,
        "x-jarvis-file-name": encodeURIComponent(fileName)
      },
      body
    });
  } catch {
    throw new Error("Network error");
  }
  if (!response.ok) {
    throw new Error(`Request failed (${response.status})`);
  }
  const parsed = (await parseJson(response)) as { attachment?: { id?: unknown } } | null;
  const attachmentId = parsed?.attachment?.id;
  if (typeof attachmentId !== "string" || attachmentId.length === 0) {
    throw new Error("Malformed attachment response");
  }
  return attachmentId;
}

/** The text/paste draft — a paste or a client-read .txt/.md upload, always uploaded as plain text. */
export async function uploadResumeAttachment(content: string): Promise<string> {
  return uploadAttachment("text/plain", "resume.txt", content);
}

/**
 * The binary draft (task #112) — a .pdf/.docx upload, sent as the raw bytes resume-editor.tsx
 * read via File.arrayBuffer(), with the mime it derived from the file's own extension (never
 * `file.type`, which is empty for a .txt/.md file in every browser and would 415 here otherwise).
 */
export async function uploadResumeAttachmentBytes(
  bytes: ArrayBuffer,
  mimeType: string,
  fileName: string
): Promise<string> {
  return uploadAttachment(mimeType, fileName, bytes);
}
