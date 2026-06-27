# Long-running Jarvis goals across days or weeks (#535)

**Status:** RFA - AGY review passed
**Date:** 2026-06-27
**Owner:** Ben + Codex
**Issue:** #535
**Depends on:** #526 unified priority model, #527 usefulness feedback signals, #528 Jarvis memory
graph substrate, #532 confidence-aware memory records, #533 user-editable memory dashboard, #534
explicit action permission tiers, existing Tasks module.
**Related follow-ups:** #536 scheduled recurring briefings, #537 automatic commitment extraction,
#538 unified person/contact model, #539 source-backed answers/provenance, #540 safe automation audit
log.
**Grounded on:** `~/Jarv1s/docs/superpowers/specs/2026-06-27-unified-priority-model.md`,
`~/Jarv1s/docs/superpowers/specs/2026-06-27-usefulness-feedback-signals.md`,
`~/Jarv1s/docs/superpowers/specs/2026-06-26-jarvis-memory-graph-substrate.md`,
`~/Jarv1s/docs/superpowers/specs/2026-06-27-confidence-aware-memory-records.md`,
`~/Jarv1s/docs/superpowers/specs/2026-06-27-user-editable-memory-dashboard.md`,
`~/Jarv1s/docs/superpowers/specs/2026-06-27-explicit-action-permission-tiers.md`,
`~/Jarv1s/docs/superpowers/specs/2026-06-25-agency-action-loop.md`.

## 1. Problem

Jarvis can track concrete tasks and remember facts, but it does not yet have a durable model for
larger objectives that stretch across days or weeks.

Examples:

- "Get the house ready for inspection."
- "Improve sleep consistency this month."
- "Finish the Jarv1s dogfood capability spec pass."
- "Keep the onboarding launch moving without dropping follow-ups."

These are not single tasks. They gather tasks, notes, calendar events, emails, memory records,
blockers, and periodic check-ins. Without a goal model, Jarvis can forget what matters between
sessions, briefings have no stable objective context, and chat answers have to reconstruct the same
open loops repeatedly.

## 2. Decision

Add **long-running Jarvis goals V1**.

A goal is an owner-scoped, durable, reviewable objective. It stores the user's intended outcome and
current state, then links to the concrete records that carry the work.

V1 is intentionally small:

1. one owner-scoped goal table;
2. one owner-scoped evidence/link table;
3. read/write API and UI for review;
4. a read assistant tool so chat and briefings can see active goals;
5. write assistant tools only through #534 action permission tiers.

Goals organize work. They do not execute work. Tasks remain the action substrate.

## 3. Current Architecture Anchor

Relevant existing or already-specified pieces:

- Tasks own concrete action records: title, status, due/do dates, priority, tags, lists, comments,
  recurrence, and task write tools.
- #526 defines a shared priority scorer and priority anchors.
- #527 records usefulness feedback and dismissal signals.
- #528/#532 define graph memory, confidence, provenance, stale/superseded state, and recall
  phrasing.
- #533 gives the user one place to inspect and correct Jarvis memory.
- #534 defines explicit action tiers and says scheduled/proactive surfaces may suggest actions but
  must route execution through the gateway.

#535 should reuse those seams. It must not create a workflow engine, a second task system, or a
background action runner.

## 4. Goal Model

Goal fields:

```ts
type JarvisGoalStatus = "active" | "paused" | "blocked" | "completed" | "archived";

type JarvisGoalReviewCadence = "none" | "daily" | "weekly" | "biweekly" | "monthly" | "custom";

interface JarvisGoal {
  readonly id: string;
  readonly ownerUserId: string;
  readonly title: string;
  readonly desiredOutcome: string;
  readonly status: JarvisGoalStatus;
  readonly priority: 1 | 2 | 3 | 4 | 5;
  readonly reviewCadence: JarvisGoalReviewCadence;
  readonly nextReviewAt: string | null;
  readonly targetAt: string | null;
  readonly lastProgressSummary: string | null;
  readonly lastProgressAt: string | null;
  readonly blockerSummary: string | null;
  readonly nextSuggestedAction: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly completedAt: string | null;
  readonly archivedAt: string | null;
}
```

Rules:

- `title` is the short objective label.
- `desiredOutcome` is the user's definition of done, not a generated plan.
- `priority` is user-editable and maps to #526 priority language when goals are used as context.
- `reviewCadence` and `nextReviewAt` describe when Jarvis should revisit the goal in eligible
  surfaces. They do not create jobs in #535.
- `targetAt` is an optional target date, not a hard scheduler.
- `lastProgressSummary`, `blockerSummary`, and `nextSuggestedAction` are bounded summaries for
  review surfaces. They are not private-source dumps.
- `completed` means the user or an explicit user-approved action marked the objective done.
- `archived` hides the goal from active lists without deleting history.

## 5. Goal Evidence And Links

Add one evidence/link table for material that explains goal state.

```ts
type JarvisGoalEvidenceKind =
  | "context"
  | "task"
  | "status"
  | "progress"
  | "blocker"
  | "decision"
  | "checkpoint"
  | "suggested_action";

type JarvisGoalSourceKind =
  | "goal"
  | "task"
  | "note"
  | "email"
  | "calendar"
  | "chat"
  | "memory"
  | "manual";

interface JarvisGoalEvidence {
  readonly id: string;
  readonly ownerUserId: string;
  readonly goalId: string;
  readonly evidenceKind: JarvisGoalEvidenceKind;
  readonly sourceKind: JarvisGoalSourceKind;
  readonly sourceRef: string | null;
  readonly sourceLabel: string;
  readonly summary: string;
  readonly occurredAt: string | null;
  readonly createdAt: string;
}
```

Rules:

- Evidence rows are owner-scoped and belong to exactly one goal.
- `sourceRef` may hold a source-local id or stable target ref, but never raw source content.
- `summary` is bounded text suitable for UI review. It may mention private owner data, but it must
  not contain full email bodies, full note contents, prompts, secrets, tokens, connector credentials,
  or hidden connector metadata.
- A linked task uses `evidenceKind = "task"` and `sourceKind = "task"`.
- A manual progress note uses `evidenceKind = "progress"` and `sourceKind = "manual"`.
- A suggested next action uses `evidenceKind = "suggested_action"` and remains a suggestion until
  the user chooses to act through #534.
- Goal status changes and user-authored changes to progress, blockers, or next suggested action
  append a bounded evidence row with `sourceKind = "goal"` so the goal remains reviewable without a
  separate history table.
- Status changes use `evidenceKind = "status"`.
- `sourceKind = "goal"` is reserved for server-generated audit evidence. Client-submitted evidence
  requests must reject `sourceKind = "goal"`.
- The backend compares incoming values against the stored row and appends evidence only when a
  value actually changes. Full-resource `PATCH` payloads with unchanged progress, blocker, or
  suggested-action fields must not create duplicate evidence rows.
- Non-manual source links are server-created or server-verified. The Goals service may not trust a
  client-supplied `sourceRef` for `task`, `note`, `email`, `calendar`, `chat`, or `memory` evidence
  until the owning source verifies the target belongs to the actor.

V1 does not need a separate history table. Evidence rows are the review trail.

## 6. Storage

Add `app.jarvis_goals`.

Fields:

- `id uuid primary key`
- `owner_user_id uuid not null references app.users(id) on delete cascade`
- `title text not null`
- `desired_outcome text not null`
- `status text not null default 'active'`
- `priority integer not null default 3`
- `review_cadence text not null default 'weekly'`
- `next_review_at timestamptz null`
- `target_at timestamptz null`
- `last_progress_summary text null`
- `last_progress_at timestamptz null`
- `blocker_summary text null`
- `next_suggested_action text null`
- `memory_synced_at timestamptz null`
- `memory_synced_goal_updated_at timestamptz null`
- `memory_sync_error_class text null`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`
- `completed_at timestamptz null`
- `archived_at timestamptz null`

Add `app.jarvis_goal_evidence`.

Fields:

- `id uuid primary key`
- `owner_user_id uuid not null references app.users(id) on delete cascade`
- `goal_id uuid not null`
- `evidence_kind text not null`
- `source_kind text not null`
- `source_ref text null`
- `source_label text not null`
- `summary text not null`
- `occurred_at timestamptz null`
- `created_at timestamptz not null default now()`

Constraints:

- both tables use owner-only FORCE RLS;
- runtime app and worker roles do not bypass RLS;
- `jarvis_goals` has `UNIQUE (owner_user_id, id)` so evidence can use an owner-scoped composite
  foreign key;
- `jarvis_goal_evidence(owner_user_id, goal_id)` references
  `jarvis_goals(owner_user_id, id) ON DELETE CASCADE`;
- index `jarvis_goal_evidence(owner_user_id, goal_id)` for detail reads and cascade cleanup;
- `jarvis_app_runtime` gets `SELECT, INSERT, UPDATE, DELETE` on both goal tables;
- `jarvis_worker_runtime` gets `SELECT, UPDATE` on `app.jarvis_goals` and `SELECT` on
  `app.jarvis_goal_evidence`;
- `priority` is `1..5`;
- status/cadence/kind/source values are constrained by code and database checks;
- title max length: 160;
- desired outcome max length: 2,000;
- current summary fields max length: 1,000;
- evidence summary max length: 1,000;
- source label max length: 200;
- data export and account deletion include both tables.

## 7. Goal And Task Boundary

Tasks remain the concrete action substrate.

Rules:

- A goal may link zero or more tasks.
- A task may be linked to zero or more goals by evidence rows, but the Tasks module remains the
  owner of task data and task behavior.
- Creating a goal does not create tasks.
- Completing every linked task does not automatically complete the goal.
- Completing a goal does not automatically complete linked tasks.
- Recurring tasks stay in Tasks; recurring briefings/check-ins belong to #536.
- Commitment extraction into tasks or goal evidence belongs to #537.

Goal-driven next actions are suggestions:

- "Create a task to call Sarah" is a suggested action.
- If the user chooses it, Jarvis must route through the normal assistant tool/gateway path and #534
  decides whether it confirms or auto-runs.
- Goals cannot carry executable action payloads in jobs, evidence rows, or schedule records.

## 8. Priority Integration

Goals have explicit priority, but they do not replace #526.

V1 consumers may use active goals in two ways:

1. show and sort goal rows by `priority`, `targetAt`, and `nextReviewAt`;
2. pass active goal titles and bounded desired-outcome text as transient priority context when
   ranking already-loaded candidates for briefings or chat.

Rules:

- #535 does not mutate `priority.model.v1` automatically.
- A high-priority goal may raise related task/briefing/source candidates only after those candidates
  were already loaded by their owning consumer.
- Goal priority must not trigger cross-source reads by itself.
- A user can still create explicit #526 priority anchors. Goals are another context input, not a
  replacement for priority settings.

## 9. Memory Integration

Memory records are context and evidence, not the goal store.

Rules:

- The canonical goal state lives in `app.jarvis_goals`.
- A goal may create or link to a #528 memory entity of kind `goal` so recall can mention it.
- Memory entity/fact text must be derived from bounded goal fields and evidence summaries, never
  from raw source payloads.
- If memory and goal state disagree, the goal store wins for status, priority, cadence, blockers,
  and next suggested action.
- #532 confidence/status rules apply to memory records about goals. They do not change the canonical
  goal status.
- #533 can show linked memory records in the memory dashboard, but goal editing belongs to the
  Goals surface.

Memory sync must not run inside the goal write transaction. Goal routes commit the canonical goal
write first, then enqueue or publish a metadata-only sync request:

```ts
interface SyncGoalMemoryJobPayload {
  readonly actorUserId: string;
  readonly goalId: string;
  readonly goalUpdatedAt: string;
  readonly reason: "created" | "updated" | "completed" | "archived";
  readonly idempotencyKey: string;
}
```

The worker identifies derived memory through a reserved owner-scoped memory alias:

```text
jarvis_goal:<goalId>
```

It never looks up goal memory by title. The derived memory episode uses `source_kind = "goal"` and
`source_ref = <goalId>` so updates are idempotent even when the user renames the goal.

The job uses bounded pg-boss retries with exponential backoff and the idempotency key prevents
duplicate queue entries for the same goal update. The worker serializes sync per goal with a
per-goal advisory lock, reloads the current goal under `DataContextDb`, and syncs the current row
state. On success, it updates sync metadata only if the goal row's `updated_at` still matches the
loaded row version:

- `memory_synced_at = now()`;
- `memory_synced_goal_updated_at = <loaded updated_at>`;
- `memory_sync_error_class = null`.

If the goal changed while the worker was syncing, the worker leaves sync metadata stale and exits as
a successful no-op. The mutation route's already-queued job, or the reconciliation worker, handles
the newer row version.

Worker details:

- advisory locks use a stable 64-bit hash of `goalId` text, not the raw UUID;
- after reloading the goal, if `memory_synced_goal_updated_at >= updated_at`, the worker exits as a
  successful no-op;
- sync metadata updates must use an update path or conditional trigger that does not bump
  `updated_at` when only `memory_synced_at`, `memory_synced_goal_updated_at`, or
  `memory_sync_error_class` changes.

On final worker failure, it stores only an error class on the goal row. Goal mutation paths that
observe `memory_synced_goal_updated_at < updated_at` may enqueue another sync for that owner/goal,
rate-limited to avoid a retry loop. Read routes do not enqueue jobs. If enqueue/publish or worker
sync fails, the goal write remains successful and the failure logs metadata only.

Internal updates to `memory_synced_at` and `memory_sync_error_class` must not modify the goal's
user-visible `updated_at` timestamp, or drift detection will loop. If a sync job reloads the actor
or goal and it no longer exists, the worker completes successfully as a no-op instead of retrying.

To recover from enqueue/publish failures, the module registers an actor-scoped maintenance queue,
`goals-memory-sync-reconcile`. The job payload contains only `actorUserId`, `reason`, and an
idempotency key. It runs under that actor's `DataContextDb`, finds that owner's goals whose
`memory_synced_goal_updated_at` is null or older than `updated_at`, and enqueues bounded
`goals-memory-sync` jobs. Reconciliation is no more frequent than daily per owner and is created from
goal mutation/setup flows, not from read routes. Store the per-owner reconciliation timestamp as
metadata in `app.preferences` under `goals.memory_sync_reconcile.v1`.

Derived memory status mapping:

| Goal status | Memory fact status | Memory entity status | Recall behavior                                               |
| ----------- | ------------------ | -------------------- | ------------------------------------------------------------- |
| `active`    | `active`           | `active`             | eligible for normal goal recall                               |
| `blocked`   | `active`           | `active`             | eligible for normal goal recall, labeled blocked              |
| `paused`    | `stale`            | `active`             | excluded from normal recall unless stale/history is requested |
| `completed` | `expired`          | `archived`           | excluded from normal recall, available in history             |
| `archived`  | `expired`          | `archived`           | excluded from normal recall, available in history             |

For completed or archived goals, the worker sets memory `valid_to` to `completed_at`, `archived_at`,
or the sync time if no timestamp is available. For active, blocked, or paused goals, the worker
sets the derived memory fact/entity statuses from the table and clears `valid_to` on derived memory
records so a reactivated goal can be recalled again.

## 9.1 Package And Registry Wiring

Add a focused Goals module package, for example `packages/goals`.

It owns:

- SQL under `packages/goals/sql/`;
- the goal repository and source-link verifier registry;
- Fastify routes for `/api/goals`;
- assistant tool manifests for `goals.*`;
- the `goals-memory-sync` pg-boss worker for derived memory sync.
- the `goals-memory-sync-reconcile` actor-scoped maintenance worker.

Extend the jobs package metadata-only payload validator so `goalId`, `goalUpdatedAt`, and `reason`
are allowed payload keys. These keys carry identifiers and command metadata only, not private
content.

Register the module manifest, routes, SQL migrations, assistant tools, and worker in the same
central module-registry/composition paths used by existing modules. Do not wire goals by importing
source-module repositories directly.

## 10. API

Add goal-owned self routes:

- `GET /api/goals?status=active&limit=...&cursor=...`
- `POST /api/goals`
- `GET /api/goals/:id`
- `PATCH /api/goals/:id`
- `GET /api/goals/:id/evidence?limit=...&cursor=...`
- `POST /api/goals/:id/evidence`
- `DELETE /api/goals/:id/evidence/:evidenceId`
- `POST /api/goals/:id/archive`
- `POST /api/goals/:id/complete`

Create request:

```ts
interface CreateJarvisGoalRequest {
  readonly title: string;
  readonly desiredOutcome: string;
  readonly priority?: 1 | 2 | 3 | 4 | 5;
  readonly reviewCadence?: JarvisGoalReviewCadence;
  readonly nextReviewAt?: string | null;
  readonly targetAt?: string | null;
}
```

Patch request:

```ts
interface PatchJarvisGoalRequest {
  readonly title?: string;
  readonly desiredOutcome?: string;
  readonly status?: JarvisGoalStatus;
  readonly priority?: 1 | 2 | 3 | 4 | 5;
  readonly reviewCadence?: JarvisGoalReviewCadence;
  readonly nextReviewAt?: string | null;
  readonly targetAt?: string | null;
  readonly lastProgressSummary?: string | null;
  readonly lastProgressAt?: string | null;
  readonly blockerSummary?: string | null;
  readonly nextSuggestedAction?: string | null;
}
```

Evidence request:

```ts
interface CreateJarvisGoalEvidenceRequest {
  readonly evidenceKind: JarvisGoalEvidenceKind;
  readonly sourceKind: JarvisGoalSourceKind;
  readonly sourceRef?: string | null;
  readonly sourceLabel: string;
  readonly summary: string;
  readonly occurredAt?: string | null;
}
```

Rules:

- All routes use `DataContextDb` with `AccessContext.actorUserId`.
- No route accepts an owner id from the client.
- Unknown top-level keys are rejected.
- Date values must be ISO instants.
- `GET /api/goals` supports a single status or a comma-separated status list, such as
  `status=active,blocked`.
- `GET /api/goals/:id` returns bounded recent evidence only. Full history loads through the
  paginated evidence route.
- Client-submitted evidence may use `sourceKind = "manual"` or a verifier-backed source kind.
  `sourceKind = "goal"` is server-only.
- For `sourceKind` values other than `manual` or `goal`, the route calls a source-owned verifier
  before storing the link. The central Goals service does not query module-owned source tables
  directly.
- If a source verifier is available but the target is missing or not owned by the actor, return 404
  and do not store the link. If the actor lacks source/module permission, return 403.
- If `sourceKind` is not a recognized enum value, return 400. If the source kind is recognized but
  its verifier is temporarily unavailable, return 503.
- `DELETE /api/goals/:id/evidence/:evidenceId` removes only the link/evidence row, not the
  underlying source object.
- Archive and complete endpoints are convenience transition routes so the UI can confirm them; the
  same status transitions may also be handled by `PATCH` through one controller path.
- Deleting server-generated evidence where `sourceKind = "goal"` is rejected; goal audit evidence is
  kept as the review trail.
- Transitioning from a non-completed status to `completed` sets `completed_at = now()` and clears
  `archived_at`. Re-sending `completed` for an already completed goal does not change
  `completed_at`.
- Transitioning to `archived` sets `archived_at = now()` and leaves `completed_at` as-is.
- Setting status to `active`, `paused`, or `blocked` clears `completed_at` and `archived_at`.
- Hard delete of goals is out of scope in V1. Archive instead.

## 11. Assistant Tools

Add a small goal tool surface.

| Tool                   | Risk    | Policy                          |
| ---------------------- | ------- | ------------------------------- |
| `goals.listActive`     | `read`  | runs when module is available   |
| `goals.get`            | `read`  | runs when module is available   |
| `goals.create`         | `write` | governed by #534 `goal_changes` |
| `goals.update`         | `write` | governed by #534 `goal_changes` |
| `goals.addEvidence`    | `write` | governed by #534 `goal_changes` |
| `goals.removeEvidence` | `write` | governed by #534 `goal_changes` |
| `goals.complete`       | `write` | governed by #534 `goal_changes` |
| `goals.archive`        | `write` | governed by #534 `goal_changes` |

Action family:

```ts
assistant.action_policy.v1.goals.goal_changes;
```

Default tier: `ask_each_time`.

Rules:

- Read tools return bounded goal summaries and recent evidence only.
- Write tools never execute from a scheduled job without the gateway policy.
- No goal tool may create, update, complete, delete, send, or schedule source-owned records directly.
- If Jarvis wants to create a task, draft email, or calendar event from a goal, it must call the
  owning module's tool and #534 applies there too.
- Goal tools must not accept raw prompt text, source bodies, or action payloads from background jobs.

## 12. UI

Add a Goals surface in the existing app shell.

V1 layout:

- active goals list ordered by priority, blocked status, `nextReviewAt`, and target date;
- filters for active, blocked, paused, completed, and archived;
- detail drawer for desired outcome, priority, cadence, target/checkpoint dates, progress, blockers,
  next suggested action, linked tasks/source evidence, and history;
- edit controls for current goal fields;
- archive and complete actions with confirmation.

The Today page may show a compact active-goals section, capped to the highest-priority or blocked
items. It must not become another card feed.

Text and design rules:

- Use existing authored `jds-*` and local primitives.
- Do not use nested cards.
- Use compact rows, badges, menus, and icon buttons rather than explanatory feature text.
- Do not expose raw source ids or full source bodies in the UI.

## 13. Chat And Briefing Behavior

Chat:

- `goals.listActive` can provide active goal context when the user asks "where did we leave off?",
  "what should I focus on?", "what goals are blocked?", or names a goal.
- Chat answers may suggest next actions, but action execution routes through source tools and #534.
- Passive memory retrieval (#530) may recall goal-related memory, but canonical goal status comes
  from the goal read tool.

Briefings:

- #536 scheduled briefings may include goal check-ins when the schedule's source selection includes
  goals.
- A briefing may list progress, blockers, and suggested next actions.
- A briefing does not mark goals complete, update tasks, or send messages by itself.

Proactive monitoring:

- #531 proactive cards may deep-link to goals only if a source-owned monitor creates a high-signal
  card.
- Goals do not create proactive cards in #535.

## 14. Privacy, Safety, And Auditability

- Goals and evidence are owner-only with FORCE RLS.
- No admin private-data bypass.
- Runtime roles have no `BYPASSRLS`.
- Goal rows and evidence rows contain no secrets, connector credentials, auth tokens, prompts, full
  source bodies, or raw tool payloads.
- Job payloads, if any future job references a goal, carry metadata only: actor id, goal id,
  schedule id, reason, and idempotency key.
- Logs include metadata only: actor id, goal id, operation, status transition, source kind, duration,
  and error class. Never log goal summaries, evidence summaries, source text, prompts, secrets, or
  connector payloads.
- Source links do not grant source permissions. Opening a linked source still uses that source's
  normal route/tool authorization.
- User export/delete includes goals and goal evidence.

## 15. Error Handling

- Missing goal: 404.
- Goal not owned by actor: 404.
- Unknown status/cadence/kind/source: 400.
- Invalid priority: 400.
- Invalid date: 400.
- Source target missing or unavailable: keep the goal route functional and show the evidence row as
  an unavailable source link; do not delete it automatically.
- Source verifier unavailable for a new non-manual link: return 503 and do not store an unverified
  source reference.
- Linked task deleted or archived: keep the evidence row, but render it as historical/unavailable
  until a cleanup path is specified.
- Memory sync enqueue/publish failure: log metadata only and keep the already-committed goal write
  successful.
- Memory sync worker failure: log metadata only and leave canonical goal state unchanged.
- Assistant write tool policy lookup failure: confirm, per #534.

## 16. Out Of Scope

- A workflow engine.
- Automatic task creation, task completion, email sending, calendar writes, or source mutations.
- Recurring briefing schedule creation (#536).
- Automatic commitment extraction from chats, notes, or email (#537).
- Person/contact enrichment and aliases beyond existing memory aliases (#538).
- Source-backed answer citation UX (#539).
- Safe automation audit-log UI (#540).
- Data freshness labels (#541).
- Multi-user/shared goals.
- Hard delete of goal history.

## 17. Acceptance Criteria

- [ ] A user can create, view, edit, complete, and archive owner-scoped Jarvis goals.
- [ ] A goal tracks status, priority, cadence/checkpoint dates, recent progress, blockers, and next
      suggested action.
- [ ] A goal can link bounded evidence from tasks, notes, email, calendar, chat, memory, or manual
      entries without storing full source payloads.
- [ ] Tasks remain the concrete action records; goal state changes do not automatically mutate task
      state.
- [ ] Goal-driven action suggestions route through source-owned assistant tools and #534 action
      policy.
- [ ] Active goals can be read by chat and future briefings through bounded read tools.
- [ ] Goal writes use a `goals/goal_changes` action family with default `ask_each_time`.
- [ ] Memory records about goals are derived context/evidence only; `app.jarvis_goals` remains the
      canonical goal store.
- [ ] Source links do not bypass source permissions.
- [ ] Goal rows, evidence rows, API routes, and assistant tools are owner-scoped under RLS.
- [ ] User A cannot read, create, update, archive, complete, or link evidence to user B's goals.

## 18. Verification

Local gate:

```bash
pnpm lint
pnpm format:check
pnpm typecheck
pnpm test:api
pnpm test:tasks
pnpm test:memory
pnpm test:web
```

Targeted tests:

- create goal with default cadence and priority;
- patch status, priority, target date, blocker, progress, and next suggested action;
- invalid enum/date/priority requests return 400;
- archive and complete set their timestamps;
- evidence add/delete affects only goal evidence, not the source object;
- linked task deletion does not delete the goal;
- goal list excludes archived/completed goals by default;
- read tools cap active goals and recent evidence;
- write tools route through #534 policy;
- goal tool cannot mutate tasks, email, calendar, notes, or memory records directly;
- memory sync failure does not roll back the canonical goal write;
- RLS isolation for goals and goal evidence.

## 19. External Review

AGY reviewed this spec with `--model "Gemini 3.5 Pro"` on 2026-06-27. Blocker and medium findings
were addressed in this draft, including owner-scoped foreign keys, async memory sync isolation,
source-link verification, stable goal-to-memory correlation, sync race handling, payload-key
validation, role grants, evidence pagination, and status-transition edge cases. Final AGY passes
reported no remaining blocker/medium findings.
