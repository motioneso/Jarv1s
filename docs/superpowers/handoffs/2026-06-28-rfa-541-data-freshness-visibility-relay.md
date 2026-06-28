# Relay Handoff — rfa-541-data-freshness-visibility

**Date:** 2026-06-28
**Spec:** `docs/superpowers/specs/2026-06-28-data-freshness-visibility.md`
**Issue:** #541
**Branch/worktree:** `rfa-541-data-freshness-visibility` (off `origin/main @ 6835a9d0`)
**Risk tier:** routine (UI + metadata enrichment; no new tables, no RLS changes)
**Coordinator label:** `Coordinator`
**Coordinator session id:** `5e1a6b62-a480-4b5c-9706-e476cfe77044`
**Relay threshold:** ~80–100k tokens or compaction summary

## State

**No code written yet.** This relay covers the full architecture survey only. The plan has NOT been
submitted to the coordinator yet. The successor must:

1. Write the plan to `docs/superpowers/plans/2026-06-28-rfa-541-data-freshness-visibility.md`
2. Message coordinator for plan approval (`herdr-pane-message`)
3. Wait for approval — DO NOT write code before approval
4. Execute the plan with TDD per `coordinated-build` skill

## Spec Premises Verified (all still true as of this relay)

- `packages/briefings/src/compose.ts` — no freshness fields (`sourceTimestamps`, `sourceFreshness`, etc.)
- `packages/shared/src/briefings-api.ts` — no freshness types
- `packages/shared/src/chat-api.ts` — no `sourceFreshness` on `ChatMessageDto`
- `packages/chat/src/live/types.ts` — no freshness fields
- All confirmed absent with grep. Safe to build as specced.

## Architecture Survey Findings

### 1. Briefings — compose.ts

- `composeBriefing()` gathers sections (commitments, tasks, calendar, email, vault, chats, goals) via `gatherToolSection()`
- Returns `{ status, summaryText, sourceMetadata: Record<string, unknown> }`
- `sourceMetadata` is already JSONB (`jsonObjectSchema` in Fastify schema) — additive keys are safe
- `ComposeDeps` interface at line 53 — add optional `connectorSyncAt` and `vaultLastWriteAt` here
- The `fallback()` function also builds `sourceMetadata` — needs freshness too
- `now` is already captured at `const now = input.now ?? new Date()` — use as `capturedAt`
- Sections gathered: commitments, tasks, calendar (conditional), email (conditional), vault, chats, goals (conditional)
- Each section has `key` (string like "email", "calendar", "tasks") — use as freshness source key

### 2. Shared types

- `BriefingRunDto.sourceMetadata` is `Record<string, unknown>` → additive, no schema change needed
- `ChatMessageDto` in `packages/shared/src/chat-api.ts` line 35 — add `sourceFreshness?: SourceFreshnessV1 | null`
- `chatMessageSchema` (line 139) has `additionalProperties: false` — MUST add `sourceFreshness` to properties or it will be stripped
- Add freshness types as a new export in `packages/shared/src/` (e.g., `freshness-types.ts`) then re-export from `index.ts`

### 3. Connectors — sync state API

- `ConnectorsRepository.listAccounts(scopedDb)` → `ConnectorAccountSafeRow[]` with `last_sync_finished_at: Date | null`
- `ConnectorProviderType = "calendar" | "email" | "google"` — but Google accounts provide both
- Use scope-based detection from `packages/connectors/src/feature-grants.ts`:
  - `accountHasEmailScope(scopes)` → email
  - `accountHasCalendarScope(scopes)` → calendar
- CALENDAR_SCOPE = `"https://www.googleapis.com/auth/calendar"` (in sync-jobs.ts)
- For briefing/chat freshness: inject `connectorSyncAt(scopedDb, "email" | "calendar") => Promise<Date | null>`
  - Implementation: `listAccounts(scopedDb)` → filter by scope → max `last_sync_finished_at`

### 4. Memory/vault freshness

- `packages/memory/src/repository.ts` — `MemoryRepository` has `listRecentChunks` which joins `memory_file_index.ingested_at`
- No existing "get max ingested_at" method — need to add `getLatestIngestedAt(scopedDb, sourceKind): Promise<Date | null>`
- SQL: `SELECT MAX(ingested_at) FROM app.memory_file_index WHERE owner_user_id = app.current_actor_user_id() AND source_kind = $1`
- Inject into `ComposeDeps` as `vaultLastWriteAt?: (scopedDb) => Promise<Date | null>`

### 5. Chat persistence pipeline

- `ChatPersistencePort.recordTurn` (in `chat-session-manager.ts` line 48) — needs `invokedToolNames?: readonly string[]`
- `ChatSessionManager.runTurn` at line 431 collects `TranscriptRecord` — `record.kind === "tool"` records have `record.toolName`
  - Collect tool names into a `Set<string>` during the turn loop
  - Pass to `recordTurn`
- `DataContextChatPersistence.recordTurn` (in `persistence.ts` line 99) — receives tool names → maps to freshness
- `ChatRepository.recordCompletedTurn` (in `repository.ts` line 172) — add optional `sourceFreshness?: SourceFreshnessV1 | null`
  - Store in `toolMetadata: { selectedTools: [], sourceFreshness }` (spread in only when present)
- `DataContextChatPersistenceDeps` (in `persistence.ts` line 34) — add `connectorSyncAt?`
- `createChatSessionRuntime` in `runtime.ts` line 296 builds `DataContextChatPersistence` — wire `connectorSyncAt` there

### 6. Chat routes — DTO serialization

- `packages/chat/src/routes.ts` line 601: `const toolMetadata = asRecord(message.tool_metadata)`
- Line 610: `tools: readTools(toolMetadata.selectedTools)`
- Line 611: `activity: readActivity(toolMetadata.activity)`
- Add: `sourceFreshness: readSourceFreshness(toolMetadata.sourceFreshness)` mapping to `SourceFreshnessV1 | null`

### 7. Module registry wiring

- `packages/module-registry/src/index.ts` line 614 builds `composeDeps` for briefings worker
- Add `connectorSyncAt` using `ConnectorsRepository` instance + `feature-grants.ts` helpers
- Add `vaultLastWriteAt` using `MemoryRepository.getLatestIngestedAt`
- A `ConnectorsRepository` instance already exists in `apps/api/src/server.ts:262` (passed to `registerBuiltInApiRoutes`)
  - The module registry needs its own instance or the same one passed in
  - Simplest: create a new `ConnectorsRepository()` inside the composeDeps block (lightweight, no state)

### 8. Web UI

- Briefing run detail: `apps/web/src/today/today-page.tsx` (check how runs are displayed — likely in a run detail card)
- Chat messages: `apps/web/src/chat/chat-drawer.tsx` line 519 `recordsFromMessages` and around line 525 for tool rendering
- Design rules:
  - NO curved colored left-border card accent (memory: design-no-accent-left-border)
  - Use existing `jds-*` primitives
  - Stale warning = inline functional notice, non-blocking
  - Chat footer = collapsed by default, expand for per-source ages

## Freshness Logic — Source Table

| Section key | freshnessKind  | asOf source                               | "live" UI |
| ----------- | -------------- | ----------------------------------------- | --------- |
| email       | connector_sync | max `last_sync_finished_at` (email scope) | no        |
| calendar    | connector_sync | max `last_sync_finished_at` (cal scope)   | no        |
| vault/notes | vault_write    | max `ingested_at` in memory_file_index    | no        |
| tasks       | realtime       | capturedAt                                | yes       |
| commitments | realtime       | capturedAt                                | yes       |
| chats       | realtime       | capturedAt                                | yes       |
| goals       | realtime       | capturedAt                                | yes       |

## Tool-name → Source Mapping (for chat)

```
"email.*"       → "email"       → connector_sync
"calendar.*"    → "calendar"    → connector_sync
"vault.*"/"notes.*" → "vault"  → vault_write
"tasks.*"       → "tasks"       → realtime
"commitments.*" → "commitments" → realtime
"chat.*"        → "chats"       → realtime
"goals.*"       → "goals"       → realtime
"memory.*"      → "memory"      → memory_update (skip for V1 if no memory section in chat)
```

## Stale Threshold

- Default: 24h, briefings only
- `capturedAt - asOf > threshold` → stale
- `live` and `asOf: null` sources are never "stale"
- Chat: show age only, no threshold, no warning

## Collision Notes (from handoff doc)

- `packages/shared/src/chat-api.ts` shared with #539 (rfa-539-source-backed-provenance)
- Use DISJOINT field names: `sourceFreshness` (ours), NOT `provenance` or `sources`
- No migration needed — no new tables
- Limit file scope to:
  - `packages/briefings/`
  - `packages/shared/src/briefings-api.ts` (minimal / no changes needed)
  - `packages/shared/src/chat-api.ts`
  - `packages/chat/src/`
  - `packages/connectors/src/` (read-only — only import types/helpers)
  - `packages/memory/src/repository.ts` (add `getLatestIngestedAt`)
  - `packages/module-registry/src/index.ts` (wiring)
  - `apps/web/src/` (UI)

## Files To Create/Modify

1. `packages/shared/src/freshness-types.ts` — NEW: `FreshnessKind`, `SourceFreshnessEntry`, `SourceFreshnessV1`
2. `packages/shared/src/index.ts` — re-export freshness types
3. `packages/shared/src/chat-api.ts` — add `sourceFreshness` to DTO + Fastify schema
4. `packages/memory/src/repository.ts` — add `getLatestIngestedAt`
5. `packages/briefings/src/freshness.ts` — NEW: `resolveBriefingFreshness()`
6. `packages/briefings/src/compose.ts` — extend `ComposeDeps`; call freshness resolver
7. `packages/chat/src/live/chat-session-manager.ts` — extend `ChatPersistencePort.recordTurn`; collect tool names
8. `packages/chat/src/live/persistence.ts` — extend `DataContextChatPersistenceDeps`; compute freshness
9. `packages/chat/src/repository.ts` — extend `recordCompletedTurn` to store `sourceFreshness`
10. `packages/chat/src/routes.ts` — serialize `sourceFreshness` from `tool_metadata` to DTO
11. `packages/module-registry/src/index.ts` — wire freshness deps for briefings
12. `packages/chat/src/live/runtime.ts` — wire `connectorSyncAt` for chat
13. `apps/web/src/chat/chat-drawer.tsx` — add freshness footer to assistant messages
14. `apps/web/src/today/today-page.tsx` (or new component) — add sources section to briefing run detail

## Tests Required (spec §13)

- `packages/briefings/src/freshness.test.ts` — `resolveBriefingFreshness` unit tests
- Extend `packages/briefings/src/compose.test.ts` (if exists, else new) — `sourceTimestamps` in output
- `packages/chat/src/live/persistence.test.ts` — tool-name → freshness mapping
- `packages/chat/src/routes.test.ts` — `sourceFreshness` serialized in DTO
- Web component tests for freshness label rendering

## Verification Gate

```bash
pnpm lint
pnpm format:check
pnpm typecheck
pnpm test:briefings
pnpm test:chat
pnpm test:api
pnpm test:web
```

## Compact

- No code written. Survey complete. Plan not yet submitted.
- Successor: write plan → message coordinator → wait approval → TDD build.
- node_modules present — skip `pnpm install`.
