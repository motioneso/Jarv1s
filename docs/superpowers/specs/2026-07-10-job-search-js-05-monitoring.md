# JS-05 — scheduled monitoring and run-now

**Status:** Draft — issue #934; pending Ben's final approval

**Grounding:** grounded on `eafa22dd`

**Depends on:** #931, #933, and replacement #915 queue/schedule/run-now task

## Goal

Run idempotent source discovery manually and on a manifest-static periodic tick, retaining state in
KV without private content in pg-boss.

## Job contract

One module-prefixed queue accepts the host-bound external job envelope with only actor id, module id,
manifest hash, job kind, and monitor UUID. Resume/profile text, descriptions, prompts, responses,
credentials, URLs, and errors never enter the payload.

The manifest declares one user schedule ticking hourly. On delivery the handler reads
the monitor's IANA timezone, local due time, and last completed local date. It no-ops before due or
after today's completion. After downtime it performs at most the current local day's run; it never
replays missed ticks. Spring-forward runs on the first tick after the skipped due time; fall-back
runs once because local date completion is authoritative.

Run-now uses the generic authenticated enqueue route, requires the module/monitor enabled, and uses
the platform singleton key to collapse double-clicks. Manual runs do not consume the scheduled
local-day slot.

## Execution

1. Recheck user/module/monitor enablement and idempotency.
2. Fetch/normalize the configured adapter.
3. Upsert canonical opportunities and cursor.
4. Preserve known jobs on source failure.
5. Mark stale only from authoritative absence or explicit liveness evidence.
6. Apply deterministic eligibility and queue/perform the bounded evaluation work.
7. Rebuild the feed index, apply retention, and finish safe run counts/status.

Per-monitor failures are isolated. AI failure does not fail ingestion; candidates remain pending.

## Verification

- Metadata-only payload snapshot and actor binding.
- Duplicate delivery/run-now singleton/idempotency cases.
- Due-before/after, timezone, DST, downtime, and no-catch-up cases.
- Browser/chat closed scheduled execution.
- Source failure preserves data and cursor correctness.
- Disable/delete/hash drift prevents delivery work and reconciles schedules.
- Run retention and safe error-code behavior.

The hourly tick is only a due-check. It performs at most 24 bounded KV checks per user/day and one
real discovery run; it is not an hourly source fetch.
