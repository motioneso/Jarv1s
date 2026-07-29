# Job Search résumé upload — is a new write seam needed?

**Status:** Decision — no new host capability required
**Date:** 2026-07-29
**Grounded on:** working tree at branch `feat/job-search`, `HEAD` `a8c9719b`
**Issue:** #1280 (Job Search epic) — no separate architecture issue needed; see Scope below

## Question

Job Search's own module UI needs to let a user upload a résumé. Résumé text is private user
content. Does any browser→module write path exist that doesn't violate a hard invariant, and if
not, what's the minimal correct fix?

## Verifying the six findings

1. **Confirmed.** `POST /api/ai/assistant-tools/:name/invoke` 403s every non-read tool before
   execution (`packages/ai/src/routes.ts:645-669`). The comment at lines 693-697 states the floor
   is structurally un-bypassable and that service-backed writes must go "via the gateway/CLI path,
   which threads per-tool ToolServices only after an Approve."
2. **Confirmed, and worth being precise about why.** `POST /api/ai/assistant-actions/:id/resolve`
   (`packages/ai/src/routes.ts:532-552`) calls only `repository.resolveAssistantAction` — a DB
   status update. The actual approve→execute bridge lives entirely inside a live gateway session:
   `packages/ai/src/gateway/gateway.ts` pauses a pending write tool call on
   `confirmations.awaitResolution(...)` (lines 329, 524) and only resumes it when
   `resolveActionRequest` (line 418) calls `this.deps.confirmations.resolve(...)`. The REST route
   never touches `ConfirmationRegistry`, so a browser Approve click today updates a row nobody is
   waiting on. Even once wired, this bridge only unblocks a tool call **currently in flight in a
   live session** — it is not a queue of approved actions that execute later.
3. **Confirmed, and stronger than stated.** `POST /api/modules/:moduleId/queues/:queueName/run`
   (`apps/api/src/external-module-jobs.ts:22`) enqueues via `sendModuleJob` →
   `assertModuleJobPayload` (`packages/jobs/src/module-jobs.ts:45-91`): total payload ≤ 4096 bytes,
   `params` ≤ 2048 bytes, and must match the queue's declared `paramsSchema`. The metadata-only
   rule isn't just convention here — it's load-bearing in the SDK's type system.
   `ModuleParamScalarSchema` (`packages/module-sdk/src/external-module.ts:92-95`) only admits
   `uuid | identifier | timestamp | boolean | null | integer | number | enum`. **There is no
   free-text string type at all.** Putting résumé content through this route isn't a policy
   shortcut, it's something the SDK cannot currently express.
4. **Confirmed.** `GET /api/modules/:moduleId/web/*` (`apps/api/src/external-module-web-route.ts:27`)
   serves static built assets only — no write verb, no body handling.
5. **Confirmed.** No multipart dependency anywhere in the repo (`@fastify/multipart` is absent).
   The only two raw-blob-body upload routes that exist are core-owned, not module-owned:
   `POST /api/ai/transcriptions` and `POST /api/chat/attachments`.
6. **Confirmed, and this is the useful correction.** `job-search.meta` /
   `job-search.fetch-host-grants` KV is reachable **only** from the module worker, over the
   internal JSON-RPC transport in `packages/module-registry/src/external/worker-rpc-host.ts`
   (`kv.get`/`kv.set`/`kv.delete`, ~lines 442-469). There is no browser-facing REST route into
   module KV storage anywhere in `apps/api/src` — grepped, zero hits. So this isn't a fourth
   candidate seam; it collapses back into finding 3 (a worker can only be reached via a queue job).

**Precedent check (the open item you flagged):** none, and it's not close. No module puts
user-authored content through a `runQueue` payload today, and per finding 3 the SDK's own
`ModuleParamsSchema` union has no scalar type that could hold free text. Metadata-only is enforced
at the type-system level, not just by house style.

## The seam that already exists (this changes the ranking)

`docs/superpowers/specs/2026-07-18-chat-attachments-design.md` — **approved**, and per its own
"(As built: …)" annotations, **already implemented** — is exactly this problem, already solved,
and explicitly scoped to this exact case: _"Job search (résumé, job-post PDFs, screenshots) is the
motivating case, not the boundary"_ (line 8). Verified present in the tree:

- `POST /api/chat/attachments` — raw-blob upload into the user's own `VaultContext`
  (0600/0700, structurally owner-scoped), mime-whitelisted (`application/pdf`, `text/*`, images),
  size-capped, magic-byte sniffed. Client helper `uploadChatAttachment` —
  `apps/web/src/api/client.ts:879`.
- `chat.readAttachment` MCP tool (`packages/chat/src/manifest.ts:212`) — the engine fetches the
  file on demand over its authenticated per-user gateway; PDF text is extracted server-side
  (`pdf-parse`). Bytes never touch pg-boss, logs, or the persisted transcript — only the small
  `attachmentIds` reference travels in the turn request.
- `apps/web/src/chat/composer.tsx` — attach button and upload wiring already present.
- `job-search.resume.set` (`external-modules/job-search/jarvis.module.json:165-179`) is already
  declared: `risk: "write"`, input `{ profileId, content }`. It needs no manifest change.

So the pipeline from "user has a résumé file" to "text lands in `job-search.resume.set`'s
`content` argument" already exists end to end, already respects every invariant (vault-only I/O,
metadata-only payloads, RLS-scoped tool execution, no secrets involved), and already treats
Job Search as its motivating case. What's missing is not a write seam — it's finding 2: the
browser Approve click doesn't resume the paused tool call yet.

## Options, honestly ranked

**A. New module-declared HTTP route seam** (owner-scoped, RLS-enforced, module-owned handler).
Checked before ranking: there is no `routes`/`http` field anywhere in the manifest schema
(`packages/module-sdk/src/external-module.ts` — only `web.entrypoint` for static assets and
`worker.queues` for jobs). This would be new core infrastructure, not an extension of something
half-built: a manifest schema addition, a new dynamic-mount point in `apps/api/src/server.ts` for
module-owned handlers, a new content-security review surface (module code now parses raw HTTP
bodies), and — per existing memory that manifest routes are public API — a new permanent surface
to maintain. It would also duplicate the vault storage, mime whitelist, and magic-byte sniffing
that `chat-attachments` already built. **Reject:** solves an already-solved problem with a new,
larger, permanent capability.

**B. Extend the queue-run route** to accept content stored outside `pgboss.job.data`, with only a
reference in the payload. Real cost: a new blob-store surface (this is the vault, rebuilt a second
time, module-scoped), an SDK change to `ModuleParamsSchema` to add a content-ref type, a new
worker-side RPC to fetch the referenced content bounded to the invoking module+user, and new
manifest declaration for which queues accept a ref and what size/type caps apply. It also puts the
save on the async queue path when it's really a synchronous, user-facing save. **Reject:** more
new surface than A in some ways (a second content-storage system) to reach the same destination
finding 6 already ruled out — the worker path — for a content-editing action that has no reason to
be async.
I gave both A and B equal-depth review specifically because I initially leaned toward "we need a
new seam"; neither survives contact with what's already in the tree.

**C. Do nothing new at the host level — reuse the existing, approved, already-built
chat-attachments pipeline, gated on the resolve→execute fix landing.** Cost: low, close to zero
new core work. What Job Search actually needs:

- A module-owned "Upload résumé" affordance (or simply exposing the profile's already-scoped
  thread's existing attach button — design spec §8 already makes the profile thread the module's
  chat surface) that calls the existing generic `uploadChatAttachment()` and starts a turn on that
  profile's thread referencing the attachment.
- The already-declared `job-search.resume.set` tool does the write, through the existing (once
  fixed) confirm→execute bridge.
- **Hard dependency:** finding 2 must be fixed first — but that fix is platform-wide, not
  job-search-specific, and blocks every module write via the browser today, not just résumés.
  Assume it lands, per the brief.

**Recommendation: C.**

### Security reasoning

Every hard invariant is preserved because nothing new is introduced:

- **RLS / private-by-default:** unchanged. Vault storage is structurally per-user
  (`VaultContext` root derives from `actorUserId`); `resume.set` executes through the existing
  `DataContextDb`-scoped write against the already FORCE-RLS, owner-only
  `app.job_search_resumes` table.
- **No `BYPASSRLS`, no admin bypass:** not touched by this flow at all.
- **Secrets never escape:** a résumé isn't a secret, and no credential-bearing path is involved.
- **Metadata-only job payloads:** untouched — the content never goes near pg-boss; only the small
  `attachmentIds` reference (identical in kind to any other tool argument) travels in the turn
  request, exactly as designed in the attachments spec.
- **Module isolation:** Job Search gains no new host capability. It calls a generic, already
  core-owned upload endpoint (the same one any chat user already uses) and a tool it already
  declared in its own manifest. No module boundary is crossed or widened.

## What it would take to build

- **No new spec.** This is implementation detail under two specs already approved: the job-search
  design spec (§9, résumé handling) and the chat-attachments spec (which already names job-search
  résumés as its motivating case). A one-paragraph addendum to job-search §9 — "upload flows
  through the existing chat-attachments pipeline; no new host write seam" — is proportionate given
  this was raised as a possible invariant violation; a full spec cycle is not warranted.
- **No manifest change.** `job-search.resume.set` is already declared.
- **No new host route, no SDK change.**
- **Scope of the actual work:**
  - Frontend: a small affordance in the module's own web bundle
    (`external-modules/job-search/src/web/screens/`) that either surfaces the profile thread's
    existing attach control or calls `uploadChatAttachment()` + starts a scoped turn directly —
    a UI call, not an architecture call, and out of scope for this doc.
  - Depends on, but does not itself need to build: the resolve→execute fix (finding 2), tracked
    separately and already in flight on another agent's branch.
- **Task issue:** file a small child issue under epic #1280 for the module-side wiring once the
  UI approach is picked; it does not need a standalone architecture issue since no new capability
  is being added.
- **Known gap worth flagging separately (not blocking):** the attachments mime whitelist covers
  `application/pdf`, `text/*`, and images — not `.docx`. A résumé that's only a Word document would
  be rejected today. That's a content-format gap in the existing attachments feature, not a
  write-seam problem, and is out of scope for this decision.
