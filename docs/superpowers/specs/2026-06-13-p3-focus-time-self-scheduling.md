# Phase 3 — Early agency win: Jarvis blocks own focus-time (calendar self-scheduling)

**Status:** Approved design — ready to build
**Date:** 2026-06-13
**Owner:** Ben
**GitHub:** Epic #48 (Phase 3 · Core Value), exit-criterion #5 ("Early agency win — Jarvis blocks
own focus-time").
**Grounded on:** `origin/main` @ `5759b90` (local HEAD `e945100`, tree fresh per `git fetch`: 0 behind,
5 ahead = local doc commits only).
**Builds on:**

- `docs/superpowers/specs/2026-06-13-p3-connector-sync-engine.md` — **hard dependency.** That slice
  builds the reusable Google REST client (`packages/connectors/src/google-api-client.ts`, component 1)
  and explicitly defers `events.insert` + `freeBusy.query` to **this** slice ("Out of scope / deferred
  → Calendar write / focus-time"). It also lands the RLS `provider_type` relaxation
  (migration `0065_calendar_worker_grants_and_google_insert.sql`) that lets a `provider_type='google'`
  account INSERT into `app.calendar_events` — which this slice's local-cache mirror relies on.
- `docs/architecture/decisions/0005-jarvis-mcp-agentic-tools.md` — the in-process MCP gateway,
  module-owned tools, blocking confirmation (the floor this rides).
- `docs/architecture/decisions/0006-google-connector-per-user-oauth.md` — decision #4: read+write
  Calendar scope (`https://www.googleapis.com/auth/calendar`) granted at first consent.
- `docs/superpowers/specs/2026-06-08-m-b1-google-connector-oauth.md` — the connection foundation
  (encrypted bundle, `getFreshAccessToken`).

---

## Goal

Give Jarvis its first real **agency win**: when Ben asks ("Jarvis, block two hours tomorrow morning
for deep work"), Jarvis proposes a concrete focus block, Ben approves it through the existing
Approve/Deny card, and a real event appears on his **primary Google Calendar** — tagged as
Jarvis-created and conflict-checked against his live availability. This is the first time Jarvis
_changes the outside world_ on the user's behalf, and it does so under the un-skippable
write→confirm gate (ADR 0005 #3), so the agency is real but never unsupervised.

Concretely: a new module-owned assistant tool `calendar.proposeFocusBlock` (declared `risk: "write"`)
takes a desired window (date + part-of-day or explicit start/duration), calls Google **freeBusy
live** at propose time to verify the window is clear (and to nudge to the next clear slot if not),
emits an Approve/Deny card via the gateway's existing `confirmAndRun` path, and on approval calls
Google `events.insert` on the primary calendar with `extendedProperties.private.jarvisCreated=true`,
then mirrors the created event into `app.calendar_events` (subject to the connector-sync RLS fix).

Success = on the headless box, with Ben's connected Google account, in the chat drawer: "block 2
hours tomorrow morning" → Jarvis returns a proposed block with the resolved time → an Approve/Deny
card appears → Ben approves → a real event lands on his primary Google Calendar with the Jarvis tag,
visible in Google Calendar and (after the next read) on the Jarv1s Calendar page → a conflicting
request is reported as a conflict or shifted to the next clear slot → `pnpm verify:foundation` +
`pnpm audit:release-hardening` green.

---

## Architecture

The whole feature is a single **module-owned assistant tool** on the existing `calendar` module,
dispatched through the **existing** AssistantToolGateway with **zero new policy**. The gateway already
intercepts a `risk: "write"` tool (`packages/ai/src/gateway/policy.ts` returns `"confirm"` for
anything not `"read"`), creates a pending `action_request`, emits an Approve/Deny card via the
`SessionNotifier`, and **blocks** in `confirmAndRun` until the user resolves it
(`packages/ai/src/gateway/gateway.ts:113`). Declaring the new tool `risk: "write"` makes it ride that
gate verbatim — the locked **ALWAYS-CONFIRM** autonomy model is achieved purely by manifest
declaration. No edit to `policy.ts`, `gateway.ts`, or `confirmation-registry.ts`.

The single hard structural problem is **service injection across module isolation**. The focus-time
tool must (a) get a fresh Google access token and (b) call Google `freeBusy.query` + `events.insert`.
Both capabilities live in `packages/connectors` (`GoogleConnectionService.getFreshAccessToken` at
`google-connection.ts:110`; the `GoogleApiClient` built by the connector-sync slice). But
`packages/calendar` must **not** import `packages/connectors` (module isolation), and a `ToolExecute`
handler receives only `(scopedDb, input, ctx)` — no injected services (`packages/module-sdk/src/index.ts:39`).
The connectors module _could_ host the tool itself, but that misplaces a _calendar_ write under
_connectors_ and forces connectors to own calendar's cache-mirror and DTOs (rejected below). Instead we
introduce a **generic tool-service injection seam**: the gateway gains an optional per-module
`ToolServices` map; a module declares (by manifest) that its tools want a named service; the
composition layer (`packages/chat/src/routes.ts`, where the gateway is already wired) **constructs**
the service — a small `CalendarWriteService` closing over `GoogleConnectionService.getFreshAccessToken`
and a `GoogleApiClient` — and hands it to the gateway, which passes it to `ToolExecute` via a fourth
argument. The seam is designed **generically** (any module, any service) so it is not a calendar
special-case; the calendar tool is merely its first consumer.

The conflict check is **live, not cached**: the local `app.calendar_events` cache is unreliable until
the connector-sync slice's sync runs and even then lags reality, so `proposeFocusBlock` calls Google
`freeBusy.query` at propose time over the candidate window. The created event is represented as a
**normal event on the primary calendar**, tagged Jarvis-created two ways: Google
`extendedProperties.private.jarvisCreated="true"` (survives in Google, lets a future sync or a human
distinguish it) **and** mirrored into `app.calendar_events.external_metadata` (so the Jarv1s Calendar
page can render/badge it without a round-trip). The mirror is **best-effort and gated**: it requires
the connector-sync slice's RLS `provider_type IN (…,'google')` relaxation (migration 0065); if that has
not landed at build time, the mirror is skipped (the event still exists in Google — the source of
truth — and a later sync will pull it in). The tool **never** holds a credential beyond the access
token the service hands it per call; secrets stay in `connectors`.

Trigger is **explicit user ask only** for the MVP. There is a clean seam — the propose logic is a pure
function over `(window, freeBusyResult)` plus a thin tool wrapper — so the future Phase-3 briefing
slice can call the same `CalendarWriteService.proposeFocusBlock` programmatically (e.g. "you have a
clear morning, want me to protect it?") without re-plumbing. The cron/briefing caller is **noted, not
built**.

---

## Components

### 1. Generic tool-service injection seam — `packages/module-sdk/src/index.ts` (extend) + `packages/ai/src/gateway/*` (extend)

- **What it does:** lets a module's `ToolExecute` receive a named, composition-layer-constructed
  service object, without the module importing another module and without the gateway special-casing
  any module. Three additive pieces:
  1. **Manifest declaration.** Add an optional `requiresServices?: readonly string[]` to
     `ModuleAssistantToolManifest` (`module-sdk/src/index.ts:123`). A tool lists the service keys it
     needs (e.g. `["calendarWrite"]`). Declaration only — no implementation in the module.
  2. **ToolExecute fourth argument.** Extend `ToolExecute` (`module-sdk/src/index.ts:39`) to
     `(scopedDb, input, ctx, services) => Promise<ToolResult>`, where `services` is
     `ToolServices = Readonly<Record<string, unknown>>` (typed `unknown` to keep module-sdk free of any
     module dependency, mirroring why `scopedDb` is `unknown` there — see the comment at
     `module-sdk/src/index.ts:32`). The owning module narrows the value via its own type. **Existing
     tools ignore the new arg** (they are `(scopedDb, _input, _ctx)` today — adding a 4th optional param
     is backwards compatible; TS allows a handler that takes fewer args to satisfy a wider type).
  3. **Gateway plumbing.** `AssistantToolGatewayDependencies` (`gateway.ts:21`) gains
     `toolServices?: ToolServices` (a flat registry keyed by service name). In `runHandler`
     (`gateway.ts:96`) the gateway passes `this.deps.toolServices ?? {}` as the 4th argument to
     `found.execute(scopedDb, input, ctx, services)`. The gateway does **not** know what any service is;
     it is an opaque map. (We keep it a flat string→service map rather than per-tool wiring because the
     gateway already resolves tools generically; `requiresServices` is declarative documentation +
     a build-time/test assertion that every declared key is present, not a dispatch key.)
- **How used:** `packages/chat/src/routes.ts` constructs the registry (component 4) and passes it into
  the `AssistantToolGateway` constructor. The calendar tool (component 2) reads
  `services.calendarWrite`.
- **Depends on:** nothing new. Pure type + one-line plumbing extension. **Alternative considered:**
  extend `ToolContext` with the services instead of a 4th arg — rejected because `ToolContext` is a
  _value-identity_ object (`{actorUserId, requestId, chatSessionId}`, `module-sdk:21`) persisted into
  action-request summaries; mixing live service objects into it muddies that. A separate 4th arg keeps
  identity and capabilities cleanly separated.

### 2. Focus-time tool + propose logic — `packages/calendar/src/focus-time.ts` (new) + `packages/calendar/src/tools.ts` (extend) + `packages/calendar/src/manifest.ts` (extend)

- **What it does:** the assistant tool `calendar.proposeFocusBlock`, declared in the calendar manifest
  with `risk: "write"`, `permissionId: "calendar.manage"` (the existing manage permission,
  `manifest.ts:50`), `requiresServices: ["calendarWrite"]`, a `summarize` for the Approve/Deny card,
  and a typed input schema.
  - **Input schema** (validated by `validateToolInput` before the handler runs, `gateway.ts:69`):
    `{ date?: string (ISO yyyy-mm-dd), partOfDay?: "morning"|"afternoon"|"evening", start?: string
(ISO datetime), durationMinutes: integer (15..480, default 120), title?: string (default "Focus
time") }`. Either `partOfDay` (mapped to a window via documented local-time bands, e.g.
    morning=09:00–12:00) **or** an explicit `start` resolves the candidate slot; `date` defaults to the
    next day when only `partOfDay` is given. Timezone: resolved from the primary calendar's timezone
    (fetched once via the Google client `calendars.get` / settings, or defaulting to the connection's
    configured tz) — documented and tested, never assume UTC.
  - **`execute`** (the `ToolExecute` handler in `tools.ts`): narrows
    `services.calendarWrite` to `CalendarWriteService`, resolves the candidate window from input, then
    delegates to `service.proposeAndInsert(scopedDb, ctx, resolvedWindow)`. Because the tool is
    `risk:"write"`, the gateway has **already** obtained the user's approval before `execute` is called
    (`confirmAndRun` runs `runHandler` only after `outcome === "confirmed"`, `gateway.ts:158`). So
    `execute` performs the **real write**. The _proposal preview_ shown on the card comes from
    `summarize` (next bullet).
  - **`summarize(input, ctx)`** (`ToolSummarize`, `module-sdk:46`): returns the human-readable card
    text, e.g. `Block "Focus time" on Tue Jun 17, 09:00–11:00 (primary calendar)`. **Important
    constraint:** `summarize` is synchronous and pure (`gateway.ts:168` calls it inline, no `await`),
    so it **cannot** call freeBusy. Therefore the **conflict check + slot resolution happens inside
    `execute`/`proposeAndInsert`**, and the card text from `summarize` reflects the _requested_ window;
    the _resolved_ window (after any conflict shift) is reported in the tool result text the user sees
    after approval. (See Open risks #1 for the UX nuance and the chosen resolution.)
  - **Pure propose logic** lives in `focus-time.ts`: `resolveWindow(input, now, tz) → {start, end}`
    and `chooseSlot(window, freeBusyBusyIntervals, durationMinutes) → {start, end, shifted: boolean}`
    (if the requested window is busy, scan forward within the same day/part-of-day to the next clear
    slot; if none, return `shifted:false` with a `noClearSlot` marker). These are unit-testable with no
    I/O.
- **How used:** registered automatically via the manifest's `assistantTools` array (the gateway's
  `executableTools` reads `module.assistantTools`, `gateway.ts:184`). No core edit.
- **Depends on:** the injection seam (component 1) for `services.calendarWrite`; the
  `CalendarWriteService` interface **declared in `packages/calendar`** (component 3) and _implemented_
  in the composition layer (component 4). Calendar declares the interface it needs; connectors/chat
  satisfy it — dependency points the right way (calendar owns its contract).

### 3. `CalendarWriteService` interface — `packages/calendar/src/calendar-write-service.ts` (new, interface only)

- **What it does:** declares the contract the calendar tool depends on, owned by the calendar module so
  no `connectors` import leaks in:

  ```ts
  export interface FocusBlockWindow {
    start: Date;
    end: Date;
    title: string;
  }
  export interface ProposeFocusResult {
    created: boolean;
    resolvedStart: string;
    resolvedEnd: string; // ISO
    shifted: boolean; // moved from requested window
    conflict: "none" | "shifted" | "no-clear-slot";
    googleEventId?: string;
    calendarMirror: "written" | "skipped-rls" | "skipped-error";
  }
  export interface CalendarWriteService {
    proposeAndInsert(
      scopedDb: unknown, // DataContextDb; calendar narrows via assertDataContextDb
      ctx: ToolContext,
      window: FocusBlockWindow
    ): Promise<ProposeFocusResult>;
  }
  ```

- **How used:** the tool's `execute` consumes it; the composition layer provides the concrete
  implementation. The result is rendered by the gateway's `renderToolResult` (the `data` becomes the
  tool's textual reply).
- **Depends on:** only `@jarv1s/module-sdk` (`ToolContext`). **No `@jarv1s/connectors` import** — this
  is the linchpin that keeps module isolation intact.

### 4. `CalendarWriteService` implementation + wiring — `packages/chat/src/routes.ts` (extend) + `packages/chat/src/calendar-write-impl.ts` (new)

- **What it does:** builds the concrete `CalendarWriteService` and registers it in the gateway's
  `toolServices`. `packages/chat` already constructs the `AssistantToolGateway`
  (`chat/routes.ts:74`) and already depends on `@jarv1s/ai`; it is the natural composition layer (it
  is _not_ a module that another module imports — it is the host that wires the gateway). The impl
  closes over:
  - `GoogleConnectionService.getFreshAccessToken(scopedDb)` → the per-call access token.
  - `GoogleApiClient` (from the connector-sync slice) → `freeBusy.query` + `events.insert`.
  - `getActiveGoogleAccountSecret(scopedDb)` → the **`connector_account_id`** needed for the local
    cache mirror INSERT (the row returns `{ id }`, `connectors/src/repository.ts:262`).
  - `CalendarRepository.upsertCachedEvent` (the production upsert added by the connector-sync slice,
    component 5 there) → the mirror.
  - `chooseSlot`/`resolveWindow` from `packages/calendar` for the pure logic (imported from
    `@jarv1s/calendar` public exports — chat may import calendar; the _forbidden_ direction is calendar
    → connectors).
  - `proposeAndInsert` flow: `getFreshAccessToken` → `freeBusy.query({timeMin,timeMax,items:[{id:
"primary"}]})` → `chooseSlot` → if `no-clear-slot` return early (no write) → else
    `events.insert({calendarId:"primary", start, end, summary:title,
extendedProperties:{private:{jarvisCreated:"true", jarvisTool:"proposeFocusBlock"}}})` → on success,
    attempt the cache mirror via `upsertCachedEvent` (catch RLS/other errors → `calendarMirror:
"skipped-rls"|"skipped-error"`, never fail the whole call — the Google event is the source of
    truth).
- **How used:** in `registerChatRoutes`, when the gateway is constructed, build the impl **only when**
  the necessary deps are available (a `GoogleConnectionService` + Google client factory passed down
  through `ChatRoutesDependencies` → from `module-registry` → from the connectors module's exports).
  Add `calendarWrite` to the gateway's `toolServices`. The plumbing of `GoogleConnectionService` into
  chat goes through `BuiltInRouteDependencies` (component 5).
- **Depends on:** `@jarv1s/connectors` (allowed — chat is the composition host, not a peer module),
  `@jarv1s/calendar` (pure logic + upsert), the Google client from the connector-sync slice.
  **Why this site, not the connectors module hosting the tool (the alternative):** siting the tool in
  `connectors` would (a) put a _calendar_ write tool under the _connectors_ surface and permission
  (`connectors.manage`, semantically wrong — this is a calendar action), (b) force `connectors` to own
  the calendar cache-mirror upsert and any calendar DTO, re-introducing the cross-module reach the
  module contract exists to prevent (ADR 0005 #2 calls the central-switch reach "exactly the rot a
  connector contract exists to prevent"), and (c) couple the focus-time tool's lifecycle to connectors
  rather than calendar. The injection seam keeps the tool _in calendar_ (correct ownership, correct
  permission) while the _credential + Google I/O_ stay _in connectors_ (correct secret containment),
  joined only at the composition layer that is already allowed to see both. This is the same shape the
  gateway itself uses (it lives in `ai`/`chat` and reaches every module's tools through a generic
  contract, not by importing module internals).

### 5. Dependency plumbing — `packages/module-registry/src/index.ts` (extend) + `packages/connectors` exports (extend) + `apps/api`

- **What it does:** carries a `GoogleConnectionService` factory and the `GoogleApiClient` from the
  connectors module down to the chat route registration so component 4 can build the impl.
  - `BuiltInRouteDependencies` (`module-registry/src/index.ts:65`) gains an optional
    `buildCalendarWriteService?: (deps) => CalendarWriteService | undefined` **or**, more simply, the
    raw collaborators (`googleConnectionServiceFactory`, `googleApiClient`) — chosen at build to
    minimize surface. The connectors module already exports `GoogleConnectionService`; the
    connector-sync slice exports `GoogleApiClient`. `module-registry` already imports both
    `@jarv1s/connectors` and `@jarv1s/calendar`.
  - The chat registration block (`module-registry/src/index.ts:149`) passes the collaborators into
    `registerChatRoutes`.
  - `apps/api` already constructs `BuiltInRouteDependencies`; it gains the connectors collaborators
    (it already has the connectors crypto cipher + repository wiring from M-B1).
- **How used:** purely wiring; no behavior beyond making component 4 constructible.
- **Depends on:** the connector-sync slice's `GoogleApiClient` export existing. If the focus-time slice
  builds _before_ connector-sync merges, this is the **blocking** dependency (see Open risks #4).

### 6. OAuth granted-scope verification + re-consent path — `packages/connectors` (verify) + Settings/chat copy

- **What it does:** Calendar **write** scope (`https://www.googleapis.com/auth/calendar`) is in
  `GOOGLE_SCOPES` (`oauth.ts:4`) and is requested at first consent (ADR 0006 #4). The stored bundle
  records `grantedScopes` (`oauth.ts:16`, populated from the token response at
  `google-connection.ts:100`). **Verify, don't assume:** before `events.insert`, the
  `CalendarWriteService` checks the active account's `scopes` include
  `https://www.googleapis.com/auth/calendar`. If a **pre-existing** account (connected before this
  scope was added, or one that granted a narrower set) lacks it, the tool returns a clear, actionable
  result: _"Your Google connection doesn't have calendar-write permission yet — reconnect in Settings
  to grant it,"_ and does **not** attempt the insert. The re-consent path reuses the **existing**
  `buildAuthUrl`, which **already** sets `prompt=consent` and `access_type=offline`
  (`oauth.ts:79`), so re-running the Settings connect flow re-prompts and re-stores `grantedScopes` —
  **no new OAuth code is required**, only the scope check + the guidance copy. The scope check reads
  `accounts.scopes` (already selected by `safeAccountQuery`, `repository.ts:306`); expose a tiny
  `hasCalendarWriteScope(scopedDb)` helper on the connectors repository/service (read-only, owner
  scoped) for the impl to call.
- **How used:** called at the top of `proposeAndInsert` before any Google write.
- **Depends on:** existing OAuth machinery only.

### 7. Manifest registration + tests scaffolding — `packages/calendar/src/manifest.ts`

- Add the `calendar.proposeFocusBlock` entry to `assistantTools` (alongside the existing
  `calendar.listVisibleEvents`, `manifest.ts:80`). No new route, no new permission (reuses
  `calendar.manage`), no new SQL **owned by this slice** (the cache-mirror RLS comes from the
  connector-sync slice's calendar migration). No `database.migrations` change in this slice unless the
  build discovers connector-sync has not landed (see Out of scope).

---

## Data flow

**Trigger (MVP, explicit ask):** Ben in chat drawer: "Jarvis, block 2 hours tomorrow morning" → the
CLI engine calls the MCP tool `calendar.proposeFocusBlock` with
`{partOfDay:"morning", durationMinutes:120}` → MCP transport → `AssistantToolGateway.callTool`
(`gateway.ts:51`) verifies the per-session token → identity = `{actorUserId, chatSessionId}` from the
token (never the agent) → `validateToolInput` against the input schema → `resolvePolicy("write")` →
`"confirm"` → `confirmAndRun`.

**Confirmation (existing gate, unchanged):** `confirmAndRun` (`gateway.ts:113`) creates a pending
`action_request` (metadata-only: tool name, permission, `risk:"write"`, an **input summary** — no
secrets) under `withDataContext` → emits an `action_request` card via the `SessionNotifier` with
`summary = tool.summarize(input, ctx)` (the requested-window preview) → **blocks** on
`confirmations.awaitResolution(action.id, confirmTimeoutMs)` (150 s, `chat/routes.ts:81`). Ben clicks
Approve in the drawer → `POST /api/chat/action-requests/:id/resolve` (`chat/routes.ts:117`) →
`gateway.resolveActionRequest` persists `confirmed` (owner-checked, `gateway.ts:81`) → unblocks the
waiter → `confirmAndRun` proceeds to `runHandler`.

**Execution (the real write, inside `withDataContext` under the actor's RLS):** `runHandler`
(`gateway.ts:96`) builds `AccessContext {actorUserId, requestId}` and calls
`found.execute(scopedDb, input, ctx, toolServices)` →

1. tool narrows `services.calendarWrite`, `resolveWindow(input, now, tz)` → candidate window.
2. `service.proposeAndInsert(scopedDb, ctx, window)`:
   a. `hasCalendarWriteScope(scopedDb)` — if false → return `{created:false, conflict:"none",
calendarMirror:"skipped-error"}` with the re-consent message; **no Google call**.
   b. `getFreshAccessToken(scopedDb)` (`google-connection.ts:110`; refreshes + re-encrypts if <60 s to
   expiry — needs the connector account to be readable/updatable under RLS, which it is for
   `jarvis_app_runtime` since this runs in the **API** process, not the worker).
   c. `googleApiClient.freeBusy({accessToken, timeMin:windowStart, timeMax:windowEnd,
items:[{id:"primary"}]})` → busy intervals.
   d. `chooseSlot(window, busy, durationMinutes)` → `{start, end, shifted}` or `no-clear-slot`.
   e. if `no-clear-slot` → return `{created:false, conflict:"no-clear-slot"}` (no write).
   f. else `googleApiClient.insertEvent({accessToken, calendarId:"primary", start, end,
summary:title, extendedProperties:{private:{jarvisCreated:"true",
jarvisTool:"proposeFocusBlock"}}})` → `{ googleEventId }`.
   g. **cache mirror (best-effort, gated):** `getActiveGoogleAccountSecret(scopedDb)` → `connector
_account_id` → `calendarRepository.upsertCachedEvent(scopedDb, {connectorAccountId, externalId:
googleEventId, title, startsAt:start, endsAt:end, externalMetadata:{jarvisCreated:true,
htmlLink, source:"proposeFocusBlock"}})`. The calendar INSERT policy requires
   `provider_type IN (…,'google')` + calendar scope (connector-sync migration 0065). If that
   migration has not landed the INSERT fails the `WITH CHECK` → catch → `calendarMirror:
"skipped-rls"`. Any other error → `"skipped-error"`. **Never throws out of `proposeAndInsert`.**
   h. return `{created:true, resolvedStart, resolvedEnd, shifted, conflict: shifted?"shifted":"none",
googleEventId, calendarMirror}`.
3. `runHandler` wraps the result via `renderToolResult` → the tool's textual reply to Jarvis →
   `confirmAndRun` emits an `action_result` card (`executed`/`error`) → Jarvis tells Ben the resolved
   time (and whether it was shifted / blocked).

**Read-back:** the event is on Google immediately. The Jarv1s Calendar page (`GET
/api/calendar/events` → `CalendarRepository.listVisible`, owner-or-share SELECT) shows it once the
mirror is written (or after the next connector-sync run if the mirror was skipped). The
`external_metadata.jarvisCreated` flag lets the UI badge it as Jarvis-created (UI badge is **out of
scope** here — the data carries the flag).

**Future briefing trigger (seam, not built):** the Phase-3 briefing slice constructs the same
`CalendarWriteService` (already in the gateway's `toolServices`) or calls `proposeAndInsert` directly
with a window it chose, and surfaces an Approve/Deny the same way. No focus-time code changes for that.

**Migrations:** **this slice adds none of its own.** It _depends on_ the connector-sync slice's
calendar migration (`0065_calendar_worker_grants_and_google_insert.sql`) for the
`provider_type IN (…,'google')` INSERT relaxation that the cache mirror needs. If the build sequence
ever puts focus-time first, the mirror simply runs in `skipped-rls` mode until connector-sync lands —
no migration is authored here, honoring "never edit applied migrations / module SQL in the owning
module's `sql/`." (If a build decision later wants the focus-time event to carry a distinct
`external_metadata` shape requiring a constraint, that would be a **new** file in
`packages/calendar/sql/` at the next free global number — re-derived at build time; highest applied
today is **0064**, and connector-sync claims **0065–0068**, so the next free is **0069+**.)

---

## Error handling

- **Missing/insufficient scope:** `hasCalendarWriteScope` false → no Google call; return the
  re-consent message. Tested.
- **No active Google connection:** `getFreshAccessToken` throws `GoogleConnectError` ("No active
  Google connection", `google-connection.ts:112`) → caught in `proposeAndInsert` → return
  `{created:false}` with "Connect Google in Settings first." Never leak internals.
- **Token refresh failure:** `getFreshAccessToken`'s refresh throws (`oauth.ts:125`, message is
  `Google token endpoint returned <status>` — already body-free per the `oauth.ts:122` rule) →
  caught → `{created:false}` with "Couldn't refresh your Google access — reconnect in Settings."
- **Google freeBusy/insert non-2xx or network:** the `GoogleApiClient` (connector-sync component 1)
  throws `Google <api> returned <status>` with **no response body** in `Error.message` (the
  `oauth.ts:122` rule — `handleRouteError` echoes `Error.message`; the gateway's `runHandler` already
  swallows handler throws into a generic `Tool … failed`, `gateway.ts:107`). A 401 on
  freeBusy/insert triggers one forced-refresh-and-retry (connector-sync client already does this).
- **Conflict (window busy):** not an error — `chooseSlot` shifts to the next clear slot
  (`shifted:true`) or returns `no-clear-slot` (`created:false`, reported as "no clear slot in that
  window — try a different time"). No partial write.
- **Cache mirror failure (RLS not relaxed yet, or any DB error):** caught inside `proposeAndInsert`;
  the Google event still exists; `calendarMirror` records why it was skipped; the call returns
  `created:true`. The mirror is **never** load-bearing for success.
- **Confirmation timeout (150 s):** existing gateway behavior — `confirmAndRun` returns
  `denied:true, reason:"Timed out … still pending in your drawer."` (`gateway.ts:151`). **No Google
  write happens** because `execute` runs only after `confirmed` (`gateway.ts:158`). This is the key
  safety property: a timed-out or denied proposal never touches the calendar.
- **Server restart mid-confirmation:** orphans the in-flight call (ADR 0005 consequence; accepted) —
  again, **no write occurs** because the write is after approval.
- **Invalid input:** `validateToolInput` rejects before the handler (`gateway.ts:69`) → generic
  invalid-input error, no Google call.
- **Idempotency / double-approve:** `resolveActionRequest` only unblocks if the DB row was actually
  updated (still pending + owner matches, `gateway.ts:92`), so a re-approve is a no-op; one approval =
  one insert.

---

## Security & invariants

Citing the CLAUDE.md **Hard Invariants**:

- **No new policy / write→confirm floor (ADR 0005 #3).** The tool is `risk:"write"`, so it rides the
  un-skippable confirm gate (`policy.ts:10`). The locked **ALWAYS-CONFIRM** autonomy is achieved by
  declaration alone — zero edit to `policy.ts`/`gateway.ts`. A focus block is never created without an
  explicit human Approve in the drawer.
- **Secrets never escape.** The Google access/refresh token and OAuth client secret stay inside
  `packages/connectors` — `getFreshAccessToken` returns only a short-lived **access token** to the
  `CalendarWriteService`, which uses it for the immediate Google call and discards it. No token, no
  `client_secret`, no refresh token ever reaches the tool input/output, the action-request summary,
  logs, the pg-boss payload (this slice enqueues **no** job), the frontend, or an AI prompt. The
  `GoogleApiClient` follows the established "never embed response body / token in `Error.message`"
  rule (`oauth.ts:122`). Connector secrets remain AES-256-GCM at rest.
- **DataContextDb only.** Every DB touch (scope check, `getFreshAccessToken`'s refresh-UPDATE,
  `getActiveGoogleAccountSecret`, `upsertCachedEvent`) goes through the branded `scopedDb` the gateway
  supplies via `withDataContext` (`gateway.ts:103`); each repository calls `assertDataContextDb`. No
  root Kysely handle reaches any repository. No raw `fs`.
- **AccessContext shape.** The gateway builds `{actorUserId, requestId}` only (`gateway.ts:101`); the
  4th `services` argument is **not** part of AccessContext/ToolContext identity — it is a separate
  capability channel. No field added to AccessContext.
- **Metadata-only job payloads.** N/A by construction — this slice enqueues **no** pg-boss job (the
  write is synchronous within the approved tool call). The only persisted record is the
  metadata-only `action_request` (tool name, permission, risk, input summary) the gateway already
  writes.
- **Module isolation.** `packages/calendar` does **not** import `packages/connectors`. The calendar
  tool depends only on the `CalendarWriteService` _interface it owns_ (component 3); the _implementation_
  that touches connectors is built in the composition host (`packages/chat`), which is allowed to see
  both. The injection seam is generic (component 1), not a calendar special-case. The calendar tool
  writes only `app.calendar_events` (its own table) via its own repository.
- **Provider-agnostic AI.** N/A — focus-time involves **no LLM/model call** (the "AI" is the chat
  CLI driving the tool, which is provider-agnostic by the existing chat adapter; the tool itself
  requests no capability tier and hardcodes no provider/model). The slot logic is deterministic.
- **Never edit applied migrations; module SQL in the owning module's `sql/`.** This slice authors **no**
  migration (it consumes connector-sync's 0065). Any future calendar SQL would be a **new** file in
  `packages/calendar/sql/` at the next free global number.
- **RLS applies to all actors including admins; private by default.** The mirror INSERT runs under the
  actor's RLS; the calendar INSERT policy still pins `owner_user_id = current_actor_user_id()`
  (`0020:29`) and the connector-account-ownership EXISTS check (`0020:30`). No `BYPASSRLS`. The event
  is owner-only.

> **Independent-review reflex:** this slice is the **first real outbound write to a third party
> (Google) on the user's behalf.** Per project memory ("CI-green ≠ secure — independent review for
> auth/crypto/RLS/agency PRs"), the PR MUST get an independent review confirming: (1) the tool is
> `risk:"write"` and **cannot** write without an Approve (no path bypasses `confirmAndRun`); (2) no
> token/secret reaches the tool I/O, the action-request summary, or any log; (3) the
> `CalendarWriteService` is constructed only in the composition host and `calendar` has no
> `connectors` import; (4) the scope check gates the insert. Adversarial second opinion
> (`/codex-review` or a Claude critic) on the injection seam + the no-write-without-approval property
> is recommended.

---

## Testing strategy

All DB tests run via Vitest against the `pnpm db:up` Postgres with RLS on (per CLAUDE.md). Google HTTP
is faked at the `fetch` boundary (the `GoogleApiClient` takes an injectable `fetch`, mirroring
`GoogleOAuthClient`'s `fetchFn?`, `oauth.ts:60`) — **never live in CI**.

- **Pure propose logic (`focus-time.ts`, unit):** `resolveWindow` maps partOfDay/date/start +
  timezone to a window (table-driven: morning/afternoon/evening, explicit start, default tomorrow,
  duration clamping 15..480). `chooseSlot` against synthetic busy intervals: empty window → requested
  slot; partial overlap → shifted to next clear slot (`shifted:true`); fully busy day/part → `no-clear-
slot`; exact-fit gap chosen.
- **Injection seam (`gateway` + `module-sdk`, integration):** a fake module with a tool declaring
  `requiresServices:["x"]` whose `execute` reads `services.x` receives the registered service; a tool
  that ignores the 4th arg still runs (backwards compat); `requiresServices` key absent from
  `toolServices` is asserted at wiring (build-time guard test). Existing tools (`calendar
.listVisibleEvents`, `tasks.focus`, etc.) still dispatch unchanged.
- **`CalendarWriteService` impl (integration, faked Google `fetch`):**
  - happy path: scope present → freeBusy returns empty → insert called with `calendarId:"primary"`,
    correct `start/end/summary`, `extendedProperties.private.jarvisCreated:"true"` → returns
    `created:true, googleEventId` → cache mirror row written (when 0065 present) with
    `external_metadata.jarvisCreated:true`.
  - conflict: freeBusy returns a busy interval over the requested window → result `shifted:true` with
    the next clear slot; fully-busy → `no-clear-slot`, **insert NOT called**.
  - missing scope: account without `…/auth/calendar` → re-consent message, **freeBusy/insert NOT
    called**.
  - no connection / refresh failure / Google non-2xx: each → `created:false` (or generic failure), no
    leaked secret/body in any error string.
  - mirror skip: with the calendar INSERT policy _not_ relaxed (simulate by using a non-google
    connector account) → insert succeeds (Google faked) but mirror → `skipped-rls`, call still
    `created:true`.
- **No-write-without-approval (the safety property, integration):** drive the full gateway path; a
  **denied** resolution and a **timeout** each yield no `events.insert` call (assert the faked Google
  `fetch` was never hit for insert). An **approved** resolution yields exactly one insert.
- **Scope verification (integration):** `hasCalendarWriteScope` true for the granted account, false
  for a pre-existing narrower account; the re-consent `buildAuthUrl` carries `prompt=consent`
  (assert on the existing `oauth.ts:79`).
- **Secret containment (integration/review):** assert the action-request `inputSummary` and the tool
  result contain no token/secret; assert `Error.message` from a faked Google 500 carries no body.
- **Gate:** `pnpm verify:foundation` (lint, format, file-size <1000 lines, typecheck, db:migrate,
  integration) + `pnpm audit:release-hardening` green. New calendar test file wired into the gate
  (`pnpm test:calendar-email` or a dedicated script if added).
- **Live round-trip (manual, headless box):** connect Ben's Google → in the drawer "block 2 hours
  tomorrow morning" → Approve → confirm a real event with the Jarvis tag in Google Calendar → confirm
  it appears on the Jarv1s Calendar page → request a window that's busy → confirm it shifts or reports
  no slot → deny a proposal → confirm **nothing** is created.

---

## Acceptance criteria

1. A module-owned assistant tool `calendar.proposeFocusBlock` exists on the **calendar** manifest,
   declared `risk:"write"`, `permissionId:"calendar.manage"`, with a validated input schema
   (`date?/partOfDay?/start?/durationMinutes/title?`) and a `summarize` for the Approve/Deny card. It
   adds **no** new policy and **no** edit to `policy.ts`/`gateway.ts`/`confirmation-registry.ts`.
2. Calling the tool routes through the **existing** write→confirm gate: it creates a pending
   metadata-only `action_request`, emits an Approve/Deny card, and **blocks** until resolved. On
   **deny or timeout, no Google write occurs** — proven by a test asserting `events.insert` is never
   called on the faked Google `fetch`. On **approve**, exactly one insert occurs.
3. On approval the tool calls Google `events.insert` on the **primary** calendar with the event tagged
   `extendedProperties.private.jarvisCreated="true"`, and returns the resolved start/end + Google event
   id to the user via the chat reply.
4. Before any Google write the tool calls Google **freeBusy.query LIVE** over the candidate window; a
   busy window is shifted to the next clear slot within the same part-of-day (`shifted:true`), and a
   fully-busy window returns `no-clear-slot` with **no insert**.
5. The created event is **mirrored** into `app.calendar_events` with
   `external_metadata.jarvisCreated:true` when the connector-sync RLS relaxation (calendar migration 0065) is present; when it is absent the mirror is **skipped** (`calendarMirror:"skipped-rls"`) and
   the call still succeeds (the Google event is the source of truth). The mirror is best-effort and
   never fails the call.
6. A **generic** tool-service injection seam exists: `ModuleAssistantToolManifest.requiresServices?`,
   a 4th `services` argument on `ToolExecute`, and `toolServices` on the gateway — none of it
   special-cases calendar. Existing tools (which ignore the 4th arg) still dispatch unchanged. The
   `CalendarWriteService` **interface is owned by `packages/calendar`**; its **implementation is built
   in `packages/chat`** (the composition host). `packages/calendar` does **not** import
   `packages/connectors`.
7. The calendar-write scope is **verified** (`hasCalendarWriteScope`) before any Google write; a
   pre-existing account lacking `https://www.googleapis.com/auth/calendar` yields a clear re-consent
   message (no insert), and re-consent reuses the existing `buildAuthUrl` (`prompt=consent`,
   `access_type=offline`) with **no new OAuth code**.
8. **No secret escapes:** the Google access/refresh token and client secret never appear in the tool
   input/output, the action-request summary, logs, the frontend, or an AI prompt; the
   `CalendarWriteService` receives only a short-lived access token and discards it. Google errors carry
   no response body in `Error.message`. The slice enqueues **no** pg-boss job (no payload to leak).
9. There is a **clean seam** for the future briefing slice to call `proposeAndInsert` (or the same
   `calendarWrite` service) programmatically; that caller is **documented, not built**. The MVP trigger
   is **explicit user ask only**.
10. The slice authors **no migration of its own** (it consumes connector-sync's calendar migration);
    no applied migration is edited; module isolation, DataContextDb-only, and the AccessContext shape
    are all preserved.
11. `pnpm verify:foundation` and `pnpm audit:release-hardening` are green; the PR carries an
    independent review of (a) the no-write-without-approval property and (b) secret containment +
    module-isolation of the injection seam.

---

## Out of scope / deferred

- **Autonomous / proactive triggering** (briefing or cron proposing focus blocks unprompted). The seam
  is built; the caller is the Phase-3 briefing slice (epic #48 #2). **Not built here.**
- **Configurable autonomy** (auto-create without confirm, per-user policy). Locked to ALWAYS-CONFIRM;
  configurable policy is the Module Connector epic (#30), and the destructive/write floor survives it
  (ADR 0005 #3).
- **Editing/deleting/moving** existing focus blocks (a `destructive` tool would be a later slice with
  the always-confirm floor). MVP is **create only**.
- **Recurring focus blocks**, smart "find me the best 2 hours this week" multi-day search, or
  learning preferred focus times. MVP resolves a single window from explicit input.
- **Secondary calendars / multiple Google accounts.** Primary calendar of the single unified Google
  connection only (matches M-B1 / connector-sync).
- **UI badge for Jarvis-created events** on the Calendar page. The data carries
  `external_metadata.jarvisCreated`; rendering a badge is a small follow-up, not required for the
  agency win.
- **The Google REST client itself** (`events.insert` + `freeBusy.query` methods). Built by the
  **connector-sync slice** (its component 1, structured for this reuse). This slice **consumes** it.
- **The calendar cache-mirror RLS relaxation** (`provider_type IN (…,'google')`). Built by the
  **connector-sync slice** (migration 0065). This slice **depends on** it and degrades gracefully if
  absent.
- **Any pg-boss job / async path.** The write is synchronous within the approved tool call.

---

## Open risks

1. **`summarize` is sync; freeBusy is async — card accuracy.** The Approve/Deny card text comes from
   the synchronous `summarize` (`gateway.ts:168`, no `await`), so it shows the **requested** window,
   while the actual conflict check + any slot-shift happens in `execute` **after** approval. Ben could
   approve "09:00–11:00" and get "10:00–12:00" (the next clear slot). **Chosen resolution:** the card
   text explicitly says "(or the next clear slot if busy)" and the post-approval tool reply states the
   **resolved** time; the shift is bounded to the same date/part-of-day. **Alternative (heavier, noted):**
   a two-step tool (`proposeFocusBlock` returns a concrete slot as a _read_, then a separate
   `confirmFocusBlock` _write_ inserts the exact slot the card showed) — rejected for the MVP as
   double the round-trips and tool count, but it is the clean upgrade if approve-then-shift proves
   confusing in the live round-trip. Re-evaluate after Ben uses it.
2. **Hard build-order dependency on connector-sync.** The `GoogleApiClient` (`events.insert` +
   `freeBusy`) and the calendar RLS relaxation both come from the connector-sync slice. If focus-time
   builds first, it cannot insert/conflict-check at all. **Mitigation:** sequence connector-sync first
   (it is epic #48 criterion #1, naturally earlier); if parallelized, coordinate via
   `herdr-pane-message`, and the focus-time build stubs the client behind the
   `CalendarWriteService` interface so its own logic/tests land while waiting. The cache mirror already
   degrades to `skipped-rls` if 0065 is late.
3. **Timezone correctness.** Mapping "tomorrow morning" to a wall-clock window depends on the user's
   calendar timezone, and Google freeBusy/events use RFC3339 with offsets. A wrong tz silently books
   the wrong hour. **Mitigation:** resolve tz from the primary calendar (Google `calendars.get` /
   settings) once, pass it through `resolveWindow`, and **test** the partOfDay→window mapping across at
   least one non-UTC tz; never default to UTC silently.
4. **Generic seam scope-creep / over-engineering.** Building a fully generic service registry for a
   single first consumer risks gold-plating. **Mitigation:** keep it minimal — one optional manifest
   field, one optional 4th arg, one flat `Record<string,unknown>` on the gateway. It is deliberately
   the smallest thing that keeps `calendar` from importing `connectors`; no DI container, no lifecycle.
5. **freeBusy reflects only the primary calendar's busy state.** If Ben has other calendars he treats
   as authoritative, a "clear" primary slot might still conflict. **Mitigation (MVP):** primary only,
   documented; multi-calendar freeBusy `items` is a trivial later extension (same API call, more
   `items`).
6. **Testing-mode ~7-day refresh-token expiry** (carried from M-B1 / ADR 0006). If the refresh token
   has expired, the write fails at `getFreshAccessToken`; the tool returns a reconnect message.
   Re-confirm in the live round-trip; fallback is "publish app to production-unverified."
7. **Approve latency vs. token freshness.** The 150 s confirm window plus think-time could in theory
   straddle a token expiry; `getFreshAccessToken` is called **after** approval inside `execute`
   (`gateway.ts:158` → `runHandler`), and it refreshes on <60 s-to-expiry, so the token is always fresh
   at write time. Verified by reading the call order; noted so a future refactor doesn't move the token
   fetch before the confirm.
