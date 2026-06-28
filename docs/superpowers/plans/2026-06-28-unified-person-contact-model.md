# Build Plan — Unified Person / Contact Model (#538)

**Date:** 2026-06-28
**Branch:** rfa-538-person-contact-model
**Spec:** ~/Jarv1s/docs/superpowers/specs/2026-06-27-unified-person-contact-model.md
**Issue:** #538
**Approval gate:** Coordinator (`5e1a6b62-a480-4b5c-9706-e476cfe77044`) must approve before any code is written.

---

## Overview

Introduce `packages/people` as a new first-class Jarvis module. It stores a **unified person / contact
model** — one `person_context_people` row per real-world person, linked to raw identity signals
ingested from email, calendar, chat, notes, tasks, commitments, and memory. The module exposes:

- A SQL migration (`XXXX_person_context.sql`) — 9 ENUMs + 7 tables, all FORCE RLS
- Kysely table interfaces + Selectable aliases in `packages/db/src/types.ts`
- A `PersonContextProvider` contract in `packages/module-sdk`
- A full `packages/people` package (types, matching, repository, service, jobs, workers, tools, manifest, routes)
- Module-registry wiring so the new routes and workers are registered at server start
- A Settings → Memory & context → People & context tab (`settings-people-pane.tsx`)
- All integration tests run against a lane DB (`JARVIS_PGDATABASE=jarvis_build_538`)

Migration slot: **XXXX** — coordinator assigns actual number (expected 0127) before push. Use
`XXXX` throughout this plan; replace globally before the final push.

---

## Risk Tier — SECURITY

All 7 tables hold personal data.

- FORCE RLS + ENABLE RLS on every table — `jarvis_app_runtime` and `jarvis_worker_runtime`
  both scoped to `app.current_actor_user_id()`.
- `normalized_value` (canonical identity string) is **private** — strip from all REST responses and
  assistant-tool outputs. Return `display_value` only.
- `source_ref` (raw foreign key into a source module) is **private** — never leave the DB layer
  except inside workers loading indexing state.
- `people.merge` and `people.splitIdentity` tools: `risk: "destructive"`, `executionPolicy` must
  NOT be `"auto"` — always requires explicit human confirmation.
- `people.acceptMatch` must detect `candidate_kind in ("merge_people","split_identity")` and
  refuse to auto-execute; escalate to the destructive tools instead.
- Job payloads carry metadata only: `actorUserId, source, sourceRefHash, sourceVersion, reason,
  idempotencyKey`. No content, no raw signals, no `source_ref`.
- Never log raw `PersonContextSignal` objects — log counts, `sourceKind`, `sourceRefHash`, and
  error class only.
- Memory-sync failures must NOT roll back person-context writes — keep them in separate
  transactions.

---

## Task List

| # | Task | Scope |
|---|------|-------|
| 1 | SQL migration: ENUMs + 7 tables + FORCE RLS + policies | DB |
| 2 | Kysely types in `packages/db/src/types.ts` | packages/db |
| 3 | `PersonContextProvider` contract in `packages/module-sdk` | packages/module-sdk |
| 4 | `packages/people` scaffold: `package.json`, `tsconfig.json`, `src/types.ts` | packages/people |
| 5 | `src/matching.ts` — normalizeIdentity, matchResult, candidateSignature | packages/people |
| 6 | `src/repository.ts` — PeopleRepository | packages/people |
| 7 | `src/service.ts` — PersonContextService | packages/people |
| 8 | `src/jobs.ts` + `src/workers.ts` — queues + worker registration | packages/people |
| 9 | `src/tools.ts` — 7 assistant tools | packages/people |
| 10 | `src/manifest.ts` + `src/routes.ts` + `src/index.ts` — manifest, 14 REST routes, public API | packages/people |
| 11 | Module-registry wiring in `packages/module-registry/src/index.ts` | packages/module-registry |
| 12 | Web UI: `settings-people-pane.tsx` + `people-client.ts`, wire into settings-memory-pane | apps/web |
| 13 | Full gate: typecheck + lint + format + integration tests + foundation.test.ts row | all |
