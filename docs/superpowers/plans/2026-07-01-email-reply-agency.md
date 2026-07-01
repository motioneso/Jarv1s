# Plan — Email reply agency (#629, spec `2026-06-30-email-agency-slice.md`)

**Risk tier:** `security` (cross-model QA + Ben merge sign-off). Build defensively.
**Branch:** `coord/629-email-reply-agency`. **No new migration** (keep `foundation.test.ts` green).
**Body never persisted** (rows/audit/jobs/prompts/exports/logs). Email writes **synchronous** (no pg-boss).

## Goal

Two email assistant tools over cached Gmail threads, reusing the confirm-and-run bridge:

- `email.draftReply` — `risk:"write"`, family `email_drafts`, `executionPolicy:"auto"`, promotable to
  `trusted_auto`. On approval → Gmail `drafts.create` threaded into the original thread.
- `email.sendReply` — `risk:"destructive"`, **always confirms** (floor `policy.ts` UNCHANGED, no family).

Tool input = `{ cacheMessageId, body }` ONLY. Server derives recipient/subject/threadId from
`app.email_messages` under the actor's `DataContextDb` (security floor §5 — LLM can never address).

## Key files (verified on branch)

- Template (mirror): `packages/calendar/src/calendar-write-service.ts` (interface, module-owned),
  `packages/chat/src/calendar-write-impl.ts` (`buildCalendarWriteService`, imports connectors),
  `packages/calendar/src/manifest.ts` (write-tool decl + `assistantActionFamilies`),
  `packages/calendar/src/tools.ts` (`narrowCalendarWrite`, execute + summarize).
- Gmail client: `packages/connectors/src/google-api-client.ts` — has `GMAIL_BASE`, `getMessage`,
  `postJson`. **MISSING** `drafts.create` / `messages.send` → add both.
- Scope: `gmail.modify` already in `GOOGLE_SCOPES` (`packages/connectors/src/oauth.ts`). No re-consent.
- Gateway chunk hops for `preview`: `packages/ai/src/gateway/types.ts` (GatewaySessionRecord) →
  `packages/ai/src/gateway/gateway.ts` (`confirmAndRun` emit ~L381) →
  `packages/chat/src/gateway-notifier.ts` (`toTranscriptRecord`) + `packages/chat/src/live/types.ts`
  (TranscriptRecord) → `apps/web/src/chat/use-chat-stream.ts` (parse) + `chat-drawer.tsx` (render) +
  `apps/web/src/chat/action-request-card.tsx` (props). (SSE chunk is defensively parsed, not ajv —
  verify during build whether a shared schema also gates it.)
- Preview producer needs DB-scoped async hook: existing `summarize(input,ctx)` is sync (can't do the
  lookup). Add optional async `preview` hook on `ModuleAssistantToolManifest`
  (`packages/module-sdk/src/index.ts:394`).
- Settings: `packages/email/src/settings/index.tsx` (add ONE new Switch), backed by the GENERIC
  action-policy route `packages/ai/src/action-policy-routes.ts` with `email/email_drafts` (finding 1 —
  it already accepts arbitrary family ids; no new email REST route).
- Repo lookup: `EmailRepository.getById(scopedDb, id)` (`packages/email/src/repository.ts`).
- Wiring: `packages/chat/src/routes.ts` `buildChatToolServices` (register `emailWrite` like
  `calendarWrite`).

## Design decisions

1. **Recipient derivation = single source.** Pure helper `deriveReplyTarget(message): {to, subject,
threadId}` in `packages/email` (to = `sender`; subject = `subject`, `Re: ` prefix if absent;
   threadId = `external_metadata.threadId`). Used by BOTH the preview producer AND the write-impl.
   Execute re-does `getById` + `deriveReplyTarget` under DataContextDb — never trusts the card.
2. **Provider gate (COLLISION #642 / finding 5).** Write-impl checks the connector account's
   `provider_type`. Non-Gmail (IMAP) → return secret-free `"Replies aren't supported for this account
yet."` message; NEVER call Gmail API with an IMAP threadId.
3. **Preview hook.** New optional `preview?: (scopedDb, input, ctx, services) => Promise<{to,subject,
body} | undefined>` on the tool manifest. Gateway `confirmAndRun` calls it inside
   `withDataContext` and includes result in the `action_request` emit ONLY. Persisted row stays
   `inputSummary = summarizeAssistantToolInput(input)` (key names) — metadata-only holds automatically.
   Preview body = `input.body` (composed text); to/subject from `deriveReplyTarget`.
4. **`email-write-impl.ts` in `packages/chat`** (composition host may import connectors). Interface
   `EmailWriteService` owned by `packages/email/src/email-write-service.ts`.

## Tasks (TDD — each commits GREEN; `git add` only that task's files)

**T1. Gmail write methods.** `google-api-client.ts`: add `createDraft({accessToken, raw, threadId})`
→ `POST {GMAIL_BASE}/users/me/drafts` body `{message:{raw,threadId}}`; `sendMessage({accessToken,raw,
threadId})` → `POST {GMAIL_BASE}/users/me/messages/send` body `{raw,threadId}`. `raw` = base64url
RFC822. Reuse `postJson` (status-only logging — keep). Unit tests: URL/body/base64url, error→GoogleApiError.

**T2. MIME builder + `deriveReplyTarget` (email module).** `packages/email/src/reply-mime.ts`:
`buildReplyMime({to, subject, body}) => base64url string` (RFC822: To/Subject/`Content-Type: text/plain;
charset=UTF-8`/MIME-Version; body as-is). `deriveReplyTarget(EmailMessage)` pure helper. Unit tests
incl. `Re:` idempotency, threadId extraction, base64url shape.

**T3. `EmailWriteService` interface** (`packages/email/src/email-write-service.ts`):
`draftReply(scopedDb, ctx, {cacheMessageId, body}) => Promise<EmailWriteResult>` + `sendReply(...)`;
`EmailWriteResult = { ok, mode:"draft"|"send", message? }` (secret-free). Export from email index.

**T4. `buildEmailWriteService` impl** (`packages/chat/src/email-write-impl.ts`, mirror
calendar-write-impl): getById → not-found secret-free msg; provider gate (Gmail only, else
unsupported msg); feature-grant + scope checks (mirror calendar); fresh access token; `deriveReplyTarget`
→ `buildReplyMime` → `createDraft`/`sendMessage`; wrap GoogleApiError/GoogleConnectError into secret-free
`message`, never throw raw. Unit tests (fake deps): draft happy path, send happy path, IMAP→unsupported,
no-connection, API-error→secret-free, verify recipient comes from DB not input.

**T5. Manifest + tools** (`packages/email/src/manifest.ts` + `tools.ts`): declare `assistantActionFamilies:
[{id:"email_drafts", defaultTier:"ask_each_time", allowedTiers:["ask_each_time","trusted_auto"]}]`;
add `email.draftReply` (risk write, actionFamilyId `email_drafts`, executionPolicy `auto`,
requiresServices `["emailWrite"]`, input `{cacheMessageId, body}` required) and `email.sendReply`
(risk destructive, NO family/executionPolicy, requiresServices `["emailWrite"]`). Implement execute
(`narrowEmailWrite` structural), `summarize` (card fallback line — no body), and async `preview`
producer (getById + deriveReplyTarget + input.body). Promote `email.send-on-behalf` source-behavior
`coming-soon` → shipped. Unit tests: input plumbing, summarize, preview shape, provider-gate message.

**T6. Manifest `preview` hook type** (`packages/module-sdk/src/index.ts`): add optional
`preview?: ToolPreview` (async `(scopedDb, input, ctx, services) => Promise<ActionRequestPreview |
undefined>`) + `ActionRequestPreview = {to,subject,body}`. Type-only; no behavior. (Do first if T5
needs it — reorder T5/T6 as needed; keep each commit green.)

**T7. Gateway preview threading** (`packages/ai/src/gateway/types.ts` + `gateway.ts`): add optional
`preview?: ActionRequestPreview` to `GatewaySessionRecord` action_request; in `confirmAndRun`, if
`found.tool.preview`, call it via `this.deps.runner.withDataContext(access, scopedDb =>
found.tool.preview(scopedDb, input, ctx, this.servicesFor(found.tool)))`, guard throws (preview failure
must NOT block the card — fall back to no preview), include in emit. Unit tests: preview present in
emit; preview-throw → card still emits sans preview; **persisted `inputSummary` stays key-names-only**.

**T8. Notifier + live types** (`packages/chat/src/gateway-notifier.ts` + `live/types.ts`): thread
optional `preview` through `toTranscriptRecord` + `TranscriptRecord`. If a shared SSE schema gates the
chunk (`packages/shared`), extend it (optional field). Unit test: preview survives the hop.

**T9. Frontend card** (`apps/web/src/chat/use-chat-stream.ts` parse `preview`; `chat-drawer.tsx` pass
it; `action-request-card.tsx` render recipient chip / subject / scrollable body when `preview` present,
else current summary-only). Reuse authored `jds-*`/local primitives — no new raw CSS colors outside
`tokens.css`. Component/unit test for the email preview render.

**T10. Settings toggle** (`packages/email/src/settings/index.tsx`): NEW `Group`/`Row` + `Switch`
"Let Jarvis draft email replies without asking" backed by GENERIC action-policy route
(`GET /api/ai/action-policy` read `email/email_drafts`; `PATCH /api/ai/action-policy/email/email_drafts`
write), default OFF (`ask_each_time`). Optional display-only "always asks" row for `email.sendReply`.
Do NOT touch the existing briefing switches (createTasks/suggestReplies/draftReplies/autoSend). Test:
toggle maps ask_each_time↔trusted_auto.

**T11. Integration + gate.** Integration test: draftReply auto-executes when `email_drafts` promoted,
confirms when `ask_each_time`; `sendReply` always confirms regardless of tier; recipient server-derived;
body absent from persisted action row + audit. Confirm `foundation.test.ts` migration assertion
unchanged (no migration). Full gate at wrap-up.

## Acceptance → task map (§8)

1 tools exist → T5 · 2 preview card, body never persisted → T5/T7/T9 (+persistence assert T7/T11) ·
3 real Gmail draft/send, secret-free result → T1/T4 · 4 promote→auto / ask_each_time→confirm → T5/T10/T11 ·
5 sendReply always confirms (policy.ts unchanged) → T5/T11 · 6 server-derived recipient → T2/T4/T11 ·
7 failures secret-free → T4 · 8 unit+integration, migration assertion green → T1–T11.

## Invariants held

DataContextDb only · secrets never escape (Gmail tokens stay in connector; results secret-free) ·
metadata-only persistence (body rides stream only) · synchronous exec (no body in pg-boss) · destructive
floor structural (policy.ts untouched) · module isolation (email uses structural `narrowEmailWrite`;
impl in composition host) · no migration · no new AccessContext fields · private-by-default (family
default OFF).

## Out of scope (§11)

New-compose to arbitrary recipients · reply-all · edit-before-approve return channel · attachments/HTML/
signatures · briefing→proposal wiring · agency dashboard.
