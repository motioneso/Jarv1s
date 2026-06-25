# Provider-Agnostic Live Gmail and Calendar Tools

**Date:** 2026-06-25
**Status:** Approved design - pending written-spec review
**Owner:** Ben

## Problem

Jarvis currently has two different meanings for "Gmail/Calendar access":

- The Jarv1s Google connector, stored in the Jarv1s database, used for sync/cache and existing
  calendar block-time writes.
- Provider-owned app/tool auth inside the current LLM runtime, such as Codex or Claude connector
  auth.

That split is user-hostile. Re-authing Google in Jarv1s should be enough for Jarvis to read Gmail,
read Calendar, and create approved calendar focus blocks, regardless of which LLM provider is driving
the chat.

## Goal

Expose Jarv1s-owned MCP assistant tools for live Gmail and Calendar reads, backed only by the
existing Jarv1s Google OAuth connection. Keep calendar block-time creation on the existing
Jarv1s-owned approval-gated write path.

Success means a Codex, Claude, or future LLM session can use Jarvis MCP tools for live Gmail and
Calendar without any provider-specific Gmail/Calendar connector auth.

## Non-Goals

- No provider-owned Gmail/Calendar MCP or app connector dependency.
- No new Google OAuth flow.
- No email send, draft, reply, archive, or label mutation.
- No broad calendar event editor. The only write in this slice is the existing approved
  `calendar.proposeFocusBlock` block-time flow.
- No weakening of the assistant tool gateway's write-confirmation policy.

## Design

Add live read assistant tools owned by the `connectors` module, because that module already owns the
Google OAuth bundle and `GoogleApiClient`. The user-facing tool names expose the domain capability,
not the implementation module:

- `gmail.searchLive`
- `gmail.getLiveMessage`
- `calendar.listLiveEvents`

Keep the existing `calendar.proposeFocusBlock` tool unchanged for calendar block creation. It already
uses the Jarv1s Google connector, live free/busy, a user approval gate, and a deterministic insert id.

### Why the Tools Live in `connectors`

`packages/ai/src/gateway/gateway.ts` intentionally gives read tools no injected services and hides
read tools that declare `requiresServices`. That preserves the write-confirmation floor: a read tool
cannot receive a service that might write.

So the minimal safe design is not to inject a Google service into the calendar/email read modules.
Instead, put the live read handlers in `packages/connectors`, where the Google credential service and
Google API client already belong. This avoids a gateway policy change and keeps OAuth code in one
module.

### Tool Behavior

#### `gmail.searchLive`

Inputs:

- `query?: string` - Gmail search query. Defaults to recent mail with a narrow safe query such as
  `newer_than:30d`.
- `limit?: number` - default 10, clamp 1..20.

Behavior:

1. Get a fresh Jarv1s Google access token with `GoogleConnectionService.getFreshAccessToken`.
2. Call Gmail `users.messages.list` through `GoogleApiClient.listMessageIds`.
3. Fetch up to `limit` messages with `getMessage`.
4. Parse each message with the existing Gmail parser used by sync.
5. Return bounded metadata and snippets suitable for tool output.

Output fields per message:

- `id`
- `threadId`
- `from`
- `to`
- `subject`
- `snippet`
- `receivedAt`
- `labelIds`

Top-level output also includes `skipped: number` for per-message fetch/parse failures. Do not return
full body text from search.

#### `gmail.getLiveMessage`

Inputs:

- `id: string` - Gmail message id returned by `gmail.searchLive`.

Behavior:

1. Get a fresh Jarv1s Google access token.
2. Fetch the message with `GoogleApiClient.getMessage`.
3. Parse headers and body with the existing parser.
4. Return a capped plain-text body.

Output:

- `id`
- `threadId`
- `from`
- `to`
- `subject`
- `snippet`
- `receivedAt`
- `labelIds`
- `bodyText` capped at 12,000 characters

Full Gmail bodies are transient and are never persisted.

#### `calendar.listLiveEvents`

Inputs:

- `timeMin?: string` - RFC3339 instant.
- `timeMax?: string` - RFC3339 instant.
- `limit?: number` - default 20, clamp 1..50.

Defaults:

- If no window is supplied, read from now through 14 days ahead.
- If only one side is supplied, fill the other side with a bounded 14-day window.

Behavior:

1. Get a fresh Jarv1s Google access token.
2. Call `GoogleApiClient.listCalendarEvents` for the primary calendar.
3. Return bounded event fields only.

Output fields per event:

- `id`
- `title`
- `startsAt`
- `endsAt`
- `location`
- `htmlLink`
- `status`
- `attendeeCount`

Do not return raw Google event payloads.

### Calendar Block-Time Write

Use the existing `calendar.proposeFocusBlock` tool as-is:

- risk is `write`
- runs through the assistant confirmation drawer
- uses Jarv1s Google OAuth
- checks live free/busy
- inserts on primary calendar
- mirrors to the calendar cache best-effort

This is the only write capability in scope.

## Components

### Shared Schemas

Add JSON schemas in `packages/shared/src/connectors-api.ts`:

- `gmailSearchLiveInputSchema`
- `gmailSearchLiveResponseSchema`
- `gmailGetLiveMessageInputSchema`
- `gmailGetLiveMessageResponseSchema`
- `calendarListLiveEventsInputSchema`
- `calendarListLiveEventsResponseSchema`

Keep schemas closed with `additionalProperties: false` where existing shared API style does.

### Google API Client

Reuse `packages/connectors/src/google-api-client.ts`.

Needed additions:

- `listMessageIds` already exists.
- `getMessage` already exists.
- `listCalendarEvents` already exists.

No new dependency is needed.

### Gmail Parser Reuse

Reuse the existing parse path from `packages/connectors/src/email-extract.ts`. If the parser is not
exported in the needed shape, export the smallest function/type required instead of duplicating MIME
parsing.

### Connectors Assistant Tools

Add `packages/connectors/src/live-tools.ts` with the three `ToolExecute` handlers.

Register the tools in `packages/connectors/src/manifest.ts`:

- `gmail.searchLive`
- `gmail.getLiveMessage`
- `calendar.listLiveEvents`

Permissions:

- Gmail tools use `connectors.view` in this slice because the live secret and provider access are
  connector-owned.
- Calendar live read uses `connectors.view` for the same reason.
- Existing cached tools keep their current `email.view` and `calendar.view` permissions.
- Existing `calendar.proposeFocusBlock` keeps `calendar.manage`.

Risk:

- All new tools are `read`.
- None declare `requiresServices`.
- All set `externalContent: true`, because Gmail and Calendar content can include third-party text
  and invite content.

## Error Handling

- No active Google account: return a generic tool error asking the user to connect Google in
  Settings.
- Token refresh failure: return a generic reconnect message. Do not expose OAuth error bodies.
- Google 401 on an API call: force refresh once, retry once, then fail generically.
- Google 403: fail generically with a reconnect/scope message.
- Google 429/5xx: fail generically with a retry-later message.
- Per-message Gmail fetch failure in `gmail.searchLive`: skip the message and include a bounded
  `skipped` count.

No tool output includes tokens, client ids, client secrets, raw provider errors, or full raw Google
payloads.

## Security and Privacy

- Identity comes from the Jarv1s MCP session token; each tool call runs under `withDataContext`.
- The active Google connector account is selected under RLS for the actor.
- Secrets stay encrypted at rest and are decrypted only inside the handler process.
- Gmail full bodies are returned only from `gmail.getLiveMessage`, capped before tool output, and not
  persisted.
- Tool outputs use `externalContent: true` for prompt-injection boundary wrapping.
- No provider-owned Gmail/Calendar auth is read or written.

## Verification

Add focused integration tests:

- Tool listing includes the three live read tools when connectors is active.
- A read tool with no `requiresServices` is executable through the gateway.
- No active Google account returns a sanitized failure.
- Mock Google API success returns bounded Gmail search results.
- Mock Google API success returns a capped Gmail message body.
- Mock Google API success returns bounded calendar events.
- A simulated 401 triggers one forced refresh and retry.
- The existing `calendar.proposeFocusBlock` tests remain green.

Manual prod check after deploy:

1. Connect/re-auth Google in Jarv1s Settings.
2. In a Codex-backed Jarvis chat, ask for recent Gmail using `gmail.searchLive`.
3. Ask for upcoming calendar events using `calendar.listLiveEvents`.
4. Ask Jarvis to block focus time; approve the action; verify the event appears on Google Calendar.

## Out of Scope Follow-Ups

- Better cache/worker recovery for stuck `connectors.google-sync` jobs.
- Email send/draft/reply tools.
- Calendar event edit/delete tools.
- Provider-specific connector cleanup UI.
