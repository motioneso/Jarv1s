# M-A4: Vault-grounded Daily Briefings

**Status:** Draft (awaiting review) — rev 2 (post-verification + prior-art research)
**Date:** 2026-06-07
**Owner:** Ben
**GitHub:** Epic issue #5 · Milestone M-A4
**Depends on:** M-A3 (real AI providers) merged to `main`; M-A1 (real embeddings) — complete.

---

## Context

Jarv1s has a briefings module (`packages/briefings/`) with definitions, runs, a pg-boss run
worker, and routes/UI. But the pipeline is **deterministic string-concatenation**: `generateSummary`
in `repository.ts` runs the definition's selected _read tools_ via `AiAssistantToolExecutor`, then
formats their results into a fixed text summary. There is **no AI, no vault memory, and no
commitments** in the briefing today, and **nothing triggers runs on a schedule** — runs are
enqueued manually.

M-A4 makes the briefing **real and proactive**: a daily, vault-grounded briefing, synthesized by the
user's configured AI provider, fired automatically each morning in the user's timezone. The three
named pieces already exist as clean repositories:

- `MemoryRetriever.retrieve(scopedDb, query, limit)` — vault vector search (M-A1, real embeddings).
- `CommitmentsRepository.listVisible(scopedDb)` — structured-state open commitments.
- `createChatAdapter(provider, deps).generateChat({ model, messages })` — real AI text generation
  (M-A3), resolved provider-agnostically via `aiRepository.selectModelForCapability`.

### Prior art (deep research, 2026-06-07)

Research on **Hermes Agent** (Nous Research) and **OpenClaw** (Steinberger) — the two leading
self-hosted proactive assistants (22 confirmed claims from primary docs + GitHub source):

- Both converge on a **single shared scheduler ticked on a heartbeat** that DB-queries due jobs —
  but, crucially, OpenClaw documents a **two-primitive split**: **Cron** for "precise timing _or_
  isolated execution," **Heartbeat** for "approximate timing, batched, full-context." A 6 AM briefing
  is squarely a **Cron** job.
- Morning briefings are just **scheduled cron jobs** with **per-user IANA timezone**.
- Each scheduled job runs in a **fresh, isolated session**; personalization is **re-grounded at run
  time**, not carried in the trigger.
- Content is **LLM-synthesized** (not templated), with **source provenance/counts** surfaced.
- Reliability = **provider failover + bounded retries**.
- **Both systems have documented, open multi-user isolation leaks** (OpenClaw's cron list is global
  to the instance — any cron-capable agent can list/edit all users' jobs, GH #26370; "isolated"
  sessions bleeding into the main session). The leak point is **where the scheduler reads across
  users**. Our design removes that surface entirely (see Scheduling).

### Key verification findings (against the actual codebase, 2026-06-07)

The first draft of this spec rested on two unverified assumptions; both were checked and corrected:

1. **pg-boss v12.18.2 natively supports per-key, per-timezone cron schedules.** The `pgboss.schedule`
   table is `PRIMARY KEY (name, key)` (many schedules per queue), `ScheduleOptions = { tz?, key?, … }`,
   and a `schedule: true` constructor flag runs the cron engine. The earlier "one schedule per queue"
   claim was wrong. **This lets each briefing definition own a native cron schedule and eliminates the
   need for a custom heartbeat, a cross-user "what's due" read, a SECURITY DEFINER function, a system
   service-principal, and a new `withSystemContext` DB path** — i.e. it removes the entire
   highest-risk security surface from the first draft.
2. **Commitments and memory expose _no_ assistant read tools** (only tasks/calendar/email/
   notifications do), and briefings does not depend on those packages. So wiring them needs a
   deliberate choice (see Module Wiring), not a hand-wave.

Also verified: `daily` cadence + `scheduled` run-kind enums exist; `schedule_metadata` and
`source_metadata` are `jsonb` (no schema change for timezone/target or provenance); `memory_file_index`
has `ingested_at` for recency; `summarization` capability exists; all runtime roles are `NOBYPASSRLS`
with `FORCE ROW LEVEL SECURITY` (RLS fails closed). And — from the M-A3 owner, verified against code —
the **CLI/tmux transport is fragile unattended** (see Transport).

---

## Goals

1. Briefing runs are **AI-synthesized narratives** grounded in the user's **vault notes**, **open
   commitments**, and selected **read tools** — replacing the deterministic string-concat summary.
2. Vault grounding uses a **hybrid** retrieval: a semantic query derived from the day's signals
   **plus** recency.
3. Briefings fire **automatically each morning, per user, in the user's timezone**, via **native
   per-definition pg-boss cron schedules**.
4. **Subscription-first and fully provider-agnostic** AI: same capability router + `auth_method`-driven
   transport as chat (CLI/tmux default, api_key/local optional). **No api_key requirement; no
   per-feature provider logic.**
5. **Graceful degradation**: transient AI errors retry (bounded) then fall back to the deterministic
   summary marked `degraded`; a single failed source becomes a **noted gap**, not a failed briefing;
   an unattended CLI with no/expired login **fails fast** (precheck) rather than hanging 120s.
6. Cross-user isolation by construction: **no code path reads across users**; every run executes
   RLS-scoped to its owner.

**Exit criteria (Epic #5):** _a daily briefing grounded in my real notes/commitments._

---

## Non-Goals (deferred)

- **A shared "heartbeat" primitive** — native per-definition cron covers M-A4. The shared heartbeat
  (one tick many modules register approximate/batched checks into) is documented here as a **future**
  primitive for when a real approximate-timing consumer appears (e.g. M-A5 commitment-drift checks),
  adopting OpenClaw's Cron-vs-Heartbeat split deliberately. Not built now (YAGNI).
- **News, sports, and other net-new external sources** — need new connectors. The read-tool/manifest
  seam is preserved so they slot in without reshaping the pipeline.
- **Live email/calendar/Teams sync** — calendar/email are selectable read tools backed by caches that
  may be empty until M-B1; empty sources contribute nothing (or a noted gap).
- **General cron expressions** (weekly/interval/one-shot) — M-A4 ships daily-at-time + IANA timezone.
- **Non-interactive print/exec CLI mode** (`claude -p`, etc.) — **explicitly rejected, not deferred.**
  Print mode deducts from different usage/billing than the subscription (violating subscription-first)
  and can't be observed like a tmux session (the user can genuinely attach to the live tmux session to
  watch/intervene). The interactive tmux bridge stays the subscription transport.

---

## Resolved Decisions

| # | Decision | Rationale |
|---|----------|-----------|
| 1 | Spec now, build after M-A3 merges | Depends on M-A3's capability-router execution path, currently uncommitted. |
| 2 | AI synthesizes the **full narrative**; raw items + provenance in `source_metadata` | Matches "grounded briefing" and all prior art (LLM-synthesized). |
| 3 | Vault grounding = **hybrid** (signals-derived semantic query + recency) | Reflects both today's relevance and what's fresh in notes. |
| 4 | Inputs = vault (always) + commitments (always) + selected read tools | Reuses the read-tool/manifest seam; net-new sources deferred. |
| 5 | Degradation: bounded transient retry → deterministic fallback (`degraded`); per-source **partial gaps**; **fast precheck** for unattended CLI | Unattended job must always produce something useful, fast. |
| 6 | Scheduling = **native per-definition pg-boss cron** (key=`definitionId`, per-user `tz`) | Removes the cross-user read + SECURITY DEFINER + system-principal surface entirely. |
| 7 | **Subscription/CLI-first, fully provider-agnostic** transport; api_key optional, never required | Hard product invariant — ALL AI work must support subscription, any provider. |
| 8 | Per-user **IANA timezone + target time** in `schedule_metadata` | Correct multi-user morning times. |
| 9 | Surface **source provenance/counts**; store paths/ids/excerpts (not full note bodies) | Provenance without leaking full content into prompts/metadata. |
| 10 | Commitments via **read-tool seam**; vault retrieval via **direct memory capability dep** | Commitments fit the param-less seam; query-driven retrieval doesn't (see Module Wiring). |

---

## Architecture

### Data flow (one scheduled briefing)

```
pg-boss cron engine (schedule:true)   ← one schedule per enabled daily definition,
  │                                       key=definitionId, tz=user's IANA tz, cron=daily@target
  └─ fires job → BRIEFINGS_RUN_QUEUE, data {actorUserId, definitionId, runKind:"scheduled"}  (metadata only)
        │
        ▼
   briefings run worker  (registerDataContextWorker → withDataContext(owner) → RLS-scoped)
     └─ generateRun(definitionId, runKind, idempotencyKey=definitionId+localDate)
          └─ composeBriefing(scopedDb, definition, deps):
               1. signals  = commitments (read tool) + other selected read-tool results
               2. query    = titles(commitments + tasks + calendar)
               3. grounding = MemoryRetriever.retrieve(query) ∪ retrieveRecent()  (deduped)
               4. prompt   = system + {commitments, sources, relevant notes w/ provenance}
               5. model    = aiRepository.selectModelForCapability("summarization" → "chat")
                             → selectProviderWithCredential → adapter (auth_method-driven, same as chat)
               6. PRECHECK transport availability (per-adapter): CLI login-state / key present / endpoint
                  · unavailable → skip generation, deterministic fallback (degraded, re-auth reason)
               7. narrative = adapter.generateChat({model, messages})  (unique session jarv1s-<runId>)
                  · transient error → bounded retry; permanent → deterministic fallback (degraded)
                  · per-source failure → noted gap, not a failed run
               8. persist run: summary_text = narrative (or fallback);
                  source_metadata = {tools[], notes[](path/id/excerpt), commitmentCount,
                                     model, transport, degraded, degradedReason, gaps[], sourceCounts}
```

The **manual "run now"** path is unchanged in shape (UI → enqueue → same worker → `composeBriefing`).
Scheduled and manual differ only in `run_kind` and trigger.

### Scheduling — native per-definition cron (no cross-user reads)

- Enable pg-boss `schedule: true` on the worker's boss client; the cron engine evaluates
  `pgboss.schedule` rows and emits jobs.
- **Schedule lifecycle is driven entirely by actor-scoped definition mutations** — no global sweep:
  - On create/enable of a `daily` definition → `boss.schedule(BRIEFINGS_RUN_QUEUE, cronExpr, data, {tz, key:definitionId})`.
  - On disable/delete → `boss.unschedule(BRIEFINGS_RUN_QUEUE, definitionId)`.
  - On cadence/time/tz change → re-`schedule` (upsert on `(name,key)`).
  - **Per-user reconcile on session activity** (actor-scoped) self-heals drift (e.g. definitions
    created before M-A4). **Explicitly no global cross-user startup sweep** — that would reintroduce
    the leak surface.
- `cronExpr` derived from `schedule_metadata.targetTime` (e.g. `"06:00"`) → `0 6 * * *`; `tz` from
  `schedule_metadata.timezone` (IANA). Defaults documented if absent.
- Durable across restarts (pg-boss persists schedules). Idempotency: worker derives
  `definitionId + localDate` as the run idempotency key + pg-boss `singletonKey` so a definition
  can't double-fire for the same local day.

**Why this is isolation-safe:** no Jarv1s code ever reads definitions across users. Schedules are
written in the owner's request context; each fired job is already actor-scoped; execution is
RLS-scoped. The only shared surface is pg-boss's own `schedule`/job tables, holding **metadata-only**
payloads (`{actorUserId, definitionId}`) — identical to how every existing job already works, and
consistent with the metadata-only-payload invariant. This is precisely the cross-user read point
where Hermes/OpenClaw leak; we don't have it.

### Transport — subscription-first, provider-agnostic (HARD invariant)

- **Identical to chat:** the capability router resolves the user's configured model; the provider's
  `auth_method` selects the adapter (CLI/tmux primary, api_key/local optional). **No briefing-specific
  provider logic; no api_key requirement.** Works with Claude/GPT/Gemini/local.
- **Unattended robustness (provider-agnostic, the only briefing-specific addition):**
  - **Fast availability/login-state precheck** per adapter before generation — CLI: is it installed +
    logged in? api_key: key present? local: endpoint reachable? An unavailable transport degrades in
    **seconds**, not the 120s CLI timeout.
  - **Unique tmux session per run** (`jarv1s-<runId>`) — avoids the multi-turn stale-transcript bug;
    briefings are single-turn, which CLI handles correctly.
  - On any transport failure (not-logged-in, expired creds, timeout) → deterministic degraded fallback
    with a surfaced reason (e.g. "CLI login expired — re-auth to restore AI briefings").
- **Known property inherited from M-A3:** the CLI bridge spawns an agentic Claude Code in
  bypass-permissions mode in the repo cwd. Accepted for M-A4 (subscription support is required and this
  is the existing chat mechanism); the precheck + unique-session reduce blast radius. Note:
  `claude -p`/print mode is **not** an alternative — it bills against different usage than the
  subscription and can't be observed/attached like a tmux session (see Non-Goals).

### Module Wiring (isolation-consistent)

- **Commitments → assistant read tool.** Add `commitments.listVisible` (`risk:"read"`) to the
  structured-state manifest and a dispatch case in `AiAssistantToolExecutor`. Briefings consumes it
  through the existing read-tool seam — uniform with tasks/calendar/email, isolation-clean, and it
  advances M-A2's "surface the substrate." Fits the param-less seam exactly.
- **Vault retrieval → direct memory capability dependency.** Hybrid signals+recency retrieval is
  query-driven and briefing-specific orchestration; it does **not** fit the param-less read-tool model
  (the seam invokes tools with `{}`). Briefings depends on `@jarv1s/memory`'s public API
  (`MemoryRetriever`) directly — consistent with how briefings already depends on the `@jarv1s/ai`
  capability package, and within the "declared public API" isolation rule (no internals/tables
  touched). _Open for review: alternative is parameterizing the read-tool seam + a `memory.retrieve`
  tool; recommended against for M-A4 as a larger cross-cutting change to the AI package._

### Components / files (anticipated; finalized in the plan)

- `packages/briefings/src/compose.ts` _(new — synthesis core, extracted to stay < 1000 lines)_
- `packages/briefings/src/schedule.ts` _(new — schedule/unschedule lifecycle + cronExpr/tz mapping + reconcile)_
- `packages/briefings/src/{repository,jobs,routes,manifest}.ts` _(wire deps, enable `schedule:true`,
  hook schedule lifecycle into definition create/update/delete, run-queue `retryLimit`+backoff)_
- `packages/structured-state/src/manifest.ts` + `packages/ai/src/assistant-tools.ts` _(add
  `commitments.listVisible` read tool + dispatch)_
- `packages/memory/src/{repository,retrieval,index}.ts` _(add `listRecentChunks` / `retrieveRecent`)_
- `packages/ai/src/cli-availability.ts` (or adapter) _(add fast login-state precheck;
  provider-agnostic availability)_
- Composition root (API + worker) — inject briefings deps; ensure boss client has `schedule:true`.
- `tests/integration/briefings.test.ts` _(extend)_, new unit tests.

No new SQL migration is required for scheduling (pg-boss owns its schema; `schedule_metadata`/
`source_metadata` are already `jsonb`). A migration is only needed if `commitments.listVisible`'s RLS
needs adjustment (verify the commitments SELECT policy already covers owner reads).

---

## Reliability / Degradation contract

| Failure | Behavior |
|---------|----------|
| Transport unavailable (CLI not logged in / key absent / endpoint down) | **Fast precheck** → deterministic fallback, `degraded:true` + re-auth/configure reason. No 120s hang. |
| Transient AI error (429 / 5xx / network) | Bounded pg-boss retry (small `retryLimit` + backoff), then deterministic fallback. |
| Permanent AI error (401/403/no model) | No retry → deterministic fallback, `degraded:true` + reason. |
| Single source/read-tool fails | **Noted gap** in `source_metadata.gaps[]`; synthesized from the rest. Run not failed. |
| Vault empty / no commitments | Briefing notes the absence; not an error. |
| Schedule fires twice for a local day | Idempotency key (`definitionId+localDate`) + pg-boss `singletonKey` dedupe. |

---

## Security / Isolation

- **No cross-user reads anywhere in Jarv1s code.** Schedules written in owner context; jobs fire
  actor-scoped; runs execute under `withDataContext(owner)` → RLS. This removes the leak class both
  prior-art systems exhibit.
- **Metadata-only payloads** preserved (IDs + run kind + idempotency key). Personalization re-grounded
  at run time from RLS storage.
- **Secrets never escape** — credential decryption stays in worker scope (same as chat); only model id
  + provenance reach `source_metadata`.
- **No `BYPASSRLS`, no SECURITY DEFINER, no system principal, no new non-actor DB path** — the entire
  high-risk surface from rev 1 is gone.
- **Module isolation** — commitments via read-tool seam; memory via public package API; no internals
  or foreign tables touched.

---

## Testing

**Integration (`tests/integration/briefings.test.ts`, extended):**

- AI-synthesized run with a **fake adapter** → `summary_text` is the narrative; `source_metadata`
  carries note provenance, commitment count, model, transport, source counts.
- **Hybrid grounding**: provenance from both semantic and recency paths appears, deduped.
- **Commitments** appear (via the new read tool).
- **Per-source partial**: a failing read tool yields a `gaps[]` entry; run still succeeds.
- **Degraded fallbacks**: (a) no configured model, (b) permanent adapter error, (c) **precheck reports
  transport unavailable** → deterministic summary, `degraded:true` + reason, **without** a long wait.
- **Transient retry**: adapter throws transient once → retried → succeeds.
- **Scheduling**: enabling a daily definition registers a pg-boss schedule (key=definitionId, correct
  tz/cron); disable/delete unschedules; cadence/time change re-schedules; idempotent for a local day.
- **RLS / isolation**: a run executes only the owner's data; no code path enumerates across users.

**Unit:** signals→query building; hybrid dedupe; `targetTime`+tz → cron expression (DST edge);
per-adapter precheck logic.

**Gate:** `pnpm verify:foundation` + `pnpm audit:release-hardening` green.

---

## Exit Criteria (Epic #5)

- [ ] Briefing runs are AI-synthesized narratives grounded in vault notes + commitments + selected
      read tools, fully provider-agnostic and subscription-first.
- [ ] Hybrid vault retrieval (signals + recency) feeds the briefing; provenance surfaced.
- [ ] Briefings fire automatically each morning, per user, in the user's timezone, via native
      per-definition pg-boss cron.
- [ ] Degradation: fast precheck + transient retry → deterministic fallback marked `degraded`;
      per-source partial gaps.
- [ ] No cross-user reads; runs actor-scoped; no `BYPASSRLS`/SECURITY DEFINER/system principal.
- [ ] `pnpm verify:foundation` + `pnpm audit:release-hardening` green.

---

## Hard Invariants Honored (from CLAUDE.md)

- **Provider-agnostic AI** — capability request only; subscription-first; no hardcoded/required
  provider; identical transport selection to chat. ✓
- **Metadata-only job payloads** — IDs + run kind + idempotency key. ✓
- **Secrets never escape** — in-scope decryption; only model id + provenance persisted. ✓
- **DataContextDb only / AccessContext shape** — runs use `withDataContext`; no new non-actor path. ✓
- **No admin private-data bypass / no `BYPASSRLS`** — no cross-user reads at all. ✓
- **Module isolation** — read-tool seam + public package APIs. ✓
- **Spec before build** — this document. ✓
- **Never edit applied migrations** — none required; any new SQL is a new file in the owning module. ✓
- **1000-line limit** — synthesis in `compose.ts`, scheduling in `schedule.ts`. ✓
