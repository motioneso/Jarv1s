# Safe automation audit log for Jarvis actions (#540)

**Status:** Draft
**Date:** 2026-06-28
**Owner:** Ben + Codex
**Issue:** #540
**Tier:** sensitive (new table migration, cross-module write from the action gateway, data
export/deletion must include audit entries)
**Depends on:** #534 explicit action permission tiers (the action execution gateway that writes
audit entries), existing assistant gateway/action-request machinery.
**Related follow-ups:** #531 restrained proactive monitoring, #536 scheduled recurring briefings,
#537 automatic commitment extraction.
**Grounded on:** `~/Jarv1s/docs/superpowers/specs/2026-06-27-explicit-action-permission-tiers.md`,
`~/Jarv1s/docs/superpowers/specs/2026-06-27-scheduled-recurring-jarvis-briefings.md` (§11 Action
Suggestions, §12 Privacy/Safety — both defer audit-log UX to #540),
`~/Jarv1s/packages/ai/src/gateway/gateway.ts`, `~/Jarv1s/packages/ai/src/gateway/policy.ts`,
`~/Jarv1s/packages/ai/sql/0016_ai_assistant_actions.sql`,
`~/Jarv1s/packages/ai/sql/0098_ai_cancel_stale_assistant_actions.sql`,
`~/Jarv1s/packages/ai/src/repository.ts`, `~/Jarv1s/packages/settings/src/data-export.ts`,
`~/Jarv1s/scripts/delete-user-data.js`.

## 1. Problem

Jarvis can already execute and propose assistant actions through the gateway. With #534 in place,
some write families run autonomously (`trusted_auto`), some require confirmation (`ask_each_time`),
and destructive/external families always confirm. Proactive cards (#531) and scheduled briefings
(#536) can also *propose* actions that route back through the gateway.

The user has no single, durable, chronological record of **what Jarvis actually did on their
behalf** — what ran, when, whether it was auto-run or explicitly confirmed (or rejected), and what
the outcome was.

Today's partial signals are not an audit trail:

- `app.ai_assistant_action_requests` only records actions that hit the *confirm* path. Anything that
  resolves to `run` (read tools, `trusted_auto` writes) never creates a row, so the autonomous
  actions — exactly the ones a user most wants to audit — are invisible.
- the chat action-request card is ephemeral per session and scrolls away;
- briefing runs record only briefing metadata, not actions;
- logs are operator-facing, metadata-only, and not exposed to the owner.

As Jarvis gains more autonomy, "I don't know what it did" becomes a trust and safety gap. The
missing capability is a **complete, owner-visible, metadata-only audit log** covering every
gateway-executed and gateway-proposed action, regardless of which policy branch it took.

The gap is not a new executor or a second confirmation surface. It is an append-only audit record
plus a simple read UI.

## 2. Decision

Add a **safe automation audit log V1**: one owner-scoped, append-only table written by the #534
action execution gateway, plus a simple chronological read surface in Settings.

- `app.jarvis_action_audit_log` records one row per terminal action outcome (executed,
  auto-executed, confirmed-then-executed, rejected, cancelled, failed).
- The action execution gateway is the **only** writer. No module, route, job, or UI writes audit
  rows directly.
- Entries are **metadata-only**: action kind, action family, tool name, actor id, timestamp,
  approval mode, outcome code, optional bounded error class. Never content, prompts, secrets, or
  connector payloads.
- A read-only "Activity" list lives in Settings (chronological, last 90 days, light filtering).
- RLS is owner-only with FORCE RLS. No admin cross-user audit view.
- Retention is 90 days, purged by a pg-boss maintenance job.

Do **not** add: a new executor, a second confirmation table, a real-time streaming feed, a webhook
or export product, or an admin cross-user dashboard.

## 3. Current Architecture Anchor

The pieces to reuse and integrate:

- **`AssistantToolGateway`** (`packages/ai/src/gateway/gateway.ts`) is the single chokepoint between
  Jarvis and every module operation. It already has exactly the three terminal points where an audit
  row must be written:
  - `runHandler()` — the `run` path (read tools and `trusted_auto` writes). Returns `ok`/error.
  - `confirmAndRun()` — the confirm path. Resolves to `confirmed` → executes via `runHandler()`, or
    `rejected`/`cancelled`/`timeout` → returns denied.
  - These are the only places action execution terminates, so they are the only audit write sites.
- **`resolvePolicy()`** (`packages/ai/src/gateway/policy.ts`) already produces the effective
  decision (`run` vs `confirm`) and, under #534, the effective tier — the source of the recorded
  `approval_mode`.
- **`app.ai_assistant_action_requests`** (`sql/0016`) is the proven pattern for an owner-only,
  FORCE-RLS, append-/resolve-only table with an update-scope trigger and `ON DELETE CASCADE` to
  `app.users`. The audit table copies its RLS and grant shape but is **insert-only** (no user
  updates).
- **`cancel_stale_ai_assistant_action_requests`** (`sql/0098`) is the proven pattern for a
  `SECURITY DEFINER` maintenance function with a dedicated `jarvis_migration_owner` maintenance RLS
  policy and a bounded `EXECUTE` grant. The retention purge copies this shape.
- **`data-export.ts`** assembles the user export from per-table queries; account deletion runs via
  `scripts/delete-user-data.js` and relies on `ON DELETE CASCADE`. The audit table must appear in
  both.

#540 adds a table and a read surface and wires three existing gateway exit points. It does not fork
the execution path.

## 4. What Gets Logged

One row per terminal action outcome. Read tools are **not** audited (they are governed by source
permission, not the action model, and would flood the log). Only `risk: "write"` and
`risk: "destructive"` tool calls produce audit rows.

Recorded fields (all metadata):

| Field             | Meaning                                                                                |
| ----------------- | -------------------------------------------------------------------------------------- |
| `id`              | uuid, audit row id.                                                                    |
| `owner_user_id`   | actor user id (`ToolContext.actorUserId`). Owner scope.                                |
| `tool_module_id`  | owning module id (e.g. `tasks`).                                                        |
| `tool_name`       | assistant tool name (e.g. `tasks.create`, `tasks.deleteList`).                          |
| `action_family_id`| `actionFamilyId` from the tool manifest (#534), nullable for write tools without one.   |
| `action_kind`     | normalized verb class: `write` or `destructive` (the tool's `risk`).                    |
| `approval_mode`   | how it was authorized: `auto` \| `confirmed` \| `rejected` \| `cancelled` \| `timeout`. |
| `outcome`         | terminal result: `success` \| `failed` \| `denied` \| `cancelled`.                      |
| `error_class`     | optional bounded error class string (e.g. `handler_error`, `timeout`). No messages.     |
| `request_id`      | correlation id (`ToolContext.requestId`) for cross-referencing operator logs.           |
| `chat_session_id` | nullable; the originating chat session for cross-referencing only (an id, not content).  |
| `source_surface`  | where the action originated: `chat` \| `proactive` \| `scheduled` \| `unknown`.          |
| `occurred_at`     | timestamptz, terminal-outcome time.                                                     |

`approval_mode` × `outcome` mapping (written at the gateway exit point):

| Gateway path                                  | `approval_mode` | `outcome`   |
| --------------------------------------------- | --------------- | ----------- |
| `run` path (read)                             | *(not logged — read tools are not audited)*   ||
| `run` path, `trusted_auto` write succeeds     | `auto`          | `success`   |
| `run` path, `trusted_auto` write throws       | `auto`          | `failed`    |
| confirm path, approved, handler succeeds      | `confirmed`     | `success`   |
| confirm path, approved, handler throws        | `confirmed`     | `failed`    |
| confirm path, user denies                     | `rejected`      | `denied`    |
| confirm path, user cancels                    | `cancelled`     | `cancelled` |
| confirm path, confirm timeout (no decision)   | `timeout`       | `denied`    |

Notes:

- `action_kind` derives from the tool manifest `risk`, not from free text.
- `action_family_id` is the same `(moduleId, actionFamilyId)` identifier #534 defines; the audit row
  stores the family id string only (module-local; no cross-module inheritance is implied).
- A rejected/cancelled/timed-out action **is** logged — "Jarvis proposed X and you declined" is part
  of the audit story. No handler ran, so `outcome` is `denied`/`cancelled` and no `error_class`.
- `source_surface` is supplied by the caller context, defaulting to `chat`. Proactive (#531) and
  scheduled (#536) surfaces that route through the gateway set it accordingly; if not derivable, use
  `unknown`. This is a coarse enum, never a free-form description.

## 5. Storage

New migration `packages/ai/sql/XXXX_jarvis_action_audit_log.sql` (number assigned by coordinator at merge time; owned by the AI module because the gateway owns the write). Module SQL stays in the owning module's `sql/` directory.

```sql
CREATE TABLE IF NOT EXISTS app.jarvis_action_audit_log (
  id uuid PRIMARY KEY,
  owner_user_id uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  tool_module_id text NOT NULL CHECK (length(btrim(tool_module_id)) > 0),
  tool_name text NOT NULL CHECK (length(btrim(tool_name)) > 0),
  action_family_id text,
  action_kind text NOT NULL CHECK (action_kind IN ('write', 'destructive')),
  approval_mode text NOT NULL
    CHECK (approval_mode IN ('auto', 'confirmed', 'rejected', 'cancelled', 'timeout')),
  outcome text NOT NULL CHECK (outcome IN ('success', 'failed', 'denied', 'cancelled')),
  error_class text CHECK (error_class IS NULL OR length(error_class) <= 64),
  request_id text,
  chat_session_id text,
  source_surface text NOT NULL DEFAULT 'chat'
    CHECK (source_surface IN ('chat', 'proactive', 'scheduled', 'unknown')),
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS jarvis_action_audit_log_owner_time_idx
  ON app.jarvis_action_audit_log(owner_user_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS jarvis_action_audit_log_owner_family_time_idx
  ON app.jarvis_action_audit_log(owner_user_id, action_family_id, occurred_at DESC);
```

Immutability:

- The table is **insert-only** for app runtime. Grant `SELECT, INSERT` to `jarvis_app_runtime`.
  Do **not** grant `UPDATE`/`DELETE` to runtime. There is no user-facing edit or delete of audit
  rows (account-deletion cascade and the retention purge are the only deletes, both privileged).
- Because there is no `UPDATE` grant, no update-scope trigger is needed (contrast `0016`, which is
  resolve-in-place). The audit row is written once at the terminal outcome.

RLS:

```sql
ALTER TABLE app.jarvis_action_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.jarvis_action_audit_log FORCE ROW LEVEL SECURITY;

CREATE POLICY jarvis_action_audit_log_select
ON app.jarvis_action_audit_log
FOR SELECT TO jarvis_app_runtime
USING (
  app.current_actor_user_id() IS NOT NULL
  AND owner_user_id = app.current_actor_user_id()
);

CREATE POLICY jarvis_action_audit_log_insert
ON app.jarvis_action_audit_log
FOR INSERT TO jarvis_app_runtime
WITH CHECK (
  app.current_actor_user_id() IS NOT NULL
  AND owner_user_id = app.current_actor_user_id()
);
```

- FORCE RLS applies to all actors including admins (no admin private-data bypass).
- No `BYPASSRLS` on runtime or worker roles.
- The owner can only ever see their own rows; there is no cross-user select policy for any runtime
  role.

## 6. Gateway Integration (#534)

The action execution gateway is the **sole** writer. Add a single private helper on
`AssistantToolGateway`, e.g. `recordAudit(ctx, found, { approvalMode, outcome, errorClass })`, that
inserts one row under the actor's `DataContextDb`.

Write sites (the existing terminal points in `gateway.ts`):

- `runHandler()` — when invoked for a `risk: "write" | "destructive"` tool via the `run` path
  (`trusted_auto`), record `approval_mode: "auto"` and `outcome: success|failed`. Read tools (the
  other `runHandler` callers) are skipped.
- `confirmAndRun()`:
  - denied / cancelled / timeout branch → record `approval_mode: rejected|cancelled|timeout`,
    `outcome: denied|cancelled`, no handler ran;
  - approved → after the inner `runHandler()` returns, record `approval_mode: "confirmed"`,
    `outcome: success|failed`.

Rules:

- The audit insert runs inside the **same** `withDataContext(access, …)` actor scope the handler
  used, so RLS owner-scoping is automatic. Prefer writing it in the same transaction as the action
  outcome where one exists; otherwise an immediately-following insert under the same access context.
- Audit-write failure must **never** change the user-visible action result. Wrap the insert so a
  failure logs metadata-only and is swallowed (the action already happened; losing one audit row is
  not worth failing a succeeded action). This is best-effort durability, matching the existing
  notifier-failure posture.
- `approval_mode` is derived from the policy branch already computed by `resolvePolicy()` (#534) plus
  the resolution outcome — not from a second policy lookup.
- `error_class` is a bounded enum-like token computed from the caught error category, never the error
  message or stack. The gateway already converts handler throws into a generic `Tool X failed`
  string; the audit row records the *class*, not that string's contents.
- No new field is added to `AccessContext` or `ToolContext`. `source_surface` and `chat_session_id`
  come from the existing `ToolContext` (`chatSessionId`) and an optional coarse surface hint already
  carried by the call context; absent → `chat`/`unknown`.

This keeps `app.ai_assistant_action_requests` as the confirm-flow state machine (pending → resolved)
and adds the audit log as the *complete* outcome record across both branches. The two tables are
complementary: the action-request row is mutable workflow state; the audit row is the immutable
historical fact.

## 7. Read API

Owner package: `packages/ai` (the gateway owns the audit data). Shared contract types in
`packages/shared/src/ai-api.ts` (alongside the existing assistant action DTOs).

- `GET /api/ai/action-audit?since=<iso>&family=<moduleId/familyId>&limit=<n>`
  - Returns the owner's audit rows, newest first.
  - `since` defaults to 90 days ago; clamped to ≥ 90 days ago (retention floor).
  - `family` optional filter on `(tool_module_id, action_family_id)`.
  - `limit` bounded (default 200, max 500). **No pagination in V1** — the 90-day window is the
    natural bound; a single capped query is sufficient.
- Response DTO is metadata-only, mirroring §4 fields. No `input_summary`, no content.

Route rules:

- Owner-scoped read under `DataContextDb`; RLS enforces isolation (route does not hand-roll a
  `WHERE owner_user_id`).
- Read-only. There is no create/update/delete route; the gateway is the only writer and there is no
  user delete.

## 8. UI

A read-only **Activity** list in Settings (a new "Activity" sub-section under the existing Settings
surface; reuse authored `jds-*` primitives and existing list/empty/loading patterns — no new design
system, no curved accent left-border).

Each row shows:

- a human label for the tool/action family (from the module manifest label, #534), e.g. "Created a
  task", "Deleted a list";
- the approval mode as a small badge: **Auto-run**, **Confirmed**, **Declined**, **Cancelled**,
  **Timed out**;
- the outcome as a status chip: **Done**, **Failed**, **Declined**, **Cancelled**;
- relative + absolute timestamp;
- the originating surface when not `chat` (e.g. "from a scheduled briefing").

Controls:

- date range quick filters (Today / 7 days / 30 days / 90 days);
- filter by action family (dropdown sourced from rows present in the window);
- nothing else. No pagination, no infinite scroll, no row detail drawer in V1.

Empty state uses the existing authored empty pattern ("No Jarvis actions yet"). Failed/declined rows
are visually distinct but not alarming.

Labels are derived from manifest metadata and outcome codes only. The UI never renders action inputs
or content because none are stored.

## 9. Retention

V1 keeps the last **90 days** of audit rows. Older rows are purged by a pg-boss maintenance job.

- Add a `SECURITY DEFINER` purge function in the same migration, mirroring `0098`:

```sql
CREATE OR REPLACE FUNCTION app.purge_jarvis_action_audit_log(older_than timestamptz)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app, public
AS $$
DECLARE affected integer;
BEGIN
  DELETE FROM app.jarvis_action_audit_log WHERE occurred_at < older_than;
  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END;
$$;

REVOKE ALL ON FUNCTION app.purge_jarvis_action_audit_log(timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.purge_jarvis_action_audit_log(timestamptz) TO jarvis_app_runtime;
```

- A dedicated `jarvis_migration_owner` maintenance policy (as in `0098`) is **not** required because
  the function is `SECURITY DEFINER` and the function owner already bypasses the table's RLS for the
  `DELETE`. (If the chosen function owner is subject to FORCE RLS, add a maintenance `DELETE` policy
  for that role, matching the `0098` pattern.)
- A pg-boss maintenance job (registered alongside the existing AI stale-action maintenance schedule)
  calls the function daily with `older_than = now() - interval '90 days'`. The job payload is
  metadata-only (a cutoff timestamp / no payload) and the job logs the affected row count only.
- Account-deletion cascade (`ON DELETE CASCADE` to `app.users`) removes all of a user's audit rows
  immediately on account deletion, independent of retention.

## 10. Privacy & Safety

Audit entries are metadata-only by construction. A log entry **NEVER** contains:

- source content (task bodies, calendar/email subjects or bodies, note/vault text);
- AI prompts or model output;
- secrets, tokens, password hashes, or connector credentials/payloads;
- memory content or chat message text;
- action inputs or `input_summary` (those live, bounded, only in
  `app.ai_assistant_action_requests`; the audit table does not duplicate them).

Only ids, tool/family names, coarse enums (approval mode, outcome, surface), a bounded error class,
and timestamps are stored.

Invariants honored:

- **No admin private-data bypass.** FORCE RLS, owner-only; no admin cross-user audit view (§13 Out of
  Scope).
- **Private by default.** Audit rows are owner-only with no share path.
- **DataContextDb only.** All reads/writes go through the actor's `DataContextDb`; the purge is a
  privileged maintenance function, not a runtime cross-user query.
- **AccessContext unchanged** — `{ actorUserId, requestId }` only.
- **Secrets never escape** — nothing sensitive is stored, so export/logs/job payloads stay clean.
- **Metadata-only job payloads** — the retention job carries only a cutoff timestamp.
- **Module isolation** — only the AI module's gateway writes the table; other modules never read or
  write it directly.

## 11. Data Export & Deletion

Because this is a sensitive-tier change touching user data lifecycle:

- **Export:** add `jarvisActionAuditLog` to `packages/settings/src/data-export.ts` — a new
  per-table query (metadata columns from §5) plus a registry entry in `readExportTables`. The user's
  export then includes their automation audit history. (Contrast the #534 audit gap analogy: the
  v0.1.0 audit flagged "export omits wellness while delete purges it" — do not repeat that
  asymmetry. Export *and* delete must both cover the audit log.)
- **Deletion:** the `ON DELETE CASCADE` foreign key to `app.users(id)` ensures
  `scripts/delete-user-data.js` removes audit rows when the account is deleted. Add an assertion to
  the deletion test that no `jarvis_action_audit_log` rows survive a user delete.
- The exported audit rows remain metadata-only — exporting the audit log cannot leak content because
  none is stored.

## 12. Error Handling

- Audit insert fails: log metadata-only, swallow; never change the action result.
- Unknown/absent `source_surface`: store `unknown` (or default `chat` from chat context).
- Handler throw: `outcome: failed`, `error_class` from a bounded category map; never the message.
- Confirm timeout: `approval_mode: timeout`, `outcome: denied`, no handler ran.
- Read tool reaching `runHandler`: no audit row (read tools are out of scope for the action log).
- Write tool with no `actionFamilyId`: row written with `action_family_id` NULL (still audited).
- Retention job failure: logged metadata-only; next daily run retries. A missed purge cannot corrupt
  data (rows are simply older than 90 days until the next successful run).
- Export query failure for the audit table follows the existing export error posture (the export job
  surfaces a failure; it does not silently drop the table).

## 13. Out Of Scope

- Real-time streaming / live audit feed (the read API is pull-only).
- Webhook, push, email, or any external export-of-audit product surface.
- Admin or cross-user audit view (FORCE RLS, owner-only — permanently).
- Auditing read tools (governed by source permission, not the action model).
- Storing action inputs, summaries, prompts, or content in the audit log.
- Per-row user delete/edit, redaction UI, or "undo from audit".
- Configurable retention window in V1 (fixed 90 days).
- Pagination / infinite scroll (90-day window + capped query is sufficient).
- Writing audit rows from any path other than the #534 action execution gateway.
- Changing `AccessContext`/`ToolContext` shape.

## 14. Acceptance Criteria

- [ ] Every gateway-executed `write`/`destructive` action — auto-run *and* confirmed — produces
      exactly one audit row at its terminal outcome.
- [ ] Rejected, cancelled, and timed-out proposed actions are logged with the correct
      `approval_mode` and `denied`/`cancelled` outcome, with no handler run.
- [ ] Read tools never produce audit rows.
- [ ] Audit rows are metadata-only: no content, prompts, secrets, connector payloads, or action
      inputs are ever stored.
- [ ] `app.jarvis_action_audit_log` is owner-only under FORCE RLS; user A cannot read user B's audit
      rows through any runtime role.
- [ ] The table is insert-only for `jarvis_app_runtime` (no runtime UPDATE/DELETE grant).
- [ ] The action execution gateway is the only code path that writes audit rows.
- [ ] Audit-write failure never changes the user-visible action result.
- [ ] A read-only Activity list in Settings shows the owner's actions chronologically with approval
      mode and outcome, filterable by date and action family, last 90 days, no pagination.
- [ ] The canonical `GET /api/ai/action-audit` route is owner-scoped and metadata-only.
- [ ] Retention purges rows older than 90 days via a pg-boss maintenance job calling a privileged
      purge function; the job payload is metadata-only.
- [ ] The user data export includes the audit log (metadata-only).
- [ ] Account deletion removes all of a user's audit rows (cascade verified by test).
- [ ] No path changes `AccessContext`/`ToolContext` shape or grants `BYPASSRLS`.
- [ ] `foundation.test.ts` migration list includes `XXXX_jarvis_action_audit_log.sql`.

## 15. Verification

Local gate:

```bash
pnpm lint
pnpm format:check
pnpm typecheck
pnpm test:ai
pnpm test:settings
pnpm test:api
pnpm test:web
pnpm test:integration
```

Targeted tests:

- `trusted_auto` write that succeeds writes one row: `approval_mode=auto`, `outcome=success`;
- `trusted_auto` write whose handler throws writes `approval_mode=auto`, `outcome=failed`,
  bounded `error_class`, no leaked message;
- confirmed write writes `approval_mode=confirmed`, `outcome=success`;
- denied proposal writes `approval_mode=rejected`, `outcome=denied`, no handler run;
- cancelled proposal writes `approval_mode=cancelled`, `outcome=cancelled`;
- confirm-timeout writes `approval_mode=timeout`, `outcome=denied`;
- read tool produces no audit row;
- destructive tool (e.g. `tasks.deleteList`) confirmed-and-run writes `action_kind=destructive`;
- audit insert failure does not change the action result (fault-injection);
- audit row contains no `input_summary`/content columns (schema + value assertions);
- RLS isolation: user A cannot select user B's audit rows; insert with mismatched
  `owner_user_id` is rejected by the WITH CHECK policy;
- runtime role has no UPDATE/DELETE grant on the table;
- `GET /api/ai/action-audit` returns only the owner's rows, honors `since`/`family`/`limit`,
  clamps `since` to the 90-day floor;
- retention function deletes rows older than 90 days and returns the affected count; rows within 90
  days survive;
- account deletion cascade removes all of the user's audit rows;
- user data export includes the audit log table with metadata-only columns;
- `foundation.test.ts` full migration list assertion includes the new migration.
```
