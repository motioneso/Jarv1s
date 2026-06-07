# Plan 0002: Tasks Module MVP

Status: Ready
Date: 2026-06-06

## Purpose

Build the first real product vertical slice on top of the foundation scaffold: a minimal Tasks module that proves Jarv1s can support a module-owned data model, API routes, RLS-protected repositories, and worker jobs without weakening the security substrate.

This is M1. The existing foundation scaffold is M0. Do not expand this into the full product MVP.

## Inputs

Read these before implementation:

- `docs/HANDOFF.md`
- `docs/archive/HANDOFF_TASKS_M1.md`
- `docs/architecture/decisions/0001-foundation.md`
- `docs/architecture/decisions/0002-maintenance-system-posture.md`
- `docs/architecture/plans/0001-mvp-foundation-scaffold.md`

Reference proof code and tests:

- `packages/db/`
- `packages/jobs/`
- `tests/integration/foundation.test.ts`
- `spikes/auth-rls-safety/`
- `spikes/pg-boss-rls/`

## Scope

Build the smallest useful Tasks module:

- minimal module manifest/type support for built-in modules
- Tasks module package with manifest, SQL migrations, repository, API route registration, and job registration
- task tables with RLS for private, workspace-visible, and explicitly granted access
- Fastify routes for list, create, get, and update
- request-to-`AccessContext` API helper using the existing session table
- one metadata-only worker job that touches task data through `withDataContext()`
- integration tests proving task privacy, sharing, API context, and worker posture

## Non-Scope

Do not build yet:

- full frontend UI
- full module marketplace
- hot module loading
- arbitrary third-party module execution
- real OAuth providers
- email/calendar/notes/chat/briefings/notifications modules
- recurring tasks
- task dependencies
- complex project management views
- workflow engine
- AI task agents
- real push reminders
- final API contract layer unless the Tasks API proves a clear need

## Foundation Fixes First

Before adding Tasks, make these small foundation fixes:

- move the migration advisory lock so `runSqlMigrations()` locks before reading `app.schema_migrations`
- add `pnpm verify:foundation` for `pnpm typecheck`, `pnpm db:migrate`, and `pnpm test:integration`
- document API port override and Docker subnet override or make them configurable
- keep `pnpm test:spike` passing

## Suggested Package Shape

Use this structure unless a simpler local pattern emerges:

```txt
packages/module-sdk/
packages/module-registry/
packages/tasks/
packages/tasks/src/manifest.ts
packages/tasks/src/repository.ts
packages/tasks/src/routes.ts
packages/tasks/src/jobs.ts
packages/tasks/sql/
```

`packages/module-sdk` should stay tiny. It only needs types for built-in module manifests and registration contracts.

`packages/module-registry` should load built-in module manifests at startup. It should not support marketplace install, dynamic code loading, permission review UI, or hot reload.

If module-owned migrations are too much for this slice, keep the root migration runner simple but make the Tasks SQL location and manifest relationship explicit. Do not hide Tasks tables inside anonymous root migrations without a path to module-owned migrations.

## Minimal Task Model

Use a conservative v1 task shape:

```txt
app.tasks
  id uuid primary key
  owner_user_id uuid not null references app.users(id)
  workspace_id uuid null
  visibility task_visibility not null default 'private'
  title text not null
  description text null
  status task_status not null default 'todo'
  priority smallint null
  due_at timestamptz null
  completed_at timestamptz null
  created_at timestamptz not null default now()
  updated_at timestamptz not null default now()

app.task_activity
  id uuid primary key
  task_id uuid not null references app.tasks(id) on delete cascade
  actor_user_id uuid not null references app.users(id)
  activity_type text not null
  body text null
  created_at timestamptz not null default now()
```

Suggested enums:

```txt
task_visibility: private, workspace
task_status: todo, in_progress, done, archived
```

Keep assignment, watchers, labels, source links, task templates, mentions, and agent runs out of M1 unless the implementation naturally needs a small placeholder.

## RLS Rules

Tasks must use `FORCE ROW LEVEL SECURITY`.

Read access is allowed only when:

- actor owns the task
- actor has an explicit `resource_grants` row for `resource_type = 'task'`
- task is workspace-visible, the active context workspace matches the task workspace, and actor is a workspace member

Insert is allowed only when:

- `owner_user_id = app.current_actor_user_id()`
- private tasks have no workspace requirement
- workspace-visible tasks require active workspace context and workspace membership

Update is allowed only when:

- actor owns the task, or
- actor has an explicit `manage` grant, or
- actor is a member of the active workspace and the task is workspace-visible

Delete can be deferred. Prefer `status = 'archived'` for M1.

Task activity must not leak cross-task access. Activity reads should be governed by task visibility. Activity writes should require access to the parent task and should set `actor_user_id` from the active context, not client input.

## API Scope

Use plain Fastify routes for now.

Suggested routes:

```txt
GET    /api/tasks
POST   /api/tasks
GET    /api/tasks/:id
PATCH  /api/tasks/:id
POST   /api/tasks/:id/activity
POST   /api/tasks/:id/deferred-status
```

`POST /api/tasks/:id/deferred-status` can enqueue the M1 worker job. If it feels artificial during implementation, replace it with a small real job that still uses only metadata payloads and proves worker RLS posture.

Authentication for M1 can use the existing `app.auth_sessions` table:

```txt
Authorization: Bearer <session-id>
  -> AuthSessionResolver
  -> AccessContext
  -> DataContextRunner.withDataContext()
  -> TasksRepository
```

Do not implement final Better Auth integration in this slice unless it becomes the smallest safe way to create `AccessContext`.

## Worker Job

Add one Tasks-owned job registered through the module boundary.

Payload may contain:

- actor user id
- workspace id
- task id
- requested status or small command metadata
- idempotency key

Payload must not contain:

- task title
- task description
- activity body
- secrets
- prompts
- connector payloads
- model-visible private content

The worker handler must enter `withDataContext()` before repository access. Tests must prove User A's job cannot read or update User B's private task.

## Integration Acceptance Criteria

Add integration tests proving:

- Tasks migrations apply from an empty database
- module registry loads the Tasks manifest
- missing context denies task reads
- user can create and read their own private task
- user cannot read another user's unshared private task
- instance admin cannot read another user's private task by admin role alone
- explicit grant allows task access
- workspace membership allows workspace-visible task access only in active workspace context
- task activity does not leak parent task content
- API routes derive actor context from session and do not accept `owner_user_id` from the client
- API routes do not expose another user's private task
- worker job payload is metadata-only
- worker job with User A context cannot read or update User B private task
- repository calls outside `withDataContext()` fail loudly or are structurally impossible
- foundation tests and spike tests still pass

## Expected Commands

Keep these working:

```txt
pnpm verify:foundation
pnpm test:integration
pnpm test:spike
```

Add one focused command if useful:

```txt
pnpm test:tasks
```

## Completion Criteria

M1 Tasks is complete when:

- Tasks is represented as a built-in module manifest
- Tasks SQL is applied by the migration flow
- API can list, create, fetch, and update tasks through session-derived context
- task data is private by default and protected by RLS
- explicit grants and workspace visibility work
- one Tasks worker job runs through `withDataContext()`
- integration tests cover the acceptance criteria
- no full UI, connector, AI, workflow, or marketplace work was introduced

## Deferred Decisions

Keep these deferred unless the Tasks slice forces a decision:

- final API contract tooling
- Better Auth provider configuration
- final module SDK shape
- module marketplace install/review flow
- task recurrence model
- notification/reminder delivery
- AI task assistant behavior
