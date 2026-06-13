# Phase 3 — Connector Sync Engine (Google Calendar + Gmail → read caches)

**Status:** Approved design — ready to build
**Date:** 2026-06-13
**Owner:** Ben
**GitHub:** Epic #48 (Phase 3 · Core Value), exit-criterion #1 ("Connector sync engine"); sync-scope
question #13.
**Grounded on:** `origin/main` @ `5759b90` (HEAD `a898533`, tree fresh per `git fetch`).
**Builds on:** `docs/superpowers/specs/2026-06-08-m-b1-google-connector-oauth.md` (the M-B1 connection
foundation — OAuth, encrypted credential bundle, refresh). M-B1 §9 named this slice and recorded the
RLS `provider_type` conflation as the carried constraint; this spec resolves it.

---

## Goal

Turn the existing, owner-only, auto-refreshing **Google Connection** (M-B1) into populated read
caches. After this slice, an on-demand sync reads the user's **primary Google Calendar** (a ±-window
of events) and **Gmail** (full message bodies, transiently), upserts them idempotently into
`app.calendar_events` and `app.email_messages`, and the previously-stubbed Calendar and Email web
pages render real data. Email rows carry an **LLM-derived summary + structured signals** (bills,
action items, deadlines, "may get lost in the shuffle"), produced by the user's own
capability-routed economy model — never the raw body — so the Email page is a triage surface, not an
inbox clone. This is the data foundation the "real briefings" criterion (epic #48 #2) grounds on.

Success = on the headless box, with Ben's connected Google account: `POST /api/connectors/google/sync`
(and sync-on-connect) populates both caches; `GET /api/calendar/events` and `GET /api/email/messages`
return real rows; the Calendar and Email pages render them; re-running sync is idempotent (no
duplicate rows); no raw email body is persisted anywhere (vault or relational); `pnpm
verify:foundation` + `pnpm audit:release-hardening` green.

---

## Architecture

The sync engine follows the codebase's established **route → metadata-only pg-boss job → DataContext
worker → repository** spine, the same shape M-A3 used for chat execution and briefings use for run
generation. A new `POST /api/connectors/google/sync` route (in the `connectors` module) enqueues a
single metadata-only job on a new `connectors.google-sync` queue via `sendJob` (allowlist-enforced);
the worker handler runs inside `withDataContext` so RLS scopes every read/write to the actor, decrypts
the Google OAuth bundle in-process, and drives a new outbound **Google API client** to fetch
calendar/email, then upserts through the calendar/email module repositories. Sync-on-connect reuses
the same `sendJob` call from `GoogleConnectionService.completeAuthorization`'s caller. The job payload
shape carries `actorUserId` + `kind` + `idempotencyKey` only, leaving a clean seam for the Phase-3
briefings-slice scheduler to enqueue the identical job on a cron without re-plumbing — **the seam is
noted, the cron is not built here**.

The work crosses three modules but honors **module isolation**: `connectors` owns the trigger
(route + job + Google client + the orchestration handler), and calls the public repository APIs of
`calendar` and `email` to write their own tables. It never touches another module's tables directly —
the `calendar`/`email` repositories gain production `upsert*` methods (today they only expose
`createCachedEventForTest`/`createCachedMessageForTest`). The orchestration handler lives in
`connectors` because it owns the Google credential and the cross-cache fan-out; the per-table write
logic lives in each owning module.

The single hard structural problem is **role + RLS reach**. The worker process runs as
`jarvis_worker_runtime` (`packages/db/src/urls.ts` builds the worker URL with that role), but the
calendar/email/connector tables today grant and policy-gate **only** `jarvis_app_runtime`
(`grep "TO jarvis" packages/{calendar,email,connectors}/sql/*.sql` → 29 app-runtime, 0 worker). So
the worker cannot today read `connector_accounts` (to decrypt the Google secret) nor write
`calendar_events`/`email_messages`. We resolve this exactly as M-A3 did for chat/AI
(`packages/chat/sql/0036_chat_worker_runtime_grants.sql`,
`packages/ai/sql/0037_ai_worker_read_grants.sql`): **additive** migrations that widen the role list on
grants and RLS policies while preserving the owner-scoped `USING`/`WITH CHECK` expressions verbatim.
The worker already has SELECT on `ai_provider_configs`/`ai_configured_models` (from 0037), so the
economy-model selection + credential decrypt for the email LLM pass already works in-worker — only the
connector + cache tables need widening.

The **LLM pass** is provider-agnostic by construction. The worker calls
`AiRepository.selectModelForCapability(scopedDb, "summarization", "economy")` (the exact call briefings
already make at `packages/briefings/src/repository.ts:309`), then
`selectProviderWithCredential` + decrypt + `HttpApiAdapter.generateChat`. No provider/model is
hardcoded; if the user has no economy/summarization model the ladder in `selectModelForCapability`
falls upward to interactive/reasoning, and if none exists the email sync degrades to
metadata-only rows (subject/sender/snippet, null summary) rather than failing.

---

## Components

### 1. Google API client — `packages/connectors/src/google-api-client.ts` (new)

- **What it does:** a reusable outbound HTTP client over the Google REST APIs, taking a fresh access
  token per call. Methods for this slice:
  - `listCalendarEvents({ accessToken, calendarId: "primary", timeMin, timeMax, singleEvents: true, pageToken? })`
    → Calendar v3 `events.list` (paginated). `singleEvents=true` expands recurring events into
    instances (locked decision); `orderBy=startTime` for stable paging.
  - `listMessageIds({ accessToken, query?, pageToken? })` → Gmail `users.messages.list` (returns
    `{ id, threadId }` stubs + `nextPageToken`).
  - `getMessage({ accessToken, id, format: "full" })` → Gmail `users.messages.get` (full payload incl.
    body parts and headers).
- **Designed for reuse:** the Phase-3 focus-time slice (epic #48 "Jarvis blocks own focus-time")
  reuses this client for `events.insert` + `freeBusy.query`; structure it so adding those is a method,
  not a rewrite. Keep it a plain class with an injectable `fetch` (mirror `GoogleOAuthClient` in
  `oauth.ts`, which takes `fetchFn?: typeof fetch` for test seams).
- **How used:** instantiated by the sync handler; never holds a credential itself — the caller passes
  `accessToken` obtained from `GoogleConnectionService.getFreshAccessToken`.
- **Depends on:** `globalThis.fetch` (injectable), nothing else. Like `oauth.ts` it uses a minimal
  injected `logger` and **never** embeds Google response bodies in thrown `Error.message`
  (`handleRouteError` propagates `Error.message` to HTTP responses — see the comment at
  `oauth.ts:122`). On non-2xx, log `{ statusCode }` server-side and throw `Google <api> returned
  <status>`. A 401 triggers one token-refresh-and-retry via `getFreshAccessToken` (which already
  refreshes on <60s-to-expiry; M-B1 §7 step 5).

### 2. Email-message body→signals normalizer + LLM pass — `packages/connectors/src/email-extract.ts` (new)

- **What it does:** two pure-ish steps.
  1. **Parse** a Gmail `format=full` message into headers (`Subject`, `From`, `To`/`Cc`, `Date`),
     `labelIds`, the API `snippet`, and a decoded plaintext body (walk MIME parts, base64url-decode
     `text/plain`, fall back to stripped `text/html`). Output a transient in-memory
     `ParsedEmail`.
  2. **Summarize + extract signals** by calling the capability router. Given the full body, produce:
     - `summary`: a concise natural-language summary string.
     - `signals`: a typed JSON object — `billsDue: [{ description, amount?, currency?, dueDate? }]`,
       `actionItems: [{ text, dueDate? }]`, `deadlines: [{ text, date? }]`,
       `mayGetLostInShuffle: boolean`, `importance: "low"|"normal"|"high"`,
       `confidence: number (0..1)`.
- **How used:** the sync handler calls it per message (or in a small batch loop). The prompt is built
  in-worker and sent through `HttpApiAdapter.generateChat`; we request a JSON-shaped reply and parse
  it defensively (on parse failure → null summary, empty signals, `confidence: 0`, never throw — a
  bad LLM reply must not fail the whole sync).
- **Optional escalation (locked):** if `importance === "high"` **and** `confidence < THRESHOLD`
  (default 0.5, env-tunable `JARVIS_EMAIL_ESCALATE_CONFIDENCE`), re-run the extraction once with a
  higher tier — `selectModelForCapability(scopedDb, "summarization", "interactive")` (and from there
  the ladder may reach reasoning). Bounded to one escalation per message; the escalated result
  replaces the economy result.
- **Depends on:** `@jarv1s/ai` (`AiRepository`, `HttpApiAdapter`, `createAiSecretCipher`,
  `selectModelForCapability`, `selectProviderWithCredential`). All AI access goes through `scopedDb`
  (DataContextDb) — never a root handle.

### 3. Sync job + worker handler — `packages/connectors/src/sync-jobs.ts` (new)

- **What it does:** defines the queue, the metadata-only payload, and the worker handler that
  orchestrates a full Google sync.
  - `GOOGLE_SYNC_QUEUE = "connectors.google-sync"`.
  - `GOOGLE_SYNC_QUEUE_DEFINITIONS: QueueDefinition[]` with `policy: "exclusive"` (dedupe a
    double-submit / sync-on-connect-plus-manual collision via a `singletonKey` of the actor id —
    mirror the briefings `exclusive` rationale at `packages/briefings/src/jobs.ts:36`),
    `retryLimit: 1`, bounded `deleteAfterSeconds`/`retentionSeconds`.
  - `GoogleSyncPayload extends ActorScopedJobPayload` = `{ actorUserId, kind: "google-sync",
    idempotencyKey? }`. **All keys are already in `ALLOWED_PAYLOAD_KEYS`** (`actorUserId`, `kind`,
    `idempotencyKey` — see `packages/jobs/src/pg-boss.ts:45`), so `sendJob` accepts it with **no
    allowlist change required**. (Confirm at build; if a key is added, extend the allowlist + its
    test.)
  - `registerConnectorsJobWorkers(boss, dataContext, deps)` registers the handler via
    `registerDataContextWorker<GoogleSyncPayload, GoogleSyncResult>` so the actor id from the payload
    becomes the RLS principal (`toAccessContext` in `pg-boss.ts:204`).
- **Handler flow (inside `withDataContext`):** decrypt Google credential → `getFreshAccessToken` →
  sync calendar (component 5) → sync email (component 6) → return a metadata-only
  `GoogleSyncResult { calendarUpserted, emailUpserted, errors }`. A failure in one cache is logged
  structured and recorded in `errors` but does not abort the other (partial success is better than
  none for a daily-driver).
- **Depends on:** `@jarv1s/jobs`, `@jarv1s/connectors` (GoogleConnectionService, crypto, repository,
  google-api-client, email-extract), `@jarv1s/calendar`, `@jarv1s/email`, `@jarv1s/ai`.

### 4. Sync route + sync-on-connect — `packages/connectors/src/routes.ts` (extend)

- **What it does:** adds `POST /api/connectors/google/sync` (permission `connectors.manage`). It
  resolves `AccessContext`, then calls `sendJob(boss, GOOGLE_SYNC_QUEUE, { actorUserId, kind:
  "google-sync", idempotencyKey })` and returns `202 { enqueued: true, jobId }`. The route needs
  `boss: PgBoss` in `ConnectorsRoutesDependencies` (today it has none — add it; the
  module-registry already passes `deps.boss`, e.g. chat at `module-registry/src/index.ts:156`).
- **Sync-on-connect:** after `completeAuthorization` succeeds in the `/complete` route handler, enqueue
  the same job (best-effort: a send failure logs but does not fail the connect response — the user can
  retry sync manually). This is a route-layer call, keeping `GoogleConnectionService` free of a boss
  dependency.
- **Scheduler seam (note only):** the briefings-slice scheduler will enqueue the identical
  `GOOGLE_SYNC_QUEUE` job per user on a cron. Because the payload is metadata-only and the handler is
  idempotent, **no code here needs to change** for that — document it; do not build cron.

### 5. Calendar upsert — `packages/calendar/src/repository.ts` (extend) + worker grants migration

- **What it does:** add `upsertCachedEvent(scopedDb, input)` — an idempotent upsert keyed on the
  existing `UNIQUE(connector_account_id, external_id)` (`packages/calendar/sql/0011_calendar_module.sql:17`).
  Use Kysely `onConflict((oc) => oc.columns(["connector_account_id","external_id"]).doUpdateSet(...))`,
  updating `title, starts_at, ends_at, location, summary, external_metadata, updated_at` (never
  `owner_user_id`/`connector_account_id`/`external_id` — the identity-change trigger at
  `0011:27` forbids it). Map a Google event: `external_id = event.id`, `title = event.summary`
  (Google's "summary" is the title), `starts_at`/`ends_at` from `start`/`end`
  (`dateTime` or all-day `date`), `location`, our `summary` column from `event.description`
  (truncated), `external_metadata` = a small whitelisted subset (`status`, `htmlLink`, `attendees`
  count) — never the full Google payload.
- **How used:** called per event by the sync handler.
- **Depends on:** a new migration `packages/calendar/sql/0065_calendar_worker_grants_and_google_insert.sql`
  (see Data flow → migrations). Mirror `0036`/`0037` exactly.

### 6. Email upsert + new summary/signals columns — `packages/email/src/repository.ts` (extend) + migrations

- **What it does:**
  - **Schema:** add nullable `summary text` and `signals jsonb NOT NULL DEFAULT '{}'::jsonb CHECK
    (jsonb_typeof(signals) = 'object')` to `app.email_messages` via a new additive migration. The
    existing `snippet`, `body_excerpt` columns stay; **`body_excerpt` is optional and short** (a
    snippet-length excerpt only — never the full body). The full body is **never** a column.
  - `upsertCachedMessage(scopedDb, input)` — idempotent upsert on
    `UNIQUE(connector_account_id, external_id)` (`packages/email/sql/0012_email_module.sql:17`).
    Stores: `sender, recipients, subject, snippet, received_at, labels` (into `external_metadata`),
    `summary`, `signals`, optional short `body_excerpt`. Identity-change trigger (`0012:26`) forbids
    mutating owner/connector/external_id.
- **How used:** the sync handler calls it after the email-extract LLM pass produces summary+signals.
- **Depends on:** new migrations:
  `packages/email/sql/0066_email_summary_signals_columns.sql` (add columns + index on
  `(owner_user_id, received_at desc)` already exists) and
  `packages/email/sql/0067_email_worker_grants_and_google_insert.sql` (worker role + RLS relax).
  The DTO (`packages/shared/src/email-api.ts`) and serializer
  (`packages/email/src/routes.ts:serializeEmailMessage`) gain `summary` + `signals`.

### 7. RLS `provider_type` relaxation — calendar + email insert-policy migrations (the M-B1 carried blocker)

- **What it does:** today the calendar/email INSERT `WITH CHECK` requires the connector account's
  `definitions.provider_type = 'calendar'` / `'email'` (`0011:92`, `0012:92`,
  `0020:37`, `0021:37`). The only authenticating account is `provider_type='google'`
  (`packages/connectors/sql/0044_google_unified_connection.sql:10`). So inserts keyed to the Google
  connection **fail the EXISTS check** — the blocker documented 3× in M-B1 (spec §9, ADR 0006,
  memory). **Resolve additively:** new migrations relax the INSERT `WITH CHECK` EXISTS subquery to
  accept `definitions.provider_type IN ('calendar','email','google')`, with a scope guard for the
  `'google'` row (require the Google scope present: calendar requires
  `'https://www.googleapis.com/auth/calendar' = ANY(accounts.scopes)`; email requires
  `'https://www.googleapis.com/auth/gmail.modify' = ANY(accounts.scopes)`). Owner-equality and the
  `owner_user_id = current_actor_user_id()` checks are preserved verbatim. This lives in the
  **worker-grants** migrations (5 & 6) so the role-widen and the provider relax land together (they
  are the same `CREATE POLICY` statements). **This edits RLS on personal-data tables → triggers the
  independent security-review reflex at build (see Security & invariants).**

### 8. Web — Calendar + Email pages — `apps/web/src/calendar/calendar-page.tsx`,
   `apps/web/src/email/email-page.tsx` (rebuild)

- **What it does:** replace the `ComingSoon` stubs with real React-Query pages.
  - **Calendar:** `useQuery({ queryKey: queryKeys.calendar.list, queryFn: listCalendarEvents })`
    (both the query key and the `listCalendarEvents` fetcher already exist —
    `query-keys.ts:27`, `client.ts:232`). Render events grouped by day, showing title, time, location.
  - **Email:** `useQuery({ queryKey: queryKeys.email.list, queryFn: listEmailMessages })`
    (`query-keys.ts:36`, `client.ts:240`). Render each message as a **triage card**: sender, subject,
    received time, and the **summary + signals** (bills due with amounts/dates, action items,
    deadlines, a "may get lost" flag) — **never raw body**. Add a "Sync now" button that POSTs the new
    sync route (add a `syncGoogleConnector()` fetcher to `client.ts`) and invalidates the list query.
  - Mirror the existing data-page pattern (`notifications-page.tsx`: `useQuery`, loading/empty/error
    states, `useMutation` + `invalidateQueries`).
- **Depends on:** new `summary`/`signals` fields on `EmailMessageDto`; the new sync fetcher. e2e mocks
  the REST as `tests/e2e/mock-*.ts` already do.

### 9. Worker wiring — `apps/worker` + `packages/module-registry`

- **What it does:**
  - `apps/worker/package.json`: add deps `@jarv1s/connectors`, `@jarv1s/calendar`, `@jarv1s/email`,
    `@jarv1s/ai` (the worker registers their workers transitively via module-registry, which already
    imports all of these — so the dep is for the registry's `registerConnectorsJobWorkers` call).
  - `packages/module-registry/src/index.ts`: give the `connectors` registration a
    `queueDefinitions: GOOGLE_SYNC_QUEUE_DEFINITIONS` and a `registerWorkers` that calls
    `registerConnectorsJobWorkers(boss, deps.dataContext, { … })`. The route registration for
    connectors must now receive `boss` (add `boss: deps.boss` to its `registerRoutes`, like chat).
  - **Secret material in-worker:** the worker process must have `JARVIS_CONNECTOR_SECRET_KEY` (decrypt
    the Google OAuth bundle via `createConnectorSecretCipher`) **and** `JARVIS_AI_SECRET_KEY` (decrypt
    the AI provider credential via `createAiSecretCipher`) in its environment. Document this in
    `docs/operations/dev-environment.md` and the compose/worker env. The ciphers are constructed from
    `process.env` exactly as today (`crypto.ts` `createConnectorSecretCipher` /
    `createAiSecretCipher`).
- **Depends on:** the new queue must exist before the worker starts — `pnpm db:migrate` calls
  `migratePgBoss` over `getAllQueueDefinitions()`, and the worker's startup guard
  (`apps/worker/src/worker.ts:61`) fails fast if a queue is missing. Adding `queueDefinitions` to the
  registration makes the queue part of `getAllQueueDefinitions()` automatically.

---

## Data flow

**Trigger (manual):** Web "Sync now" → `POST /api/connectors/google/sync` → route resolves
`AccessContext` → `sendJob(boss, "connectors.google-sync", { actorUserId, kind:"google-sync",
idempotencyKey })` (allowlist-checked) → `202`. **Trigger (on-connect):** `/complete` success →
same `sendJob`. **Trigger (future cron, not built):** scheduler → same `sendJob` per user.

**Worker:** pg-boss invokes the handler → `registerDataContextWorker` builds
`AccessContext { actorUserId, requestId: "pgboss:<jobId>" }` → `withDataContext` opens a transaction
and `set_config('app.actor_user_id', actorUserId, true)` (`data-context.ts:49`), so every query runs
under the actor's RLS.

1. **Credential:** `connectorsRepository.getActiveGoogleAccountSecret(scopedDb)` (SELECT on
   `connector_accounts` — needs the new worker SELECT grant) → `connectorSecretCipher.decryptJson` →
   `GoogleConnectionService.getFreshAccessToken(scopedDb)` (refreshes + re-encrypts via UPDATE — needs
   worker UPDATE grant on `connector_accounts`).
2. **Calendar:** `googleApiClient.listCalendarEvents({ calendarId:"primary", singleEvents:true,
   timeMin: now-7d, timeMax: now+30d })`, paging until no `nextPageToken` → for each event,
   `calendarRepository.upsertCachedEvent(scopedDb, …)` (INSERT/UPDATE on `calendar_events` under the
   relaxed `provider_type IN (...,'google')` policy; needs worker grant + policy).
3. **Email:** `googleApiClient.listMessageIds({ query: "newer_than:30d" })` (window-bounded; tunable)
   → for each id, `getMessage(format:"full")` → `parseEmail` → economy LLM pass
   (`selectModelForCapability("summarization","economy")` → `selectProviderWithCredential` →
   decrypt AI cred → `HttpApiAdapter.generateChat`) → optional one escalation →
   `emailRepository.upsertCachedMessage(scopedDb, { …, summary, signals })`. The **full body is held
   only in the handler's local variable for the duration of the LLM call and then discarded** — it is
   never written to the vault (no `VaultContext` call) and never to a relational column.
4. **Result:** metadata-only `GoogleSyncResult` returned to pg-boss (counts + error labels only).

**Read:** Web → `GET /api/calendar/events` / `GET /api/email/messages` → `repository.listVisible`
(owner-or-share SELECT, app-runtime) → serialized DTOs → React-Query render.

**Migrations (additive, never edit applied files; module SQL in the owning module's `sql/`).** Next
free global number is **0065** (highest applied is `0064_*`):
- `packages/calendar/sql/0065_calendar_worker_grants_and_google_insert.sql` — `GRANT SELECT, INSERT,
  UPDATE ON app.calendar_events TO jarvis_worker_runtime`; recreate `calendar_events_insert/select/
  update` policies adding `jarvis_worker_runtime` to the role list and relaxing the INSERT EXISTS to
  `provider_type IN ('calendar','google')` + calendar-scope guard for the `'google'` case. Preserve
  owner-or-share `USING`/`WITH CHECK` from `0020` verbatim.
- `packages/email/sql/0066_email_summary_signals_columns.sql` — `ALTER TABLE app.email_messages ADD
  COLUMN summary text`, `ADD COLUMN signals jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(
  signals)='object')`.
- `packages/email/sql/0067_email_worker_grants_and_google_insert.sql` — worker grants + policy relax
  mirroring 0065, INSERT EXISTS → `provider_type IN ('email','google')` + gmail-scope guard.
- The connectors module needs **worker SELECT/UPDATE on `connector_accounts` + SELECT on
  `connector_definitions`**: `packages/connectors/sql/0068_connector_worker_runtime_grants.sql` —
  `GRANT SELECT ON app.connector_definitions TO jarvis_worker_runtime`; `GRANT SELECT, UPDATE ON
  app.connector_accounts TO jarvis_worker_runtime`; recreate `connector_accounts_select/update` and
  `connector_definitions_select` adding `jarvis_worker_runtime`, owner-scoped expressions preserved
  from `0022`. (Confirm exact next numbers at build time with
  `find . -name '[0-9][0-9][0-9][0-9]_*.sql'` — numbers are global by landing order; another slice may
  land first.)

Each module also adds the new migration filename to its manifest `database.migrations` array (the
manifests list files explicitly — e.g. `calendar/src/manifest.ts:31`).

---

## Error handling

- **No active Google connection:** `getActiveGoogleAccountSecret` returns undefined →
  `GoogleConnectError`/handled job error; the route still enqueues (the user may connect then sync),
  but the handler exits cleanly with a `GoogleSyncResult` carrying an `errors: ["no-active-connection"]`
  label. Never throw raw.
- **Token refresh failure (401 / refresh rejected):** `getFreshAccessToken` throws; on a 401 from an
  API call, retry once after a forced refresh, then mark the connector account `status='error'` (via
  the existing `updateAccount` path so it surfaces for re-connect, per M-B1 §7 step 5) and record
  `errors: ["auth-error"]`.
- **Google API non-2xx / network:** the client throws `Google <api> returned <status>` with **no
  response body** in the message (the `oauth.ts:122` rule — `handleRouteError` echoes `Error.message`).
  Server-side log carries `{ statusCode }` only. Calendar and email sync are independent: one failing
  does not abort the other.
- **LLM pass failure (provider down, non-JSON reply, no model):** caught per message → store the row
  with `summary: null`, `signals: {}`, `confidence: 0`; never fail the whole sync. If
  `selectModelForCapability` returns undefined, skip the LLM pass entirely and store metadata-only
  rows (graceful degrade — the page still populates).
- **Idempotency / double submit:** the `exclusive` queue policy + actor `singletonKey` collapses a
  manual sync racing sync-on-connect into one job; upserts are keyed on
  `UNIQUE(connector_account_id, external_id)` so even a duplicate job produces no duplicate rows.
- **pg-boss internal errors:** unchanged — the worker's existing handlers (`worker.ts`) log and
  survive transient boss errors; genuine handler throws are retried once (`retryLimit:1`) then dead.
- **Partial pages / pagination:** bound total fetched per sync (e.g. cap calendar at the window, email
  at N most-recent in the window) so one run can't unboundedly fan out LLM calls; record a
  `truncated: true` signal if the cap is hit.

---

## Security & invariants

Citing the CLAUDE.md **Hard Invariants**:

- **Secrets never escape.** The Google OAuth bundle and AI provider credential are decrypted **only**
  in-worker, held in locals, and never logged, never put in the pg-boss payload, never returned in the
  `GoogleSyncResult`, never sent to the frontend. The Google client and HttpApiAdapter follow the
  established "never embed key/secret/response-body in `Error.message`" rule (`oauth.ts:122`,
  `http-api.ts:53`). Connector + AI secrets remain AES-256-GCM at rest (`crypto.ts`).
- **Metadata-only job payloads.** `GoogleSyncPayload` = `{ actorUserId, kind, idempotencyKey? }` — all
  already in `ALLOWED_PAYLOAD_KEYS` (`pg-boss.ts:45`); `sendJob` enforces it. No email content, no
  prompt, no body, no token in any payload.
- **DataContextDb only.** Every DB touch (credential read, calendar/email upsert, AI model select) is
  through the branded `scopedDb` from `withDataContext`; repositories call `assertDataContextDb`. No
  root Kysely handle reaches a repository. No raw `fs` — the full email body never goes to the vault
  (no `VaultContext` write at all; it is held in memory and discarded).
- **AccessContext shape.** Worker builds `{ actorUserId, requestId }` only (`pg-boss.ts:213`); no
  fields added.
- **No admin private-data bypass / private by default.** All new RLS policies preserve owner-equality;
  no `BYPASSRLS`; the worker role is subject to RLS exactly like app-runtime. Calendar/email stay
  owner-or-share; connector accounts stay owner-only.
- **Provider-agnostic AI.** The email LLM pass requests the **`summarization` capability at the
  `economy` tier** and lets the router pick the user's configured model (`selectModelForCapability`,
  the same call briefings make). No provider/model string is hardcoded anywhere in this slice. The
  escalation requests a higher tier, still capability-routed.
- **Module isolation.** `connectors` writes calendar/email tables **only** through their public
  repository `upsert*` methods, never by direct SQL on another module's tables. The cross-module
  orchestration is justified: `connectors` owns the credential + Google fan-out; each table's write
  logic lives in its owning module.
- **Never edit applied migrations; module SQL in the owning module's `sql/`.** All schema/RLS changes
  are **new** files (0065–0068) in the **owning** module's `sql/` dir. The calendar/email INSERT-policy
  relax and the worker grants are additive `CREATE POLICY`/`GRANT` recreations preserving prior
  owner-scoped expressions verbatim — exactly the `0036`/`0037` precedent.
- **pgvector image / no provider hardcode in compose:** unaffected; only worker env vars are added.

> **Independent security-review reflex (build-time gate):** migrations 0065/0067/0068 **edit RLS on
> personal-data tables** (`calendar_events`, `email_messages`, `connector_accounts`). Per project
> memory ("CI-green ≠ secure — independent review for auth/crypto/RLS PRs"), the PR for this slice
> MUST get an independent security review of the policy diffs before merge: confirm the relaxed INSERT
> `WITH CHECK` still pins `owner_user_id = current_actor_user_id()`, that the `'google'` branch is
> scope-gated, and that adding `jarvis_worker_runtime` to SELECT/INSERT/UPDATE does not widen read
> beyond the owner. The privacy posture of full bodies transiting the user's own configured economy
> model (their CLI subscription or API key) is **acceptable under the house model** — the user's data
> goes only to the user's own configured provider — but state it explicitly in the PR and the
> Settings/Email UI copy.

**Privacy posture (documented decision):** full email bodies are fetched (Gmail `format=full`) and
passed to the user's **own** capability-routed economy model for summarization + signal extraction.
This is the user sending their own mail to their own configured AI provider — no third party, no
Jarv1s-operated model. The body is never persisted (vault or relational); only the model-derived
summary + structured signals (and an optional short excerpt) are stored. This is the deliberate
trade Ben chose to make email a triage surface.

---

## Testing strategy

All DB tests run via Vitest against the `pnpm db:up` Postgres, RLS-on (per CLAUDE.md). External Google
+ AI HTTP calls are faked at the `fetch` boundary (injected `fetchFn`), never live in CI (the M-B1
precedent — spec §11).

- **Google API client (`tests/integration/connectors.test.ts` or a new `google-sync.test.ts`):**
  inject a fake `fetch`; assert request shapes (calendar `singleEvents=true`, `timeMin/timeMax`
  window, `events.list` paging follows `nextPageToken`; gmail `messages.list` then `messages.get
  format=full`); assert 401→refresh→retry; assert non-2xx throws without leaking the response body in
  `Error.message`.
- **Email extract:** unit-test the MIME parser (plaintext, html-fallback, base64url); test the LLM
  pass with a fake adapter returning (a) valid JSON, (b) garbage (→ null summary, empty signals,
  confidence 0, no throw), (c) high-importance/low-confidence → one escalation to the next tier.
- **Calendar upsert idempotency:** insert an event, re-run with the same `external_id` → one row,
  fields updated; identity-change attempt rejected by the trigger.
- **Email upsert idempotency + columns:** same; assert `summary`/`signals` persist and round-trip
  through the DTO; assert **no full body** column exists / is written.
- **RLS — the M-B1 blocker resolution:** with a `provider_type='google'` connector account holding the
  calendar scope, an INSERT into `calendar_events` keyed to it **succeeds** (previously failed); with
  the gmail scope, an email INSERT succeeds; **without** the relevant scope, INSERT is **rejected**
  (the scope guard works). Cross-user INSERT (another owner's account id) rejected. Worker role
  (`jarvis_worker_runtime`) can SELECT `connector_accounts` and INSERT/UPDATE the caches under the
  actor; cannot see another user's rows.
- **Job/worker:** `sendJob` accepts `GoogleSyncPayload` (allowlist) and rejects a payload with a body
  field; `registerDataContextWorker` builds the right AccessContext; the handler partial-fails one
  cache without aborting the other.
- **Web:** Playwright e2e with mocked REST — Calendar page renders events; Email page renders
  summary + signals and **never** shows a raw body; "Sync now" posts the route and refetches.
- **Gate:** `pnpm verify:foundation` (lint, format, file-size <1000 lines, typecheck, db:migrate,
  integration) + `pnpm audit:release-hardening` green. New module test scripts wired into the gate if
  a new suite file is added.
- **Live round-trip (manual, headless box, like issue #12):** connect Ben's Google → sync → verify
  both pages populate with real data → re-sync → no dupes → confirm no body persisted (grep the row).

---

## Acceptance criteria

1. `POST /api/connectors/google/sync` exists (permission `connectors.manage`), enqueues exactly one
   metadata-only job on `connectors.google-sync` via `sendJob`, and returns `202` with a job id; the
   payload contains only `actorUserId`, `kind`, `idempotencyKey`.
2. Sync-on-connect: a successful `/api/connectors/google/complete` enqueues the same sync job
   (best-effort; a send failure does not fail the connect response).
3. The worker (`jarvis_worker_runtime`) decrypts the Google OAuth bundle in-process, refreshes the
   token when needed, and makes authenticated Calendar + Gmail calls — proven by an integration test
   with a faked `fetch`.
4. Calendar sync reads the **primary** calendar with `singleEvents=true` over **timeMin = now−7d,
   timeMax = now+30d**, pages fully, and upserts idempotently on
   `UNIQUE(connector_account_id, external_id)`; re-running sync produces no duplicate rows and updates
   changed events.
5. Email sync fetches **full** messages (`format=full`), runs an **economy-tier, capability-routed**
   (`summarization`) LLM pass producing a `summary` and a structured `signals` object (bills due with
   amount/due-date when present, action items, deadlines, may-get-lost flag, importance, confidence),
   and upserts idempotently. High-importance + low-confidence items trigger exactly one escalation to
   a higher tier.
6. **No raw full email body is persisted** anywhere — not in the vault, not in any relational column.
   Only subject, sender, recipients, received_at, labels, snippet, summary, signals, and an optional
   short `body_excerpt` are stored. A test asserts the absence of a body column and that the handler
   discards the body.
7. The M-B1 RLS blocker is resolved by **additive** migrations: a `provider_type='google'` connector
   account with the matching scope can INSERT into `calendar_events`/`email_messages`; missing scope or
   wrong owner is rejected. No applied migration is edited; all new SQL lives in the owning module's
   `sql/` dir.
8. The worker role has the minimum new grants (SELECT/UPDATE on `connector_accounts`, SELECT on
   `connector_definitions`, SELECT/INSERT/UPDATE on the two caches) and is added to the relevant RLS
   policies with owner-scoped expressions preserved; no `BYPASSRLS`; cross-user access is impossible.
9. `apps/worker` depends on `@jarv1s/connectors`/`@jarv1s/calendar`/`@jarv1s/email`/`@jarv1s/ai`, the
   `connectors` module registration declares `GOOGLE_SYNC_QUEUE_DEFINITIONS` + `registerWorkers`, the
   queue is created by `pnpm db:migrate`, and the worker startup queue-guard passes. The worker env
   provides `JARVIS_CONNECTOR_SECRET_KEY` and `JARVIS_AI_SECRET_KEY` (documented).
10. The Calendar page renders real events (grouped by day); the Email page renders the **summary +
    signals** triage view (no raw bodies) with a working "Sync now" control; both use the existing
    `queryKeys.calendar.list`/`queryKeys.email.list` + fetchers; e2e covers both with mocked REST.
11. `EmailMessageDto` + the email serializer expose `summary` and `signals`; calendar DTO unchanged.
12. `pnpm verify:foundation` and `pnpm audit:release-hardening` are green; the slice's PR carries an
    independent security review of the RLS policy diffs and a stated full-body privacy posture.
13. The job is shaped so the future briefings-slice scheduler can enqueue the **identical**
    `connectors.google-sync` job with no code change here; the seam is documented and **no cron is
    built** in this slice.

---

## Out of scope / deferred

- **Cron/scheduler.** Built in the Phase-3 briefings slice; this slice only leaves the metadata-only,
  idempotent job seam.
- **Calendar write / focus-time.** `events.insert` + `freeBusy` are the next Phase-3 slice (epic #48
  "Jarvis blocks own focus-time"); the Google client is structured for that reuse but the methods are
  not added here.
- **Email send/draft/label write.** `gmail.modify` scope is held (M-B1) but write actions are a later
  slice.
- **Attachments.** Issue #13's "attachments handling" — not synced; not stored. (Recorded as resolved-
  out for this slice.)
- **Full-text search over the caches.** Issue #13's FTS — deferred; the caches are list/triage
  surfaces, and memory/embeddings already cover semantic recall elsewhere.
- **Incremental/delta sync** (Gmail `historyId`, Calendar `syncToken`). Issue #13's incremental sync —
  deferred; this slice does a **bounded-window full re-sync** that is idempotent via upsert. Delta is a
  performance optimization for a later slice and the upsert keying makes it a drop-in later.
- **Secondary calendars / multiple Google accounts per user.** Primary calendar, single connection
  only (matches the M-B1 unified-connection model).
- **Briefing grounding on the new caches.** That is epic #48 criterion #2 (a separate slice); this
  slice only makes the data exist.
- **Non-Google providers (Outlook/M365).** M-B1 non-goal; unchanged.

---

## Open risks

1. **Economy-tier extraction quality.** Bills/amounts/dates from arbitrary mail bodies via a cheap
   model may be noisy. Mitigation: the escalation path + `confidence` field; the UI shows confidence;
   acceptance only requires the pipeline + shape, not perfect recall. Tune the prompt against Ben's
   real inbox in the live round-trip.
2. **LLM fan-out cost/latency.** One (or two, on escalation) model calls **per email** can be slow and
   costly on a large inbox. Mitigation: window-bound (`newer_than:30d`) + a per-sync message cap +
   `exclusive` queue; consider batching multiple messages per LLM call as a follow-up if needed.
3. **RLS relax correctness.** Widening the INSERT `WITH CHECK` to include `'google'` is the highest-
   risk change. Mitigation: scope-gated branch, owner-equality preserved verbatim, explicit
   negative tests (missing scope / wrong owner rejected), and the mandatory independent security
   review. Adversarial second opinion (`/codex-review` or a Claude critic) recommended on the policy
   diffs.
4. **Worker secret-env drift.** If `JARVIS_CONNECTOR_SECRET_KEY` / `JARVIS_AI_SECRET_KEY` differ
   between API and worker, decryption fails silently-ish (cipher throws). Mitigation: document in
   dev-environment.md + compose; the cipher's decrypt error is caught and surfaced as a sync error
   label, not a crash.
5. **Migration-number collision with a concurrent slice.** Numbers are global by landing order;
   another Phase-3 slice may take 0065+ first. Mitigation: re-derive the next free number at build
   time and coordinate via `herdr-pane-message` before staging SQL.
6. **Gmail `format=full` body size.** Very large bodies could blow prompt limits. Mitigation: truncate
   the decoded body to a bounded length before the LLM call (a documented cap), recording
   `truncated` in signals.
7. **~7-day testing-mode refresh-token expiry** (carried from M-B1 open question #1). If the refresh
   token expires, sync flips the account to `status='error'`; the user re-connects. Re-confirm during
   the live round-trip; fallback is "publish app to production-unverified."
