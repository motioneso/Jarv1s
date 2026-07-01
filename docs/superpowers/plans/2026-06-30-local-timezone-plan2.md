# Local Timezone Plan 2 Implementation Plan

> **For agentic workers:** implement this through the repo's coordinated-build flow. This is a
> build-slice plan, not implementation. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route one resolved user-local IANA timezone through request, chat, tool, planner, and
display paths so relative dates and user-facing times stop drifting to UTC.

**Architecture:** Reuse the shared timezone utilities that already exist in `@jarv1s/shared`
(`localDay`, `formatInZone`, `isValidTimeZone`) and add only the missing resolver/request plumbing.
The live browser timezone wins per request, stored locale settings are the fallback for backend and
worker paths, and `AccessContext` remains exactly `{ actorUserId, requestId }`.

**Tech Stack:** TypeScript, Fastify, React web client, Vitest, `Intl.DateTimeFormat`,
`@jarv1s/shared`, `DataContextRunner` / `PreferencesRepository`.

---

## Current Branch Facts

- `packages/shared/src/time.ts` already exports `localDay`, `formatInZone`, and
  `isValidTimeZone`; do not fork new per-module helpers.
- `packages/settings/src/locale-routes.ts` persists `locale.timezone` through
  `app.preferences`; treat it as real fallback storage, not a stub.
- `apps/web/src/api/client.ts` does not currently send `X-Timezone`.
- Server request objects do not currently expose a validated timezone signal.
- Chat already has useful seams (`getThreadContext().localTimezone`,
  `planCrossToolReasoning({ localNowIso, localTimezone })`), but current `localNowIso` is UTC
  `new Date().toISOString()`.

## Non-Negotiables

- Do not change `AccessContext`; timezone is an explicit request/tool/chat signal.
- Do not add a new date library.
- Do not compute civil days from UTC ISO slicing, `Date.UTC(...)` day boundaries, or `getUTC*`
  date parts unless the code is explicitly doing UTC protocol math and is documented as such.
- Prompt-cache safety: stable persona/session prompt may include the user's timezone; dynamic
  current date/time must be injected per turn or passed to tools, never baked into a long-lived
  persona file.

## Slice 1: Shared Resolver

**Purpose:** Add the missing single source of truth for timezone precedence.

**Files:**

- Modify: `packages/shared/src/time.ts`
- Test: `tests/unit/shared-time.test.ts`

- [ ] Add `resolveTimeZone(headerTz?: string | null, storedTz?: string | null): string`.
- [ ] Implement precedence: valid trimmed header, then valid trimmed stored value, then `"UTC"`.
- [ ] Reuse `isValidTimeZone`; do not duplicate validation.
- [ ] Unit tests:
  - valid header beats valid stored value;
  - invalid header falls back to valid stored value;
  - invalid/blank values fall back to `"UTC"`;
  - whitespace is trimmed.
- [ ] Run:

```bash
pnpm test:unit -- tests/unit/shared-time.test.ts
```

## Slice 2: Web Header + Fastify Request Signal

**Purpose:** Put the browser's current IANA timezone on every normal API request, then validate it
once at the server boundary.

**Files:**

- Modify: `apps/web/src/api/client.ts`
- Modify: `apps/api/src/server.ts` or a small adjacent API request-context helper if the route tree
  needs declaration merging kept out of `server.ts`
- Test: `tests/unit/api-timezone-request.test.ts` or extend the nearest API server/client unit test

- [ ] In `requestJson`, set `X-Timezone` from `Intl.DateTimeFormat().resolvedOptions().timeZone`
      when available and valid-looking as a string. Keep caller-provided headers working.
- [ ] Add a Fastify `onRequest` hook that reads `x-timezone`, validates with shared
      `isValidTimeZone`, and exposes `request.timeZone?: string`.
- [ ] Invalid or missing header must not throw; downstream code handles fallback.
- [ ] Unit tests:
  - client sends `X-Timezone: America/New_York`;
  - caller headers are preserved;
  - server hook accepts valid IANA zones;
  - server hook ignores invalid zones.
- [ ] Run:

```bash
pnpm test:unit -- tests/unit/api-timezone-request.test.ts
```

## Slice 3: Resolved Route/Tool Timezone Without `AccessContext`

**Purpose:** Resolve header + stored locale in route/tool dependencies and pass it explicitly to
callers that need date/time behavior.

**Files:**

- Modify: `packages/module-registry/src/index.ts`
- Modify: `packages/chat/src/routes.ts`
- Modify: `packages/ai/src/gateway/gateway.ts` only if existing `resolveLocalTimezone` needs the
  header-aware source threaded in
- Test: `tests/unit/gateway-policy.test.ts` or a new focused gateway/request test

- [ ] Add a small composition helper that can resolve `resolveTimeZone(request.timeZone, stored)`.
- [ ] For authenticated API requests, read stored locale only when the header is absent/invalid.
- [ ] Thread the resolved value through route dependencies as `resolvedTimeZone` /
      `resolveRequestTimeZone`; do not put it in `AccessContext`.
- [ ] Ensure MCP/tool `ToolContext.localTimezone` uses the same resolver/fallback path. The gateway
      already has a `resolveLocalTimezone` seam; prefer using it over changing session tokens.
- [ ] Unit tests:
  - valid header avoids stored fallback and becomes tool context timezone;
  - invalid header uses stored locale;
  - no header/no stored locale uses `"UTC"`;
  - `AccessContext` type and runtime construction stay `{ actorUserId, requestId }`.
- [ ] Run:

```bash
pnpm test:unit -- tests/unit/gateway-policy.test.ts
pnpm typecheck
```

## Slice 4: Chat Timezone + Prompt-Cache-Safe Current Time

**Purpose:** Make chat and relative-date reasoning use the resolved local date/time without putting
dynamic timestamps into stable prompt prefixes.

**Files:**

- Modify: `packages/chat/src/live/chat-session-manager.ts`
- Modify: `packages/chat/src/live/persona.ts` or existing persona rendering inputs
- Modify: `packages/chat/src/live/types.ts` only if launch options need a stable timezone field
- Test: `tests/unit/chat-session-manager.test.ts`
- Test: `tests/unit/chat-cross-tool-reasoning.test.ts`

- [ ] Put stable timezone guidance in persona/session context: "User timezone:
      `<IANA timezone>`." This can live for the session.
- [ ] Build a per-turn local context block from `formatInZone(now, tz, ...)` and `localDay(now, tz)`
      before user text. Include current local date, time, and timezone.
- [ ] Keep `planCrossToolReasoning.localNowIso` semantically local-aware. Either pass an explicit
      local context object or keep ISO as UTC instant plus `localTimezone`; do not name UTC "local now".
- [ ] Unit tests:
  - launched persona contains timezone but no hardcoded current timestamp;
  - each turn includes local date/time context for `America/Los_Angeles`;
  - at `2026-07-01T00:21:00Z`, local day in `America/Los_Angeles` is `2026-06-30`;
  - cross-tool planner receives the same timezone used in the turn context.
- [ ] Run:

```bash
pnpm test:unit -- tests/unit/chat-session-manager.test.ts tests/unit/chat-cross-tool-reasoning.test.ts
```

## Slice 5: Tool/Planner Relative-Date Conversion

**Purpose:** Make "today", "tomorrow", and date windows resolve through one timezone-aware path
instead of UTC helpers.

**Files:**

- Modify: `packages/calendar/src/tools.ts`
- Modify: `packages/tasks/src/search-interpret-route.ts`
- Modify: `packages/chat/src/live/cross-tool-reasoning.ts`
- Modify: any module tool found by the targeted audit in Slice 6
- Test: `tests/unit/focus-time-logic.test.ts`
- Test: `tests/unit/tasks-search-interpret.test.ts`
- Test: `tests/unit/chat-cross-tool-reasoning.test.ts`

- [ ] Replace calendar relative-date freezing with shared local-day conversion in the resolved
      timezone.
- [ ] Ensure task search prompt `today` uses the resolved request/tool timezone, not stored-only
      locale when a header is present.
- [ ] For cross-tool evidence dedupe, derive date keys with `localDay(instant, timezone)`.
- [ ] Unit tests:
  - "tomorrow" at `2026-07-01T00:21:00Z` in `America/Los_Angeles` resolves from
    `2026-06-30`, not UTC July 1;
  - task search prompt receives local today;
  - cross-tool dedupe groups same local-day evidence across calendar/tasks.
- [ ] Run:

```bash
pnpm test:unit -- tests/unit/focus-time-logic.test.ts tests/unit/tasks-search-interpret.test.ts tests/unit/chat-cross-tool-reasoning.test.ts
```

## Slice 6: User-Facing Rendering + Targeted Unsafe-Date Audit

**Purpose:** Finish the product-wide class of bug by replacing unsafe civil-day derivations in
display and day-bucketing paths while leaving documented UTC protocol math alone.

**Files:**

- Modify: `apps/web/src/wellness/*`
- Modify: `apps/web/src/tasks/*`
- Modify: `packages/wellness/src/*`
- Modify: `packages/tasks/src/*`
- Modify: `packages/calendar/src/*`
- Modify: `packages/chat/src/*`
- Modify: `packages/briefings/src/*` only where it still has local helper duplication
- Test: existing focused unit tests plus any new regression tests required by changed files

- [ ] Run targeted audit:

```bash
rg -n "\.slice\(0, ?10\)" apps packages --glob '!**/*.test.ts' --glob '!**/*.spec.ts'
rg -n "Date\.UTC\(" apps packages --glob '!**/*.test.ts' --glob '!**/*.spec.ts'
rg -n "getUTC(Date|FullYear|Month)\(" apps packages --glob '!**/*.test.ts' --glob '!**/*.spec.ts'
```

- [ ] Classify each hit as:
  - unsafe day-from-instant derivation, replace with `localDay` / `formatInZone`;
  - UTC protocol math, leave with a short comment;
  - non-date array/string truncation, leave unchanged.
- [ ] Add regression tests for the reported bug class:
  - Friday evening US check-in instant buckets to Friday;
  - wellness today/history/trends use local day;
  - medication logs use resolved timezone boundaries;
  - task due/completed badges use local day;
  - chat/calendar/sports-style answers format dates through shared formatter.
- [ ] Add/extend the repo guard if needed so future unsafe day derivations fail locally. Prefer
      extending `scripts/check-no-ambient-dates.ts` or adding a narrow sibling script over manual review.
- [ ] Run:

```bash
pnpm check:no-ambient-dates
pnpm test:unit
pnpm lint
pnpm typecheck
```

## Final Acceptance

- [ ] `resolveTimeZone` exists in `@jarv1s/shared` and is covered by unit tests.
- [ ] Browser API requests send validated `X-Timezone`; invalid values fall back cleanly.
- [ ] Routes/tools receive resolved timezone explicitly; `AccessContext` is unchanged.
- [ ] Chat has stable timezone in session context and dynamic local current date/time per turn.
- [ ] Relative-date planners/tools use the same timezone source of truth.
- [ ] User-facing day bucketing and date/time rendering use `localDay` / `formatInZone`.
- [ ] Targeted audit has no unclassified unsafe UTC day derivations.
- [ ] Full local gate passes:

```bash
pnpm verify:foundation
```
