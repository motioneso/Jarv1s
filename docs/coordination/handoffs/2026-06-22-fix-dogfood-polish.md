# Build Handoff — fix-dogfood-polish (#419 + #420 + #403)

**Spec (approved):** Issue bodies are the specs. Read all three:
- `gh issue view 419` — task creation: name persists to Details modal
- `gh issue view 420` — mobile task filter bar redesign
- `gh issue view 403` — chat auto-title from first user prompt
**GitHub issues:** #419, #420, #403
**Risk tier:** `routine` (pure UI changes + one chat route addition; no auth/schema/secret surface;
no migration; auto-merge after QA agent gives green)
**Worktree:** /home/ben/Jarv1s/.claude/worktrees/fix-dogfood-polish
**Branch:** fix-dogfood-polish (off origin/main @ 25c7bd5)
**Build skill path (absolute):** /home/ben/Jarv1s/.claude/skills/coordinated-build/SKILL.md
**Coordinator label:** `Coordinator` (UNIQUE — escalate via `herdr-pane-message`; verify
`herdr pane list` shows EXACTLY ONE pane with this label before every message)
**Coordinator session id:** `0ee17fb4-0c20-488e-be1e-146d2f9acacb`
**Relay threshold:** ~⅔–¾ context consumed OR after plan-approval + ~5–8 tasks OR on any
compaction summary in your own context.

## Start

1. Confirm `coordinated-build` skill is accessible; if not, open the absolute Build skill path
   above and follow it directly.
2. `[ -d node_modules ] || pnpm install`
3. Read all three issues IN FULL: `gh issue view 419 && gh issue view 420 && gh issue view 403`
4. Invoke **`coordinated-build`**: write plan → escalate to coordinator for approval → build → wrap up.

## Your compact (non-negotiable)

- Work only in this worktree/branch. Stage only your files by name (never `git add -A`).
- Plan approval comes from the coordinator (label `Coordinator`), not a human.
- Escalate immediately on: plan ready, blocker, design fork outside these issues, done.
- Never touch the project board, milestones, or merge.
- Caveman mode for all coordinator messages: terse, no filler.

## Build Brief (coordinator-distilled — grounded on `25c7bd5`)

Three dogfood Polish items — treat each as an independent commit.

---

### #419 — Task creation: name persists to Details modal

**Problem:** When adding a new task inline, the user types the name, then hits "Details" to open
the task modal — but the typed name is NOT passed into the modal. The modal opens with a blank name
field.

**Fix:** Pass the in-progress task name from the inline creation field into the Details modal state
when "Details" is clicked. The name should pre-populate the modal's name field so the user can
continue editing without retyping.

**Files to look at:**
- `apps/web/src/tasks/` — find the inline task-creation component and the Details modal.
- Look for how the "Details" click opens the modal and where modal initial state comes from.
- Thread the `name` value through: `onDetailsClick(name)` → modal `defaultValues` or equivalent.

**Behavior:** After fix, typing "Buy milk" in inline creation → click Details → modal opens with
"Buy milk" pre-populated in the name field.

---

### #420 — Mobile task filter bar redesign

**Problem:** The mobile task filter area has layout/sizing issues. The current layout has a full
search input inline with other controls, which doesn't fit on mobile.

**New layout (Ben's design — do not deviate):**
- **Row 1 (top, full width):** The **existing lists dropdown** (already a dropdown — keep it as a
  dropdown selector; do NOT make it a scroll row or change the dropdown behavior).
- **Row 2 (second row):** All/Open/Done/Archived status chips + tag search + a **magnifying glass
  icon (🔍)** that toggles visibility of the text search input.

The full text search input should be **hidden by default** on mobile; tapping the 🔍 reveals it
(expands inline or shows below Row 2). This saves row space when search isn't needed.

**Files to look at:**
- `apps/web/src/tasks/` — find the mobile filter bar component.
- Look for the existing filter/search layout and the lists dropdown.
- Implement responsive: Row 1 (dropdown) + Row 2 (chips + 🔍). The 🔍 toggles a text input.

---

### #403 — Chat auto-title from first user prompt

**Problem:** Chats in history have no title — they show a timestamp or generic label. Hard to
browse history.

**Fix:** When a chat starts (first user turn), derive a short title from the first user prompt and
persist it as the chat's title.

**Design decision (coordinator-resolved):** Use a **heuristic truncation approach** (zero LLM cost,
no provider dependency). Smart-truncate the first user prompt to a ~40–60 char label: take the
first sentence or phrase, strip question marks / trailing punctuation, capitalize. Do NOT use an
LLM call for this — the LLM-generated title option is deferred to a later pass (avoids provider
dependency, keeps it fast and free).

**Files to look at:**
- `packages/chat/` — find where turns are recorded/persisted and where chat metadata is stored.
- Look for `chat_sessions` or equivalent table (check migration files for schema).
- Add a `title` field if not present (or use an existing metadata field). On first turn recorded,
  derive title from `text` using heuristic truncation, set it.
- `apps/web/src/` — find the chat history list and wire in the title display.

**Behavior:** After first user message in a new chat, the chat history sidebar shows a short
descriptive title instead of a timestamp/generic label.

---

**Reuse:**
- Existing task inline-creation pattern (look for similar "quick-add" components in `apps/web/src/tasks/`).
- Existing chat turn persistence in `packages/chat/` — extend, don't fork.
- For #420 mobile filter: look at the existing filter component — identify the responsive breakpoint
  and the existing structure before redesigning.

**Landmines:**
- For #403: if `chat_sessions` table has no `title` column, this requires a migration. If a
  migration is needed, escalate `[DESIGN-FORK]` to coordinator immediately (Wave 2 migration slots
  are pre-assigned; adding one here needs coordination). First check if a `metadata` jsonb column
  already exists that could hold the title without a migration.
- For #420: the lists dropdown (Row 1) **stays as a dropdown**. Do not convert it to a scroll row.
  Ben was explicit about this.
- File-size gate applies to all `apps/web/src/` files too. If the filter component file is near
  1000 lines, decompose first.
- `@jarv1s/shared` is Vite-bundled (browser bundle) — no `node:*` imports allowed there.

**Decided — do not re-litigate:**
- #403 title: heuristic truncation only (no LLM). LLM titles are deferred.
- #420 Row 1: existing dropdown (not scroll row).
- #420 search: hidden behind 🔍; tap to reveal.

**Open for you to decide:**
- Heuristic truncation rules for #403 (word boundary at N chars, strip trailing punct, capitalize
  first word — keep it simple).
- Whether #403 title is stored in an existing `metadata` column or requires a new migration
  (investigate before deciding; escalate if migration needed).
- Mobile breakpoint threshold for #420 redesign (reuse the existing breakpoint used elsewhere in
  tasks).

**Collision notes:**
- Wave 1, no migration (pending #403 investigation — escalate if needed).
- Other Wave 1 items don't touch `apps/web/src/tasks/` or `apps/web/src/chat/` history components.
- `packages/chat/` for #403 title storage: confirm this doesn't conflict with #318 (which touches
  `live-routes.ts` and `chat-session-manager.ts` — different files from the persistence layer).

**Verification target:**
- #419: typing name → Details modal opens with name pre-populated.
- #420: mobile filter shows Row1 (dropdown) + Row2 (status chips + 🔍); search reveals on tap.
- #403: after first chat turn, chat history entry shows heuristic title.
- `pnpm test:e2e` passes (mocks REST; no PG needed for frontend-only changes).
- `pnpm verify:foundation` passes.
