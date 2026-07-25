# Spec — #1250 + #1253 Approval-request lifecycle: honest resolve outcomes and reload rehydration

Date: 2026-07-25. Status: DRAFT — awaiting Ben's approval.

Grounded on branch `spec/host-findings-1250-1255` (base `origin/main` `fd524022`). Every line
number below was read in that tree; where the issue text cites a different line, the number here is
the verified one.

**Line numbers are `fd524022`'s.** `build/js-03-perms` (`ee7ca045`, unpushed, under Ben's #1234 UAT)
merges first and changes two files central to this design — `apps/web/src/chat/action-request-card.tsx`
(+19) and `packages/ai/src/gateway/gateway.ts` (+33, replacing three copies of a hardcoded
`found.dto.name === "job-search.resume.critique"` check with a helper at `gateway.ts:75`). Re-resolve
line references in those two files against main at implementation time. That branch is also why
#1250/#1253 were left alone during the JS-03 build: patching the card mid-UAT would have changed what
Ben is testing. Verified on `ee7ca045` that neither guard this spec builds on is weakened — the
fail-closed early return survives verbatim at `gateway.ts:405` and the owner-match `if (!resolved)
return` at `gateway.ts:415` (a +17 shift from `376/388/396`; that shift is also why the issue text
cites 405/413-415). The `void` return and the unconditional 204 are unchanged, so the problem
statement holds post-merge. Two behaviour changes there do touch this design and are noted inline:
the Reject button is relabelled **Deny**, and the card gains a `revealOnAppear` prop.

These two issues are one design. #1250 is "the client believes a write happened that did not";
#1253 is "the client cannot see a request that still exists". Fixing #1253 alone recreates #1250 on
every reload, because a rehydrated card would offer Approve for a call whose in-memory waiter is
already gone. The shared root cause is that **whether an approval is still actionable is
in-memory-only state that the client is never told about**.

## Problem

### P1 — The resolve route reports success it did not verify (#1250)

`AssistantToolGateway.resolveActionRequest` (`packages/ai/src/gateway/gateway.ts:376-400`) has three
distinct outcomes and returns `Promise<void>` for all of them:

1. **Expired** — `gateway.ts:388-390`:
   `if (status === "confirmed" && !this.deps.confirmations.isAwaiting(actionRequestId)) return;`
   This is the fail-closed guard. The blocked tool call already timed out, so persisting
   `confirmed` would record an approval that can never execute. The row is deliberately left
   `pending`. **This behaviour is correct and is preserved unchanged.**
2. **Not found / not yours** — `gateway.ts:396-399`: `repository.resolveAssistantAction` returns
   `undefined` when its `.where("status", "=", "pending")` + RLS owner predicate matches no row
   (`packages/ai/src/repository.ts:1731-1750`), and the gateway returns early without touching the
   registry. The inline comment is explicit: "Without this guard a logged-in user could unblock
   another user's tool call via a guessed ID." **Preserved unchanged.**
3. **Resolved** — the row moved to `confirmed`/`rejected`/`cancelled` and the live waiter was
   settled via `confirmations.resolve` (`packages/ai/src/gateway/confirmation-registry.ts:38-43`).

The route cannot distinguish them (`packages/chat/src/routes.ts:384-389`):

```ts
await wiring.gateway.resolveActionRequest(access.actorUserId, id, rawStatus);
return reply.code(204).send();
```

All three become `204`. `resolveActionRequest` in `apps/web/src/api/client.ts:959-967` returns
`Promise<void>` and discards the response, so `ActionRequestCard`
(`apps/web/src/chat/action-request-card.tsx:40-50`) takes the success branch, sets `status = "done"`
and renders "Resolved." (`action-request-card.tsx:109`). The user is told their approval landed. In
cases 1 and 2 nothing was written and no tool ran. That is the phantom success.

The window is not narrow: `confirmTimeoutMs` is `NATIVE_CONFIRM_TIMEOUT_MS = 150_000`
(`packages/chat/src/live/claude-permission-hook.ts:17`, wired at `packages/chat/src/routes.ts:770-772`).
Any card older than 2.5 minutes is in case 1, and on timeout the gateway does **not** cancel the row
(`gateway.ts:514-534` emits `action_result: denied` and returns a denial reason; no DB write), so the
row sits `pending` until the boot sweep at `packages/chat/src/routes.ts:347-360` cancels rows older
than `STALE_ACTION_GRACE_MS = 5 * 60_000` (`routes.ts:112`). A stale card is the normal state of any
drawer left open.

### P2 — A second resolve endpoint bypasses the registry entirely

`POST /api/ai/assistant-actions/:id/resolve` (`packages/ai/src/routes.ts:531-551`) calls
`repository.resolveAssistantAction` directly. It never consults `ConfirmationRegistry`, so it can
persist `confirmed` with no live waiter — precisely the divergence `gateway.ts:388-390` exists to
prevent — and it never unblocks the blocked call, so the tool does not run either. No `apps/web`
code calls it (only `tests/integration/ai-tools.test.ts` and `tests/integration/ai.test.ts:217-219`),
but it is **public API surface, not dead code**: it is a declared manifest route
(`packages/ai/src/manifest.ts:350-356`) with `permissionId: "ai.assistant-actions"` and shared
request/response schemas, so consumers outside `apps/` may call it and grants may already reference
that id. Fixing the chat route while leaving this one in place leaves the bug reachable.

### P3 — Approval cards exist only in the live stream, so a reload loses them (#1253)

`action_request` records are emitted to the SSE notifier only — `gateway.ts:505-511` for module tools
and `gateway.ts:292-297` for native tool permissions. `GET /api/chat/stream`
(`packages/chat/src/live-routes.ts:500-536`) subscribes live with **no replay buffer**.

`useChatStream` accumulates records from `EventSource` (`apps/web/src/chat/use-chat-stream.ts:94-120`)
and separately rehydrates thread history (`use-chat-stream.ts:122-141`), but `recordsFromMessages`
(`use-chat-stream.ts:146-169`) only ever produces `user` and `reply` records. There is no code path
that can produce an `action_request` record after a reload. `message-row.tsx:150-168` therefore never
renders a card, and the blocked tool call runs out its 150 s with no surface at all.

The row does survive in Postgres (`packages/ai/sql/0016_ai_assistant_actions.sql`, owner-only FORCE
RLS), so `listAssistantActions` (`packages/ai/src/repository.ts:1696`) can find it. **But the DB row
alone cannot answer "is this still actionable"** — `ConfirmationRegistry` is a plain in-process
`Map` (`confirmation-registry.ts:12-13`) whose own doc comment notes "a server restart mid-wait
orphans the call (accepted cost)". A `pending` row means "nobody answered", not "somebody is still
waiting". Rendering every `pending` row as an actionable card would hand the user an Approve button
that silently no-ops — #1250, reintroduced.

### P4 — The card payload is deliberately not persisted

`gateway.ts:490-493` states it directly: the human `summary` and the rich `preview` ride the live
stream only; the persisted `input_summary` is key-names-only (metadata-only persistence). A `preview`
carries email recipient, subject and body (`apps/web/src/chat/use-chat-stream.ts:23-27`). So
rehydration cannot simply re-read the card content from the database, and **must not** start
persisting it. Any rehydrated card must get its rich content from somewhere that is not the DB, or
render without it.

## Design

Single organising idea: **the server owns the join between the RLS-scoped `pending` DB rows and the
in-memory live-waiter set, and tells the client the answer.** The client never infers liveness.

### Fix 1 — `resolveActionRequest` returns a discriminated outcome

`packages/ai/src/gateway/gateway.ts`. Add an exported type and change the signature at `gateway.ts:376`:

```ts
export type ActionRequestResolution =
  | { readonly outcome: "resolved"; readonly action: AiAssistantActionRequestSafeRow }
  | { readonly outcome: "expired" }
  | { readonly outcome: "not_found" };
```

- `gateway.ts:388-390` (fail-closed guard) returns `{ outcome: "expired" }` instead of falling
  through to `return`.
- `gateway.ts:396-399` returns `{ outcome: "not_found" }` when `resolveAssistantAction` yields
  `undefined`.
- The success path returns `{ outcome: "resolved", action: resolved }` — the updated row is already
  in hand at `gateway.ts:394` (`repository.resolveAssistantAction` returns
  `AiAssistantActionRequestSafeRow | undefined`, `packages/ai/src/repository.ts:1731-1735`), so
  carrying it out costs nothing and saves Fix 3 a second read. The chat route ignores it.

Owner mismatch, already-resolved, and nonexistent id all collapse into `"not_found"` on purpose —
distinguishing them would turn the endpoint into an existence oracle for other users' request ids.
The guards themselves are untouched; only the return value changes. This is the AI-package layer
because it is the only layer that can see both the registry and the repository.

Note the ordering that makes the security story hold: the `"expired"` branch fires **before** any DB
lookup, so a guessed id that has no live waiter returns `expired` regardless of owner (no
information leak). A guessed id that _does_ have another user's live waiter falls through to the DB
owner check and returns `not_found` without settling that waiter — `gateway.ts:396-399` still runs
first.

### Fix 2 — The chat route maps outcomes to honest status codes

`packages/chat/src/routes.ts:384-389`:

| outcome     | status | body                                                                                                          |
| ----------- | ------ | ------------------------------------------------------------------------------------------------------------- |
| `resolved`  | `204`  | empty (unchanged)                                                                                             |
| `expired`   | `409`  | `{ error: "This request expired before you answered — ask again to retry.", code: "action_request_expired" }` |
| `not_found` | `404`  | `{ error: "Action request not found", code: "action_request_not_found" }`                                     |

The thrown-exception branch keeps its `400`.

**Schema warning (mandatory):** the shared `errorResponseSchema`
(`packages/shared/src/schema-fragments.ts`) is `additionalProperties: false` with only `error`
declared. If this route is given that schema, fast-json-stringify silently drops `code`. Two
required changes:

1. Add a `codedErrorResponseSchema` fragment to `packages/shared/src/schema-fragments.ts` declaring
   `error` (required) and `code` (optional string), and use it for the `409`/`404` responses of this
   route. Do not widen `errorResponseSchema` itself — every existing route shares it.
2. The route registration at `packages/chat/src/routes.ts:366` currently declares **no** Fastify
   schema. Add one (params + body + the three responses) as part of this change so the contract is
   explicit rather than incidentally permissive.

`packages/module-sdk/src/route-errors.ts:76-106` (`handleRouteError`) only ever emits `{ error }` and
is not on this path; leave it alone.

Client: `apps/web/src/api/client.ts:959-967` changes to return the outcome as a plain string union
(`"resolved" | "expired" | "not_found"` — the browser never sees the row that rides Fix 1's
server-side discriminated union), deriving it from the `ApiError` (`client.ts:174-182`,
populated from the body's `code` by `readErrorBody` at `client.ts:1349-1371`) rather than rethrowing.
Status code is the primary contract; `code` is the machine-readable confirmation.

### Fix 3 — Re-wire the registry-bypassing AI resolve route through the gateway

`POST /api/ai/assistant-actions/:id/resolve` is **not** dead code to be deleted. It is a declared
entry in the module's public API manifest (`packages/ai/src/manifest.ts:350-356`) carrying
`permissionId: "ai.assistant-actions"`, with request/response schemas in the shared contracts. Under
module isolation, a manifest-declared route is public surface that consumers may call without
appearing in a grep of `apps/`, and install-time permission grants (#1246) may already reference that
id. Removing it is a breaking API change; re-pointing it closes the hole for less.

Change the handler body at `packages/ai/src/routes.ts:536-547` so that instead of calling
`repository.resolveAssistantAction` directly it calls the same `resolveActionRequest` the chat route
calls. It then inherits **both** guards for free — fail-closed confirm-after-timeout
(`gateway.ts:388-390`) and owner-match (`gateway.ts:396-399`) — and it actually unblocks the waiting
call, which today it never does.

**Wiring (this is the non-obvious part).** `AiRoutesDependencies` (`packages/ai/src/routes.ts:106-129`)
has no gateway, and packages/ai must not import `@jarv1s/chat` — the file-header comment on
`connectTerminalRpc` (`routes.ts:120-126`) records that this edge "was tried and reverted: it creates
real cycles". The `AssistantToolGateway` _class_ lives in packages/ai, but the _instance_ is built
inside the chat wiring closure (`packages/chat/src/routes.ts:237-271`), and the composition root calls
`registerAiRoutes` (`packages/module-registry/src/index.ts:1210`) **before** `registerChatRoutes`
(`index.ts:1245`) — so the instance does not exist yet at AI-route registration time. Use the existing
late-bind pattern:

1. Add an optional `resolveActionRequest?: (actorUserId: string, actionRequestId: string, status:
ResolveAiAssistantActionStatus) => Promise<ActionRequestResolution>` to `AiRoutesDependencies`.
   Pass the narrow function, not the gateway object — smallest possible seam across the module edge.
2. Publish it from the chat wiring via an `adoptResolveActionRequest` setter on the composition root,
   modelled exactly on `adoptChatRpcConnection` and `adoptDropSessionsForProvider`
   (`packages/module-registry/src/index.ts:2130-2141`), which exist for precisely this
   "built-inside-registerChatRoutes, needed-by-something-registered-earlier" case.
3. When the dependency is absent (tests/deployments that wire no chat runtime), the route returns
   `503` rather than falling back to the direct repository call. A silent fallback would restore the
   bypass exactly when the registry is missing — the worst case.

**Response contract.** The declared `200` body stays `{ action: AiAssistantActionDto }`
(`packages/shared/src/ai-types.ts:423-425`), serialized as today via `serializeAssistantAction`
(`packages/ai/src/routes.ts:547`) from the row the gateway now hands back on `outcome: "resolved"`
(Fix 1) — no second query, no shape change for existing callers. Additive change: the declared error
responses on `resolveAiAssistantActionRouteSchema` (`packages/shared/src/ai-api.ts:841`) gain `409`
for `expired` using the same `codedErrorResponseSchema` fragment from Fix 2, alongside the existing
`404` (whose message stays "Assistant action request not found"). Manifest untouched, `permissionId`
untouched, no grant churn.

`GET /api/ai/assistant-actions` (`packages/ai/src/routes.ts:515`) is read-only and unchanged.

### Fix 4 — The registry carries the card payload and the deadline

`packages/ai/src/gateway/confirmation-registry.ts`. The registry is already the authoritative
liveness oracle; make it the authoritative _card_ store too, since P4 forbids persisting the
payload. Extend `Waiter` (`confirmation-registry.ts:4-6`):

```ts
interface Waiter {
  readonly settle: (outcome: AwaitOutcome) => void;
  readonly card: LiveActionRequestCard; // actorUserId, surface, toolName, summary, preview?, expiresAt
}
```

`awaitResolution` (`confirmation-registry.ts:15-30`) takes the card as a third argument; the existing
`setTimeout`/`delete` teardown at `confirmation-registry.ts:17-20` already guarantees the entry
disappears exactly when liveness ends, so no separate expiry bookkeeping is needed. Add:

```ts
listLive(actorUserId: string, surface: ChatSurface): readonly LiveActionRequestCard[]
```

which filters by `actorUserId` **first** (never return another user's card, and never leak a
`preview` across users — P4 content is exactly the kind of data the "secrets never escape" invariant
covers) and then by surface.

Both creation sites pass the card: `gateway.ts:287-290` (native, summary from `nativeToolSummary`, no
preview) and `gateway.ts:498-503` (module tools, with `summary` + optional `preview`). The surface is
derivable from `ctx.chatSessionId` via `parseSurfaceSessionKey` (`packages/chat/src/live/chat-surface.ts`).
`expiresAt` = now + `confirmTimeoutMs`, so the client can show a countdown and stop offering Approve
a moment before the server would reject it.

This stays in memory. No new column, no new persisted content, no change to metadata-only
persistence.

### Fix 5 — `GET /api/chat/action-requests?surface=…` returns pending requests with liveness

New route in `packages/chat/src/routes.ts`, registered next to the resolve route inside the same
`if (wiring)` block (`routes.ts:363`) so it shares the gateway/registry instance built at
`routes.ts:237-271`.

Handler:

1. Resolve `AccessContext` exactly as the resolve route does (`routes.ts:369-374`) — `{ actorUserId,
requestId }` only, no new fields.
2. Normalise `surface` with `normalizeChatSurface` (`packages/shared/src/chat-api.ts:11-22`).
3. Read the RLS-scoped `pending` rows through `DataContextRunner.withDataContext(access, …)` calling
   `repository.listAssistantActions` (`packages/ai/src/repository.ts:1696`) — branded `DataContextDb`
   only; RLS applies to the owner like any other actor.
4. Ask the gateway for `listLive(actorUserId, surface)`.
5. Left-join by action-request id and emit one DTO per pending row:
   - **live** → `actionable: true`, `toolName`/`summary`/`preview` from the in-memory card,
     `expiresAt` set.
   - **not live** → `actionable: false`, `expiresAt: null`, and **metadata-safe fields only**:
     `toolName` from the persisted `permission_id`/tool name and `requestedAt` from the row. No
     `summary`, no `preview` — those never existed in the DB and must not be invented.

Response DTO in `packages/shared/src/ai-types.ts` (mirroring `AiAssistantActionDto` at
`ai-types.ts:181-194`) plus a schema in `packages/shared/src/ai-api.ts` alongside
`aiAssistantActionSchema` (~`ai-api.ts:277`). **Every field must be declared** — `additionalProperties:
false` on that schema family silently drops anything undeclared, which is exactly how a missing
`actionable` flag would turn into "card renders as approvable", i.e. #1250 again. Declare
`actionRequestId`, `toolName`, `summary` (nullable), `preview` (nullable object with `to`/`subject`/
`body`), `actionable`, `expiresAt` (nullable), `requestedAt`.

Surface scoping for the non-live half is the one thing the DB cannot do today — see Open question A.

### Fix 6 — The web card gains an `expired` state; the stream hydrates from the new endpoint

`apps/web/src/chat/action-request-card.tsx`:

- Widen the state union at `action-request-card.tsx:23` to include `"expired"`, and accept an
  `actionable?: boolean` prop that starts the card there.
- In `resolve` (`action-request-card.tsx:40-50`), branch on the outcome now returned by
  `resolveActionRequest`: `"resolved"` → `done`; `"expired"` → `expired`; `"not_found"` → `error`
  with the server message. The current code's assumption that "no throw = success" is the bug; it
  goes away.
- `expired` renders the card body (so the user still sees what was asked) with Approve/Deny
  **removed**, not disabled, and the line "This request expired before you answered — ask again to
  retry." Keep `data-action-request-id` (`action-request-card.tsx:59`) for the e2e selector. (The
  reject button is labelled "Reject" on `fd524022` and **"Deny"** after `ee7ca045` lands — assert on
  the post-merge label.)
- **A rehydrated card must not set `revealOnAppear`** (the prop `ee7ca045` adds). Its mount-only
  effect scroll-centres and focuses the card, and its own comment says cards mounted as part of the
  first paint must not reveal themselves or "every one of them would fight for the scroll position
  and steal focus from the composer". Rehydrated cards are by definition first-paint cards; pass it
  only for requests arriving live over SSE.

`apps/web/src/chat/use-chat-stream.ts`:

- Add a third effect that calls the Fix 5 endpoint on mount (and on `surface` change) and merges the
  results into `records` as `action_request` records keyed by `actionRequestId`, carrying
  `actionable` and `expiresAt` through `TranscriptRecord` (`use-chat-stream.ts:29-44`).
- Merge by id, **not** by the `current.length === 0` guard used for history at
  `use-chat-stream.ts:133`. That guard exists to stop history clobbering a live session; approval
  cards must merge into a non-empty transcript, and must not duplicate a card the SSE stream also
  delivered. Dedupe on `actionRequestId`; live-stream data wins on conflict (it is the same object
  from the same registry).
- `parseRecord` (`use-chat-stream.ts:179-213`) gains `actionable`/`expiresAt` parsing so a future
  server-side liveness change over SSE is representable.
- `message-row.tsx:150-168` passes `actionable` through to the card.
- No change needed to `apps/web/src/chat/assistant-surface/surface.tsx:15-25` — `action_request` is
  already in the allowed kind set, so the job-search surface gets this for free.

Ordering: rehydrated cards are appended after history, which matches how a stale card reads —
"still waiting on you", at the bottom.

## Testing / UAT

**Unit — `tests/unit/`**

- `confirmation-registry.test.ts` (new or extended): `listLive` returns only the calling
  `actorUserId`'s entries; only the requested surface; an entry disappears from `listLive` the
  instant the timeout fires; `resolve()` on a settled id still returns `false`.
- `action-request-card-preview.test.tsx` (extend; existing file already SSRs the card): `actionable:
false` renders the summary but **no** Approve/Reject and the expired copy; `actionable: true`
  renders both buttons (guards the default).
- New `tests/unit/use-chat-stream-rehydrate.test.ts`: merging pending requests into a non-empty
  transcript does not drop live records; the same `actionRequestId` from both the endpoint and SSE
  yields one card.

**Integration — `tests/integration/`**

- `chat-action-requests.test.ts` (new): with a live waiter, `POST …/resolve` → `204` and the tool
  runs. After the waiter times out, the same call → `409` + `code: "action_request_expired"` and the
  row is **still `pending`** (asserts the fail-closed behaviour survives). A second user resolving a
  guessed id → `404`, the row unchanged, and the victim's waiter still live (asserts
  `gateway.ts:396-399`).
- Same file: `GET /api/chat/action-requests` returns `actionable: true` + `summary` while live;
  after timeout the same id returns `actionable: false`, `summary: null`, `preview: null`. Assert
  the absence of `preview` explicitly — that is the metadata-only-persistence guard.
- Same file: a second user's `GET` never sees the first user's request (RLS).
- **Parity test (required by Fix 3), in `chat-action-requests.test.ts`:** table-drive the same
  fixtures through `POST /api/chat/action-requests/:id/resolve` and
  `POST /api/ai/assistant-actions/:id/resolve` and assert both produce the same outcome for the same
  request id — live waiter → success and the tool runs; **expired → both refuse and the row stays
  `pending`**; other user's id → both refuse without settling the victim's waiter. This is the guard
  that stops the two paths drifting apart again; it must fail if either handler is re-pointed at the
  repository.
- `tests/integration/ai-tools.test.ts` (`:263,324,364,369,388,394`) and
  `tests/integration/ai.test.ts:217-219` keep calling the AI route — they now need a live waiter (or
  the injected `resolveActionRequest`) in scope, since the route no longer writes on its own. Add one
  case asserting the `503` when the dependency is absent.
- Verify the `code` field actually survives serialisation via `app.inject` — this repo has a
  recurring class of bug where a response-schema `additionalProperties: false` silently strips a new
  field.

**E2E — `tests/e2e/`**

- `chat-action-request-reload.spec.ts` (new, on the #1000 dev-instance harness since this is
  user-visible UI): trigger a confirm-gated tool, see the card, reload the page, assert the card is
  still present via `[data-action-request-id]` and still has an Approve button, click it, assert the
  tool result appears. Then a second case: let the request pass its deadline, reload, assert the
  card renders with the expired copy and **no** Approve button.
- `tests/e2e/mock-chat-api.ts:33-46` currently stubs `/api/chat/stream` with an empty event-stream;
  it needs a matching stub for `GET /api/chat/action-requests` (default: empty list) so existing
  specs are unaffected.

**Manual UAT**

Ask the assistant for a confirm-gated action, wait past 2.5 minutes, click Approve: expect "expired",
not "Resolved." Then repeat and reload mid-request: expect a working card.

## Non-goals

- **Persisting the card payload.** `summary`/`preview` stay in memory (`gateway.ts:490-493`).
  Surviving an API restart is explicitly out of scope; the registry's "restart orphans the call" cost
  (`confirmation-registry.ts:10`) is accepted and unchanged.
- **Durable/queued approvals.** No pg-boss, no cross-process registry, no approval that outlives the
  blocked call.
- **Extending the 150 s timeout** (`claude-permission-hook.ts:17`) or the 5-minute boot-sweep grace
  (`routes.ts:112`). Behaviour change only in what the client is _told_.
- **Push notification of expiry.** The card learns it is dead on load or on click, not via a live
  "your request just expired" event.
- **Re-running the original tool call from an expired card.** "Ask again" means a new turn. Retry
  would need the original tool input, which is not persisted.
- **Touching the audit log** (`packages/db/src/types.ts:466-480`) or the SECURITY DEFINER sweep
  (`packages/ai/sql/0098_ai_cancel_stale_assistant_actions.sql`).

## Open questions for Ben

**A. Should `ai_assistant_action_requests` get a `chat_session_id` column?**

Live cards are surface-scoped for free (the registry holds the surface, Fix 4). Expired ones are not:
`packages/ai/sql/0016_ai_assistant_actions.sql` has no session/surface column
(`packages/db/src/types.ts:450-464`), so a dead `pending` row cannot be attributed to the drawer vs
the job-search surface, and both surfaces would show it.

**Recommendation: yes, add it.** Precedent exists: `jarvis_action_audit_log.chat_session_id`
(`packages/db/src/types.ts:466-480`), and `gateway.ts` already threads `ctx.chatSessionId` into
`recordAudit`, so the write site is free. A session key is metadata, not content, so this does not
weaken metadata-only persistence.

Three implementation constraints if approved — name them here so nobody discovers them the hard way:

1. **New file only.** Add a new `packages/ai/sql/00NN_ai_assistant_action_chat_session.sql`. Never
   edit `0016_ai_assistant_actions.sql` — applied migrations are hash-checked. The number is assigned
   by global landing order, so take the next free one at landing time, not at spec time (the list is
   already past `0100`).
2. **The immutability trigger must be re-issued, not edited.** `0016` installs
   `app.enforce_ai_assistant_action_update_scope()`, which whitelists the columns an UPDATE may
   touch; the new file must `CREATE OR REPLACE FUNCTION` it so a `chat_session_id` write is legal,
   and must also extend the RLS/column grants for `jarvis_app_runtime` the same way `0016` did.
3. **`tests/integration/foundation-schema-catalog.test.ts` asserts the FULL migration list with
   `toEqual`** (the assertion at `:31`, inside the "applies versioned SQL migrations from an empty
   database" case at `:18`; the existing AI rows sit at `:126`). The new `{ version, name }` row must
   be appended there in the right position or the gate fails with a diff that looks unrelated to the
   change.

**Fallback if you'd rather not migrate:** show non-live cards on the default `drawer` surface only.
Cheap, and slightly wrong for job-search users.

**B. Should the new `GET` opportunistically cancel dead `pending` rows?**

It could make the DB self-healing rather than waiting for the next boot sweep (`routes.ts:347-360`).
**Recommendation: no.** A `GET` with a write side effect is a footgun, and the row's honest state is
"pending — nobody answered", which is what the audit trail should say. Leave reconciliation to the
existing boot sweep.
