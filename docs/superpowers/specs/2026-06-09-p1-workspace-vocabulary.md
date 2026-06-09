# Resolve the dangling "workspace" vocabulary — Design (P1 #59)

**Status:** Approved for build (2026-06-09)
**Date:** 2026-06-09 **Owner:** Ben **Issue:** #59 (Part of epic #46)

## Context

Slice 1f (migration `0028_workspace_teardown.sql`) tore down workspace-as-data-isolation: it dropped
every product table's `workspace_id`/`visibility` column, dropped the `app.is_workspace_member` /
`app.current_workspace_id` SQL functions, and removed `workspaceId` from `AccessContext` (now
`{ actorUserId, requestId }` only). The access substrate is now **owner-or-share** (`app.has_share`

- `app.shares`) for shareable modules, **owner-only** for credential modules, and **recipient-only**
  for notifications (see auto-memory `rls-shareability`). There is no workspace dimension the runtime
  can scope by.

But the **manifest vocabulary still advertises a `workspace` scope that the runtime cannot honor**:

- `ModuleScope = "user" | "workspace" | "admin" | "system"` in `packages/module-sdk/src/index.ts:2`
  (and a duplicated string-literal union + JSON-schema enum in `packages/shared/src/platform-api.ts:65,216`).
- **20+ manifest entries declare `scope: "workspace"`** across tasks, chat, email, calendar,
  notifications, briefings, connectors — with permission/tool descriptions that promise
  "workspace-visible tasks", "visible in the active joined workspace", "workspace membership", etc.
  (e.g. `tasks/src/manifest.ts:93,99`, `email/src/manifest.ts:42-43`, `briefings/src/manifest.ts:62`).

Nothing in the codebase **branches** on `scope === "workspace"`. The only `ModuleScope` consumers
are the three `readonly scope: ModuleScope` manifest fields themselves — it is **descriptive
metadata, not a control input**. So the vocabulary outruns the runtime: it is a half-existing concept.

**Separately — do NOT conflate:** the `app.workspaces` / `app.workspace_memberships` tables and the
`/api/admin/workspaces*` admin routes (`settings` module) **still exist and still work** as an admin
grouping/org concept. They were NOT torn down in 1f — only the _data-access-scoping_ role of
workspaces was. This spec does **not** touch those tables, routes, the settings admin Workspaces
panel, or `me.workspaces`. It only removes the dead **access-scope vocabulary** from module
manifests/permissions/tools.

## Goals

- No `workspace`-scoped vocabulary survives in module manifests where the runtime cannot honor it:
  remove `"workspace"` from `ModuleScope`, reclassify every `scope: "workspace"` manifest entry to
  its real runtime scope, and rewrite the "workspace-visible / joined workspace / workspace
  membership" prose to describe the actual owner-or-share model.
- The shareability vocabulary matches `AccessContext = { actorUserId, requestId }` exactly.
- `pnpm verify:foundation` + `pnpm audit:release-hardening` green.

## Non-Goals

- **No new workspace-scoping feature.** We are not building real per-resource workspace visibility.
- **Do not touch the admin Workspaces feature** (`app.workspaces`, `app.workspace_memberships`,
  `/api/admin/workspaces*`, `settings/src/repository.ts`, settings admin panel, `me.workspaces`,
  `queryKeys.settings.workspaces`). That is a live, separate concept and stays.
- No migrations, no RLS-policy edits (1c–1f already settled the access model).
- No `AccessContext` change (it is already correct).

## Resolved Decisions (already decided)

- **Workspace-as-data-isolation is permanently gone** (Slice 1f, migration 0028; auto-memory
  `accesscontext-state`, `rls-shareability`). "Any code referencing workspace scoping is stale and
  should be removed, not kept."
- **The "house" multi-user model is real and near-term** (ADR 0007: Ben + Katherine), but it is
  delivered through **owner-or-share grants**, not workspace membership. So multi-user is NOT a
  reason to keep workspace scoping.

## Resolved Decisions (was open)

**The fork → REMOVE the dead access-scope vocabulary now. No scoping ADR.** The vocab is a shallow,
mechanical removal, not load-bearing:

1. **Zero runtime branches.** No code reads `ModuleScope` / `scope ===` / `scope ==` to make a
   decision. The field is pure documentation on manifest entries; changing the strings changes no
   behavior.
2. **No DB/RLS dependency.** The workspace access functions/columns were already dropped in 0028.
   Removing the vocab touches no SQL and needs no migration.
3. **The near-term multi-user case is already served** by owner-or-share (ADR 0007 +
   `rls-shareability`), so no pending feature needs a `workspace` scope. A scoping ADR would design a
   feature with no consumer.
4. **Steelman for keeping it (rejected):** a future workspace concept would be a fresh milestone with
   its own ADR and correctly-runtime-backed vocabulary; keeping a dead enum value as a placeholder is
   exactly the "silent half-existing concept" #59 forbids.

Concretely: drop `"workspace"` from `ModuleScope` (`packages/module-sdk`) and from the `platform-api`
union + JSON-schema enum (`packages/shared`); delete the ~20 stale `scope:"workspace"` manifest
entries and stale prose; let `pnpm typecheck` surface the full edit set.

**Scope: do NOT conflate with the admin Workspaces feature.** Leave the real `app.workspaces` /
`app.workspace_memberships` admin tables, the `/api/admin/workspaces*` routes, `me.workspaces`, and
the settings admin Workspaces panel **intact** — only the dead _access-scope vocabulary_ is removed.

**Sub-decision → default reclassification = `"user"`.** Each former `scope: "workspace"` entry becomes:

- Per-user read/write/create tool & permission entries (tasks, chat, email, calendar, notifications,
  briefings) → **`scope: "user"`** (actor's own + shared-to-actor resources under RLS).
- Connectors' entry (`connectors/src/manifest.ts:68`) → **`scope: "user"`** (owner-only).
- Any admin-gated entry whose route requires `*.manage` → keep/confirm **`scope: "admin"`**.

The default for actor-scoped entries is **`"user"`**.

## Approach (concrete files + changes)

1. **`packages/module-sdk/src/index.ts`** — change `ModuleScope` to
   `"user" | "admin" | "system"` (drop `"workspace"`). This makes every stale `scope: "workspace"`
   a **type error**, surfacing the full edit set via `pnpm typecheck`.
2. **`packages/shared/src/platform-api.ts`** — mirror the change in both the inline union (`:65`) and
   the JSON-schema `enum` (`:216`): drop `"workspace"`.
3. **Reclassify each manifest entry** (per the Open-Decision mapping) and **rewrite the prose** so no
   description references "workspace-visible", "joined workspace", "workspace membership", or
   "workspace-level". Files:
   - `packages/tasks/src/manifest.ts` (lines ~79–115; note `id: "tasks.workspace-settings"` →
     rename to e.g. `tasks.module-settings`, and "workspace-level task behavior" → "Tasks module behavior")
   - `packages/chat/src/manifest.ts` (~48–64)
   - `packages/email/src/manifest.ts` (~42–80)
   - `packages/calendar/src/manifest.ts` (~44–82)
   - `packages/notifications/src/manifest.ts` (~48–99)
   - `packages/briefings/src/manifest.ts` (~55–77)
   - `packages/connectors/src/manifest.ts` (~68)
     New prose pattern: "owned by the actor or shared with the actor" / "List … the actor can see"
     (owner-or-share); for notifications, "delivered to the actor" (recipient-only); for connectors,
     "owned by the actor" (owner-only).
4. **Grep sweep for residual strings** in non-manifest source/tests: `"workspace-visible"`,
   `"joined workspace"`, `"workspace membership"`, `"workspace context"` — fix any test assertion that
   pins the old description text. (Settings/admin-workspaces strings are intentionally left alone.)
5. **`tasks.workspace-settings` permission id rename** — if any test, route guard, or frontend
   references the literal `"tasks.workspace-settings"`, update it. Grep before renaming.

## Collision notes

- **Independent of #60.** #59 is manifests + two SDK/shared type files; #60 is `apps/web`. No file overlap.
- **Soft overlap risk with any other Phase-1 spec touching `platform-api.ts` or a module manifest.**
  The `ModuleScope` change is a one-line type edit; coordinate merge order via herdr if another agent
  is mid-edit in `packages/shared/` or a `manifest.ts`. Recommend landing this early (it is mechanical
  and the type-error surface makes it self-verifying).

## Exit Criteria (from issue #59 acceptance)

- [ ] `"workspace"` removed from `ModuleScope` (`module-sdk`) and from the `platform-api.ts` union +
      JSON-schema enum.
- [ ] No `scope: "workspace"` remains in any `packages/*/src/manifest.ts`; each former entry is
      reclassified to `user` / `admin` (verified by grep + `pnpm typecheck`).
- [ ] No manifest description references "workspace-visible", "joined workspace", "workspace
      membership", or "workspace-level" (module-access prose). (Admin Workspaces feature strings exempt.)
- [ ] Admin Workspaces feature untouched and still passing (`/api/admin/workspaces*`,
      `app.workspaces`, settings panel, `me.workspaces`).
- [ ] `pnpm verify:foundation` green (lint, format, file-size, typecheck, migrate, integration).
- [ ] `pnpm audit:release-hardening` green.

## Hard Invariants honored

- **AccessContext shape.** Unchanged and never re-extended — this spec aligns vocabulary _to_ the
  `{ actorUserId, requestId }` shape, the opposite of re-introducing `workspaceId`.
- **Private by default / owner-or-share.** New prose describes exactly the RLS model already in force;
  no access behavior changes.
- **Module isolation.** Edits stay within each module's own manifest + the shared SDK/contract types.
- **Never edit applied migrations.** No migrations in scope.
- **Spec before build.** This document is the gate for #59; it resolves the fork rather than deferring it.
