# M-A4: Vault-grounded Daily Briefings

**Status:** Draft (awaiting review)
**Date:** 2026-06-07
**Owner:** Ben
**GitHub:** Epic issue #5 · Milestone M-A4
**Depends on:** M-A3 (real AI providers) merged to `main`; M-A1 (real embeddings) — complete.

---

## Context

Jarv1s has a briefings module (`packages/briefings/`) with definitions, runs, a pg-boss run
worker, and routes/UI. But the pipeline is **deterministic string-concatenation**: `generateSummary`
in `repository.ts` runs the definition's selected _read tools_ via `AiAssistantToolExecutor`, then
formats their results into a fixed text summary (`formatToolSummary`). There is **no AI, no vault
memory, and no commitments** in the briefing today, and **nothing triggers runs on a schedule** —
runs are enqueued manually.

M-A4 makes the briefing **real and proactive**: a daily, vault-grounded briefing, synthesized by the
configured AI provider, fired automatically early each morning. The three named pieces already exist
as clean repositories and only need wiring:

- `MemoryRetriever.retrieve(scopedDb, query, limit)` — vault vector search (M-A1, real embeddings).
- `CommitmentsRepository.listVisible(scopedDb)` — structured-state open commitments.
- `createChatAdapter(provider, deps).generateChat({ model, messages })` — real AI text generation
  (M-A3), resolved provider-agnostically via `aiRepository.selectModelForCapability`.

### Prior art (research, 2026-06-07)

A deep-research pass on **Hermes Agent** (Nous Research) and **OpenClaw** (Steinberger) — the two
leading self-hosted proactive assistants — produced findings that directly shaped this design
(22 confirmed claims from primary vendor docs + GitHub source):

- Both converge on a **single shared centralized scheduler ticked on a fixed heartbeat** (Hermes 60s
  gateway daemon; OpenClaw 30m/1h heartbeat + durable SQLite cron) that **DB-queries due jobs per
  tick** — _not_ per-task OS cron. This validates our heartbeat decision.
- Morning briefings are just **cron-expression jobs evaluated by the tick** (`0 8 * * *`), with
  **per-user IANA timezone** + active-hours windowing.
- Each scheduled job runs in a **fresh, isolated session** with no inherited context — personalization
  is **re-grounded at run time**, not carried in the trigger.
- Content is **LLM-synthesized** (not templated), with **source provenance/counts** surfaced.
- Reliability = **provider failover + bounded retries** (transient retry, permanent fail-fast).
- New sources via **typed capability registration** (no pipeline reshape per source).
- **Critically:** both systems have _documented, open multi-user isolation leakage bugs_ — OpenClaw's
  cron list is **global to the instance** (any cron-capable agent can list/edit all users' jobs,
  GH #26370, open P1); a security writeup found "isolated" sessions leaking into the main session and
  a user request evaluated under **admin context**. The leakage happens precisely **where the
  scheduler reads all jobs**. Jarv1s's RLS-everywhere model is the differentiator — provided the
  heartbeat tick reads only a **minimal, non-private scheduling projection** and every run executes
  **RLS-scoped to the owning user**.

---

## Goals

1. Briefing runs are **AI-synthesized narratives** grounded in the user's **vault notes**, **open
   commitments**, and selected **read tools** — replacing the deterministic string-concat summary.
2. Vault grounding uses a **hybrid** retrieval: a semantic query derived from the day's signals
   **plus** recency.
3. Briefings fire **automatically each morning, per user, in the user's timezone**, via a **thin
   shared heartbeat** in `packages/jobs` that briefings registers a handler into (first consumer).
4. Cross-user scheduling is **RLS-safe**: the tick reads only non-private scheduling metadata; every
   run is actor-scoped to the owner. No `BYPASSRLS`.
5. **Graceful degradation**: transient AI errors retry (bounded) then fall back to the deterministic
   summary marked `degraded`; a single failed source becomes a **noted gap**, not a failed briefing.
6. **Provider-agnostic**: capability request only; no hardcoded provider/model.

**Exit criteria (Epic #5):** _a daily briefing grounded in my real notes/commitments._

---

## Non-Goals (deferred)

- **News, sports, and other net-new external sources** — need new connectors/sources. Future
  milestone. The connector seam (read-tool/manifest registration) is preserved so they slot in
  without reshaping the pipeline.
- **Live email/calendar/Teams sync** — calendar/email are wired as _selectable read tools_ backed by
  read caches that may be empty until live sync (M-B1). M-A4 grounds on whatever a definition selects;
  empty sources contribute nothing (or a noted gap).
- **Full cron-expression scheduling** — M-A4 ships daily-at-time + IANA timezone only. General cron
  (weekly/interval/one-shot) is YAGNI until a second consumer needs it.
- **A general heartbeat framework** — the heartbeat is intentionally thin (tick + handler registry).
  No per-handler priorities, dynamic intervals, or retry policies until a second real consumer
  (M-A5/M-B1) shows what's needed.
- **Persistent per-user "user model" for personalization** — beyond commitments + vault grounding.
  Re-grounding from RLS storage at run time is sufficient for M-A4.

---

## Resolved Decisions

| # | Decision | Rationale |
|---|----------|-----------|
| 1 | Spec now, build after M-A3 merges | M-A4 depends on M-A3's capability-router execution path, currently uncommitted. |
| 2 | AI synthesizes the **full narrative**; raw items + provenance stored in `source_metadata` | Matches "grounded daily briefing"; matches all prior art (LLM-synthesized, not templated). |
| 3 | Vault grounding = **hybrid** (signals-derived semantic query + recency) | Reflects both what's relevant to today's commitments/tasks and what's fresh in notes. |
| 4 | Inputs = vault (always) + commitments (always) + selected read tools | Reuses the existing read-tool/manifest connector seam; net-new sources deferred. |
| 5 | Degradation: bounded retry transient → deterministic fallback (`degraded`); per-source **partial with noted gaps** | Unattended job must always produce something useful; mirrors Hermes source-count provenance. |
| 6 | Scheduling = **thin shared heartbeat** in `packages/jobs`; briefings is the first handler | Validated by Hermes/OpenClaw; one tick, DB-query due, fan-out. |
| 7 | Tick reads only a **SECURITY DEFINER safe projection**; runs are **actor-scoped per owner** | Closes the cross-user leakage class both prior-art systems suffer. |
| 8 | Per-user **IANA timezone + target time** in `schedule_metadata` | Correct multi-user wake-up times; no hardcoded "morning." |
| 9 | Surface **source provenance/counts** in output; store paths/ids/excerpts (not full note bodies) | Provenance without leaking full content into `source_metadata`/prompts. |

---

## Architecture

### Data flow (one briefing run)

```
heartbeat tick (pg-boss scheduled, every N min, system context)
  └─ briefings handler: app.list_due_briefing_definitions()  ← SECURITY DEFINER safe projection
        (returns {definition_id, owner_user_id, cadence, last_run_at, schedule_metadata} only)
     └─ for each DUE definition (per-user tz/time vs last_run_at):
          enqueue BriefingRunPayload {actorUserId, definitionId, briefingRunId,
                                      runKind:"scheduled", idempotencyKey}   ← metadata only
                │
                ▼
   briefings run worker  (registerDataContextWorker → withDataContext(owner) → RLS-scoped)
     └─ composeBriefing(scopedDb, definition, deps):
          1. signals  = commitments.listVisible() + selected read-tool results
          2. query    = titles(commitments + tasks + calendar)
          3. grounding = MemoryRetriever.retrieve(query) ∪ retrieveRecent()  (deduped)
          4. prompt   = system + {commitments, sources, relevant notes w/ provenance}
          5. model    = aiRepository.selectModelForCapability("summarization" → "chat")
                        → selectProviderWithCredential → decrypt (in-scope) → createChatAdapter
          6. narrative = adapter.generateChat({model, messages})
             · transient error → bounded retry; permanent → deterministic fallback (degraded)
             · per-source failure → noted gap, not a failed run
          7. persist run: summary_text = narrative (or fallback);
             source_metadata = {tools[], notes[] (path/id/excerpt), commitmentCount,
                                 model, degraded, gaps[], sourceCounts}
```

### Components

**`packages/jobs/src/heartbeat.ts`** _(new — the thin shared seam)_

- A `heartbeat` queue + a **single pg-boss schedule** (enable `schedule: true` on the worker's boss
  client; register one cron, e.g. `*/15 * * * *`). Cadence is a free knob; default 15 min (worst-case
  lateness, not load — the tick is a cheap metadata query that usually finds nothing).
- `registerHeartbeatHandler(name, handler)` — module registry. The tick worker invokes every
  registered handler each tick.
- Handler signature receives a **constrained system executor** whose _only_ powers are (a) calling
  whitelisted SECURITY DEFINER safe-projection functions and (b) enqueueing actor-scoped jobs. It
  **cannot** read private tables directly.
- No speculative features (priority/interval/retry-per-handler) — added when a second consumer needs them.

**`packages/db/src/data-context.ts`** _(foundation change — highest-scrutiny)_

- Add `withSystemContext(work)` to `DataContextRunner`: opens a transaction that sets **no**
  `app.actor_user_id` (RLS therefore **fails closed** for direct table reads — no rows). The system
  context is used **only** to invoke SECURITY DEFINER safe-projection functions and to enqueue jobs.
- This is the single most security-sensitive addition. It gets a dedicated test (direct private-table
  read under system context returns **zero rows**) and a security/codex review before merge.

**`packages/briefings/sql/00NN_due_briefings_fn.sql`** _(new migration)_

- `app.list_due_briefing_definitions()` — `SECURITY DEFINER`, returns the **minimal safe projection**
  (`definition_id, owner_user_id, cadence, last_run_at, schedule_metadata`) for **enabled** definitions
  only. **No titles, no content, no selected tool names.** Mirrors the existing
  `packages/connectors/sql/0010_connector_admin_safe_metadata.sql` precedent. Grants restricted to the
  app role; due-time math (tz/target/`last_run_at`) is done in TypeScript from this projection.

**`packages/briefings/src/schedule-handler.ts`** _(new)_

- The briefings heartbeat handler. Calls `app.list_due_briefing_definitions()`, computes which are due
  (per-user IANA timezone + target time vs `last_run_at`, "not yet run today"), and enqueues one
  actor-scoped `BriefingRunPayload` (`runKind:"scheduled"`) per due definition. **Idempotency key =
  `definitionId + scheduledLocalDate`** so a definition can't double-fire within a sweep window.

**`packages/briefings/src/compose.ts`** _(new — the synthesis core, extracted to stay < 1000 lines)_

- `composeBriefing(scopedDb, definition, deps)`: gathers signals, builds the hybrid vault query,
  retrieves + dedupes, assembles the grounded prompt, resolves AI via the capability router, generates
  the narrative, applies retry/partial/degraded logic, and returns `{ status, summaryText,
  sourceMetadata }`. `repository.generateRun` delegates synthesis here; persistence stays in the repo.

**`packages/memory/src`** _(small additions)_

- `MemoryRepository.listRecentChunks(scopedDb, limit)` — ordered by file-index `updated_at desc`.
- `MemoryRetriever.retrieveRecent(scopedDb, limit)` — public surface for the recency half of the
  hybrid. Briefings consumes memory **only** through its package's public API (module isolation).

**Dependency injection / wiring**

- `registerBriefingsJobWorkers` / `generateRun` gain injected deps (memory retriever, commitments
  repo, ai repository, secret cipher, `createChatAdapter`), mirroring the M-A3 chat worker's options
  pattern. Defaults wired at the API/worker composition root, which also registers the heartbeat and
  the briefings handler.

**Queue config**

- New `heartbeat` queue. Briefings **run** queue gains a small `retryLimit` (currently `0`) + backoff
  so transient AI failures retry before the deterministic fallback fires.

### Prompt & grounding shape

- **System prompt:** role = personal daily-briefing writer; instructed to ground strictly in provided
  context, attribute notes by provenance, and never fabricate. (Echoes OpenClaw's "follow it strictly,
  do not infer" guardrail.)
- **Context blocks:** (1) open commitments (title, due, counterparty), (2) read-tool source summaries,
  (3) relevant vault notes with provenance (path + excerpt; **not** full bodies). Excerpts only —
  consistent with "secrets/content never over-shared."
- **Output stored:** narrative → `summary_text`; provenance, model used, `degraded` flag, `gaps[]`,
  and source counts → `source_metadata`.

---

## Reliability / Degradation contract

| Failure | Behavior |
|---------|----------|
| Transient AI error (429 / 5xx / network) | Bounded pg-boss retry (small `retryLimit` + backoff). |
| Permanent AI error (no model configured / 401 / 403) | **No retry.** Deterministic string-concat fallback; `degraded:true` + reason in `source_metadata`. User still gets a briefing. |
| Single source/read-tool fails | **Noted gap** in `source_metadata.gaps[]`; briefing synthesized from remaining sources. Run not failed. |
| Vault empty / no commitments | Briefing notes the absence; not an error. |
| Heartbeat tick failure | Logged; next tick retries. Idempotency key prevents duplicate runs. |

---

## Security / Isolation (the differentiator)

- **Tick reads no private content.** Only `app.list_due_briefing_definitions()` (safe projection) is
  callable from system context. This is the exact point where Hermes/OpenClaw leak (global job list);
  Jarv1s confines it to non-private scheduling metadata.
- **Every run is RLS-scoped to the owner** via `withDataContext({actorUserId})`. User A's tick can
  never enqueue work that reads user B's data; the run worker physically cannot see another user's rows.
- **Metadata-only payloads** preserved: the trigger carries IDs + run kind + idempotency key only —
  no content, no prompts, no secrets. Personalization is **re-grounded at run time** from RLS storage.
- **Secrets never escape:** credential decryption stays in worker scope; only model id + provenance
  reach `source_metadata`.
- **No `BYPASSRLS`** on any runtime role; elevation is per-function (SECURITY DEFINER) and returns only
  non-private metadata.

---

## Testing

**Integration (`tests/integration/briefings.test.ts`, extended):**

- AI-synthesized run with a **fake `createChatAdapter`** (deterministic) → `summary_text` is the
  narrative; `source_metadata` carries note provenance, commitment count, model, source counts.
- **Hybrid grounding**: retrieved-note provenance from both semantic and recency paths appears, deduped.
- **Commitments** included in context.
- **Per-source partial**: a failing read tool produces a `gaps[]` entry; the run still succeeds.
- **Degraded fallback**: no configured model, and adapter-throws-permanent → deterministic summary,
  `degraded:true`.
- **Transient retry**: adapter throws transient once → retried → succeeds.
- **Scheduler**: handler enqueues actor-scoped jobs for **due** definitions only; respects
  timezone/target-time/`last_run_at`; **idempotent** (no double-fire same local day).
- **RLS**: user A's sweep never enqueues or surfaces user B's definition; `list_due_briefing_definitions`
  returns the safe projection only.

**Unit:** signals→query building; hybrid dedupe; due-time computation across timezones (DST edge);
`withSystemContext` returns zero rows on a direct private-table select.

**Gate:** `pnpm verify:foundation` + `pnpm audit:release-hardening` green. Security/codex review of the
`withSystemContext` foundation change and the SECURITY DEFINER function before merge.

---

## Files (anticipated; finalized in the plan)

- `packages/jobs/src/heartbeat.ts` _(new)_, `packages/jobs/src/index.ts` _(export)_
- `packages/db/src/data-context.ts` _(add `withSystemContext`)_
- `packages/briefings/sql/00NN_due_briefings_fn.sql` _(new migration)_
- `packages/briefings/src/schedule-handler.ts` _(new)_, `compose.ts` _(new)_,
  `repository.ts` / `jobs.ts` / `manifest.ts` _(wire deps, queue config, register handler)_
- `packages/memory/src/repository.ts` + `retrieval.ts` _(recency methods)_, `index.ts` _(export)_
- Composition root (API + worker) — register heartbeat + briefings handler with deps.
- `tests/integration/briefings.test.ts` _(extend)_, new unit tests.

---

## Exit Criteria (Epic #5)

- [ ] Briefing runs are AI-synthesized narratives grounded in vault notes + commitments + selected
      read tools (provider-agnostic).
- [ ] Hybrid vault retrieval (signals + recency) feeds the briefing; provenance surfaced.
- [ ] Briefings fire automatically each morning, per user, in the user's timezone, via the shared
      heartbeat (briefings = first handler).
- [ ] Degradation: transient retry → deterministic fallback marked `degraded`; per-source partial gaps.
- [ ] RLS-safe scheduling: tick reads safe projection only; runs actor-scoped; no `BYPASSRLS`.
- [ ] `pnpm verify:foundation` + `pnpm audit:release-hardening` green; security review of system-context
      + SECURITY DEFINER passed.

---

## Hard Invariants Honored (from CLAUDE.md)

- **Provider-agnostic AI** — capability request only; no hardcoded provider/model. ✓
- **Metadata-only job payloads** — trigger carries IDs + run kind + idempotency key. ✓
- **Secrets never escape** — in-scope decryption; only model id + provenance persisted. ✓
- **DataContextDb only / AccessContext shape** — runs use `withDataContext`; new `withSystemContext`
  is narrow, fails closed, and never used by repositories for private reads. ✓
- **No admin private-data bypass / no `BYPASSRLS`** — SECURITY DEFINER safe projection of non-private
  metadata only. ✓
- **Module isolation** — briefings consumes memory/structured-state/ai via public package APIs. ✓
- **Spec before build** — this document. ✓
- **Never edit applied migrations** — new SQL file in the briefings module `sql/` dir. ✓
- **1000-line limit** — synthesis extracted into `compose.ts`. ✓
