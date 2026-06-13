# Phase 3: Real Briefings — Scheduled, LLM-Synthesized, Grounded

**Status:** Draft (awaiting review)
**Date:** 2026-06-13
**Owner:** Ben
**GitHub:** Epic issue #48 (Phase 3), criterion #2 — "Real briefings"
**Grounded on:** local `main` at the start of this session (run `pnpm audit:preflight` before building).
**Supersedes/extends:** `docs/superpowers/specs/2026-06-07-m-a4-vault-grounded-briefings-design.md`
(see "Relationship to the M-A4 spec" below).

---

## Relationship to the M-A4 spec (read this first)

The 2026-06-07 M-A4 spec ("Vault-grounded Daily Briefings") **predates epic #48** and the current
roadmap. It established the right backbone — native per-definition pg-boss cron, isolation-by-construction
scheduling, AI synthesis at a capability tier, hybrid vault retrieval, graceful degradation — and most of
its reasoning still holds. **This spec supersedes and extends it.** Concretely, this spec:

- **Adds two sources the M-A4 spec omits:** the **day's chats** (a new read-tool seam) and a richer
  **EMAIL SUMMARIES + SIGNALS** section (bills due / past-due / action items from the connector-sync slice).
- **Specifies `handleExtractFactsJob`** (the literal NO-OP stub in `packages/chat/src/jobs.ts` ~line 104),
  which the M-A4 spec does not mention at all. Durable chat facts feed future briefings.
- **Pins the synthesis transport to the HTTP `generateChat` path** (`HttpApiAdapter`, the only
  `generateChat` implementation that accepts a decrypted credential), where the M-A4 spec left transport
  ambiguous between CLI/tmux and api_key. Rationale below in "Transport decision".
- **Fixes the grounding order and budget** as a locked, fixed-priority section list with per-source caps.
- **Adds the morning-briefing notification** on scheduled completion.

Where this spec is silent, the M-A4 spec's reasoning (esp. the prior-art research and the isolation
argument) remains the reference. Where they conflict, **this spec wins.**

---

## Goal

Turn the briefings module from a deterministic string-concatenation summary into a **real morning
ritual**: a daily, per-user, timezone-correct briefing that is **LLM-synthesized** (provider-agnostic,
economy tier) and **grounded** in the user's commitments, tasks, today's calendar, email signals, vault
notes, and the day's chats — fired automatically by **native per-definition pg-boss cron**, with a
"Your morning briefing is ready" notification on scheduled completion, and a **deterministic degraded
fallback** whenever synthesis or a source is unavailable. The existing manual "run now" path is preserved
unchanged in shape. Also: implement the NO-OP `handleExtractFactsJob` so the day's chats leave durable
facts behind for future briefings.

This is epic #48 criterion #2 ("Real briefings"). Exit feeling: _a useful morning briefing grounded in my
real life, in my inbox, in my own words._

---

## Architecture

Today, `BriefingsRepository.generateRun` (`packages/briefings/src/repository.ts`) calls a private
`generateSummary` that runs each definition's selected read tools through the manifest's
`assistantTools[].execute` seam, formats their results with `formatToolSummary` into a fixed text blob
(`summary.join("\n")`), and persists that as `summary_text`. `selectModelForCapability(scopedDb,
"summarization", "economy")` is already called (line ~309) but its result is **only recorded as metadata**
(`source_metadata.aiModel`) — **no model is ever invoked**. This spec makes that resolved model do real
work and reorders the inputs into a deliberate grounding pipeline.

The new pipeline keeps the exact same trigger/worker/persistence skeleton (so the manual and scheduled
paths share one code path) and replaces the body of summary generation. A scheduled run and a manual run
differ only in `run_kind` (`"scheduled"` vs `"manual"`, both already valid enums in
`packages/db/src/types.ts:135` and `packages/shared/src/briefings-api.ts:4`) and in their trigger
(pg-boss cron vs the `POST /:id/run` route). Both land on `BRIEFINGS_RUN_QUEUE`, both execute in
`registerDataContextWorker` → `withDataContext(owner)` (RLS-scoped), both call `generateRun`. The worker
payload stays metadata-only: `{actorUserId, definitionId, briefingRunId, runKind, idempotencyKey?}` — all
keys already in `BRIEFING_RUN_PAYLOAD_KEYS` (`packages/briefings/src/jobs.ts:55`) and
`ALLOWED_PAYLOAD_KEYS` (`packages/jobs/src/pg-boss.ts:45`).

Inside `generateRun`, summary generation becomes a **compose pipeline** (extracted to a new
`packages/briefings/src/compose.ts` to keep `repository.ts` under the 1000-line limit): gather the
fixed-priority sections under per-source caps, build a single bounded prompt, request the user's configured
`summarization`/economy model via the existing capability router, synthesize a narrative through the
**HTTP `generateChat` adapter** (decrypting the provider credential in-worker), and persist the narrative
to `summary_text` with raw items / provenance / counts / gaps in `source_metadata` (a `jsonb` column,
serialized today by `serializeRun` in `routes.ts:387`). On any synthesis failure, a **deterministic
narrative-shaped fallback** (close to today's concat output, marked `degraded`) is persisted instead, so an
unattended job always produces something useful.

Scheduling is **native per-definition pg-boss cron**, exactly as the M-A4 spec argued: flip
`createPgBossClient`'s `schedule: false` → `true` (the one shared-foundation change, called out below), and
drive `boss.schedule` / `boss.unschedule` from actor-scoped definition create/update/delete. There is **no
cross-user "what's due" read** anywhere — each schedule is written in its owner's request context, each
fired job is already actor-scoped, and execution is RLS-scoped. This deliberately avoids the documented
multi-user leak surface that the M-A4 prior-art research found in Hermes/OpenClaw.

---

## Components

Each component lists: what it does · how it is used · what it depends on.

### 1. `createPgBossClient` — enable the cron engine (SHARED-FOUNDATION change)

- **What:** In `packages/jobs/src/pg-boss.ts:115`, change the constructor option `schedule: false` →
  `schedule: true` so pg-boss evaluates `pgboss.schedule` rows and emits jobs on their cron/timezone.
- **How used:** Both the API process and the worker process construct a boss via `createPgBossClient`
  (`apps/api/src/server.ts`, `apps/worker/src/worker.ts:46`). The **worker** must run the cron engine (it
  is the long-lived process that should fire scheduled jobs). The API process also constructs a boss for
  `sendJob`; running the cron engine in both is harmless because pg-boss's scheduler is itself DB-row
  driven and idempotent per schedule tick, but to keep the blast radius minimal we make `schedule`
  **overridable per call site** and turn it on **only where required** (see "Minimal/safe" below).
- **Depends on:** pg-boss `^12.18.2` (pinned in `packages/jobs/package.json`), whose `pgboss.schedule`
  table is `PRIMARY KEY (name, key)` (many schedules per queue) and whose `ScheduleOptions` carries `tz`
  and `key` — verified in the M-A4 spec's research pass.

**Minimal/safe call-out (this is a foundation change — treat it carefully):**

- Add an explicit `schedule?: boolean` knob to `createPgBossClient` (default stays `false`) **or** pass
  `{ schedule: true }` via the existing `overrides` argument at the worker call site only. Prefer the
  latter — it is a one-line change at `apps/worker/src/worker.ts` (`createPgBossClient(connectionString,
  { schedule: true })`) and leaves the API boss unchanged, so the cron engine runs in exactly one process.
- Do **not** also enable `supervise`/`migrate`/`createSchema` (they remain `false`; migrations are owned by
  `pnpm db:migrate` → `migratePgBoss`). The change is scoped to the scheduler only.
- The `error`-event handler that must never rethrow (`defaultOnPgBossError`, `pg-boss.ts:97`) already
  guards the maintenance connection; the cron engine reuses it. No change there.
- pg-boss persists schedules in its own schema, so schedules **survive restarts** with no extra work.

### 2. `packages/briefings/src/schedule.ts` — per-user schedule reconcile (new)

- **What:** A small module that maps a `BriefingDefinition` to a cron schedule and reconciles pg-boss
  schedule rows on definition lifecycle. Pure mapping helpers + thin boss calls.
  - `cronExprFor(scheduleMetadata)`: derive a daily cron expression from
    `schedule_metadata.targetTime` (e.g. `"06:00"` → `"0 6 * * *"`), defaulting to a documented time
    (e.g. `"07:00"`) when absent. Weekly cadence is **out of scope** (see deferred); only `daily`
    definitions get a schedule.
  - `timezoneFor(scheduleMetadata)`: read `schedule_metadata.timezone` (IANA, e.g.
    `"America/New_York"`), defaulting to a documented fallback (`"UTC"`) when absent/invalid.
  - `reconcileSchedule(boss, definition)`: if cadence is `daily` and `enabled`, call
    `boss.schedule(BRIEFINGS_RUN_QUEUE, cronExpr, data, { tz, key: definition.id })`; otherwise
    `boss.unschedule(BRIEFINGS_RUN_QUEUE, definition.id)`. `key=definition.id` means the schedule upserts
    on `(name, key)`, so create/update/cadence-change/tz-change all funnel through the same call. `data` is
    the **metadata-only** scheduled-run payload `{actorUserId: definition.owner_user_id, definitionId:
    definition.id, runKind: "scheduled"}` — note no `briefingRunId`/`idempotencyKey` here; the worker mints
    those (see component 4).
- **How used:** Called from the route layer (component 3) on create/update/delete, with the boss handle
  that `BriefingsRoutesDependencies.boss` already provides (`routes.ts:37`). Also exposes a
  `reconcileOwnedSchedules(boss, scopedDb, repository)` used for **per-user self-heal on session activity**
  (lists the actor's own definitions via `repository.listDefinitions(scopedDb)` — RLS-scoped, owner-only —
  and reconciles each). **No global/cross-user sweep** anywhere.
- **Depends on:** `@jarv1s/jobs` (`BRIEFINGS_RUN_QUEUE`, payload typing), the boss handle, and
  `BriefingsRepository.listDefinitions` for the reconcile path. Schedule writes happen in the owner's
  request context only.

### 3. `packages/briefings/src/routes.ts` — wire schedule lifecycle into mutations

- **What:** After a successful `createDefinition` / `updateDefinition` (the existing handlers at
  `routes.ts:71` and `routes.ts:90`) and on a new delete handler, call `reconcileSchedule(boss,
  definition)`. There is no delete route today; if delete remains out of scope for this slice, then
  "disable" (`enabled: false` via PATCH) is the unschedule path and that is sufficient — call it out in the
  PR. Schedule reconcile runs **after** the DB mutation commits, using the returned definition row.
- **How used:** The route already has `dependencies.boss` (`routes.ts:37`) and runs inside
  `withDataContext`. Reconcile happens **outside** the data-context callback (pg-boss is not RLS-scoped),
  using the owner id from the returned definition.
- **Depends on:** component 2; the existing `BriefingsRoutesDependencies.boss`. **Failure isolation:** a
  reconcile error must not fail the user's create/update HTTP request — log it (structured, name+message
  only, like the existing `briefing_tool_failed` log at `repository.ts:285`) and return the definition; the
  per-session reconcile self-heals. The mutation is the source of truth, the schedule is derived.

### 4. `packages/briefings/src/jobs.ts` — scheduled-run worker handling

- **What:** The worker handler (`registerBriefingsJobWorkers`, `jobs.ts:69`) already validates the payload
  is metadata-only (`isBriefingRunPayloadMetadataOnly`, `jobs.ts:80`) and calls `repository.generateRun`.
  For **scheduled** jobs, the cron payload carries no `briefingRunId`/`idempotencyKey` (component 2), so the
  handler must:
  - Mint `briefingRunId = randomUUID()` when absent.
  - Derive an idempotency guard for the local day so a definition can't double-fire for the same morning:
    set the run id / dedupe such that a re-fire on the same `(definitionId, localDate-in-user-tz)` is a
    no-op. Because the cron payload itself is fixed (no per-run key), use a **DB-level idempotency check** in
    `generateRun` (component 5) rather than pg-boss `singletonKey` (the scheduled job's payload has no unique
    per-day key to namespace on). The manual path keeps its existing `singletonKey` dedupe (`routes.ts:150`).
  - On a **scheduled** run whose status is `succeeded` or `degraded`, emit the "Your morning briefing is
    ready" notification (component 8).
- **How used:** Same queue, same worker registration. Extend `RegisterBriefingsJobWorkersOptions`
  (`jobs.ts:29`) with the new deps generation needs (component 6: AI repository, cipher factory, fetch,
  memory retriever, notifications repository) so the worker can pass them into `generateRun`.
- **Depends on:** `BRIEFINGS_RUN_QUEUE`, the metadata-only invariant, and the new compose deps.

### 5. `packages/briefings/src/repository.ts` + `compose.ts` — grounded LLM synthesis (the core)

- **What:** Replace the deterministic `generateSummary` body. `generateRun` keeps its current shape (resolve
  owned definition via `getOwnedDefinitionById` at `repository.ts:207`, insert a `briefing_runs` row, bump
  `last_run_at`). The synthesis itself moves to `compose.ts`:
  1. **Idempotency (scheduled only):** before composing, if `runKind === "scheduled"` and a `briefing_runs`
     row already exists for this definition with `created_at` on the same local day (in the user's tz),
     return that run and skip — prevents double-fire. (Manual runs always proceed; the route's
     `singletonKey` already dedupes those.)
  2. **Gather sections** in **fixed priority order** (each capped; see Data flow for the caps):
     1. **Commitments** — via the new `commitments.listVisible` read tool (component 7a), surfacing
        title, status (`open`/`at_risk`/`slipped`/...), due date, counterparty.
     2. **Tasks** — via the existing `tasks.listVisible`/`tasks.list` tool (already summarized in
        `summarizeToolResult`, `repository.ts:357`).
     3. **Today's calendar** — via `calendar.listVisibleEvents` (existing), filtered to events whose
        `startsAt` is today in the user's tz.
     4. **EMAIL SUMMARIES + SIGNALS** — via `email.listVisibleMessages` (existing). Surface
        bills due / past-due and action items from the cached messages' subject/snippet/body-excerpt
        (`EmailRepository.listVisible`, `email/repository.ts:21`). This source is **empty until the
        connector-sync slice lands** — degrade with a noted gap (see Dependencies).
     5. **Vault** — hybrid semantic + recency retrieval via `MemoryRetriever.retrieve` (semantic,
        `memory/retrieval.ts:12`) unioned with a recency pass (component 7b), deduped by source path /
        chunk id. The semantic query is derived from the higher-priority signals (commitment + task +
        calendar titles).
     6. **The day's chats** — via the new `chat.listTodaysTurns` read tool (component 7c): the user's chat
        turns from today (in the user's tz), excluding incognito threads.
  3. **Note gaps:** when a source is empty, errors, or is truncated by a cap, record a structured entry in
     `source_metadata.gaps[]` (e.g. `{ source: "email", reason: "empty_cache" | "tool_failed" |
     "truncated" }`). A single failed source degrades to a noted gap — it never fails the whole run (this
     preserves the existing per-tool degrade-not-fail behavior at `repository.ts:279`).
  4. **Build one bounded prompt:** a system instruction ("synthesize a concise morning briefing with light
     section headers; ground strictly in the provided items; note where a section is empty") plus a
     user/content message containing the capped, structured sections with provenance. Enforce **one
     conservative economy token budget** by char-capping each section and the total (see Data flow).
  5. **Resolve the model (provider-agnostic):** `aiRepository.selectModelForCapability(scopedDb,
     "summarization", "economy")` — the call already present at `repository.ts:309`. No provider/model is
     hardcoded; the router returns the user's configured economy model (with its tier-ladder fallback,
     `repository.ts:279`).
  6. **Decrypt credential in-worker + synthesize:** `aiRepository.selectProviderWithCredential(scopedDb,
     model.provider_config_id)` (`repository.ts:310`) returns the row including
     `encrypted_credential`; decrypt with `createAiSecretCipher()` (`ai/crypto.ts:16`) **in worker scope
     only**; construct `HttpApiAdapter(provider_kind, apiKey, { baseUrl })` (`ai/adapters/http-api.ts:28`)
     and call `generateChat({ model: { provider_kind, provider_model_id }, messages })`. The plaintext key
     never leaves the function, never enters logs, `source_metadata`, or the prompt.
  7. **Persist:** `summary_text` = the LLM narrative (with light structured headers); `source_metadata` =
     `{ tools[], commitmentCount, taskCount, calendarCount, emailCount, notes[] (path/id/excerpt only),
     chatTurnCount, aiModel (id/displayName/tier), gaps[], degraded: false }`. Status = `succeeded` (or
     `blocked` if a non-read tool was selected — keep the existing `blockedSummary` guard at
     `repository.ts:229`).
  8. **Deterministic degraded fallback:** if model resolution returns `undefined`, credential decryption
     fails, or `generateChat` throws, persist a deterministic narrative built from the gathered sections
     (shaped like today's `formatToolSummary` output, `repository.ts:415`), set `source_metadata.degraded
     = true` and `degradedReason` (e.g. `"no_model" | "synthesis_failed" | "credential_error"`), and set
     status `succeeded` (the run still produced a useful summary) — **not** `failed`. `failed` stays
     reserved for a hard read-tool failure as today (`selectRunStatus`, `repository.ts:341`).
- **How used:** `generateRun` is the single entry for both manual and scheduled runs. `compose.ts` holds
  the gathering + prompt + synthesis + fallback; `repository.ts` holds persistence and the unchanged
  definition/run CRUD. Keep both files under 1000 lines (`pnpm check:file-size`).
- **Depends on:** `@jarv1s/ai` (`AiRepository`, `HttpApiAdapter`, `createAiSecretCipher`), `@jarv1s/memory`
  (`MemoryRetriever` + recency, component 7b), the read-tool seam for commitments/tasks/calendar/email/
  chats, and `@jarv1s/notifications` (component 8). All reads stay RLS-scoped through the passed
  `DataContextDb`; no module internals or foreign tables are touched (module isolation).

### 6. Worker composition — inject synthesis deps

- **What:** `registerBriefingsJobWorkers` (`jobs.ts:69`) and its registration in
  `packages/module-registry/src/index.ts:166` currently pass only `{ moduleManifests }`. Extend the worker
  deps to include what synthesis needs: an `AiRepository`, a cipher factory (`createAiSecretCipher`), an
  injectable `fetch` (defaults to global; tests inject), a `MemoryRetriever` (built from the worker's
  existing `embeddingProvider` — already available as `BuiltInWorkerDependencies.embeddingProvider`,
  `module-registry/src/index.ts:84` — plus a `MemoryRepository`), and a `NotificationsRepository`.
- **How used:** `module-registry`'s `registerWorkers` callback for briefings (`index.ts:166`) passes these
  in; the worker is the only place credentials are decrypted and `generateChat` runs.
- **Depends on:** `BuiltInWorkerDependencies` already carrying `dataContext` + `embeddingProvider`. No new
  global wiring beyond constructing these repositories.

### 7. New read-tool seams + retrieval

- **(7a) `commitments.listVisible` read tool (structured-state).** Add an `assistantTools` entry to
  `packages/structured-state/src/manifest.ts` (which has **none** today) mirroring calendar's manifest
  shape (`calendar/manifest.ts:80`): `name: "commitments.listVisible"`, `risk: "read"`, empty
  `inputSchema`, and an `execute` that calls `CommitmentsRepository.listVisible(scopedDb)`
  (`structured-state/commitments-repository.ts:45`). This also requires the structured-state manifest to
  gain a `permissions` entry to back `permissionId` (it has none today) — add a `structured-state.view`
  (or `commitments.view`) read permission. Add a `summarizeToolResult` case in `repository.ts:357` for
  `commitments.listVisible` (excerpt: title + status + due). The commitments SELECT RLS policy
  (sql/0031) already scopes to owner — **verify it covers owner reads before relying on it**; if a grant
  is missing for the runtime role, add a **new** migration file in `packages/structured-state/sql/`
  (never edit applied migrations).
- **(7b) Vault recency retrieval (memory).** Add a recency method to `@jarv1s/memory` (e.g.
  `MemoryRepository.listRecentChunks(scopedDb, limit, sourceKind="vault")` ordered by `ingested_at`
  desc, plus a `MemoryRetriever.retrieveRecent` wrapper). The M-A4 spec confirms `memory_file_index` has
  `ingested_at` for recency. Compose (component 5) unions semantic + recency results, deduped by source
  path / chunk id. Vault is reached via the **memory public package API**, not a param-less read tool
  (query-driven retrieval does not fit the `{}`-input seam) — consistent with the M-A4 decision and the
  module-isolation rule (public API only).
- **(7c) `chat.listTodaysTurns` read tool (chat).** Add an `assistantTools` entry to
  `packages/chat/src/manifest.ts` and a `tools.ts` (mirroring calendar/email/notifications `tools.ts`):
  `name: "chat.listTodaysTurns"`, `risk: "read"`, empty input, `execute` that lists the actor's chat
  messages created today (in the user's tz), **excluding incognito threads** (the chat repo already tracks
  `incognito`, `chat/repository.ts:124`), returning role + body excerpt + thread title. Reuse
  `ChatRepository.listThreads` + `listMessages` (`chat/repository.ts:25,46`). Back it with a
  `chat.view`-style read permission (chat manifest already defines permissions — reuse or add a read one).
  Add a `summarizeToolResult` + `displayToolName` case for it in `repository.ts`.
- **How used:** All three are consumed by compose's section gathering through the same
  `manifestTool.execute(scopedDb, {}, ctx)` seam the briefing already uses (`repository.ts:264`), keeping
  briefings uniform across sources.
- **Depends on:** the module manifests, the respective repositories, and (for commitments) a verified/added
  RLS grant for the runtime role.

### 8. Morning-briefing notification (notifications module)

- **What:** On a **scheduled** run that completes `succeeded` or `degraded`, create a notification "Your
  morning briefing is ready" via `NotificationsRepository.create(scopedDb, { title, body?, metadata })`
  (`notifications/repository.ts:50`), with `recipient_user_id` defaulting to the actor (the repo defaults
  both actor/recipient to `app.current_actor_user_id()` when omitted). `metadata` carries only IDs
  (`{ definitionId, briefingRunId }`) — no summary content.
- **How used:** Called from the worker handler (component 4) after a scheduled run persists, inside the same
  `withDataContext(owner)` so the notification is owner-scoped via RLS. **Manual** runs do not notify (the
  user is already looking at the result). Notification creation failure is logged but does not fail the run
  (the briefing already persisted).
- **Depends on:** `@jarv1s/notifications` `NotificationsRepository` (a declared public API — module
  isolation preserved; no foreign-table access).

### 9. `handleExtractFactsJob` — implement the stub (chat module)

- **What:** Replace the NO-OP body (`packages/chat/src/jobs.ts:104`) with real extraction. The queue,
  worker slot, and per-turn enqueue already exist: `CHAT_EXTRACT_FACTS_QUEUE` (`chat/jobs.ts:17`) is
  registered in `registerChatJobWorkers` (`chat/jobs.ts:145`) and enqueued per completed turn from
  `DataContextChatPersistence.recordTurn` (`chat/live/persistence.ts:140`) — for non-incognito threads
  only. Implement:
  1. Load the latest stored user+assistant turn for `threadId` (reuse the same `listMessages` →
     `status==="stored"` → last-two logic as `handleEmbedTurnJob`, `chat/jobs.ts:49`).
  2. Resolve the user's model via `selectModelForCapability(scopedDb, "summarization", "economy")` and
     synthesize a structured extraction through the **same HTTP `generateChat` + in-worker decryption
     path** as briefings (component 5 step 6), prompting for durable facts as JSON: each with `category`
     (`preference | fact | profile | goal`), `content`, `importance` (0..1), and an optional supersede
     hint.
  3. Parse defensively; for each extracted fact, **upsert** into `app.chat_memory_facts` via
     `ChatMemoryFactsRepository` (`memory/facts-repository.ts:28`): `insertFact` for new facts; when the
     model flags a superseding fact, `supersedeFact` the prior one (the repo + table already model
     `status: active|superseded` and `superseded_at`, sql/0041). Set `sourceThreadId = threadId`.
  4. **Bounded + safe:** cap the number of facts per turn; on any LLM/parse/decrypt error, **degrade to a
     no-op** (log structured name+message; do not throw) so a flaky extraction never blocks the chat
     turn's other jobs. The queue already has `retryLimit: 2` (`chat/jobs.ts:21`).
  - **Deferred (explicitly):** commitment/Task auto-creation and vault-fact writes are **out of scope** —
    this implements only durable chat-fact upserts.
- **How used:** Runs in the existing chat extract-facts worker; needs the AI deps wired into
  `RegisterChatJobWorkersOptions` (`chat/jobs.ts:115`) and the `module-registry` chat `registerWorkers`
  callback (`index.ts:158`) the same way briefings gets them (component 6). The facts it writes are read at
  chat session launch today (sql/0041 header: "always-loaded at session launch") and become available to
  briefings synthesis as the substrate matures.
- **Depends on:** `@jarv1s/ai` (model resolution + HTTP adapter + cipher), `ChatMemoryFactsRepository`
  (already a public memory API; `app.chat_memory_facts` grants exist for `jarvis_worker_runtime`, sql/0041
  lines 44-45). RLS already scopes facts to owner (sql/0041 policies).

---

## Data flow

**One scheduled morning briefing:**

```
worker boss (schedule:true) cron engine
  └─ pgboss.schedule row  key=definitionId, tz=user IANA, cron="0 7 * * *"
       └─ fires job → BRIEFINGS_RUN_QUEUE  data {actorUserId, definitionId, runKind:"scheduled"}  (metadata only)
            │
            ▼
   registerDataContextWorker → withDataContext(owner) → RLS-scoped scopedDb
     └─ jobs handler: mint briefingRunId; generateRun(definitionId, {runKind:"scheduled", runId})
          └─ compose(scopedDb, definition, deps):
               0. local-day idempotency: existing scheduled run today? → return it, skip
               1. commitments  = commitments.listVisible            (cap N items / C chars)
               2. tasks        = tasks.listVisible                  (cap N / C)
               3. calendar     = calendar.listVisibleEvents, today  (cap N / C)
               4. email        = email.listVisibleMessages → bills/past-due/action items (cap N / C)  [empty until sync slice]
               5. vault        = MemoryRetriever.retrieve(query) ∪ retrieveRecent  (deduped, cap N / C)
                                  query = commitment+task+calendar titles
               6. chats        = chat.listTodaysTurns (non-incognito) (cap N / C)
               7. gaps[]       = any empty/failed/truncated source
               8. model        = selectModelForCapability("summarization","economy")  (provider-agnostic)
               9. cred         = selectProviderWithCredential(model.provider_config_id) → decrypt in-worker
              10. narrative    = HttpApiAdapter(kind, key).generateChat({model, messages})  (one bounded economy budget)
                                   · failure → deterministic fallback (degraded:true, reason)
              11. persist run: summary_text = narrative|fallback;
                                source_metadata = {tools[], counts, notes[](path/id/excerpt),
                                                   aiModel, gaps[], degraded, degradedReason}
          └─ if scheduled & status in {succeeded, degraded}:
               NotificationsRepository.create({title:"Your morning briefing is ready", metadata:{definitionId, briefingRunId}})
```

**Token-budget grounding (one conservative economy budget):** fixed-priority sections fill the budget in
order — commitments first, the day's chats last — each section char-capped (e.g. a per-source item cap and a
per-source total-char cap; concrete numbers chosen at build time so the assembled prompt stays comfortably
within an economy context window). When a section is dropped or truncated by the cap, record a
`gaps[]` entry (`reason: "truncated"`). Excerpts persisted to `source_metadata.notes[]` carry path/id +
short excerpt only — never full note bodies (the M-A4 provenance-without-leak rule).

**Manual "run now"** (`POST /api/briefings/definitions/:id/run`, `routes.ts:113`): unchanged in shape —
mints `runId`, enqueues with the existing `singletonKey` dedupe (`routes.ts:150`), same worker, same
`generateRun`/`compose`, `runKind:"manual"`, **no notification**.

---

## Error handling

| Failure | Behavior |
| --- | --- |
| No `summarization`/economy model configured (`selectModelForCapability` → undefined) | Deterministic fallback summary, `degraded:true`, `degradedReason:"no_model"`; status `succeeded`. |
| Credential decrypt fails / provider has no credential | Deterministic fallback, `degraded:true`, `degradedReason:"credential_error"`. |
| `generateChat` throws (network/4xx/5xx) | Deterministic fallback, `degraded:true`, `degradedReason:"synthesis_failed"`. (`HttpApiAdapter` already throws `HTTP <status>` without the key, `http-api.ts:54`.) |
| A single source/read tool fails or is empty | Noted `gaps[]` entry; synthesize from the rest; run not failed (preserves `repository.ts:279` degrade-not-fail). |
| Connector-sync slice not landed (calendar/email caches empty) | `gaps[]` entry `{source:"email"|"calendar", reason:"empty_cache"}`; briefing still produced from the other sources. |
| Non-read tool selected | `blockedSummary`, status `blocked` (unchanged guard, `repository.ts:229`). |
| Scheduled job double-fires for one local day | Local-day idempotency check in `compose` returns the existing run; no second synthesis, no second notification. |
| Schedule reconcile fails on create/update | Logged (name+message only); HTTP mutation still succeeds; per-session reconcile self-heals. |
| Notification create fails | Logged; run already persisted, not failed. |
| `handleExtractFactsJob` LLM/parse/decrypt error | No-op degrade (logged); chat turn unaffected; pg-boss `retryLimit:2` may retry. |
| pg-boss internal `error` event | Existing `defaultOnPgBossError` logs and never rethrows (`pg-boss.ts:97`); cron engine inherits this. |

All error logs are single-line structured JSON with **name + bounded message only** (mirroring the
existing `briefing_tool_failed` log, `repository.ts:285`) — never the raw error (it can echo tool output,
connection strings, or, critically, a decrypted key).

---

## Security & invariants (cited from CLAUDE.md Hard Invariants)

- **Provider-agnostic AI** — synthesis requests the `summarization` capability at the `economy` tier via
  `selectModelForCapability`; no provider/model is hardcoded. The router selects the user's configured
  model (tier-ladder fallback, `repository.ts:279`). Same for `handleExtractFactsJob`.
- **Secrets never escape** — provider credentials are decrypted **in worker scope only**
  (`createAiSecretCipher` + `selectProviderWithCredential`), used to construct the adapter, and never
  written to logs, `source_metadata`, the prompt, the notification, or job payloads. AI credentials remain
  AES-256-GCM at rest (`ai/crypto.ts`). Excerpts in `source_metadata.notes[]` are path/id + short excerpt
  only.
- **Metadata-only job payloads** — scheduled cron `data` and run-now payloads contain only
  `{actorUserId, definitionId, runKind, briefingRunId?, idempotencyKey?}`, all in `ALLOWED_PAYLOAD_KEYS`
  (`pg-boss.ts:45`) and enforced by `isBriefingRunPayloadMetadataOnly` (`jobs.ts:80`). No content/prompts/
  secrets. Notification `metadata` carries only IDs.
- **DataContextDb only / AccessContext shape** — every read/write goes through the branded
  `DataContextDb` (`assertDataContextDb` guards in every repo). The worker runs in
  `withDataContext(toAccessContext(job))` → `{actorUserId, requestId}` (`pg-boss.ts:204`); no new
  AccessContext fields, no root Kysely handle in any module.
- **No admin private-data bypass / no `BYPASSRLS` / no SECURITY DEFINER / no system principal** — there is
  **no cross-user read** anywhere: schedules are written in the owner's request context, each fired job is
  actor-scoped, execution is RLS-scoped, and the per-session reconcile lists only the actor's own
  definitions. This is the M-A4 isolation-by-construction argument, preserved.
- **Private by default** — briefing definitions/runs, commitments, chats, facts, and notifications are all
  owner-scoped by their existing RLS policies; cross-user access only via explicit grants (briefings is
  already share-aware, manifest.ts:85).
- **Module isolation** — briefings consumes commitments/tasks/calendar/email/chats through the declared
  read-tool seam and memory/notifications/ai through their public package APIs. No module imports another's
  internals or queries its tables directly.
- **Never edit applied migrations / module SQL in the owning module's dir** — no migration is required for
  scheduling (pg-boss owns its schema; `schedule_metadata`/`source_metadata` are already `jsonb`). If the
  commitments runtime-role grant is missing (component 7a), add a **new** file in
  `packages/structured-state/sql/` — never modify an applied one (the runner hash-checks). `chat_memory_facts`
  already grants the worker role (sql/0041:44-45).
- **Spec before build** — this document.
- **1000-line file limit** — synthesis is extracted to `compose.ts` and scheduling to `schedule.ts` so
  `repository.ts` stays under the cap (`pnpm check:file-size`).

---

## Testing strategy

Integration tests run via Vitest against the Postgres from `pnpm db:up` (`pnpm test:briefings`,
`pnpm test:chat`, plus the gate). Extend `tests/integration/briefings.test.ts` (which today asserts the
deterministic concat at lines 282-306 and records the economy model at 488-526 — those expectations change)
and add chat-facts coverage.

**Synthesis (inject a fake `generateChat`/`fetch` so no real provider is called):**

1. A configured economy model + fake adapter → `summary_text` is the fake narrative (not the concat);
   `source_metadata` carries counts, note provenance (path/id/excerpt only), `aiModel`, `degraded:false`.
2. Fixed-priority ordering: with all sources present, the prompt/sections appear in the order
   commitments > tasks > calendar > email > vault > chats (assert on the assembled prompt via a spy).
3. Hybrid vault grounding: provenance from both semantic and recency paths appears, deduped.
4. Per-source gap: a failing read tool / empty source yields a `gaps[]` entry; run still `succeeded`.
5. Degraded fallbacks: (a) no configured model → `degraded:true`, `no_model`; (b) `generateChat` throws →
   `synthesis_failed`; (c) credential decrypt error → `credential_error`. Each persists a deterministic
   summary and status `succeeded`.
6. **Secrets**: assert the decrypted key never appears in `summary_text`, `source_metadata` (serialized),
   logs, or the enqueued payload.

**Scheduling:**

7. Enabling a `daily` definition registers a pg-boss schedule (`key=definitionId`, correct cron from
   `targetTime`, `tz` from `timezone`); disabling/PATCH→`enabled:false` unschedules; cadence/time/tz change
   re-schedules (upsert on `(name,key)`).
8. Local-day idempotency: a second scheduled fire for the same `(definition, local day)` returns the
   existing run — no second synthesis, no second notification.
9. `cronExprFor`/`timezoneFor` unit tests incl. defaults and a DST-sensitive timezone.

**Notification:**

10. A scheduled `succeeded` (and a `degraded`) run creates exactly one "Your morning briefing is ready"
    notification owned by the actor with IDs-only metadata; a **manual** run creates none.

**Read-tool seams:**

11. `commitments.listVisible`, `chat.listTodaysTurns` are listed as `risk:"read"` tools and return
    owner-scoped data under `withDataContext`; selecting them in a definition is accepted by
    `requiredReadToolNames` (`routes.ts:263`). `chat.listTodaysTurns` excludes incognito threads.

**`handleExtractFactsJob` (chat suite):**

12. After a recorded non-incognito turn, the job upserts facts into `app.chat_memory_facts` (categories
    constrained to the four enum values, `sourceThreadId` set, importance in 0..1); a superseding fact marks
    the prior `superseded`. Incognito threads enqueue nothing (existing `persistence.ts:128` guard).
13. LLM/parse error → no-op (no rows written), no throw.

**RLS / isolation:**

14. A run executes only the owner's data (extend the existing `does not let a User A worker job run User B's
    private briefing` test, briefings.test.ts:446); no code path enumerates definitions/commitments/chats
    across users.

**Gate:** `pnpm verify:foundation` + `pnpm audit:release-hardening` green. Run `pnpm check:file-size` to
confirm `repository.ts`/`compose.ts`/`schedule.ts` stay under 1000 lines.

---

## Acceptance criteria (numbered, testable)

1. A scheduled briefing run persists an **LLM-synthesized narrative** (from the configured `summarization`/
   economy model, via the HTTP `generateChat` path) to `summary_text` — not the deterministic concat — with
   light structured section headers, when a model is configured and synthesis succeeds.
2. `source_metadata` carries raw items / provenance (path/id/excerpt only) / per-source counts / `aiModel` /
   `gaps[]` / `degraded` — and **never** any decrypted credential or full note body.
3. Grounding sections are gathered in the fixed priority order **commitments > tasks > today's calendar >
   email summaries+signals > vault (semantic ∪ recency, deduped) > the day's chats**, each under per-source
   item/char caps, within one economy token budget.
4. `createPgBossClient` runs the cron engine (worker process), and a `daily` definition registers a native
   per-definition pg-boss schedule (`key=definitionId`, cron from `targetTime`, `tz` from `timezone`);
   disable/delete unschedules; cadence/time/tz change re-schedules; per-user session reconcile self-heals.
5. **No cross-user read** exists in any Jarv1s code path; scheduled jobs are actor-scoped and execute under
   `withDataContext(owner)`; no `BYPASSRLS`/SECURITY DEFINER/system principal is introduced.
6. The manual "run now" path is unchanged in shape (route → enqueue with `singletonKey` dedupe → same
   worker → `generateRun`) and produces a briefing with `runKind:"manual"` and **no** notification.
7. A scheduled run completing `succeeded` or `degraded` creates exactly one "Your morning briefing is ready"
   notification owned by the actor with IDs-only metadata.
8. Synthesis failure (no model / decrypt error / `generateChat` throws) yields a **deterministic degraded
   fallback** with `degraded:true` + `degradedReason`, status `succeeded` (not `failed`); a single failed/
   empty source becomes a noted `gaps[]` entry, not a failed run.
9. `commitments.listVisible` (structured-state) and `chat.listTodaysTurns` (chat) exist as `risk:"read"`
   assistant tools, return owner-scoped data, and are selectable by briefing definitions;
   `chat.listTodaysTurns` excludes incognito threads.
10. `handleExtractFactsJob` extracts durable facts (category ∈ {preference, fact, profile, goal},
    importance, supersede) from the latest non-incognito chat turn and upserts them into
    `app.chat_memory_facts` via `ChatMemoryFactsRepository`; errors degrade to no-op; commitment/Task
    auto-creation and vault-fact writes are **not** implemented.
11. A scheduled fire that repeats for the same `(definition, local day in user tz)` does not create a second
    run or a second notification (local-day idempotency).
12. Metadata-only payload invariant holds for scheduled cron `data` and run-now payloads
    (`isBriefingRunPayloadMetadataOnly` passes; `ALLOWED_PAYLOAD_KEYS` unchanged).
13. `pnpm verify:foundation` + `pnpm audit:release-hardening` are green; `pnpm check:file-size` passes
    (`repository.ts`/`compose.ts`/`schedule.ts` < 1000 lines).

---

## Out of scope / deferred

- **Commitment/Task auto-creation and vault-fact writes from chat** — `handleExtractFactsJob` writes only
  durable chat facts this slice.
- **Weekly / general cron expressions / one-shot schedules** — only daily-at-time + IANA tz. Weekly
  cadence definitions exist as an enum but get no schedule yet.
- **A shared "heartbeat" primitive** — native per-definition cron covers this slice (M-A4's deferral
  stands).
- **CLI/tmux as the briefing synthesis transport** — see "Transport decision"; deferred unless a future
  slice makes the interactive CLI bridge robust for unattended single-turn jobs.
- **Real connector sync** — calendar/email caches stay empty until the connector-sync slice lands; this
  spec degrades gracefully with noted gaps (DEPENDS ON below).
- **New external sources (news, sports, etc.)** — need new connectors; the read-tool seam keeps them
  pluggable.
- **A briefings web UI redesign / reader** — surfacing the narrative beyond the existing runs list is not
  part of this slice.
- **Per-source "what changed since last briefing" diffing** — present-state grounding only.

---

## Transport decision (recorded for the build)

The locked decision is "real synthesis via the `generateChat` capability path." The **only `generateChat`
implementation that accepts a decrypted credential is `HttpApiAdapter`** (`ai/adapters/http-api.ts:28`);
`ChatProviderAdapter` (`chat-adapter.ts:21`) is the interface. The live chat drawer instead drives an
**interactive, stateful tmux CLI engine** (`chat/live/cli-chat-engine.ts`) that is launched once and driven
turn-by-turn — the M-A4 spec itself flags this transport as **fragile unattended**. A scheduled worker job
is unattended and single-turn, which is exactly the HTTP adapter's sweet spot and what
`selectProviderWithCredential` (`repository.ts:310`, documented "for use in the pg-boss worker") was built
for. **Therefore briefing synthesis (and `handleExtractFactsJob`) use the HTTP `generateChat` adapter with
in-worker credential decryption.** This requires the user to have a configured provider with a stored
credential for the economy tier; when absent, the briefing degrades deterministically (`no_model` /
`credential_error`) rather than hanging — which is the correct unattended behavior. (Provider-agnosticism is
intact: any `anthropic` / `openai-compatible` / `google` provider with an economy model works.)

---

## Dependencies

- **Connector-sync slice (calendar/email caches).** `CalendarRepository.listVisible` /
  `EmailRepository.listVisible` return empty until that slice populates the caches. This spec treats empty
  caches as **noted gaps**, so the briefing ships and improves automatically once sync lands. No blocking
  dependency for the rest of the pipeline (commitments / tasks / vault / chats are live today).
- **Embeddings** are real (M-A1, `LocalEmbeddingProvider`), so vault retrieval works now.
- **AI providers** are real (Phase 1 / M-A3 substrate); `HttpApiAdapter` + capability router + crypto exist.

---

## Open risks

1. **Running the cron engine in the worker only.** If a future deployment runs the worker as multiple
   replicas, pg-boss's scheduler could tick on more than one — the local-day idempotency check (component 5
   step 0) is the backstop, but confirm pg-boss's own scheduler does not double-emit within a single tick
   and that the idempotency check is race-safe (two ticks landing simultaneously). Single-worker dev is
   fine; flag before any multi-replica deploy.
2. **Economy budget tuning.** The per-source caps and total budget are chosen at build time; too tight and
   the briefing feels thin, too loose and economy models truncate or cost more. Needs one empirical pass
   against a real economy model and a real-ish vault.
3. **Email "signals" extraction quality.** "Bills due / past-due / action items" from cached subject/snippet/
   body-excerpt is heuristic until the connector-sync slice defines richer email metadata; until then this
   section is best-effort and may be a frequent gap.
4. **`handleExtractFactsJob` fact quality / dedupe.** LLM-extracted facts can be noisy or duplicative; the
   supersede path depends on the model correctly identifying conflicts. Cap per-turn facts and consider a
   later dedupe/consolidation pass (out of scope here).
5. **Schedule drift vs. mutations.** Schedule reconcile is best-effort on mutation (failures logged, not
   fatal) and healed per-session; a user who never starts a session after editing a definition could run a
   stale schedule until next login. Acceptable for this slice; note it.
6. **Time-zone correctness across DST.** `cronExprFor` + pg-boss `tz` must produce the right local fire time
   across DST transitions; covered by a unit test but worth a real-clock sanity check.
7. **Foundation flip blast radius.** `schedule:true` is a shared-foundation change; even scoped to the
   worker call site, confirm no existing test asserts `schedule:false` and that the API process boss is left
   untouched.
