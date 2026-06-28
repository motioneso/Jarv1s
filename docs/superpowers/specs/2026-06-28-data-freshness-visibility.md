# Data freshness visibility in Jarvis answers (#541)

**Status:** Draft - RFA
**Date:** 2026-06-28
**Owner:** Ben + Coordinator fleet
**Issue:** #541
**Tier:** routine (UI + metadata enrichment; no new tables, no RLS changes, no auth surface)
**Depends on:** existing Briefings module, existing Chat (CLI-bridge) module, existing Connectors
module sync-state, Memory/Vault modules.
**Related:** #536 scheduled recurring briefings (defers user-facing freshness UX to #541 — see #536
§12), #531 restrained proactive monitoring, #526 unified priority model.
**Grounded on:**
`~/Jarv1s/docs/superpowers/specs/2026-06-27-scheduled-recurring-jarvis-briefings.md`,
`~/Jarv1s/packages/briefings/src/compose.ts`,
`~/Jarv1s/packages/briefings/src/repository.ts`,
`~/Jarv1s/packages/briefings/src/jobs.ts`,
`~/Jarv1s/packages/shared/src/briefings-api.ts`,
`~/Jarv1s/packages/shared/src/chat-api.ts`,
`~/Jarv1s/packages/chat/src/live/types.ts`,
`~/Jarv1s/packages/connectors/src/repository.ts` (`last_sync_finished_at`),
`~/Jarv1s/packages/db/src/types.ts` (`last_sync_*` columns).

## 1. Problem

Jarvis answers — both briefing runs and chat replies — are synthesized from sources that may be
hours or days stale. Email and calendar reflect the last connector sync, not live mailboxes; notes
reflect the last vault write; memory reflects the last memory update. The user gets a confident
answer with **no signal about when the underlying data was last fetched**.

This is a trust and safety gap, not a sync gap. A user reading "you have no urgent email" cannot
tell whether that reflects a sync from two minutes ago or from yesterday morning. The same answer is
trustworthy in one case and misleading in the other, and today the two are indistinguishable.

The missing capability is **visibility**, not freshness itself. We do not need to fetch more often;
we need to surface, per source, *when the data Jarvis used was last refreshed*, and warn when a
briefing leaned on clearly-stale inputs.

## 2. Decision

Surface **per-source freshness labels** on every Jarvis answer that was generated from grounded
sources:

- briefing run detail view shows a **source list with per-source timestamps**
  (e.g. `email — synced 2h ago`, `calendar — live`, `notes — 3d ago`);
- chat responses that used grounded read sources show a **collapsed freshness footer**; expanding it
  reveals the per-source ages.

Freshness is recorded as **metadata-only timestamps** captured at the moment the run/response was
generated. It is derived from existing module state (connector sync time, vault write time, memory
update time, real-time DB reads) — never from new sync jobs, never from source content.

A configurable **stale threshold** (default: 24h for briefings) drives a single non-blocking warning
when any contributing source is older than the threshold. Chat shows ages with no threshold and no
warning — just the age.

This extends the existing `source_metadata` blob (briefings) and adds an equivalent metadata field
to assistant chat messages. No new tables, no schema migrations beyond optional JSON shape, no RLS
changes.

## 3. Current Architecture Anchor

Already present:

- **Briefings** persist `app.briefing_runs.source_metadata` as a JSONB column
  (`jsonObjectSchema` / `Record<string, unknown>`). `compose.ts` already writes counts, `gaps`
  (`BriefingGap = { source, reason }`), `degraded`, and `aiModel` into it. There is **no**
  `sourceTimestamps` field today — #541 adds it.
- Each briefing source is gathered as a `Section` via an owner-scoped read tool / internal read
  section under `DataContextDb`. Sources gather into commitments, tasks, calendar, email, vault
  (notes), chats, memory.
- **Connectors** expose per-account `last_sync_finished_at`, `last_sync_started_at`, and
  `last_sync_status` (`packages/db/src/types.ts`, `packages/connectors/src/repository.ts`). Email and
  calendar freshness derive from these via the connectors module public API — **never** by querying
  connector tables directly (module isolation).
- **Chat** is a CLI-bridge live session. `ChatMessageDto` already carries `tools`
  (`ChatSelectedToolMetadataDto[]`, each with `risk: "read" | "write" | "destructive"`) and
  `activity` (`ChatActivityEventDto[]`). There is **no** source-freshness field today — #541 adds a
  metadata-only one on the assistant message.

#541 enriches these existing shapes; it does not introduce a new freshness subsystem.

## 4. What "Freshness" Means Per Source

Freshness is a single timestamp per source: **the as-of time of the data Jarvis used**, resolved
through the owning module's public API.

| Source             | Freshness kind     | As-of timestamp                                              | "Live" semantics                  |
| ------------------ | ------------------ | ----------------------------------------------------------- | --------------------------------- |
| `email`            | `connector_sync`   | connector account `last_sync_finished_at` for the mailbox   | never live (cache-backed)         |
| `calendar`         | `connector_sync`   | connector account `last_sync_finished_at` for the calendar  | never live (cache-backed)         |
| `notes` / `vault`  | `vault_write`      | last vault write time (most recent note mtime in scope)     | never labelled "live"             |
| `memory`           | `memory_update`    | last memory/fact update time in scope                       | never labelled "live"             |
| `tasks`            | `realtime`         | the run/response capture time (`capturedAt`)                | always "live" (direct DB query)   |
| `commitments`      | `realtime`         | the run/response capture time                               | always "live" (direct DB query)   |
| `chats`            | `realtime`         | the run/response capture time                               | always "live" (direct DB query)   |

Rules:

- Sources read directly from owner-scoped app tables (`tasks`, `commitments`, `chats`) are
  **real-time**: their as-of time equals the capture time, and the UI renders them as `live`.
- Cache-backed sources (`email`, `calendar`) use the connector's last successful sync time. If the
  connector never synced or sync state is unknown, `asOf` is `null` and the UI renders `unknown`.
- `notes`/`memory` use the last write/update time of the in-scope content.
- An `asOf` of `null` is a first-class state ("never synced" / "unknown"), distinct from a recent
  timestamp. It is **not** treated as fresh.
- Freshness is resolved at gather time, alongside the existing section gather, using the same
  owner-scoped `DataContextDb` and the same module public APIs. No source content is read for the
  purpose of computing freshness beyond what the answer already reads.

## 5. Data Model

### 5.1 Briefings — extend `source_metadata`

Add a `sourceTimestamps` field to the existing `source_metadata` JSON blob. No column change
(`source_metadata` is already JSONB; `jsonObjectSchema` already permits additional keys).

```ts
type FreshnessKind = "connector_sync" | "vault_write" | "memory_update" | "realtime";

interface SourceFreshnessEntry {
  readonly source: string; // "email" | "calendar" | "notes" | "memory" | "tasks" | ...
  readonly freshnessKind: FreshnessKind;
  readonly asOf: string | null; // ISO-8601, or null when unknown / never-synced
}

interface SourceFreshnessV1 {
  readonly version: 1;
  readonly capturedAt: string; // ISO-8601 — the run generation time; the reference "now" for ages
  readonly sources: readonly SourceFreshnessEntry[];
}
```

- `compose.ts` populates `sourceMetadata.sourceTimestamps: SourceFreshnessV1` next to the existing
  `gaps`/`degraded`/counts keys, using the captured `now` already threaded through compose as
  `capturedAt`.
- A source recorded as a `gap` (tool failed / empty / truncated) still gets a freshness entry when a
  timestamp is resolvable; otherwise `asOf` is `null`. Freshness and gap are orthogonal signals.
- The shared contract documents the `sourceTimestamps` shape but keeps `sourceMetadata` typed as
  `Record<string, unknown>` / `jsonObjectSchema` (additive, no breaking schema change). Existing runs
  without the field render with no freshness section (graceful absence).

### 5.2 Chat — add assistant-message source freshness

Add an optional metadata-only `sourceFreshness` field to the assistant `ChatMessageDto`, populated
when the assistant turn used grounded read sources (resolved from the read `tools` the turn invoked).

```ts
interface ChatMessageDto {
  // ...existing fields...
  readonly sourceFreshness?: SourceFreshnessV1 | null;
}
```

- Computed at turn-finalization from the read tools the assistant actually used, mapped to their
  owning source's freshness, plus `capturedAt` = turn completion time.
- Persisted with the stored assistant message (metadata-only) so reloading a thread re-renders the
  footer. No new table — it rides the existing chat message record as metadata.
- When the turn used no grounded read sources, `sourceFreshness` is `null`/absent and no footer
  renders.

## 6. Where Freshness Shows (UI)

### 6.1 Briefing run detail view

- A **Sources** section lists every contributing source with its freshness label:
  - real-time sources → `live`;
  - timestamped sources → relative age (`2h ago`, `3d ago`) with absolute timestamp on hover/title;
  - `asOf: null` → `unknown` / `never synced`.
- If any source's age exceeds the configured stale threshold (default 24h), show **one** inline,
  non-blocking **stale-data warning** at the top of the run (e.g. "Some sources are over a day old").
  The warning names which sources are stale; it does not block, gate, or hide the briefing.
- Reuse existing authored empty/degraded patterns (jds-\*); do not introduce the curved colored
  left-border card accent (AI tell). The warning is a functional inline notice, styled with existing
  primitives.

### 6.2 Chat response footer

- For assistant replies that used grounded read sources, render a **collapsed** footer beneath the
  reply: a compact summary (e.g. "Sources: email, calendar, notes").
- Expanding reveals the per-source ages (same label rules as the briefing view).
- **No threshold and no warning in chat** — chat shows ages only. The user decides; we do not flag.
- Footer is collapsed by default to avoid visual noise on every grounded answer.

## 7. Stale Threshold (configuration)

- The stale threshold is **configurable**, with a default of **24h for briefings**.
- Threshold applies to briefings only. **Chat has no threshold** — it shows age, never a warning.
- The threshold is a presentation-layer setting (a constant/config read at render/compose time). No
  new settings table is required for V1; a single instance/user-level default is sufficient. If a
  user-facing control is added, it is a routine settings field, not a new module.
- Stale evaluation compares `capturedAt - asOf` against the threshold. Real-time (`live`) and
  `asOf: null` sources are excluded from the "stale" set: `live` is never stale; `unknown` is
  surfaced as `unknown`, not as a stale-age warning.

## 8. No New Sync Jobs

Freshness reflects **what was available when the run/response was generated**, not real-time
connector state.

- #541 introduces **no** connector sync jobs, no pg-boss queues, no background refresh, no polling.
- It reads already-recorded module state (connector `last_sync_finished_at`, vault write time, memory
  update time) at gather time and snapshots it into the answer's metadata.
- After an answer is generated, its freshness labels are **static** — they describe the data that
  produced that answer, not the current world. The relative age (`2h ago`) is computed at render time
  from the stored `asOf`, so the label naturally grows older as the answer ages, which is correct.

## 9. Privacy, Safety, and Module Isolation

- **Timestamps only, never content.** Freshness entries carry a source key, a freshness kind, and an
  ISO timestamp (or `null`). They never carry email subjects, calendar titles, note text, connector
  payloads, credentials, tokens, or any private content.
- **Secrets never escape.** No connector secret, account credential, or token reaches the freshness
  metadata, the frontend, logs, or pg-boss payloads. `last_sync_finished_at` is a timestamp, not a
  secret.
- **Module isolation.** Briefings/chat resolve email and calendar freshness through the connectors
  module's **public API**, never by querying connector tables directly. Vault and memory freshness
  come through their owning modules' read APIs. No module imports another module's internals.
- **DataContextDb only / AccessContext shape unchanged.** All freshness resolution happens under the
  existing owner-scoped `DataContextDb`; no new `AccessContext` fields (still `{ actorUserId,
  requestId }`).
- **RLS unchanged.** `source_metadata` is a column on `app.briefing_runs`, which is owner-scoped
  under FORCE RLS; the chat `sourceFreshness` rides the owner-scoped chat message row. Freshness
  inherits the owning record's RLS — no new policy, no admin bypass, no `BYPASSRLS`.
- **Metadata-only payloads preserved.** Nothing in #541 adds content to pg-boss job payloads;
  freshness is computed and stored on the result record under RLS, not shipped through job payloads.
- **Logs stay metadata-only.** Freshness logging (if any) records source key, kind, and a boolean
  stale flag — never timestamps tied to content, never content.

## 10. Error Handling

- Connector sync state unavailable / module call fails → record `asOf: null` (`unknown`); never fail
  the run or the chat turn.
- Vault/memory write-time lookup fails → `asOf: null`; continue.
- A source that is a `gap` still gets a freshness entry when resolvable; otherwise `asOf: null`.
  Freshness resolution **never** turns a successful answer into a failed one.
- Missing `sourceTimestamps` on an older run (pre-#541) → render the run with no freshness section.
- Chat turn with no grounded read tools → no footer; `sourceFreshness` absent.

## 11. Out Of Scope

- Forcing a re-sync or manual refresh from the freshness UI (no "refresh now" button).
- Per-source manual refresh controls.
- Real-time staleness streaming / live-updating connector state in the UI.
- New connector sync jobs, queues, or polling.
- Stale thresholds or warnings in chat (chat shows age only).
- Cross-user / shared-answer freshness.
- A new settings module or table for threshold configuration (V1 uses an instance/user default).

## 12. Acceptance Criteria

- [ ] Briefing run detail shows a Sources list with a per-source freshness label: `live` for
      real-time sources, relative age for timestamped sources, `unknown` for `asOf: null`.
- [ ] `source_metadata.sourceTimestamps` (`SourceFreshnessV1`) is populated by `compose.ts` for new
      runs, with `capturedAt` equal to the run generation time, and never contains source content.
- [ ] When any contributing briefing source exceeds the configured stale threshold (default 24h), a
      single non-blocking stale-data warning is shown naming the stale sources.
- [ ] Email/calendar freshness derives from connector `last_sync_finished_at` via the connectors
      public API (no direct connector-table access); tasks/commitments/chats render as `live`.
- [ ] Chat replies that used grounded read sources show a collapsed freshness footer; expanding it
      reveals per-source ages; chat shows no threshold and no warning.
- [ ] Chat assistant messages persist `sourceFreshness` metadata-only and re-render on thread reload;
      turns with no grounded read sources show no footer.
- [ ] Freshness metadata contains timestamps only — no email/calendar/note content, no connector
      payloads, no secrets — verified for both briefings and chat.
- [ ] No new sync jobs, pg-boss queues, or polling are introduced; freshness is a snapshot of
      already-recorded module state.
- [ ] `source_metadata` and chat `sourceFreshness` remain owner-scoped under existing RLS; User A
      cannot read User B's freshness metadata; no RLS policy or migration weakening.
- [ ] Older runs without `sourceTimestamps` render gracefully with no freshness section.

## 13. Verification

Local gate:

```bash
pnpm lint
pnpm format:check
pnpm typecheck
pnpm test:briefings
pnpm test:chat
pnpm test:api
pnpm test:web
```

Targeted tests:

- compose writes a `SourceFreshnessV1` blob with `capturedAt` and one entry per gathered source;
- email/calendar entries carry `connector_sync` + the account `last_sync_finished_at`; tasks carry
  `realtime` with `asOf == capturedAt`;
- connector sync-state unavailable → `asOf: null` (`unknown`) and the run still succeeds;
- stale threshold: a source older than 24h triggers exactly one warning naming that source; a
  source at 23h does not; `live`/`unknown` sources never count as stale;
- chat: a turn using a grounded read tool persists `sourceFreshness` with the right source ages and
  re-renders after reload; a turn with no read tools has no footer;
- freshness metadata snapshot contains no content/secret keys (assert allowlist of keys);
- RLS isolation: User A cannot read User B's briefing-run `source_metadata` or chat `sourceFreshness`;
- older run without `sourceTimestamps` renders with no freshness section (no crash).

## 14. External Review

Pending adversarial review (Codex / AGY) per coordinator policy before build.
