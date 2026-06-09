# Retire the legacy AiAssistantToolExecutor — Design (P1 #57)

**Status:** DRAFT (coordinator readiness, 2026-06-09) — needs Ben's sign-off
**Date:** 2026-06-09  **Owner:** Ben  **Issue:** #57 (Part of epic #46)
**Decided by:** ADR 0009 §Decision-4 (this spec is the execution detail, not a fresh decision)

## Context

`packages/ai/src/assistant-tools.ts` carries an `AiAssistantToolExecutor` class whose
`invokeReadTool` is a hardcoded `switch` over four tool names. To service that switch the
`@jarv1s/ai` package **imports four other feature modules' repositories and serializers**:

```ts
import { CalendarRepository, serializeCalendarEvent } from "@jarv1s/calendar";
import { EmailRepository, serializeEmailMessage } from "@jarv1s/email";
import { NotificationsRepository, serializeNotification } from "@jarv1s/notifications";
import { TasksRepository, serializeTask } from "@jarv1s/tasks";
```

This is the **only structural module-isolation violation in the repo**: `@jarv1s/ai` reaches
directly into Tasks, Calendar, Email, and Notifications internals instead of going through their
declared manifests.

The clean replacement already exists and is already preferred. The in-process MCP gateway
(`packages/ai/src/gateway/gateway.ts`) dispatches purely through each module's
`ModuleAssistantToolManifest.execute` handler (`module-sdk` `ToolExecute`), scoping every call to
the token's user under RLS. **Both** call sites of the legacy executor already try the manifest
`execute` first and only fall back to `invokeReadTool` when a manifest handler is absent:

- `packages/ai/src/routes.ts` (`POST /api/ai/assistant-tools/:name/invoke`) — `if (manifestTool?.execute) … else assistantToolExecutor.invokeReadTool(...)`.
- `packages/briefings/src/repository.ts` (`generateSummary`) — identical `if (manifestTool?.execute) … else executor.invokeReadTool(...)`.

The Tasks module already migrated fully: its manifest declares eight `read` tools
(`tasks.list`, `tasks.get`, `tasks.focus`, `tasks.atRisk`, `tasks.overdue`, `tasks.listLists`,
`tasks.listTags`, `tasks.activity`) each with an `execute` handler in `packages/tasks/src/tools.ts`
(M-A5 Plan 2, PR #38). The legacy switch's `tasks.listVisible` case is already **dead** — no
current manifest declares that name.

So the remaining work is small and mechanical: give the three still-legacy read tools a manifest
`execute` handler in their own module, then delete the executor and the four cross-module deps.

## Goals

- Every remaining manifest read tool has its own in-module `execute` handler.
- `AiAssistantToolExecutor` + `UnsupportedAssistantToolError` + `invokeReadTool` are deleted from
  `packages/ai`.
- The four feature-module dependencies are removed from `packages/ai/package.json`; `@jarv1s/ai` no
  longer imports any feature module's internals.
- `ai/routes.ts` and `briefings/repository.ts` dispatch **only** through the manifest gateway path
  (no executor fallback, no `UnsupportedAssistantToolError`).
- `pnpm verify:foundation` + `pnpm audit:release-hardening` green.

## Non-Goals

- No new tools, no new tool behavior, no schema/migration changes. Output shapes stay byte-for-byte
  identical (`{ events }`, `{ messages }`, `{ notifications, unreadCount }`).
- Not implementing per-user enablement / `resolveActiveModules` (ADR 0009 §Decision-3, issue #30).
- Not touching the gateway's risk/confirmation/token machinery — it already works.
- Not consolidating the duplicate `summarizeAssistantToolInput` (one copy lives in
  `assistant-tools.ts`, one inlined in `routes.ts`); keep the surviving copy where the gateway
  imports it. (See Open Decisions.)

## Resolved Decisions (already decided)

- **Direction is fixed by ADR 0009 §Decision-4** (accepted 2026-06-09): "retire the legacy
  `AiAssistantToolExecutor` switch so the clean MCP gateway is the _only_ tool path (Phase 1)."
  This spec does not re-open that; it enumerates the exact edits.
- **Pattern is fixed by the Tasks precedent** (PR #38): each module owns its read-tool `execute`
  handlers in a module-local `tools.ts`, wired into its manifest's `assistantTools[].execute`,
  returning `{ data: <same shape the switch returned> }`.

## Open Decisions — NEED BEN

1. **Where do the three new `execute` handlers live, and where do the serializers come from?**
   The switch used each module's `serialize*` function, but those are currently exported from each
   module's **`routes.ts`** (`serializeCalendarEvent`, `serializeEmailMessage`,
   `serializeNotification`) — not a dedicated serialize module. Recommendation: add a small
   `tools.ts` to each of calendar/email/notifications (mirroring `tasks/src/tools.ts`), importing
   the existing serializer from that module's own `routes.ts`. This keeps the serializer
   single-sourced and avoids a new export surface. **Low-risk, recommend approve.**

2. **`summarizeAssistantToolInput` home after the file shrinks.** `gateway.ts` imports it from
   `../assistant-tools.js`. When the executor class is deleted, keep `assistant-tools.ts` as a thin
   module retaining `summarizeAssistantToolInput`, `listAssistantToolsFromManifests`, and
   `findAssistantToolFromManifests` (all still used and module-isolation-clean — they only read
   manifest metadata). Recommendation: keep the file, delete only the executor class + error +
   the four imports. **Recommend approve.**

No genuinely hard fork remains — every handler is a one-line repository `listVisible` + `serialize`
map, structurally identical to what the switch already did.

## Approach

### Read tools that still LACK a manifest `execute` handler (the real work — exactly three)

| Tool name                     | Module        | Switch did                                                       | New handler returns                                      |
| ----------------------------- | ------------- | --------------------------------------------------------------- | ------------------------------------------------------- |
| `calendar.listVisibleEvents`  | calendar      | `CalendarRepository.listVisible` → `serializeCalendarEvent`     | `{ data: { events: events.map(serializeCalendarEvent) } }` |
| `email.listVisibleMessages`   | email         | `EmailRepository.listVisible` → `serializeEmailMessage`         | `{ data: { messages: messages.map(serializeEmailMessage) } }` |
| `notifications.listVisible`   | notifications | `NotificationsRepository.listVisible` → `serializeNotification` | `{ data: { notifications: result.notifications.map(serializeNotification), unreadCount: result.unreadCount } }` |

(Tasks is already done — its 8 read tools all have `execute` handlers. The switch's
`tasks.listVisible` case is dead and is simply deleted with the executor.)

For each of the three modules:

1. Add `packages/<module>/src/tools.ts` exporting a `ToolExecute` const (e.g.
   `calendarListVisibleEventsExecute`) that calls `assertDataContextDb(scopedDb)`, runs the
   existing repository `listVisible`, and returns `{ data: … }` in the exact shape above.
2. Wire it into the module manifest's single `assistantTools[0].execute`. Import the serializer
   from the module's own `routes.ts` (or relocate the serializer if Open Decision 1 prefers a
   dedicated file).

### Deps deleted from `packages/ai/package.json` (exactly four)

```
"@jarv1s/calendar": "workspace:*"
"@jarv1s/email": "workspace:*"
"@jarv1s/notifications": "workspace:*"
"@jarv1s/tasks": "workspace:*"
```

Retained: `@jarv1s/db`, `@jarv1s/module-sdk`, `@jarv1s/shared`, `fastify`, `kysely`. After this,
`@jarv1s/ai` imports zero feature-module internals.

### `packages/ai/src/assistant-tools.ts` edits

- Delete the four feature-module `import` lines.
- Delete `AiAssistantToolExecutorDependencies`, the `AiAssistantToolExecutor` class, and
  `UnsupportedAssistantToolError`.
- Keep `summarizeAssistantToolInput`, `listAssistantToolsFromManifests`,
  `findAssistantToolFromManifests` (manifest-metadata-only; gateway + routes still use them).
- `packages/ai/src/index.ts` still `export *`s the surviving functions — confirm no dangling
  re-export of the deleted symbols.

### Two call-site edits

1. **`packages/ai/src/routes.ts`** — remove the `AiAssistantToolExecutor` import, the
   `assistantToolExecutor` dependency field/default, the `else
   assistantToolExecutor.invokeReadTool(...)` fallback, and the `UnsupportedAssistantToolError`
   catch branch (with all three module tools now having `execute`, a declared read tool always
   resolves a `manifestTool.execute`). Read tools with no `execute` should be treated as "not
   declared/executable" → existing 404/blocked path; confirm the `manifestTool?.execute`
   guard still has a clean failure mode.
2. **`packages/briefings/src/repository.ts`** — remove the `AiAssistantToolExecutor` /
   `UnsupportedAssistantToolError` imports, the `assistantToolExecutor` field on
   `GenerateBriefingRunInput`, the `executor` default, and the `else executor.invokeReadTool(...)`
   fallback. `findAssistantToolFromManifests` stays (still used by `selectReadTool`). The
   `summarizeToolResult` / `displayToolName` switches already key off the new `tasks.list` names
   and the three module tool names — leave them; they read result shapes, not module internals.

## Collision notes

- **Soft collision with #55 (secret-key versioning/rotation) on `packages/ai/`.** #55 touches only
  `packages/ai/src/crypto.ts` (AES envelope key-id). This spec does **not** touch `crypto.ts`; it
  touches `assistant-tools.ts`, `routes.ts`, `index.ts`, `package.json`, and three sibling modules.
  The only shared file is `packages/ai/src/routes.ts` — #55 edits its `secretCipher` wiring,
  #57 edits its assistant-tool invoke handler; different functions, but a merge-time overlap is
  possible. **Recommend merge order: land #57 first (broad but mechanical, no data-at-rest risk),
  then #55 rebases its narrower crypto/routes change on top.** Both authors should coordinate via
  herdr before touching `routes.ts` concurrently.

## Exit Criteria (from issue #57 acceptance)

- [ ] `calendar.listVisibleEvents`, `email.listVisibleMessages`, `notifications.listVisible` each
      have a manifest `execute` handler in their owning module; Tasks already done.
- [ ] `AiAssistantToolExecutor` + `UnsupportedAssistantToolError` + `invokeReadTool` deleted from
      `packages/ai`.
- [ ] The four module deps removed from `packages/ai/package.json`; `@jarv1s/ai` imports no feature
      module's internals.
- [ ] `ai/routes.ts` and `briefings/repository.ts` dispatch only through the gateway/manifest path
      (no executor, no fallback).
- [ ] `pnpm verify:foundation` green (lint, format, file-size, typecheck, migrate, integration).
- [ ] `pnpm audit:release-hardening` green.
- [ ] Existing suites still pass: `pnpm test:chat`, `pnpm test:briefings`, `pnpm test:ai-tools`,
      `pnpm test:calendar-email`, `pnpm test:notifications`, `pnpm test:tasks` (output shapes
      unchanged, so assertions should hold; update any test that constructs
      `AiAssistantToolExecutor` directly).

## Hard Invariants honored

- **Module isolation (the whole point).** After this change `@jarv1s/ai` collaborates with feature
  modules only through declared manifests — the sole structural violation is removed. Each read
  tool's logic lives in its owning module.
- **DataContextDb only / RLS for all actors.** Handlers receive the gateway's RLS-scoped
  `DataContextDb` and call `assertDataContextDb`; no root Kysely, no admin bypass. Identity flows
  only from the per-session token via the gateway.
- **No behavior change to risk/confirmation.** Read tools stay `risk: "read"` → `policy "run"`; the
  write/destructive confirmation bridge is untouched.
- **Never edit applied migrations.** No migrations in scope.
- **Spec before build.** This document is that gate for #57.
