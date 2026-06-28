# Jarvis Calendar Delete Tool (#557)

**Status:** Draft
**Date:** 2026-06-28
**Owner:** Ben + Coordinator fleet
**Issue:** #557 — Jarvis should be able to delete calendar items on request.
**Tier:** security (write/destructive external action — always-confirm, connector credentials, RLS)
**Depends on:** #534 explicit action permission tiers, existing calendar focus-block write path
(`calendar.proposeFocusBlock`), Google connector OAuth/scope machinery.
**Related follow-ups:** future `calendar.create`/`calendar.move` reversible event-changes family,
recurring-series handling, multi-calendar support, undo/restore.
**Grounded on:**
`~/Jarv1s/packages/calendar/src/tools.ts`,
`~/Jarv1s/packages/calendar/src/manifest.ts`,
`~/Jarv1s/packages/calendar/src/repository.ts`,
`~/Jarv1s/packages/calendar/src/calendar-write-service.ts`,
`~/Jarv1s/packages/calendar/sql/0113_worker_calendar_events_delete.sql`,
`~/Jarv1s/packages/calendar/sql/0087_calendar_events_update_connector_scope.sql`,
`~/Jarv1s/packages/chat/src/calendar-write-impl.ts`,
`~/Jarv1s/packages/connectors/src/google-api-client.ts`,
`~/Jarv1s/packages/connectors/src/repository.ts`,
`~/Jarv1s/packages/module-sdk/src/index.ts`,
`~/Jarv1s/packages/ai/src/gateway/gateway.ts`,
`~/Jarv1s/docs/superpowers/specs/2026-06-27-explicit-action-permission-tiers.md`.

## 1. Problem

Jarvis can read calendar events (`calendar.listVisibleEvents`) and create focus blocks
(`calendar.proposeFocusBlock`), but it cannot delete a calendar item. When a user says "cancel my
3pm" or "delete that focus block you made," Jarvis has no tool to act and the user must switch to
Google Calendar. The read/create asymmetry breaks the assistant flow and undermines the "Jarvis
manages my calendar" promise.

The danger is that calendar deletion is **externally visible and effectively irreversible**:
deleting an event with attendees sends cancellation notices, and there is no Jarvis-side undo. The
tool must therefore execute only behind an explicit, unbypassable confirmation, must touch only the
owner's own events under RLS, and must never expose connector credentials.

## 2. Decision

Add a single assistant tool, **`calendar.deleteEvent`** (V1, single event only).

Properties:

- `risk: "write"`, `actionFamilyId: "calendar_management"`.
- **Always requires explicit user confirmation. No auto-run, ever.** This is guaranteed two
  independent ways (belt-and-suspenders, see §6): the tool does **not** declare
  `executionPolicy: "auto"`, and the `calendar_management` action family is **locked** to
  `allowedTiers: ["always_confirm"]`.
- The tool resolves the user's cached event by our internal id, looks up the connector account and
  the Google event id, calls the Google connector's event-delete endpoint, then best-effort removes
  the now-deleted row from the local cache.
- All data access is owner-scoped through `DataContextDb`; connector credentials come from the
  vault-backed connector secret and never leave the composition host.

V1 deliberately deletes exactly one event by id. Bulk delete, recurring-series semantics, and undo
are out of scope (§9).

### Why `write` and not `destructive`, and how always-confirm still holds

#534 §10 says "deletes/cancellations that notify others should be considered destructive unless the
calendar spec proves a safe reversible flow." This spec keeps the declared `risk` as `write` (so the
calendar module can render an explicit, user-legible "Delete calendar events" settings row rather
than a bare destructive floor), but **denies the tool any path to autonomous execution**:

1. `resolvePolicy()` returns `"confirm"` for any `write` tool whose `executionPolicy !== "auto"`.
   `calendar.deleteEvent` never sets `executionPolicy: "auto"`, so the gateway confirms before the
   family is even consulted.
2. Even if a future edit added `executionPolicy: "auto"` by mistake, the `calendar_management`
   family declares `allowedTiers: ["always_confirm"]`; the gateway enforces stored tiers against
   manifest `allowedTiers` at runtime (#534 §7) and falls closed to `confirm`.

The net effect equals the destructive floor. A reviewer who prefers may additionally set
`risk: "destructive"`; the design below is unchanged because the confirm path is identical.

## 3. Current Architecture Anchor

Reuse the existing focus-block write seam end to end; do not invent a parallel one.

- **Tool layer** (`packages/calendar/src/tools.ts`): tools narrow an injected composition-layer
  service via `narrowCalendarWrite(services)`. `calendar.proposeFocusBlock` shows the exact pattern:
  module-owned `execute` + sync `summarize`, with the heavy lifting in an injected service.
- **Service contract** (`packages/calendar/src/calendar-write-service.ts`): `CalendarWriteService`
  is owned by the calendar package (so no connector import leaks into the module); the concrete impl
  lives in the composition host `packages/chat`, which may import connectors. Extend this interface
  with `deleteEvent`.
- **Service impl** (`packages/chat/src/calendar-write-impl.ts`): `buildCalendarWriteService` already
  does scope-check → fresh token → Google call → best-effort cache mirror, with disciplined
  body-free error messages. The delete impl mirrors this shape.
- **Connector client** (`packages/connectors/src/google-api-client.ts`): `GoogleApiClient` has
  `freeBusy` and `insertEvent`. Add `deleteEvent`. The client already keeps response bodies out of
  `Error.message` (a hard rule — `handleRouteError` propagates `Error.message` to HTTP responses).
- **Scope + account** (`packages/connectors/src/repository.ts`): `getCalendarWriteScopeState` is the
  authoritative propose-time write-scope gate; `getActiveGoogleAccountSecret` resolves the active
  account. Both are owner-RLS-scoped and never decrypt unless needed.
- **Repository** (`packages/calendar/src/repository.ts`): `getById(scopedDb, eventId)` returns the
  cached row (carrying `connector_account_id` and `external_id`). `deleteStaleCachedEvents` shows
  the existing owner+connector-scoped delete pattern.
- **RLS** (`packages/calendar/sql/0113_*.sql`): DELETE on `app.calendar_events` is granted today
  **only to `jarvis_worker_runtime`** (sync reconciliation). The assistant gateway runs in the API
  process under `jarvis_app_runtime`, so an immediate cache delete needs a new app-runtime DELETE
  policy (§5).
- **Gateway** (`packages/ai/src/gateway/gateway.ts`): `confirmAndRun()` creates
  `app.ai_assistant_action_requests`, emits the chat action-request card from `summaryFor(...)`,
  waits for Approve/Deny, and runs `runHandler()` only after approval. `summarize` is **synchronous**
  (`(input, ctx) => string`) — it cannot do a DB lookup (§4).

## 4. Tool Contract

### 4.1 Manifest entry (`packages/calendar/src/manifest.ts`)

```ts
{
  name: "calendar.deleteEvent",
  description:
    "Delete a single calendar event the user owns. Always asks for confirmation; on approval " +
    "the event is removed from the user's Google Calendar (attendees are notified of the " +
    "cancellation). One event at a time; cannot delete recurring series.",
  permissionId: "calendar.manage",
  risk: "write",
  actionFamilyId: "calendar_management",
  // No executionPolicy: "auto" -> gateway confirms (see §2, §6).
  requiresServices: ["calendarWrite"],
  inputSchema: {
    type: "object",
    required: ["eventId"],
    properties: {
      eventId: { type: "string", description: "Jarvis calendar event id (uuid) from listVisibleEvents" },
      displayTitle: { type: "string", description: "Card preview only; the eventId is authoritative" },
      displayWhen: { type: "string", description: "Card preview only, e.g. 'Fri Jun 28, 14:00–15:00'" }
    }
  },
  outputSchema: deleteCalendarEventResponseSchema, // packages/shared
  execute: calendarDeleteEventExecute,
  summarize: summarizeDeleteEvent
}
```

And the locked action family (consumed by #534's policy + the calendar settings surface):

```ts
assistantActionFamilies: [
  {
    id: "calendar_management",
    label: "Delete calendar events",
    description: "Let Jarvis delete events from your calendar. Always asks first.",
    defaultTier: "always_confirm",
    allowedTiers: ["always_confirm"] // locked; no user setting can promote to auto-run
  }
]
```

`calendar_management` is intentionally **separate** from any future reversible "event changes"
family that might host `calendar.create`/`calendar.move` with `trusted_auto`. Deletes never share a
promotable family.

### 4.2 The synchronous-summarize constraint (load-bearing)

`summarize` cannot fetch the event from the DB. The model supplies optional `displayTitle` /
`displayWhen` (copied from a prior `calendar.listVisibleEvents` result) **for card text only**. The
binding fact is `eventId`; `execute` re-resolves the real row by id under `DataContextDb` and that
row — not the model-supplied text — determines what is deleted.

`summarizeDeleteEvent(input, ctx)` renders, e.g.:

> Delete **"Board sync"** (Fri Jun 28, 14:00–15:00) from your calendar? Attendees will be notified
> of the cancellation. This can't be undone from Jarvis.

If `displayTitle`/`displayWhen` are absent it falls back to a generic but honest line ("Delete this
calendar event? Attendees will be notified; this can't be undone from Jarvis."). The residual
trust gap (model could mislabel the card) is bounded in §8 and mitigated by returning the
**actually-deleted** title in the result so any mismatch is visible in the chat turn immediately
after approval.

### 4.3 Service contract extension (`packages/calendar/src/calendar-write-service.ts`)

```ts
export interface DeleteEventInput {
  readonly eventId: string; // Jarvis cached event uuid (authoritative)
}

export interface DeleteEventResult {
  readonly deleted: boolean;
  readonly googleDeleted: "deleted" | "already-gone" | "skipped-no-scope" | "skipped-error";
  readonly cacheMirror: "deleted" | "skipped-rls" | "skipped-error" | "not-cached";
  /** The real title of the deleted row, read under DataContextDb. Never a secret. */
  readonly deletedTitle?: string;
  /** Human-facing reason when deleted=false. Never a secret/body. */
  readonly message?: string;
}

export interface CalendarWriteService {
  proposeAndInsert(/* existing */): Promise<ProposeFocusResult>;
  deleteEvent(scopedDb: unknown, ctx: ToolContext, input: DeleteEventInput): Promise<DeleteEventResult>;
}
```

### 4.4 Connector client method (`packages/connectors/src/google-api-client.ts`)

```ts
async deleteEvent(input: {
  accessToken: string;
  calendarId?: string; // default "primary"
  eventId: string;     // Google external event id
}): Promise<{ deleted: "deleted" | "already-gone" }>;
```

- Issues `DELETE /calendars/{calendarId}/events/{eventId}` (add a private `deleteVoid` helper;
  Google returns `204 No Content`, no JSON body).
- Treats `404`/`410` as **idempotent success** (`already-gone`) — the event is already deleted.
- `403` (no write permission on that calendar / read-only shared calendar) throws `GoogleApiError`
  with status; the impl maps it to a permission message.
- Never embeds the response body in `Error.message` (same rule as `getJson`/`postJson`).

## 5. Execute Flow (`packages/chat/src/calendar-write-impl.ts`)

`calendarDeleteEventExecute` (in `packages/calendar/src/tools.ts`) narrows `services.calendarWrite`
and calls `deleteEvent`. The impl:

1. `assertDataContextDb(scopedDb)`.
2. **Resolve the cached row:** `calendarRepository.getById(scopedDb, input.eventId)`. If undefined →
   return `{ deleted: false, googleDeleted: "skipped-error", cacheMirror: "not-cached",
   message: "That event isn't in your calendar — it may already be gone." }`. No Google call. (RLS
   already guarantees the row, if returned, is owner-visible.)
3. **Scope gate:** `getCalendarWriteScopeState(scopedDb)`; if no active account or `!hasScope` →
   `{ deleted: false, googleDeleted: "skipped-no-scope", cacheMirror: "not-cached",
   message: "Your Google connection doesn't have calendar-write permission yet — reconnect in
   Settings to grant it." }`.
4. **Fresh token:** `googleService.getFreshAccessToken(scopedDb)`; on `GoogleConnectError` →
   "Connect Google in Settings first."; other → "Couldn't refresh your Google access — reconnect in
   Settings." (mirrors `proposeAndInsert`).
5. **Calendar id:** use `row.external_metadata.calendarId` when present, else `"primary"` (V1 default;
   focus blocks and freeBusy all use `primary`).
6. **Delete at Google:** `googleApiClient.deleteEvent({ accessToken, calendarId, eventId: row.external_id })`.
   - `deleted`/`already-gone` → success; proceed to cache mirror.
   - `GoogleApiError` 403 → `{ deleted: false, googleDeleted: "skipped-error",
     cacheMirror: "not-cached", message: "You don't have permission to delete events on that
     calendar." }`.
   - other error → `{ deleted: false, googleDeleted: "skipped-error", cacheMirror: "not-cached",
     message: "Couldn't delete the event — try again." }`.
7. **Best-effort cache mirror:** delete the cached row by id, owner+connector scoped. Classify
   failures exactly like `mirrorEvent`: SQLSTATE `42501` (or RLS message regex) → `skipped-rls`
   (Google is the source of truth; the next sync reconciliation removes the row); any other error →
   `skipped-error`. **Never rethrow** — a cache miss must not fail a successful external delete.
8. Return `{ deleted: true, googleDeleted, cacheMirror, deletedTitle: row.title }`.

A new repository method `deleteById(scopedDb, eventId)` (owner+connector scoped, mirroring
`deleteStaleCachedEvents`) performs step 7.

## 6. Permission Tier Enforcement (#534)

- `calendar.deleteEvent` is `risk: "write"` with **no** `executionPolicy: "auto"` →
  `resolvePolicy()` returns `"confirm"` unconditionally.
- The `calendar_management` family is locked (`allowedTiers: ["always_confirm"]`); even a stale or
  hand-edited `trusted_auto` preference fails the manifest `allowedTiers` check and falls closed to
  `confirm`.
- The calendar settings surface renders `calendar_management` as a **locked "Always confirm"** row
  (no toggle), consistent with #534 §8's destructive/external-send row treatment.
- Source-behavior toggles (e.g. `calendar.writeback`) and source permissions do **not** grant delete
  execution (#534 §9). Tool availability = module enabled + `calendar.manage` permission + active
  Google account with calendar-write scope; the confirm card is the safety gate.

## 7. RLS, Migrations, and Credentials

- **New migration** (next global number at landing; lives in `packages/calendar/sql/`, never in
  `infra/`): grant `DELETE ON app.calendar_events TO jarvis_app_runtime` and add an owner-scoped +
  connector-scoped DELETE policy for `jarvis_app_runtime`, **structurally identical to 0113** (the
  worker-runtime delete policy): `app.current_actor_user_id() = owner_user_id` AND an `EXISTS` guard
  that the `connector_account_id` belongs to the actor and holds the calendar scope. FORCE RLS
  stays; no `BYPASSRLS`. Add the new migration filename to `calendarModuleManifest.database.migrations`
  **and** to `foundation.test.ts`'s asserted migration list (it uses `toEqual` on the full list).
- Owner isolation: `getById` and the cache delete are owner-RLS-scoped; user A can never resolve or
  delete user B's event (the row is invisible cross-user).
- Connector credentials: the access token is obtained inside the composition host via
  `getFreshAccessToken` and passed only to the Google client. It is never returned to the tool
  result, never logged, never placed in a job payload or AI prompt. The encrypted connector secret
  is never decrypted into the tool/result path.
- This tool runs **inline** in the gateway turn (like `proposeFocusBlock`); it enqueues no job. No
  pg-boss payload is involved, so the metadata-only-payload invariant is satisfied by construction.

## 8. Privacy, Safety, Auditability

- The action-request row stores metadata only: tool name, permission id, `risk`, a bounded input
  summary, request id, status, timestamps. The card text comes from `summarize`; no secrets or
  bodies.
- Logs include actor id, module id (`calendar`), tool name, action family, effective tier
  (`always_confirm`), outcome (`deleted`/`already-gone`/`skipped-*`), Google status class, and
  duration. **Never** log event title, attendee data, the access token, or the connector secret.
- The model-supplied `displayTitle`/`displayWhen` affect the confirmation card only. `execute`
  deletes strictly by `eventId` resolved under RLS and returns the **true** `deletedTitle`, so a
  mislabeled card surfaces as an obvious mismatch in the post-approval turn. This bounds, and makes
  visible, the only trust gap created by synchronous `summarize`.
- Deletes are externally visible and effectively irreversible; the always-confirm floor (§6) is the
  primary safeguard. The card explicitly warns that attendees are notified and that Jarvis cannot
  undo the delete.

## 9. Out of Scope

- **Bulk delete** (delete many events in one call). V1 is one event per approval.
- **Recurring series handling.** V1 deletes the single event id Google resolves. "This and
  following," "all events in series," and instance/exception semantics are a follow-up; the tool
  description tells the model it cannot delete a series.
- **Undo / restore.** No Jarvis-side restore. Google's own trash/undo is out of scope.
- **Multi-calendar robustness.** V1 targets the row's recorded calendar id or `primary`. Discovering
  and disambiguating non-primary calendars is a follow-up.
- **New OAuth / scope-grant flows.** Reuse the existing calendar-write scope; if absent, the tool
  returns the reconnect message.
- **`calendar.move` / `calendar.create`** and any reversible event-changes family.

## 10. Acceptance Criteria

- [ ] `calendar.deleteEvent` is registered with `risk: "write"`,
      `actionFamilyId: "calendar_management"`, `requiresServices: ["calendarWrite"]`, and no
      `executionPolicy: "auto"`.
- [ ] The `calendar_management` action family is declared with `allowedTiers: ["always_confirm"]`
      and renders as a locked row in calendar settings.
- [ ] Invoking the tool always produces an action-request confirmation card; it never auto-runs,
      including with a stale/hand-edited `trusted_auto` preference.
- [ ] On approval, the event is deleted from the user's Google Calendar and (best effort) removed
      from `app.calendar_events`.
- [ ] Deleting an unknown/owner-invisible `eventId` returns a friendly "already gone" result and
      makes no Google call.
- [ ] Missing calendar-write scope returns the reconnect message and makes no Google call.
- [ ] Google `404`/`410` is treated as idempotent success; `403` returns the no-permission message;
      other Google errors return a generic try-again message — never leaking a response body.
- [ ] A cache-delete RLS/`42501` failure is classified `skipped-rls` and does **not** fail an
      otherwise-successful external delete.
- [ ] The result carries the real `deletedTitle` read under `DataContextDb`; the model-supplied
      display fields never determine which event is deleted.
- [ ] New app-runtime DELETE migration is owner+connector scoped, keeps FORCE RLS, adds no
      `BYPASSRLS`, lives in `packages/calendar/sql/`, and is added to both the manifest migration
      list and `foundation.test.ts`.
- [ ] User A cannot delete user B's event.
- [ ] No access token or connector secret appears in tool results, logs, action-request rows, or
      prompts.

## 11. Verification

Local gate:

```bash
pnpm lint
pnpm format:check
pnpm typecheck
pnpm test:calendar-email
pnpm test:connectors
pnpm test:ai
pnpm test:ai-tools
pnpm test:api
```

(If CI is unavailable, record the exact commands and exit codes per CLAUDE.md.)

Targeted tests:

- gateway always routes `calendar.deleteEvent` through `confirmAndRun` (never `runHandler`
  directly), even with a `trusted_auto` preference seeded for `calendar/calendar_management`;
- the `calendar_management` family rejects any tier other than `always_confirm` at runtime;
- unknown/owner-invisible `eventId` → no Google call, "already gone" result;
- missing calendar-write scope → no Google call, reconnect message;
- happy path: `getById` → `getFreshAccessToken` → `deleteEvent("deleted")` → cache row removed,
  `deleted: true`, `deletedTitle` equals the stored title;
- Google `410`/`404` → `already-gone`, still `deleted: true`, cache row removed;
- Google `403` → `deleted: false`, no-permission message, cache row untouched;
- cache delete raising SQLSTATE `42501` → `cacheMirror: "skipped-rls"`, `deleted: true` (not
  rethrown);
- RLS isolation: actor B cannot `getById` or delete actor A's event;
- result/log/action-request assertions contain no access token, secret, or event body;
- `foundation.test.ts` migration list includes the new app-runtime delete migration.
```
