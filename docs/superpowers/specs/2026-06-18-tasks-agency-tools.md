# Tasks Agency Tools

**Status:** Approved
**Date:** 2026-06-18
**Owner:** Ben
**GitHub:** #34

## Goal

Jarvis should be genuinely useful for task work. It should be able to create tasks, edit them,
organize them, break them down, mark them done, add notes/activity, and clean up lists/tags without
asking for approval on every ordinary edit.

Explicit permission is reserved for destructive delete-like operations.

## Current State

The original #34 coordination concern is mostly shipped:

- The assistant-tool/MCP gateway exists.
- Tasks exposes module-owned read tools.
- `tasks.updateStatus` exists as a confirmation-gated write tool.
- The Tasks REST/domain surface already supports create, update, status/archive, activity, list/tag
  management, tag assignment, and breakdown.

The missing piece is a deliberate agency policy and assistant-tool surface for normal task writes.

## Product Policy

Normal task agency should not require an Approve/Deny prompt.

Jarvis may perform these operations directly when acting through the governed assistant-tool gateway:

- Create tasks.
- Edit task fields: title, description, priority, due date, do date, effort, list, source fields where
  applicable, and status.
- Complete, reopen, or archive tasks.
- Break a task into subtasks.
- Add activity/comments.
- Create and rename task lists.
- Create and rename tags.
- Assign and unassign tags.

Jarvis must ask for explicit permission for destructive delete-like operations:

- Delete a task.
- Delete a task list.
- Delete a tag.
- Any future operation that permanently removes user-authored task data.

Archive is normal agency, not destructive, because it is reversible and preserves data.

## Architecture

Do not build a task-specific bypass around the gateway.

Extend the assistant-tool policy model so a module can declare non-destructive writes that run
directly, while destructive operations continue to require confirmation.

The preferred model is:

- Tool `risk` remains the coarse manifest shape: `read`, `write`, `destructive`.
- Add an explicit execution policy/default that lets a module or tool declare whether a non-destructive
  `write` is `auto` or `confirm`.
- Gateway behavior becomes:
  - `read` -> run.
  - `write` + `auto` -> run.
  - `write` + `confirm` -> action request.
  - `destructive` -> action request, always.

The implementation may name this field differently, but the product semantics must be explicit in
the manifest/policy layer, not hidden in ad hoc task code.

Existing confirmed-write behavior must remain available for modules that still want confirmation for
non-destructive writes.

## V1 Tool Set

Add or complete these non-destructive task tools:

- `tasks.create`
- `tasks.update`
- `tasks.updateStatus`
- `tasks.breakDown`
- `tasks.addActivity`
- `tasks.assignTag`
- `tasks.unassignTag`
- `tasks.createList`
- `tasks.renameList`
- `tasks.createTag`
- `tasks.renameTag`

Add destructive tools only if the implementation slice has room; otherwise leave them as an explicit
follow-up. If added, they must be confirmation-gated:

- `tasks.delete`
- `tasks.deleteList`
- `tasks.deleteTag`

## User Visibility

No approval prompt does not mean invisible.

Every task mutation tool should return a concise, user-facing result that can be shown in chat:

- Created task: `<title>`.
- Updated task: `<title>`.
- Completed task: `<title>`.
- Archived task: `<title>`.
- Added `<n>` subtasks.
- Added note/activity to `<title>`.
- Assigned/removed tag `<tag>`.

Where the task domain already records activity, use that as the durable task history. Do not write
normal task agency actions to `admin_audit_events` in V1.

## Safety And Limits

- All tools execute under `DataContextRunner.withDataContext` and current actor RLS.
- No tool accepts `ownerUserId`; ownership comes from context.
- Shared/contributed task behavior must follow existing Tasks repository permissions.
- Inputs are schema-validated through the gateway.
- Outputs are schema-projected and capped by the gateway.
- Destructive tools must never run without the confirmation bridge.
- Delete/list/tag destructive summaries must clearly name what will be removed and whether dependent
  tasks/tags are reassigned or affected.

## Integration Points

- `packages/module-sdk`: add the policy field/type if needed.
- `packages/ai/src/gateway`: update risk/policy resolution so auto non-destructive writes can run.
- `packages/tasks/src/tools.ts`: implement task agency executors.
- `packages/tasks/src/manifest.ts`: declare task agency tools, schemas, output schemas, and execution
  policy.
- `packages/shared/src/tasks-api.ts`: reuse existing DTO schemas where possible.
- `packages/chat` and MCP transport should not special-case tasks; they receive ordinary tool output
  and action requests.

## Testing

Add focused tests for:

- A non-destructive task write tool runs through the gateway without emitting an `action_request`.
- A destructive task tool emits an `action_request` and does not execute until approved.
- `tasks.create` creates an owner-scoped task under the active actor.
- `tasks.update` cannot mutate another actor's private task.
- `tasks.updateStatus` remains available and follows the new normal-agency policy.
- Archive is treated as normal agency.
- Delete remains destructive.
- Tool summaries/results are safe and useful.
- Existing REST task tests stay green.

## Acceptance Criteria

- Jarvis can create, edit, complete, archive, organize, break down, and annotate tasks through MCP.
- Normal task writes do not require an Approve/Deny prompt.
- Delete-like task operations require explicit confirmation.
- Task mutations remain RLS-scoped and module-owned.
- User-visible chat/tool output clearly states what changed.
- `pnpm verify:foundation` passes.

## Follow-Ups

- Undo affordances for recent task agency actions.
- Per-user autonomy settings for task agency.
- Destructive task/list/tag tools if not included in the first implementation slice.
- Richer bulk operations once single-item agency is proven.
