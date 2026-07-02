# Design Dead Code Deletion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete only #687 frontend design code with importer/selector proof that it is unreachable.

**Architecture:** No new behavior. Remove orphaned React files and CSS selector blocks, then let TypeScript and the app build prove no import surface remains. Keep live Today/editorial paths untouched.

**Tech Stack:** React, TypeScript, CSS, pnpm, Vite.

---

## Premise Verification

- `apps/web/src/connectors/connect-google-panel.tsx`: graph shows `ConnectGooglePanel` has `callers: 0`; `rg "ConnectGooglePanel|connect-google-panel" apps packages` finds only its own export.
- `apps/web/src/ui/time-bucket.tsx`: graph shows `TimeBucket` has `callers: 0`; `rg "TimeBucket|time-bucket" apps packages` finds only its own file.
- `apps/web/src/tasks/tasks.css`: issue range `133-482` drifted. `TaskCapture` is live at `apps/web/src/tasks/task-capture.tsx`, so keep `.task-capture` rules. Delete only unused `.tasks-layout`, `.task-groups`, legacy `.task-line`, old `.task-matrix`, sidebar/list/tag/subtask blocks. Current matrix uses `tk-*` selectors in `task-matrix-view.tsx`.
- `apps/web/src/styles/wellness-2.css`: delete only unused `.wl-emogrid`, `.wl-emobtn*`, `.wl-palette`, `.wl-palrow*`. Keep live `.wl-chipwrap`, `.wl-fchip`, `.wl-schip`, `.wl-int*`, `.wl-moodpreview`, `.wl-dial*`, and `.wl-search*`.

## Files

- Delete: `apps/web/src/connectors/connect-google-panel.tsx`
- Delete: `apps/web/src/ui/time-bucket.tsx`
- Modify: `apps/web/src/tasks/tasks.css`
- Modify: `apps/web/src/styles/wellness-2.css`

## Task 1: Delete Confirmed Dead Files

- [ ] **Step 1: Remove orphaned component files**

Delete:

```bash
rm apps/web/src/connectors/connect-google-panel.tsx apps/web/src/ui/time-bucket.tsx
```

- [ ] **Step 2: Re-run importer proof**

Run:

```bash
rg -n "ConnectGooglePanel|connect-google-panel|TimeBucket|time-bucket" apps packages -g '!node_modules'
```

Expected: exit `1`, no matches.

- [ ] **Step 3: Run focused typecheck**

Run:

```bash
pnpm --filter @jarv1s/web typecheck
```

Expected: exit `0`.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/connectors/connect-google-panel.tsx apps/web/src/ui/time-bucket.tsx
git commit -m "refactor(web): delete orphaned design components" -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

## Task 2: Delete Confirmed Dead CSS

- [ ] **Step 1: Remove unused tasks CSS blocks**

In `apps/web/src/tasks/tasks.css`, delete:

- `.tasks-layout`
- `.task-groups`, `.task-group-*`
- `.task-line*`
- `.task-matrix`, `.matrix-*`
- `.tasks-body`, `.tasks-sidebar`, `.sidebar-*`, `.list-nav`, `.sidebar-form`, `.tag-list`
- old `.tag-chip*`, `.subtask-*`, `.empty-hint`, `.task-effort`, `.task-tags-*`, `.list-row*`, `.list-reassign`, `.tag-edit-form`

Keep `.task-capture*` and `.tk-*`.

- [ ] **Step 2: Remove unused wellness CSS blocks**

In `apps/web/src/styles/wellness-2.css`, delete:

- `.wl-emogrid`
- `.wl-emobtn*`, including the left accent `::before`
- `.wl-palette`
- `.wl-palrow*`

Keep live chip, intensity, dial, search, and mood preview selectors.

- [ ] **Step 3: Re-run selector proof**

Run:

```bash
rg -n "task-line|task-matrix|matrix-cell|tasks-body|tasks-sidebar|sidebar-title|sidebar-subtitle|list-nav|sidebar-form|tag-list|tag-chip|subtask-list|subtask-item|subtask-check|subtask-form|empty-hint|task-effort|task-tags-list|task-tags-form|list-row|list-reassign|tag-edit-form|task-groups|task-group|wl-emogrid|wl-emobtn|wl-palrow|wl-palette" apps/web/src
```

Expected: exit `1`, no matches.

- [ ] **Step 4: Run focused web build**

Run:

```bash
pnpm --filter @jarv1s/web build
```

Expected: exit `0`.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/tasks/tasks.css apps/web/src/styles/wellness-2.css
git commit -m "refactor(web): delete orphaned design css" -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

## Final Verification

- [ ] **Step 1: Run required checks**

Run:

```bash
pnpm format:check && pnpm lint && pnpm typecheck
```

Expected: exit `0`.

- [ ] **Step 2: Pre-push rebase**

Run:

```bash
git fetch origin main && git rebase origin/main
```

Expected: exit `0`.

- [ ] **Step 3: Wrap up**

Use `coordinated-wrap-up`: push branch, open PR, include importer/selector proof and exact command exit codes, then report PR URL to `Coordinator`.
