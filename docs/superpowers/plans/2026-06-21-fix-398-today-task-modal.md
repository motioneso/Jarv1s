# Plan: fix-398-today-task-modal

**Issue:** #398 (Part of epic #382)
**Branch:** fix-398-today-task-modal
**Spec:** GitHub issue #398 (approved dogfood fix)

## Exit Criteria

- Clicking a task on Today page opens `TaskDetailsDialog` modal (not legacy page)
- Loose-ends task links in Today also open modal
- `task-detail-page.tsx` deleted; its route removed from `app.tsx` and `app-route-metadata.ts`
- No remaining navigations to `/tasks/:taskId`
- e2e test updated for new modal flow
- `pnpm format:check && pnpm lint && pnpm typecheck` all green

## Tasks

### Task 1 — Wire TodayPage to open TaskDetailsDialog

**Files:** `apps/web/src/today/today-page.tsx`

- Import `TaskDetailsDialog` from `../tasks/task-details-dialog`
- Import `listTaskLists` from `../api/client`
- Import `../styles/kit-tasks-modal.css`
- Remove `Link` from `react-router` import (unused after changes)
- Add `const [dialog, setDialog] = useState<{ readonly id: string } | null>(null)`
- Add `listsQuery` via `useQuery({ queryKey: queryKeys.tasks.lists, queryFn: listTaskLists })`
- `BriefTaskRow`: add `onOpen: () => void` prop; change `<Link className="jds-task__main">` → `<button type="button" className="jds-task__main">` with `onClick={props.onOpen}`
- Call site: pass `onOpen={() => setDialog({ id: task.id })}`
- Loose-ends section: change `<Link className="loose-row">` → `<button type="button" className="loose-row">` with `onClick={() => setDialog({ id: task.id })}`
- Mount `<TaskDetailsDialog>` at bottom of TodayPage return (same pattern as TasksPage)

**Commit:** `fix(today): open task detail as modal (#398)`

### Task 2 — Remove legacy route and delete legacy page

**Files:** `apps/web/src/app.tsx`, `apps/web/src/app-route-metadata.ts`
**Delete:** `apps/web/src/tasks/task-detail-page.tsx`

- `app.tsx`: remove lazy `TaskDetailPage` import (lines 34–36); remove `<Route path={webRoutePath("task-detail")} ...>` (line 195)
- `app-route-metadata.ts`: remove `task-detail` entry (`id: "task-detail"`, `path: "/tasks/:taskId"`)
- `git rm apps/web/src/tasks/task-detail-page.tsx`

**Commit:** `fix(tasks): remove legacy task-detail-page and route (#398)`

### Task 3 — Update e2e test

**File:** `tests/e2e/tasks.spec.ts`

Test "assigning a tag from the detail page renders a chip" navigates to `/tasks/t-critical` (dead route after Task 2). Rewrite to:

1. `goto("/tasks")`
2. `getByRole("button", { name: "Open File taxes" }).click()`
3. Wait for dialog
4. `getByRole("button", { name: "#urgent" }).click()` (suggestion chip)
5. `expect(getByRole("button", { name: "Remove urgent" })).toBeVisible()`

Also update test name to reflect modal flow.

`capture-screens.spec.ts:162` ("08-task-detail") clicks first task on /tasks page — already opens modal via TaskListView.onOpen, no change needed.

**Commit:** `test(tasks): update tag e2e test for modal flow (#398)`

## Notes

- No migration, no backend change
- CSS: `.loose-row` and `.jds-task__main` are class-selectors; no `a`-specific rules → `<button>` works without CSS changes
- `useNavigate` stays (still used by Stat buttons)
- `lists` from `listsQuery.data?.lists ?? []` passed to dialog
