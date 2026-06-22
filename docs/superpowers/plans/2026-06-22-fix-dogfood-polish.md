# fix-dogfood-polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix three dogfood polish issues: task-name persists to Details modal (#419), mobile filter bar two-row redesign (#420), chat auto-title from first user prompt (#403).

**Architecture:** Three independent commits — each issue is isolated to its own file set. #419 threads a callback value through 4 files. #420 restructures the tasks toolbar JSX and adds mobile CSS. #403 extends ChatRepository + DataContextChatPersistence to derive and persist a heuristic title on first turn; the frontend already displays `thread.title`.

**Tech Stack:** React (TypeScript), Kysely, Fastify; pnpm workspace monorepo; Vitest integration tests; Playwright e2e.

## Global Constraints

- File-size gate: no source file may exceed 1000 lines (`pnpm check:file-size`)
- Stage only named files — never `git add -A`
- No migrations: `chat_threads.title` column already exists
- Commit trailer: `Co-Authored-By: Claude <noreply@anthropic.com>`
- Desktop task-bar layout must not regress
- `pnpm format:check && pnpm lint && pnpm typecheck` green before each push
- Heuristic chat-title: no LLM call, no new provider dependency

---

### Task 1: #419 — Task name threads from TaskCapture → Details modal

**Files:**

- Modify: `apps/web/src/tasks/task-details-model.ts` — add `defaultTitle` param to `blankTaskDetailsForm`
- Modify: `apps/web/src/tasks/task-details-dialog.tsx` — add `defaultTitle?: string` prop, pass to initializer
- Modify: `apps/web/src/tasks/task-capture.tsx` — change `onDetails` callback to pass current title
- Modify: `apps/web/src/tasks/tasks-page.tsx` — widen dialog state type, pass `defaultName` to dialog

**Interfaces:**

- Produces: `blankTaskDetailsForm(defaultListId?: string, defaultTitle?: string): TaskDetailsFormState`
- Produces: `TaskDetailsDialog` now accepts `defaultTitle?: string` prop
- Produces: `TaskCapture` `onDetails` callback signature changes to `(name: string) => void`

- [ ] **Step 1: Update `blankTaskDetailsForm` to accept optional default title**

In `apps/web/src/tasks/task-details-model.ts`, change line 26 from:

```ts
export function blankTaskDetailsForm(defaultListId = ""): TaskDetailsFormState {
  return {
    title: "",
```

To:

```ts
export function blankTaskDetailsForm(defaultListId = "", defaultTitle = ""): TaskDetailsFormState {
  return {
    title: defaultTitle,
```

- [ ] **Step 2: Add `defaultTitle` prop to `TaskDetailsDialog` and use it**

In `apps/web/src/tasks/task-details-dialog.tsx`, change the props type (lines 56–63):

```tsx
export function TaskDetailsDialog(props: {
  readonly open: boolean;
  readonly taskId: string | null;
  readonly defaultListId?: string;
  readonly defaultTitle?: string;
  readonly currentUserLabel: string;
  readonly lists: readonly TaskListDto[];
  readonly onClose: () => void;
}) {
```

Change the state initializer (line 70–72):

```tsx
const [form, setForm] = useState<TaskDetailsFormState>(() =>
  blankTaskDetailsForm(props.defaultListId, props.defaultTitle)
);
```

- [ ] **Step 3: Change `TaskCapture` onDetails to pass current title**

In `apps/web/src/tasks/task-capture.tsx`, change the prop type (line 10–13):

```tsx
export function TaskCapture(props: {
  readonly defaultListId?: string;
  readonly onDetails: (name: string) => void;
}) {
```

Change the Details button onClick (line 49–53):

```tsx
          <button
            className="jds-btn jds-btn--secondary jds-btn--sm"
            onClick={() => props.onDetails(title)}
            type="button"
          >
```

- [ ] **Step 4: Widen dialog state in `tasks-page.tsx` and pass `defaultName`**

In `apps/web/src/tasks/tasks-page.tsx`, change the dialog state type (line 58):

```tsx
const [dialog, setDialog] = useState<{
  readonly id: string | null;
  readonly defaultName?: string;
} | null>(null);
```

Change the `TaskCapture` onDetails call (line 248–251):

```tsx
<TaskCapture
  defaultListId={soloIds.length === 1 ? soloIds[0] : undefined}
  onDetails={(name) => setDialog({ id: null, defaultName: name })}
/>
```

Pass `defaultTitle` to `TaskDetailsDialog` (around line 287–296):

```tsx
{
  dialog ? (
    <TaskDetailsDialog
      open
      taskId={dialog.id}
      defaultListId={soloIds.length === 1 ? soloIds[0] : lists[0]?.id}
      defaultTitle={dialog.defaultName}
      currentUserLabel="You"
      lists={lists}
      onClose={() => setDialog(null)}
    />
  ) : null;
}
```

- [ ] **Step 5: Run typecheck**

```bash
pnpm typecheck
```

Expected: no errors in the 4 modified files.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/tasks/task-details-model.ts \
        apps/web/src/tasks/task-details-dialog.tsx \
        apps/web/src/tasks/task-capture.tsx \
        apps/web/src/tasks/tasks-page.tsx
git commit -m "fix(tasks): thread inline capture name into Details modal (#419)

When clicking Details while typing a task name, the typed name now
pre-populates the modal's title field so the user never has to retype.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 2: #420 — Mobile task filter bar two-row redesign

**Files:**

- Modify: `apps/web/src/tasks/tasks-page.tsx` — add `showMobileSearch` state, wrap ListFilterMenu in `.tk-bar__r1`, add `.tk-msrch` toggle button, conditionally show search
- Modify: `apps/web/src/tasks/tasks.css` — replace mobile 560px block with new two-row rules, add `.tk-msrch` and `.tk-bar__search` classes

**Interfaces:**

- None external; CSS classes `.tk-bar__r1`, `.tk-bar__search`, `.tk-msrch` are introduced.

- [ ] **Step 1: Add `showMobileSearch` state and restructure tk-bar JSX**

In `apps/web/src/tasks/tasks-page.tsx`, add state after `tagFilter` (after line 55):

```tsx
const [showMobileSearch, setShowMobileSearch] = useState(false);
```

Replace the entire `<div className="tk-bar">` block (lines 115–186) with the restructured version below. On desktop all elements remain inline; on mobile CSS will order and wrap them into two rows:

```tsx
<div className="tk-bar">
  <div className="jds-segmented" role="group" aria-label="Status filter">
    {statusFilters.map((status) => (
      <button
        aria-pressed={!focus && statusFilter === status}
        className={`jds-segmented__opt ${!focus && statusFilter === status ? "is-active" : ""}`}
        key={status}
        onClick={() => {
          setStatusFilter(status);
          clearFocus();
        }}
        type="button"
      >
        {status === "all" ? "All" : statusLabels[status]}
      </button>
    ))}
  </div>

  <span className="tk-bar__sep" />

  <div className="tk-bar__r1">
    <ListFilterMenu
      lists={lists}
      stateOf={stateOf}
      soloIds={soloIds}
      counts={listCounts}
      allCount={listCountTotal}
      onCycle={cycleList}
      onReset={() => setListStates({})}
    />
  </div>

  <TagFilter
    all={allTags}
    active={tagFilter}
    onAdd={(name) => setTagFilter((a) => (a.includes(name) ? a : [...a, name]))}
  />

  <div className={`tk-bar__search${showMobileSearch ? " is-open" : ""}`}>
    <label className="tk-tagfield">
      <span className="ic">
        <Search size={14} aria-hidden="true" />
      </span>
      <input
        aria-label="Search tasks"
        onChange={(event) => setSearch(event.target.value)}
        placeholder="Search tasks…"
        type="search"
        value={search}
      />
    </label>
  </div>

  <button
    aria-label={showMobileSearch ? "Close search" : "Search tasks"}
    aria-pressed={showMobileSearch}
    className="tk-msrch"
    type="button"
    onClick={() => setShowMobileSearch((v) => !v)}
  >
    <Search size={15} aria-hidden="true" />
  </button>

  <span className="tk-bar__spacer" />

  <div className="jds-segmented" role="group" aria-label="View">
    <button
      aria-pressed={view === "priority"}
      className={`jds-segmented__opt ${view === "priority" ? "is-active" : ""}`}
      disabled={viewMutation.isPending}
      onClick={() => viewMutation.mutate("priority")}
      type="button"
    >
      <ListIcon size={15} aria-hidden="true" /> List
    </button>
    <button
      aria-pressed={view === "matrix"}
      className={`jds-segmented__opt ${view === "matrix" ? "is-active" : ""}`}
      disabled={viewMutation.isPending}
      onClick={() => viewMutation.mutate("matrix")}
      type="button"
    >
      <LayoutGrid size={15} aria-hidden="true" /> Matrix
    </button>
  </div>
</div>
```

- [ ] **Step 2: Replace the mobile CSS block in `tasks.css`**

In `apps/web/src/tasks/tasks.css`, find and replace the existing `@media (max-width: 560px)` block (currently lines 492–517) with the following expanded block. Also add the desktop `.tk-msrch` rule above the media block:

```css
/* Desktop: magnifying-glass search toggle is mobile-only */
.tk-msrch {
  display: none;
}

/* Mobile: deliberate wrap for the tasks toolbar so controls don't orphan a
   single control on its own line when lists are toggled (#388, #420). */
@media (max-width: 560px) {
  .tk-bar {
    gap: 8px 10px;
  }
  .tk-bar__spacer {
    flex-basis: 0;
  }
  .tk-bar__sep {
    display: none;
  }
  /* Row 1: lists dropdown sits alone on the top row (#420) */
  .tk-bar__r1 {
    order: -1;
    flex: 1 1 100%;
  }
  /* Search input hidden until 🔍 tapped (#420) */
  .tk-bar__search {
    display: none;
  }
  .tk-bar__search.is-open {
    display: flex;
    flex: 1 1 100%;
  }
  /* 🔍 toggle button visible on mobile only (#420) */
  .tk-msrch {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: none;
    border: none;
    color: var(--text-subtle);
    cursor: pointer;
    padding: 4px;
    border-radius: var(--radius-sm, 4px);
  }
  .tk-msrch[aria-pressed="true"] {
    color: var(--accent);
  }
  /* #404: hide the "· N hidden" count text on mobile so the list-filter button
     stays narrow when lists are excluded. Users open the dropdown to see state. */
  .tk-listbtn__hidden {
    display: none;
  }
  /* #404: cap the list-filter dropdown to the viewport width and anchor its
     right edge to the button so it never overflows off-screen to the right. */
  .tk-listfilter .tk-tagmenu {
    max-width: calc(100vw - 24px);
    left: auto;
    right: 0;
  }
}
```

- [ ] **Step 3: Run typecheck and lint**

```bash
pnpm typecheck && pnpm lint
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/tasks/tasks-page.tsx \
        apps/web/src/tasks/tasks.css
git commit -m "fix(tasks): mobile filter bar two-row redesign (#420)

Row 1: lists dropdown (full width). Row 2: status chips + tag filter +
magnifying-glass icon that toggles the search input. Desktop layout
unchanged. Collapses the always-visible search that was breaking mobile.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 3: #403 — Chat auto-title from first user prompt (heuristic)

**Files:**

- Modify: `packages/chat/src/repository.ts` — add `updateThreadTitle(db, threadId, title)` method
- Modify: `packages/chat/src/live/persistence.ts` — add `deriveChatTitle(text)` helper, call `updateThreadTitle` on first turn

**Interfaces:**

- Produces: `ChatRepository.updateThreadTitle(scopedDb: DataContextDb, threadId: string, title: string): Promise<void>`
- Produces: `deriveChatTitle(text: string): string` (module-private in persistence.ts)
- The frontend (`chat-drawer.tsx`) already renders `thread.title` via `HistoryList` — no frontend change needed.

**Background:** `chat_threads.title` exists (migration 0014). When a thread opens, `DataContextChatPersistence.recordTurn` sets `DEFAULT_CONVERSATION_TITLE = "Conversation"`. On the very first turn (when `allMessages.length === 2` after the turn is recorded), we overwrite the title with the heuristic. The DB trigger allows the owner to update `title` (it only blocks non-owner workspace participants).

- [ ] **Step 1: Add `updateThreadTitle` to `ChatRepository`**

In `packages/chat/src/repository.ts`, add this method after `updateConversationSummary` (after line 208, before `touchThread`):

```ts
  async updateThreadTitle(
    scopedDb: DataContextDb,
    threadId: string,
    title: string
  ): Promise<void> {
    assertDataContextDb(scopedDb);
    await scopedDb.db
      .updateTable("app.chat_threads")
      .set({ title })
      .where("id", "=", threadId)
      .execute();
  }
```

- [ ] **Step 2: Add `deriveChatTitle` helper in `persistence.ts`**

In `packages/chat/src/live/persistence.ts`, add this private helper function at the bottom of the file (after `buildRollingSummary`):

```ts
/**
 * Derive a short descriptive title from the user's first chat prompt.
 * Heuristic only — no LLM call. Takes the first sentence (up to the first
 * sentence-ending punctuation or newline), strips trailing punctuation,
 * capitalizes, and clamps to 60 chars at a word boundary.
 */
export function deriveChatTitle(text: string): string {
  // Take the first sentence or line
  const firstLine = text.split(/[.!?\n]/)[0] ?? text;
  const trimmed = firstLine.trim();
  if (!trimmed) return text.trim().slice(0, 60) || "Conversation";

  // Strip trailing punctuation and trim
  const stripped = trimmed.replace(/[?.!,;:]+$/, "").trim();
  if (!stripped) return "Conversation";

  // Capitalize first character
  const capitalized = stripped.charAt(0).toUpperCase() + stripped.slice(1);

  // Clamp to 60 chars at a word boundary
  if (capitalized.length <= 60) return capitalized;
  const clipped = capitalized.slice(0, 60);
  const lastSpace = clipped.lastIndexOf(" ");
  return lastSpace > 20 ? clipped.slice(0, lastSpace) : clipped;
}
```

- [ ] **Step 3: Call `updateThreadTitle` on first turn in `recordTurn`**

In `packages/chat/src/live/persistence.ts`, inside `recordTurn` (the `async (scopedDb) =>` callback), add the title-update block after `this.chat.touchThread(...)` and BEFORE the rolling-summary block. The current code after `touchThread` (around line 108):

```ts
await this.chat.touchThread(scopedDb, thread.id);

// Update rolling summary when stored turns exceed the replay window.
const k = getReplayK();
const allMessages = await this.chat.listMessages(scopedDb, thread.id);
```

Replace with:

```ts
      await this.chat.touchThread(scopedDb, thread.id);

      // Update rolling summary when stored turns exceed the replay window.
      const k = getReplayK();
      const allMessages = await this.chat.listMessages(scopedDb, thread.id);
      const storedTurns = allMessages.filter(
        (m) => m.status === "stored" && (m.role === "user" || m.role === "assistant")
      );

      // First turn: derive and persist a descriptive title (#403).
      if (storedTurns.length === 2 && thread.title === DEFAULT_CONVERSATION_TITLE) {
        await this.chat.updateThreadTitle(scopedDb, thread.id, deriveChatTitle(userText));
      }

      if (storedTurns.length > k) {
```

Also remove the now-duplicate `storedTurns` derivation in the original rolling-summary block that follows. The original block after the rolling-summary `if` guard was:

```ts
const storedTurns = allMessages.filter(
  (m) => m.status === "stored" && (m.role === "user" || m.role === "assistant")
);
if (storedTurns.length > k) {
  const oldTurns = storedTurns.slice(0, -k).map((m) => ({
    role: m.role as "user" | "assistant",
    content: m.body
  }));
  await this.chat.updateConversationSummary(scopedDb, thread.id, buildRollingSummary(oldTurns));
}
```

After your edit, the whole block should look like this (replace the entire section from `await this.chat.touchThread` through the `if (this.boss && result && !thread.incognito)` guard):

```ts
      await this.chat.touchThread(scopedDb, thread.id);

      const k = getReplayK();
      const allMessages = await this.chat.listMessages(scopedDb, thread.id);
      const storedTurns = allMessages.filter(
        (m) => m.status === "stored" && (m.role === "user" || m.role === "assistant")
      );

      // First turn: derive and persist a descriptive title (#403).
      if (storedTurns.length === 2 && thread.title === DEFAULT_CONVERSATION_TITLE) {
        await this.chat.updateThreadTitle(scopedDb, thread.id, deriveChatTitle(userText));
      }

      // Update rolling summary when stored turns exceed the replay window.
      if (storedTurns.length > k) {
        const oldTurns = storedTurns.slice(0, -k).map((m) => ({
          role: m.role as "user" | "assistant",
          content: m.body
        }));
        await this.chat.updateConversationSummary(
          scopedDb,
          thread.id,
          buildRollingSummary(oldTurns)
        );
      }

      if (this.boss && result && !thread.incognito) {
```

- [ ] **Step 4: Run typecheck**

```bash
pnpm typecheck
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add packages/chat/src/repository.ts \
        packages/chat/src/live/persistence.ts
git commit -m "feat(chat): auto-title from first user prompt — heuristic truncation (#403)

On the first recorded turn of a new conversation, derive a short title
from the user's opening message (first sentence, strip trailing punct,
capitalize, clamp 60 chars at word boundary). No LLM call. The chat
history sidebar already renders thread.title, so no frontend change needed.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**

| Requirement                                                   | Task                           |
| ------------------------------------------------------------- | ------------------------------ |
| #419: typed name pre-populates Details modal                  | Task 1 ✓                       |
| #420: Row 1 = lists dropdown full-width                       | Task 2 ✓                       |
| #420: Row 2 = status chips + tag filter + 🔍                  | Task 2 ✓                       |
| #420: 🔍 toggles hidden search                                | Task 2 ✓                       |
| #420: desktop not regressed                                   | Task 2 ✓ (CSS gated to 560px)  |
| #420: Row 1 lists dropdown stays as dropdown (not scroll row) | Task 2 ✓                       |
| #403: heuristic title, no LLM                                 | Task 3 ✓                       |
| #403: title persisted to chat history                         | Task 3 ✓                       |
| #403: no migration needed                                     | ✓ (title col exists from 0014) |

**Placeholder scan:** No TBDs, no "add error handling", no "similar to Task N". All code blocks are complete.

**Type consistency:**

- `blankTaskDetailsForm(defaultListId?, defaultTitle?)` introduced in Task 1 step 1, used in Task 1 step 2. ✓
- `onDetails: (name: string) => void` introduced in Task 1 step 3, wired in Task 1 step 4. ✓
- `updateThreadTitle(scopedDb, threadId, title)` introduced in Task 3 step 1, called in Task 3 step 3. ✓
- `deriveChatTitle(text)` introduced in Task 3 step 2, called in Task 3 step 3. ✓
