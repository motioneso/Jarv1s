# Relay: #985 true YOLO build — Task 4, handing to Codex

Plan: `docs/superpowers/plans/2026-07-12-true-yolo-approval-hardening.md` (Task 4, Steps 1-11).
Branch: `ux/985-yolo-approvals`. Worktree: unchanged from build-relay doc.

**Reason for handoff: mid-turn user policy override (Codex-only continuation) landed
during Task 4. This session stopped at the next safe checkpoint, verified, and committed.
Do not spawn a Claude successor here — Codex picks this up.**

## State: clean tree, Task 4 partially committed

Commit `fd73a7bb` on this branch has: shared hook + 3 of 5 call-site conversions, all
gates green (typecheck, lint, prettier, file-size, unit tests 11/11). Tasks 1-3 were
already committed earlier (see build-relay doc history on this branch for those SHAs).
`git status --short` at handoff time: only `.claude/context-meter.log` dirty (untouched,
not part of this work — leave as-is or let Codex's own session update it).

## Done (commit `fd73a7bb`)

- `apps/web/src/shared/use-dismissable-menu.ts` (NEW) — `useDismissableMenu<T>({ open, onClose })`
  hook: pointerdown+Escape document listeners while open, calls `onClose`. Does **not** own
  focus-return — caller's `onClose` must do `triggerRef.current?.focus()` itself.
- `tests/unit/use-dismissable-menu.test.ts` (NEW) — 4 tests on the exported `isOutsideTarget` helper.
- Call sites converted (details/summary or scrim-div → hook + `useState` open flag +
  `triggerRef`/menu `ref`): `chat-model-pill.tsx` + `.css`, `briefing-feedback-menu.tsx` +
  `kit-today.css`, `settings-admin-panes.tsx` `PersonRow` + `settings-panes.css`.
- CSS pattern applied at each: `[open] .foo__trigger` → `.foo__trigger[aria-expanded="true"]`,
  `::-webkit-details-marker`/`list-style: none` deleted, scrim-div rules deleted where a
  scrim div was removed from the component.

## Remaining — plan Steps 7, 8 (2 of 5 call sites)

- `apps/web/src/tasks/tasks-page.tsx` — `ListFilterMenu`. **Multi-select — item clicks must
  NOT call `setOpen(false)`.** Only outside-click/Escape close it.
- `apps/web/src/tasks/task-details-sections.tsx` — `TaskStatusControl`. Single-select,
  already closes on item pick via existing `setMenu(false)` in each item's `onClick` — just
  swap the manual `ref` + `mousedown`-only `useEffect` for the hook.

Then plan Steps 9-11: full `pnpm verify:foundation`, manual dev-QA pass (focus-return on
close, Escape, outside-click, each converted menu), and the Task 4 commit/PR wrap-up.

## Plan-doc bugs found and fixed this session (do not reintroduce)

The plan's own illustrative sketches for Task 4 had 3 self-contradictions, each confirmed
by actually running the code, not by inspection:

1. `isOutsideTarget(null, ...)` — plan's Step 2 sketch returns `false` for a null container,
   but its own Step 3 test expects `true`. Fixed impl to return `true` (no attached
   container = treat as outside, close the menu).
2. `target instanceof Node` throws `ReferenceError: Node is not defined` in this repo's
   Vitest (root `vitest.config.ts` runs `test.environment: "node"`, no jsdom global `Node`).
   Fixed via duck-typed `typeof node.nodeType === "number"` check instead.
3. Hook's declared return type `{ ref: RefObject<T> }` doesn't typecheck — `useRef<T>(null)`
   actually returns `RefObject<T | null>` (real `tsc` `TS2322`). Return type fixed to
   `RefObject<T | null>`.

Task 3 (already committed, for context) had 2 similar plan-sketch bugs — see git log on
this branch (`ebfeda5e`) if relevant; not reachable from Task 4 work.

## Still explicitly out of scope (needs a separate lock-release, not part of Task 4)

`apps/web/src/chat/chat-drawer.tsx` `activityVerb()` renders a genuine YOLO auto-grant
(`outcome: "allowed"`) as **"Denied"** — an active falsehood. This is a known bug, not
Task 4's job, and the file is otherwise lock-held per earlier coordination. Flag to UX
Coordinator; do not fix opportunistically while in this file for other reasons.

## Verification commands used this session (from `apps/web/`)

```
pnpm exec tsc --noEmit -p .
pnpm exec eslint <files>
pnpm exec vitest run tests/unit/use-dismissable-menu.test.ts tests/unit/action-request-card-preview.test.tsx
pnpm exec prettier --check <files>
```
(from repo root) `pnpm check:file-size`. Full `pnpm verify:foundation` was **not** run this
session — that's part of the remaining Step 9 work.
