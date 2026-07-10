# Workflow layer on pg-boss

**Status:** Approved — RFA  
**Date:** 2026-07-08  
**Owner:** Ben  
**GitHub:** #819  
**Grounded on:** `origin/main` @ `5f7784a7d687`, `packages/jobs/src/pg-boss.ts`,
`apps/worker/src/worker.ts`, `packages/ai/src/repository.ts`, and existing agency action-loop /
safe automation specs.

---

## Goal

Add a small workflow substrate on top of pg-boss: code-authored workflow definitions, durable run and
step state, one pg-boss job per step, typed edges, per-step retry policy, suspend/approval steps,
and crash recovery from persisted state.

V1 is a developer substrate. No visual builder, no AI workflow builder, no long-horizon
goal-pursuit engine, no sandboxed arbitrary user-authored workflows. Those are follow-ons parked in
#827 or later specs.

## Current state

Jarv1s already has the pieces this should reuse:

- `packages/jobs/src/pg-boss.ts` owns pg-boss client creation, queue migration, the
  `sendJob()` wrapper, and `assertMetadataOnlyPayload()`.
- pg-boss payloads are metadata-only by hard invariant. The current allowlist includes ids like
  `actorUserId`, `resourceId`, `jobId`, `idempotencyKey`, and source refs.
- `registerDataContextWorker()` turns an actor-scoped job into a `DataContextDb` under RLS.
- `apps/worker/src/worker.ts` is the only schedule/supervise owner.
- `app.ai_assistant_action_requests` and the chat action card prove the approval UI pattern, but the
  table is tool-specific and should not be overloaded for workflow continuations.

## Decisions

- **Developer-authored definitions first.** Workflow definitions are TypeScript/module code, not
  editable JSON rows. DB stores runs, step state, approval state, and artifact refs.
- **One pg-boss job per step.** Step jobs carry only metadata:
  `{ actorUserId, workflowRunId, stepRunId }`.
- **Typed edges only.** V1 edges are `always`, `onSuccess`, `onFailure`, and simple result matches.
  No arbitrary branching JavaScript in the graph.
- **Workflow-specific approvals.** Suspend/approval steps use workflow tables, not
  `app.ai_assistant_action_requests`. The frontend may reuse the existing action-card presentation
  pattern.
- **Artifacts by reference.** Step outputs in DB are bounded JSON metadata. Larger/private artifacts
  are written through `VaultContext`; step output stores `{ artifactRef, sha256, contentType }`.

## Workflow Definition API

Add a workflow contribution point to `@jarv1s/module-sdk`:

```ts
export interface ModuleWorkflowDefinition {
  readonly id: string; // module-id-prefixed
  readonly displayName: string;
  readonly version: number;
  readonly startStepId: string;
  readonly trigger: "manual" | "module";
  readonly steps: readonly WorkflowStepDefinition[];
  readonly edges: readonly WorkflowEdgeDefinition[];
}

export interface WorkflowStepDefinition {
  readonly id: string;
  readonly kind: "task" | "approval";
  readonly retry?: WorkflowStepRetryPolicy;
  readonly timeoutMs?: number;
  readonly handler?: WorkflowStepHandler; // required for kind=task
  readonly approval?: WorkflowApprovalSpec; // required for kind=approval
}

export type WorkflowEdgeCondition =
  | { readonly type: "always" }
  | { readonly type: "onSuccess" }
  | { readonly type: "onFailure" }
  | {
      readonly type: "resultEquals";
      readonly field: string; // shallow key in bounded step result metadata
      readonly equals: string | number | boolean | null;
    };

export interface WorkflowStepRetryPolicy {
  readonly maxAttempts: number; // >= 1, capped by validation
  readonly backoffMs?: number;
  readonly backoff?: "fixed" | "exponential";
}
```

Module manifests gain `workflows?: readonly ModuleWorkflowDefinition[]`. Definitions are loaded at
boot from registered modules and validated before worker registration:

- `workflows?` is added to `JarvisModuleManifest` in `packages/module-sdk/src/index.ts`;
- workflow ids must be globally unique and module-id-prefixed;
- workflow versions are positive integers;
- step ids are unique within a workflow;
- `startStepId` references an existing step;
- edges reference existing steps;
- graph must have no unreachable steps from `startStepId`;
- cycles are rejected in v1;
- retry policies must have `maxAttempts >= 1` and a bounded implementation cap;
- every non-terminal task step has at least one outgoing edge;
- no definition can register a queue name directly.

Validation runs once at module-registry construction time, before route/worker registration. The
registry exposes the validated workflow registry to API and worker composition. If any built-in
workflow definition fails validation, API and worker boot fail fast with a structured error naming
`moduleId`, `workflowId`, and the failed rule. Invalid definitions must never silently disappear from
the registry.

V1 starts runs through module/server code, not a general user-facing builder. A module may expose a
route/tool that starts one of its workflows after normal permission checks.

Step handler context is explicit:

```ts
export interface WorkflowStepContext {
  readonly actorUserId: string;
  readonly requestId: string;
  readonly workflowRunId: string;
  readonly stepRunId: string;
  readonly runInput: Record<string, unknown>;
  readonly stepInput: Record<string, unknown>;
  getStepResult(stepId: string): Promise<Record<string, unknown> | null>;
  readonly artifacts: WorkflowArtifactPort;
}
```

V1 has no generic edge input-mapping language. The module/server code that starts a run supplies
bounded `runInput` and initial `stepInput`; handlers can read bounded predecessor `result_json` by
step id through `getStepResult()`. Large/private values move through artifact refs.

## Execution Model

Add one workflow step queue, e.g. `workflow.step.execute`, and one dead-letter queue, e.g.
`workflow.step.deadletter`, declared on the new workflows module manifest's `queueDefinitions`. The
step queue sets pg-boss `deadLetter: "workflow.step.deadletter"` so exhausted transport retries keep
the original metadata-only payload. Both queues are aggregated through `BUILT_IN_MODULES` ->
`getAllQueueDefinitions()` like every other module-owned queue. `@jarv1s/jobs` continues to own the
shared pg-boss primitives; it does not own the workflow queues.

Step job payload:

```ts
interface WorkflowStepJobPayload extends ActorScopedJobPayload {
  readonly workflowRunId: string;
  readonly stepRunId: string;
}
```

Add `workflowRunId` and `stepRunId` to `ALLOWED_PAYLOAD_KEYS`. No step inputs, prompts, source
content, secrets, or artifact bodies may enter pg-boss payloads.

Worker behavior:

1. `registerDataContextWorker()` opens actor-scoped `DataContextDb`.
2. Worker loads the step run and parent workflow run under RLS.
3. If parent run is terminal or cancelled, no-op idempotently.
4. If `workflow_id` or `step_id` is missing from the validated registry at delivery time, mark the
   step failed with `error_code = 'definition_missing'` and fail the run. Do not throw to pg-boss.
5. If step is already terminal, do not re-execute the handler. Re-run edge resolution
   idempotently: create any missing successor step runs with `ON CONFLICT DO NOTHING`, enqueue any
   successor in `pending`/`queued` without a live `pgboss_job_id`, update run terminal status, and
   return.
6. If step is suspended with a still-pending approval, no-op idempotently.
7. Mark step `running`, execute handler, create approval, or finish a resolved approval step, then
   persist a bounded result.
8. Resolve typed outgoing edges and create/enqueue the next step runs.
9. Mark workflow run terminal when no runnable next step exists.

The enqueuer is idempotent:

- every workflow step job uses pg-boss `singletonKey = stepRunId`;
- the workflow repository records `pgboss_job_id` when enqueue succeeds, updates it on retry
  re-enqueue, and clears it when the step reaches terminal/suspended/cancelled state;
- same-step enqueue skips if a step run is terminal, suspended, or already has a live
  `pgboss_job_id`; approval resolution first transitions `suspended` -> `queued` and clears any old
  job id before enqueueing the continuation;
- `INSERT ... ON CONFLICT (workflow_run_id, step_id) DO NOTHING` prevents duplicate step runs when
  duplicate jobs or converging branches race.

Edge resolution runs in a transaction that locks the parent `workflow_runs` row (`FOR UPDATE`) before
creating next step runs. It re-reads `workflow_runs.status` under that lock and creates no successors
if the run is cancelled or terminal. V1 converging edges are first-trigger, not barrier joins:
handlers must tolerate `getStepResult()` returning `null` for other predecessor steps that have not
finished yet. Barrier joins are a follow-on.

The run transitions terminal only when no non-terminal step runs remain and edge resolution produced
no successors: `failed` if any step run ended `failed` without a taken `onFailure` edge, otherwise
`succeeded`.

### Retry, Failure, And Attempt State

Workflow failures are graph state, not raw pg-boss failure state. The step worker catches handler
errors, persists bounded error metadata, applies the workflow retry policy, and returns successfully
to pg-boss whenever it has committed workflow state. It throws only for infrastructure failures where
workflow state could not be safely loaded or persisted.

Rules:

- `attempt_count` increments inside the actor-scoped `DataContextDb` transaction before invoking a
  task handler.
- The same transaction records `status = 'running'`, `pgboss_job_id`, and `started_at`.
- Handler success records `status = 'succeeded'`, bounded `result_json`, and `completed_at`.
- Handler failure records `error_code` and either:
  - re-enqueues the same step with a fresh pg-boss job if the workflow retry policy still allows an
    attempt, using pg-boss `startAfter` for configured backoff; or
  - records `status = 'failed'`, `completed_at`, and resolves `onFailure` edges.
- `onFailure` edges fire only after the workflow retry policy is exhausted.
- terminal, suspended, and cancelled transitions clear `pgboss_job_id` so crash recovery never treats
  an old job id as a live queued job.
- pg-boss queue retry is transport retry only. The workflow queue uses a small retry limit for
  infrastructure failures and a dead-letter queue for exhausted transport retries. The dead-letter
  worker loads the original metadata-only payload, marks the step failed, and either resolves
  `onFailure` edges or fails the run.
- A step handler must be idempotent for a given `stepRunId`.

## Data Model

All SQL belongs to a new `workflows` module package (`packages/workflows/sql/`) unless build review
finds an existing owning module. Workflow tables are product data, not pg-boss internals, so they do
not belong in `infra/postgres/migrations/` or the `pgboss` schema.

Tables:

- `app.workflow_runs`
  - `id uuid primary key`
  - `owner_user_id uuid not null references app.users(id) on delete cascade`
  - `workflow_id text not null`
  - `workflow_version integer not null`
  - `module_id text not null`
  - `status text not null` (`pending|running|suspended|succeeded|failed|cancelled`)
  - `started_by text not null` (`user|module|system`)
  - `input_json jsonb not null default '{}'::jsonb`
  - `result_json jsonb not null default '{}'::jsonb`
  - `started_at timestamptz not null default now()`
  - `completed_at timestamptz null`
  - timestamps

- `app.workflow_step_runs`
  - `id uuid primary key`
  - `workflow_run_id uuid not null references app.workflow_runs(id) on delete cascade`
  - `owner_user_id uuid not null references app.users(id) on delete cascade`
  - `step_id text not null`
  - `status text not null` (`pending|queued|running|suspended|succeeded|failed|cancelled`)
  - `attempt_count integer not null default 0`
  - `input_json jsonb not null default '{}'::jsonb`
  - `result_json jsonb not null default '{}'::jsonb`
  - `error_code text null`
  - `pgboss_job_id text null`
  - `started_at timestamptz null`
  - `suspended_at timestamptz null`
  - `completed_at timestamptz null`
  - timestamps
  - unique constraint: `(workflow_run_id, step_id)`

- `app.workflow_approvals`
  - `id uuid primary key`
  - `workflow_run_id uuid not null references app.workflow_runs(id) on delete cascade`
  - `step_run_id uuid not null references app.workflow_step_runs(id) on delete cascade`
  - `owner_user_id uuid not null references app.users(id) on delete cascade`
  - `status text not null` (`pending|approved|denied|cancelled`)
  - `summary text not null`
  - `details_json jsonb not null default '{}'::jsonb`
  - `resolved_by_user_id uuid null references app.users(id) on delete set null`
  - timestamps

- `app.workflow_artifacts`
  - `id uuid primary key`
  - `workflow_run_id uuid not null references app.workflow_runs(id) on delete cascade`
  - `step_run_id uuid null references app.workflow_step_runs(id) on delete cascade`
  - `owner_user_id uuid not null references app.users(id) on delete cascade`
  - `artifact_ref text not null`
  - `sha256 text not null`
  - `content_type text not null`
  - `size_bytes bigint not null`
  - timestamps

RLS: all four tables are owner-only with `ENABLE ROW LEVEL SECURITY` and `FORCE ROW LEVEL SECURITY`.
Runtime app/worker roles operate only through actor-scoped `DataContextDb`.

Migration requirements:

- SQL lives in `packages/workflows/sql/`.
- Add DB types in `packages/db/src/types.ts`.
- Add every migration row to the full-list `foundation.test.ts` `toEqual`.
- Run full `test:integration`.

### Run Origins

`workflow_runs.started_by` has narrow meanings:

- `user`: an authenticated user-triggered route or assistant-approved tool started the run.
- `module`: module server code started the run on behalf of an owner after its own permission checks.
- `system`: future scheduled/system trigger; v1 may reserve the value but should not create
  system-started runs unless a concrete owner user is known.

Definition `trigger: "manual"` maps to `started_by = 'user'`; `trigger: "module"` maps to
`started_by = 'module'`.

Every run is still owner-scoped. There is always an `owner_user_id`, and worker jobs always carry
that owner as `actorUserId`. When useful for debugging, the starter may store bounded origin metadata
inside `input_json.__origin` (`requestId`, surface, source module id), never raw prompts, source
content, tokens, or secrets.

### Module Registration

The new `packages/workflows` package exports:

- `workflowsModuleManifest` with `id: "workflows"`;
- `workflowsModuleSqlMigrationDirectory`;
- `WORKFLOW_QUEUE_DEFINITIONS`, including `workflow.step.execute` and `workflow.step.deadletter`;
- `registerWorkflowWorkers()`, which registers the step worker and the dead-letter worker needed for
  transport failure exhaustion.

`workflowsModuleManifest` is added to `BUILT_IN_MODULES` in `packages/module-registry`. The worker
startup queue-existence guard then covers the workflow queues through the existing
`getAllQueueDefinitions()` path.

## Artifacts

Artifacts are stored through `VaultContext`, never raw `fs`.

Step handlers receive an artifact port:

```ts
interface WorkflowArtifactPort {
  write(input: {
    readonly workflowRunId: string;
    readonly stepRunId: string;
    readonly contentType: string;
    readonly bytes: Uint8Array;
  }): Promise<{ artifactRef: string; sha256: string; sizeBytes: number }>;
  read(artifactRef: string): Promise<{ bytes: Uint8Array; contentType: string }>;
}
```

Artifact refs are owner-scoped and dereferenced only under the actor's `DataContextDb`/VaultContext.
Step result JSON may include artifact metadata, never artifact bytes. API list/detail responses return
artifact metadata (`sha256`, `contentType`, `sizeBytes`) and stable artifact ids, not raw artifact
refs or bytes. Download/read routes re-check owner access and stream via VaultContext.

## Approval Steps

Approval steps create `app.workflow_approvals` rows and mark the step run `suspended`.

Approval UI may reuse the action-card component shape:

- summary;
- Approve / Deny;
- optional details;
- status/result display.

Resolving approval runs in one transaction. It CAS-updates `workflow_approvals` from `pending` to
`approved` or `denied` and records `resolved_by_user_id`; if no row changes, the API returns 409. The
same transaction writes a bounded result onto the step run (`{ status: "approved" }` or
`{ status: "denied" }`), transitions the step run from `suspended` to `queued`, clears any old
`pgboss_job_id`, and then enqueues the same step-run job to continue edge resolution. When the worker
receives that approval-kind step with a resolved approval, it marks the step `succeeded` with the
recorded result and routes via `resultEquals` edges.

Denied approval is a completed approval outcome, not an infrastructure failure. Workflows that need a
denial branch must add a `resultEquals` edge for `{ status: "denied" }`; otherwise no matching
successor means the run can complete with the denial result.

The continuation job carries `{ actorUserId: workflow_run.owner_user_id, workflowRunId, stepRunId }`.
It always uses the run owner as the RLS actor, never an arbitrary resolving user. V1 approvals are
owner-only; cross-user approval/delegation is a non-goal.

The approval table is workflow-specific because `app.ai_assistant_action_requests` is tied to
assistant tools (`tool_name`, `permission_id`, `risk`) and does not cleanly represent "continue
workflow run X from step Y".

## API Surface

V1 exposes minimal owner-scoped APIs:

- list workflow runs;
- get workflow run with step runs and approvals;
- cancel a run;
- resolve a workflow approval.

Cancel semantics:

- cancelling a run marks `workflow_runs.status = 'cancelled'`;
- all non-terminal step runs become `cancelled`;
- pending approvals become `cancelled`;
- orphaned pg-boss jobs for the run no-op when delivered because the worker checks parent run status
  before execution.

No generic "create workflow definition" API exists in v1. Starting runs is module/server-owned.

## Non-goals

- No visual builder in v1.
- No DB-stored editable JSON workflow definitions in v1.
- No AI workflow builder.
- No arbitrary user-authored code.
- No long-horizon goal-pursuit engine.
- No migration of existing briefings/proactive/email jobs in v1.
- No cross-user/shared workflows.
- No cross-user approval/delegation in v1.
- No barrier joins in v1; converging edges are first-trigger.
- No workflow definition version snapshots beyond `workflow_id` + `workflow_version`; changing a
  code-authored workflow while runs are in flight is an accepted v1 risk and should be avoided by
  module authors until definition snapshots are added.

## Verification

- Unit: definition validation rejects duplicate ids, missing steps, cycles, unreachable steps, and
  unsupported edge conditions.
- Unit: definition validation rejects retry policies outside the implementation cap.
- Unit: edge resolver is deterministic and only reads bounded result metadata.
- Integration: starting a run creates the first step run and one pg-boss job with metadata-only
  payload.
- Integration: one job per step; completing a step enqueues the correct next step.
- Integration: approval step suspends, resolving approval resumes via a metadata-only step job.
- Integration: approval continuation uses the workflow owner as `actorUserId`.
- Integration: failed step retries per workflow policy, records attempt state, and fires `onFailure`
  only after retries are exhausted.
- Integration: transport retry exhaustion sends the metadata-only job to `workflow.step.deadletter`,
  where the dead-letter worker marks step/run failed or resolves `onFailure`.
- Integration: worker restart/crash after a completed step does not rerun terminal step state and can
  enqueue next runnable step from DB state.
- Integration: duplicate enqueue attempts for the same `stepRunId` dedupe via singleton key and
  unique step-run constraint.
- Integration: cancelling a run cancels non-terminal children and orphan jobs no-op.
- Integration: artifact write stores bytes through VaultContext and persists only ref/hash metadata
  in workflow tables.
- Integration: artifact read/download goes through VaultContext only; raw `fs` access is rejected by
  lint or integration guard.
- Security: owner-only RLS prevents one user from seeing or resolving another user's runs/approvals.
- Queue/test trap: update queue-name `toEqual` snapshots, including
  `tests/integration/ai-tools.test.ts`, to include `workflow.step.execute` and
  `workflow.step.deadletter`.
- Gate: `pnpm verify:foundation` plus full `test:integration`.

## Approval state

Ben approved on 2026-07-08 after GLM 5.2 and Fable adversarial review fixes. Ready for build.
