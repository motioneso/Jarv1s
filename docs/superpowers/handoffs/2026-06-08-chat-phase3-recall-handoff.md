# Handoff: Jarv1s Chat Phase 3 — Recall

**Date:** 2026-06-08  
**Branch base:** `main` (latest: `fd3a481` + PR #33 merged)  
**Epic:** #22 — Jarv1s Chat — live, agentic, remembering  
**Phases complete:** Phase 1 (PR #21 +#23+#25), Phase 2 core (PR #33), Phase 2 transport (PR #37 — open for review)

---

## Context

Jarv1s Chat now has a live CLI-backed drawer with MCP tool access (Phase 2). Phase 3 adds memory: Jarvis recalls relevant past conversations and facts when starting a new chat.

**Architecture doc:** `docs/superpowers/specs/2026-06-08-jarvis-chat-design.md` — Section 8 ("Phase 3 — Recall") has the full design. Read it before speccing. The design uses `packages/memory` (already exists; built in M-A1).

## Key constraints

- **Spec-before-build is a hard gate.** Phase 3 has no standalone spec yet. Write it, get approval, then plan.
- **Do not touch** `packages/tasks/`, `packages/calendar/`, `packages/connectors/`, or any module besides `packages/chat/`, `packages/memory/` (extends), `packages/ai/` (if needed), and the web shell.
- **Hard invariants** from CLAUDE.md apply: no BYPASSRLS, private-by-default, DataContextDb only, metadata-only job payloads, module isolation.
- **Coordinate** with the Tasks agent if active. Check `herdr pane list` for other running sessions before any `git add -A`.
- PR #37 (`feat/jarvis-chat-phase2-transport`) may still be open. Do NOT edit files on that branch.

## Known traps to mention in the spec

1. **Worker grants on memory tables** — `jarvis_worker_runtime` has no grants on `memory_chunks` or `memory_file_index` today. The recall embed/reconcile pg-boss jobs run as the worker. Without grants they will hit `42501`. Add grants in the migration, not just a note. (Same trap as chat pre-PR #17/#36.)
2. **`source_kind` CHECK on `memory_chunks`** — it currently only allows `'vault'`. A migration must widen it to include `'chat'`.
3. **`MemoryRepository.upsertFileChunks` hardcodes `'vault'`** — needs to accept a `sourceKind` param; add a `source_kind` filter to `vectorSearch` too.
4. **Never edit applied migrations** — add a new file; the runner hash-checks applied ones.

## What the spec should cover

- Two-tier memory model: episodic turn-pairs vs fact/profile
- Ingestion pipeline: which turns get embedded, when, via what pg-boss job
- Retrieval: per-turn hybrid retrieval injected into the seed first message
- Controls: on/off, incognito/temporary-chat (no embed, no recall), memory-management UI
- RLS classification for new tables/rows
- Exit criteria (verify:foundation + audit:release-hardening green per phase)

## agentmemory recalls to run at session start

Run `memory_smart_search` with these queries (CLAUDE.md "Required recalls"):

- `"jarv1s current project state"`
- `"jarv1s RLS shareability policy"`
- `"jarv1s migration hash placement"`
- `"jarv1s integration test trap"`

## Start

1. `pnpm install` (fresh worktree — required)
2. Run `memory_smart_search "jarv1s current project state"` (and the other required recalls above)
3. Read `docs/superpowers/specs/2026-06-08-jarvis-chat-design.md` Section 8 in full
4. Run `/start 22` — the start skill will detect Phase 3 has no standalone spec, write one incorporating the above context and traps, then **pause for user approval before writing any code or plan**

Do not write a plan or any code until the spec is approved.
