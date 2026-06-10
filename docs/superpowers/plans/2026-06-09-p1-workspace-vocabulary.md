# Remove Dead "workspace" Access-Scope Vocabulary (#59) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the dead `"workspace"` value from `ModuleScope`, reclassify all ~20 stale `scope: "workspace"` manifest entries to `"user"`, and rewrite stale prose so no description references workspace-scoping that the runtime cannot honor.

**Architecture:** Three commit groups. (1) Fix all manifest files first — changing `scope: "workspace"` → `"user"` and rewriting stale descriptions — TypeScript stays green throughout because `"user"` is already a valid `ModuleScope` value. (2) Drop `"workspace"` from the `ModuleScope` union in `packages/module-sdk` and `packages/shared/platform-api.ts` — `pnpm typecheck` now proves no stale `"workspace"` references remain. (3) Grep sweep for any residual prose strings + format + lint. No migrations; no RLS changes; no test logic changes.

**Tech Stack:** TypeScript 5, pnpm workspaces, Prettier, ESLint, Vitest (integration gate at end)

---

## File Map

| File                                     | Change                                                                     |
| ---------------------------------------- | -------------------------------------------------------------------------- |
| `packages/tasks/src/manifest.ts`         | Rename settings id, reclassify 5 entries, rewrite 3 descriptions           |
| `packages/chat/src/manifest.ts`          | Reclassify 3 entries, rewrite 2 descriptions                               |
| `packages/email/src/manifest.ts`         | Reclassify 2 entries, rewrite 1 description, rewrite 1 tool description    |
| `packages/calendar/src/manifest.ts`      | Reclassify 2 entries, rewrite 1 description, rewrite 1 tool description    |
| `packages/notifications/src/manifest.ts` | Reclassify 2 entries, rewrite 1 description, rewrite 1 tool description    |
| `packages/briefings/src/manifest.ts`     | Reclassify 4 entries, rewrite 2 descriptions                               |
| `packages/connectors/src/manifest.ts`    | Reclassify 1 entry (description already correct)                           |
| `packages/module-sdk/src/index.ts`       | Drop `"workspace"` from `ModuleScope` union                                |
| `packages/shared/src/platform-api.ts`    | Drop `"workspace"` from inline union (`:65`) and JSON-schema enum (`:216`) |

**Do NOT touch:**

- `packages/settings/src/manifest.ts` — "workspace" prose there refers to the live admin Workspaces feature
- `packages/settings/src/routes.ts`, `packages/settings/src/repository.ts` — live admin feature
- `apps/web/src/settings/settings-page.tsx` — live admin Workspaces panel
- `apps/web/src/api/query-keys.ts` — `queryKeys.settings.workspaces` is live admin feature
- `packages/db/src/types.ts` — real DB row types for `app.workspaces`/`app.workspace_memberships`
- `tests/integration/auth-settings.test.ts` — tests the live admin Workspaces feature

---

## Task 1: Fix tasks manifest

**Files:**

- Modify: `packages/tasks/src/manifest.ts` (lines 77–117)

Changes:

- Settings entry `id: "tasks.workspace-settings"` → `"tasks.module-settings"`, `scope: "workspace"` → `"user"`
- `tasks.view` permission: `scope` → `"user"`, description rewrite
- `tasks.create` permission: `scope` → `"user"`, description rewrite
- `tasks.update` permission: `scope` → `"user"`, description rewrite
- `tasks.manage` permission: `scope` → `"user"`, description rewrite

- [ ] **Step 1: Verify current state**

```bash
cd ~/Jarv1s/.claude/worktrees/p1-workspace-vocab
grep -n "workspace" packages/tasks/src/manifest.ts
```

Expected: 5 lines showing `scope: "workspace"` and stale descriptions.

- [ ] **Step 2: Apply the changes to `packages/tasks/src/manifest.ts`**

Replace the `settings` block (lines ~77–86):

```typescript
  settings: [
    {
      id: "tasks.module-settings",
      label: "Tasks",
      path: "/settings/modules/tasks",
      scope: "user",
      order: 10,
      permissionId: "tasks.manage"
    }
  ],
```

Replace the `permissions` block (lines ~87–117):

```typescript
  permissions: [
    {
      id: "tasks.view",
      label: "View tasks",
      description: "Read tasks owned by or shared with the active actor.",
      scope: "user",
      actions: ["view"]
    },
    {
      id: "tasks.create",
      label: "Create tasks",
      description: "Create tasks owned by the active actor.",
      scope: "user",
      actions: ["create"]
    },
    {
      id: "tasks.update",
      label: "Update tasks",
      description: "Update tasks owned by or shared with the active actor.",
      scope: "user",
      actions: ["update"]
    },
    {
      id: "tasks.manage",
      label: "Manage tasks module",
      description: "Manage Tasks module settings and behavior.",
      scope: "user",
      actions: ["manage"]
    }
  ],
```

- [ ] **Step 3: Typecheck (should still pass — `"user"` is a valid ModuleScope)**

```bash
cd ~/Jarv1s/.claude/worktrees/p1-workspace-vocab
pnpm typecheck 2>&1 | head -30
```

Expected: No errors from tasks manifest. Other manifests may still have `scope: "workspace"` but that is not yet an error (not dropped from type yet).

- [ ] **Step 4: Commit**

```bash
cd ~/Jarv1s/.claude/worktrees/p1-workspace-vocab
git add packages/tasks/src/manifest.ts
git commit -m "$(cat <<'EOF'
fix(tasks): reclassify workspace-scope vocab to user scope (#59)

Rename settings id tasks.workspace-settings → tasks.module-settings.
Reclassify all four permissions from scope:"workspace" to scope:"user"
and rewrite descriptions to reflect the actual owner-or-share RLS model.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Fix chat manifest

**Files:**

- Modify: `packages/chat/src/manifest.ts` (lines ~44–66)

Changes:

- `chat.view`: `scope` → `"user"`, description rewrite
- `chat.create`: `scope` → `"user"`, description rewrite
- `chat.message`: `scope` → `"user"` (description already has no workspace prose)

- [ ] **Step 1: Verify**

```bash
grep -n "workspace" packages/chat/src/manifest.ts
```

Expected: 3 lines.

- [ ] **Step 2: Apply changes to `packages/chat/src/manifest.ts`**

Replace the `permissions` block (lines ~44–66):

```typescript
  permissions: [
    {
      id: "chat.view",
      label: "View chat",
      description: "Read chat threads and messages visible to the active actor.",
      scope: "user",
      actions: ["view"]
    },
    {
      id: "chat.create",
      label: "Create chat",
      description: "Create chat threads for the active actor.",
      scope: "user",
      actions: ["create"]
    },
    {
      id: "chat.message",
      label: "Append chat messages",
      description:
        "Append user messages and record assistant-side safe routing/tool metadata without execution.",
      scope: "user",
      actions: ["create"]
    }
  ],
```

- [ ] **Step 3: Typecheck**

```bash
pnpm typecheck 2>&1 | grep -c "error" || echo "0 errors"
```

Expected: 0 type errors from chat manifest.

- [ ] **Step 4: Commit**

```bash
git add packages/chat/src/manifest.ts
git commit -m "$(cat <<'EOF'
fix(chat): reclassify workspace-scope vocab to user scope (#59)

Reclassify all three chat permissions from scope:"workspace" to
scope:"user" and rewrite chat.view/chat.create descriptions.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Fix email manifest

**Files:**

- Modify: `packages/email/src/manifest.ts` (lines ~39–92)

Changes:

- `email.view`: `scope` → `"user"`, description rewrite
- `email.manage`: `scope` → `"user"` (description already has no workspace prose)
- `email.listVisibleMessages` tool: description rewrite

- [ ] **Step 1: Verify**

```bash
grep -n "workspace" packages/email/src/manifest.ts
```

Expected: 3 lines (2 `scope:` + 1 tool description).

- [ ] **Step 2: Apply changes to `packages/email/src/manifest.ts`**

Replace `email.view` permission:

```typescript
    {
      id: "email.view",
      label: "View email",
      description: "Read cached email messages owned by or shared with the active actor.",
      scope: "user",
      actions: ["view"]
    },
```

Replace `email.manage` permission:

```typescript
    {
      id: "email.manage",
      label: "Manage email module",
      description: "Manage Email module settings and connector-backed cache behavior.",
      scope: "user",
      actions: ["manage"]
    }
```

Replace `email.listVisibleMessages` tool description:

```typescript
      description: "List cached email messages owned by or shared with the active actor.",
```

- [ ] **Step 3: Typecheck**

```bash
pnpm typecheck 2>&1 | grep -c "error" || echo "0 errors"
```

- [ ] **Step 4: Commit**

```bash
git add packages/email/src/manifest.ts
git commit -m "$(cat <<'EOF'
fix(email): reclassify workspace-scope vocab to user scope (#59)

Reclassify email.view and email.manage from scope:"workspace" to
scope:"user"; rewrite email.view and tool descriptions.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Fix calendar manifest

**Files:**

- Modify: `packages/calendar/src/manifest.ts` (lines ~41–93)

Changes:

- `calendar.view`: `scope` → `"user"`, description rewrite
- `calendar.manage`: `scope` → `"user"` (description has no workspace prose)
- `calendar.listVisibleEvents` tool: description rewrite

- [ ] **Step 1: Verify**

```bash
grep -n "workspace" packages/calendar/src/manifest.ts
```

Expected: 3 lines.

- [ ] **Step 2: Apply changes to `packages/calendar/src/manifest.ts`**

Replace `calendar.view` permission:

```typescript
    {
      id: "calendar.view",
      label: "View calendar",
      description: "Read cached calendar events owned by or shared with the active actor.",
      scope: "user",
      actions: ["view"]
    },
```

Replace `calendar.manage` permission:

```typescript
    {
      id: "calendar.manage",
      label: "Manage calendar module",
      description: "Manage Calendar module settings and connector-backed cache behavior.",
      scope: "user",
      actions: ["manage"]
    }
```

Replace `calendar.listVisibleEvents` tool description:

```typescript
      description: "List cached calendar events owned by or shared with the active actor.",
```

- [ ] **Step 3: Typecheck**

```bash
pnpm typecheck 2>&1 | grep -c "error" || echo "0 errors"
```

- [ ] **Step 4: Commit**

```bash
git add packages/calendar/src/manifest.ts
git commit -m "$(cat <<'EOF'
fix(calendar): reclassify workspace-scope vocab to user scope (#59)

Reclassify calendar.view and calendar.manage from scope:"workspace" to
scope:"user"; rewrite calendar.view and tool descriptions.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Fix notifications manifest

**Files:**

- Modify: `packages/notifications/src/manifest.ts` (lines ~44–110)

Changes (notifications are recipient-only — "delivered to the actor"):

- `notifications.view`: `scope` → `"user"`, description rewrite
- `notifications.update`: `scope` → `"user"` (description already has no workspace prose)
- `notifications.listVisible` tool: description rewrite

- [ ] **Step 1: Verify**

```bash
grep -n "workspace" packages/notifications/src/manifest.ts
```

Expected: 3 lines.

- [ ] **Step 2: Apply changes to `packages/notifications/src/manifest.ts`**

Replace `notifications.view` permission:

```typescript
    {
      id: "notifications.view",
      label: "View notifications",
      description: "Read notifications delivered to the active actor.",
      scope: "user",
      actions: ["view"]
    },
```

Replace `notifications.update` permission:

```typescript
    {
      id: "notifications.update",
      label: "Update notification read state",
      description: "Mark notifications read for the active actor.",
      scope: "user",
      actions: ["update"]
    },
```

Replace `notifications.listVisible` tool description:

```typescript
      description: "List notifications delivered to the active actor.",
```

- [ ] **Step 3: Typecheck**

```bash
pnpm typecheck 2>&1 | grep -c "error" || echo "0 errors"
```

- [ ] **Step 4: Commit**

```bash
git add packages/notifications/src/manifest.ts
git commit -m "$(cat <<'EOF'
fix(notifications): reclassify workspace-scope vocab to user scope (#59)

Reclassify notifications.view and notifications.update from
scope:"workspace" to scope:"user"; rewrite descriptions to reflect
the recipient-only delivery model (no workspace visibility dimension).

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Fix briefings manifest

**Files:**

- Modify: `packages/briefings/src/manifest.ts` (lines ~50–79)

Changes:

- `briefings.view`: `scope` → `"user"`, description rewrite
- `briefings.create`: `scope` → `"user"`, description rewrite
- `briefings.update`: `scope` → `"user"` (description already correct: "owned by the active actor")
- `briefings.run`: `scope` → `"user"` (description already has no workspace prose)

- [ ] **Step 1: Verify**

```bash
grep -n "workspace" packages/briefings/src/manifest.ts
```

Expected: 4 lines.

- [ ] **Step 2: Apply changes to `packages/briefings/src/manifest.ts`**

Replace `briefings.view` permission:

```typescript
    {
      id: "briefings.view",
      label: "View briefings",
      description: "Read briefing definitions and runs owned by or shared with the active actor.",
      scope: "user",
      actions: ["view"]
    },
```

Replace `briefings.create` permission:

```typescript
    {
      id: "briefings.create",
      label: "Create briefings",
      description: "Create briefing definitions owned by the active actor.",
      scope: "user",
      actions: ["create"]
    },
```

Replace `briefings.update` permission:

```typescript
    {
      id: "briefings.update",
      label: "Update briefings",
      description: "Update briefing definitions owned by the active actor.",
      scope: "user",
      actions: ["update"]
    },
```

Replace `briefings.run` permission:

```typescript
    {
      id: "briefings.run",
      label: "Run briefings",
      description: "Queue metadata-only briefing runs over selected read-risk assistant tools.",
      scope: "user",
      actions: ["execute"]
    }
```

- [ ] **Step 3: Typecheck**

```bash
pnpm typecheck 2>&1 | grep -c "error" || echo "0 errors"
```

- [ ] **Step 4: Commit**

```bash
git add packages/briefings/src/manifest.ts
git commit -m "$(cat <<'EOF'
fix(briefings): reclassify workspace-scope vocab to user scope (#59)

Reclassify all four briefing permissions from scope:"workspace" to
scope:"user"; rewrite briefings.view and briefings.create descriptions.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Fix connectors manifest

**Files:**

- Modify: `packages/connectors/src/manifest.ts` (line ~68)

Changes:

- `connectors.manage`: `scope` → `"user"` (description already correct: "owned by the active actor")

- [ ] **Step 1: Verify**

```bash
grep -n "workspace" packages/connectors/src/manifest.ts
```

Expected: 1 line showing `scope: "workspace"` for `connectors.manage`.

- [ ] **Step 2: Apply change to `packages/connectors/src/manifest.ts`**

Change `scope: "workspace"` → `scope: "user"` for the `connectors.manage` entry (line ~68).

- [ ] **Step 3: Verify no more workspace-scope in any manifest**

```bash
grep -rn 'scope: "workspace"' packages/*/src/manifest.ts
```

Expected: **no output** — zero matches.

- [ ] **Step 4: Typecheck**

```bash
pnpm typecheck 2>&1 | grep -c "error" || echo "0 errors"
```

- [ ] **Step 5: Commit**

```bash
git add packages/connectors/src/manifest.ts
git commit -m "$(cat <<'EOF'
fix(connectors): reclassify workspace-scope vocab to user scope (#59)

Reclassify connectors.manage from scope:"workspace" to scope:"user".

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Drop "workspace" from ModuleScope and platform-api.ts

Now that all manifests use only `"user"` / `"admin"` / `"system"`, drop `"workspace"` from the
type union. `pnpm typecheck` becomes the proof that no stale reference remains.

**Files:**

- Modify: `packages/module-sdk/src/index.ts` (line 2)
- Modify: `packages/shared/src/platform-api.ts` (lines 65, 216)

- [ ] **Step 1: Edit `packages/module-sdk/src/index.ts` line 2**

Change:

```typescript
export type ModuleScope = "user" | "workspace" | "admin" | "system";
```

To:

```typescript
export type ModuleScope = "user" | "admin" | "system";
```

- [ ] **Step 2: Edit `packages/shared/src/platform-api.ts` line 65**

Change:

```typescript
  readonly scope: "user" | "workspace" | "admin" | "system";
```

To:

```typescript
  readonly scope: "user" | "admin" | "system";
```

- [ ] **Step 3: Edit `packages/shared/src/platform-api.ts` line 216**

Change:

```typescript
    scope: { type: "string", enum: ["user", "workspace", "admin", "system"] },
```

To:

```typescript
    scope: { type: "string", enum: ["user", "admin", "system"] },
```

- [ ] **Step 4: Typecheck — must be green (proves no stale "workspace" scope references remain)**

```bash
cd ~/Jarv1s/.claude/worktrees/p1-workspace-vocab
pnpm typecheck 2>&1
```

Expected: Zero errors. If any file still assigns `scope: "workspace"`, the error will appear here — fix before committing.

- [ ] **Step 5: Commit**

```bash
git add packages/module-sdk/src/index.ts packages/shared/src/platform-api.ts
git commit -m "$(cat <<'EOF'
fix(module-sdk,shared): drop dead "workspace" from ModuleScope (#59)

Remove "workspace" from the ModuleScope union in module-sdk and from
the inline union + JSON-schema enum in platform-api.ts. All manifest
entries were already reclassified in prior commits; typecheck confirms
no stale references remain.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Grep sweep, format, lint

Verify no residual workspace-scoping prose remains in any non-admin module source, then pass all fast checks.

- [ ] **Step 1: Grep for residual access-scope prose strings**

```bash
cd ~/Jarv1s/.claude/worktrees/p1-workspace-vocab
grep -rn "workspace-visible\|joined workspace\|workspace membership\|workspace context\|workspace-level" \
  --include="*.ts" --include="*.tsx" \
  packages/ apps/ tests/ \
  | grep -v "node_modules" \
  | grep -v "packages/settings/" \
  | grep -v "tests/integration/auth-settings"
```

Expected: **no output**. If matches appear, fix the description in the relevant manifest or source file.

- [ ] **Step 2: Grep for residual `scope: "workspace"` anywhere in source**

```bash
grep -rn 'scope:.*"workspace"' --include="*.ts" --include="*.tsx" packages/ apps/ tests/ \
  | grep -v "node_modules"
```

Expected: **no output**.

- [ ] **Step 3: Prettier format**

```bash
pnpm format 2>&1 | tail -5
```

Expected: Exits 0 (or writes any needed formatting — commit changes if any).

- [ ] **Step 4: Lint**

```bash
pnpm lint 2>&1 | tail -10
```

Expected: No warnings or errors.

- [ ] **Step 5: File size check**

```bash
pnpm check:file-size 2>&1 | tail -5
```

Expected: All files under 1000 lines.

- [ ] **Step 6: Commit format fixes (if any)**

If `pnpm format` wrote changes:

```bash
git add -p  # stage only format changes
git commit -m "$(cat <<'EOF'
style: format manifest files after workspace-vocab removal (#59)

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

If no changes, skip this step.

---

## Self-Review Against Spec Exit Criteria

| Exit criterion                                                         | Task(s) that cover it                       |
| ---------------------------------------------------------------------- | ------------------------------------------- |
| `"workspace"` removed from `ModuleScope` in module-sdk                 | Task 8                                      |
| `"workspace"` removed from platform-api.ts union + JSON-schema enum    | Task 8                                      |
| No `scope: "workspace"` in any manifest (verified by grep + typecheck) | Tasks 1–7, verified in Task 9               |
| No manifest description references stale workspace-scoping prose       | Tasks 1–6, verified in Task 9               |
| Admin Workspaces feature untouched                                     | File map "Do NOT touch" list                |
| `pnpm verify:foundation` green                                         | Covered by coordinated-wrap-up (final gate) |
| `pnpm audit:release-hardening` green                                   | Covered by coordinated-wrap-up (final gate) |
