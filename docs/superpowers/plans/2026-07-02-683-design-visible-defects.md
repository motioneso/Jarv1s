# #683 Design Visible Defects Implementation Plan

> **For agentic workers:** Executed inline by the coordinated-build agent (superpowers execution
> skills are disabled in this repo). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the five narrow visible defects from design audit B (H1/H6/H7/H8/H9): select
styling/affordances, drift red→amber, failed-delete toast tone, Today kicker type role.

**Architecture:** No new machinery. The canonical select wrapper already exists —
`Select` in `packages/settings-ui/src/index.tsx:146` (renders `.jds-selectwrap` +
`.jds-select` + chevron). All fixes are swaps to existing primitives plus three small CSS
edits. One focused Playwright assertion covers the task-dialog selects.

**Tech Stack:** React 19, `@jarv1s/settings-ui`, Playwright e2e (mock REST, no PG).

## Global Constraints

- Scope ONLY the six spec items; no broad settings redesign, no repo-wide formatting.
- Preserve authored design system: serif headings / mono eyebrows / sans body; raw colors
  only in `tokens.css` (no new colors needed here).
- Anti-shame invariant (documented in `apps/web/src/ui/badge.tsx`): human drift renders
  amber, never error-red.
- Stage only each task's files; commit per task with `Co-Authored-By: Claude` trailer.
- Do not touch `docs/coordination/`.

## Premise verification (grounded on branch `coord/683-design-visible-defects`, base `d074936c`)

All six spec premises verified current on this branch:

1. `.rt__pick .jds-select` mono override — `apps/web/src/styles/settings-panes-2.css:586-591` ✓
2. Bare activity select — `apps/web/src/settings/settings-activity-pane.tsx:116-127` ✓
3. Admin model-pin select uses `jds-input` — `apps/web/src/settings/settings-admin-panes.tsx:258-271` ✓
4. Bare task-dialog selects — `apps/web/src/tasks/task-details-dialog.tsx:308,322,379` ✓
5. Critical drift badge red — `apps/web/src/today/proactive-cards.tsx:18` ✓
6. Failed-delete generic toast has no tone (defaults `ready`/success) —
   `apps/web/src/settings/delete-account.tsx:68`; default tone confirmed in
   `apps/web/src/settings/settings-feedback.tsx:89` ✓
7. `.jds-brief__kicker` is `--font-sans` — `apps/web/src/styles/components-jarvis.css:413-420`;
   mono eyebrow role confirmed by peers (`.tk-modal__eyebrow`, `.onb-eyebrow`, `.cmd-eyebrow`,
   `.wl-eyebrow` — all `--font-mono` + uppercase tracking) ✓

Notes / small decisions for approval:

- **No new component.** Spec says "shared select wrapper/component" — it exists
  (`Select` in `@jarv1s/settings-ui`, already used by `settings-ai-admin-pane.tsx`). Settings
  files import via the `./settings-ui` shim; `task-details-dialog.tsx` imports
  `@jarv1s/settings-ui` directly (declared dependency of apps/web). CSS already anticipates
  wrapper use at both sites (`.tk-modal .jds-selectwrap` in `kit-tasks-modal.css:163`,
  `.fld__row > .jds-selectwrap` in `settings.css:289`).
- **Mono override removal** drops both `font-family: var(--font-mono)` and the paired
  `font-size: 12.5px` so the tier select inherits canonical `.jds-select` typography
  (`--font-sans` / `--text-md`); keeps `width: 100%`.
- **Toast tone choice:** generic failed-delete branch gets `tone: "error"` (true failure of a
  destructive action → red, `role=alert` assertive region). The two 409 guidance branches
  already use `drift` and stay as-is.
- **Drift badge:** `critical: "jds-badge--amber"` — critical and high both render amber; spec
  only demands not-red, and `.jds-badge--amber` exists (`components-core.css:263`).
- **Tests:** apps/web has no unit-test infra; smallest focused test is a Playwright assertion
  in `tests/e2e/tasks.spec.ts` (mock REST, no PG — safe per multi-agent contention memory).
  Settings panes + CSS items are covered by typecheck/lint + existing e2e remaining green;
  no screenshot run (capture harness is heavy, spec asks for smallest available).

---

### Task 1: Wrap task-dialog selects (List, Priority, Repeats) + e2e assertion

**Files:**

- Modify: `apps/web/src/tasks/task-details-dialog.tsx:308,322,379`
- Test: `tests/e2e/tasks.spec.ts`

**Interfaces:**

- Consumes: `Select` from `@jarv1s/settings-ui` — `(props: SelectHTMLAttributes<HTMLSelectElement>)`,
  renders `<span class="jds-selectwrap"><select class="jds-select">…</select><chev/></span>`.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Write the failing e2e test**

Append to `tests/e2e/tasks.spec.ts`:

```ts
test("task dialog selects use the canonical select wrapper", async ({ page }) => {
  await page.goto("/tasks");
  await page.getByRole("button", { name: "Open File taxes" }).first().click();
  await expect(page.getByRole("dialog")).toBeVisible();
  // List, Priority, and Repeats selects each render inside .jds-selectwrap
  // (visible chevron affordance) instead of as bare <select> elements.
  await expect(page.locator(".jds-dialog .jds-selectwrap select.jds-select")).toHaveCount(3);
  await expect(page.locator(".jds-dialog select:not(.jds-select)")).toHaveCount(0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec playwright test tasks -g "canonical select wrapper"`
Expected: FAIL — selectwrap count 0 (selects are bare).

- [ ] **Step 3: Swap the three bare selects for `Select`**

Add import:

```tsx
import { Select } from "@jarv1s/settings-ui";
```

Replace each of the three `<select className="jds-select" …>…</select>` blocks (List at ~308,
Priority at ~322, Repeats at ~379) with `Select`, dropping the `className` and keeping every
other prop and the option children verbatim, e.g. List:

```tsx
<Select
  value={form.listId}
  onChange={(event) => setForm((f) => ({ ...f, listId: event.target.value }))}
>
  {props.lists.map((list) => (
    <option key={list.id} value={list.id}>
      {list.name}
    </option>
  ))}
</Select>
```

(Repeats keeps its `as Repeat` cast in onChange; Priority keeps its `<option value="">No
priority</option>` first child.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec playwright test tasks`
Expected: full tasks spec PASS (new test + no regressions).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/tasks/task-details-dialog.tsx tests/e2e/tasks.spec.ts
git commit -m "fix(tasks): use canonical Select wrapper in task details dialog (#683)"
```

### Task 2: Wrap Settings selects (activity pane, admin model pin)

**Files:**

- Modify: `apps/web/src/settings/settings-activity-pane.tsx:116-127`
- Modify: `apps/web/src/settings/settings-admin-panes.tsx:258-271`

**Interfaces:**

- Consumes: `Select` from `./settings-ui` (same signature as Task 1).
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: settings-activity-pane.tsx — swap bare select**

Add `Select` to the existing `./settings-ui` import (or add the import if the file has none).
Replace lines 116–127:

```tsx
<Select
  aria-label="Filter by action family"
  value={familyFilter}
  onChange={(e) => setFamilyFilter(e.target.value)}
>
  <option value="">All actions</option>
  {families.map((f) => (
    <option key={f} value={f}>
      {f}
    </option>
  ))}
</Select>
```

(Adds an aria-label while touching it — the bare select had no accessible name; flag in PR.)

- [ ] **Step 2: settings-admin-panes.tsx — swap jds-input select**

Add `Select` to the existing `./settings-ui` import. Replace the
`<select className="jds-input" …>` block at 258–271 with:

```tsx
<Select
  aria-label={`Pinned AI provider for ${props.user.name || props.user.email}`}
  value={value}
  disabled={disabled}
  onChange={(event) => mutation.mutate(event.currentTarget.value || null)}
>
  <option value="">Clear pin</option>
  {models.map((model) => (
    <option key={model.id} value={model.id}>
      {model.displayName}
    </option>
  ))}
</Select>
```

- [ ] **Step 3: Verify**

Run: `pnpm --filter @jarv1s/web typecheck && pnpm exec playwright test app-shell`
Expected: typecheck exit 0; existing settings e2e PASS unchanged.
(If the web package name differs, use `pnpm typecheck` from repo root.)

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/settings/settings-activity-pane.tsx apps/web/src/settings/settings-admin-panes.tsx
git commit -m "fix(settings): canonical Select wrapper for activity and admin model-pin selects (#683)"
```

### Task 3: Remove mono override on tier picker selects

**Files:**

- Modify: `apps/web/src/styles/settings-panes-2.css:586-591`

- [ ] **Step 1: Edit CSS**

Replace:

```css
.rt__pick .jds-select,
.rt__pick select {
  width: 100%;
  font-family: var(--font-mono);
  font-size: 12.5px;
}
```

with:

```css
.rt__pick .jds-select,
.rt__pick select {
  width: 100%;
}
```

- [ ] **Step 2: Verify + commit**

Run: `pnpm format:check` (touched file only needs to stay clean).

```bash
git add apps/web/src/styles/settings-panes-2.css
git commit -m "fix(settings): drop mono typography override on tier picker selects (#683)"
```

### Task 4: Critical drift badge red → amber

**Files:**

- Modify: `apps/web/src/today/proactive-cards.tsx:18`

- [ ] **Step 1: Edit BAND_CLASS**

```ts
const BAND_CLASS: Record<string, string> = {
  critical: "jds-badge--amber",
  high: "jds-badge--amber",
  normal: "jds-badge--steel",
  low: "jds-badge--neutral"
};
```

- [ ] **Step 2: Verify + commit**

Run: `pnpm --filter @jarv1s/web typecheck` → exit 0.

```bash
git add apps/web/src/today/proactive-cards.tsx
git commit -m "fix(today): render critical drift amber, not error-red (#683)"
```

### Task 5: Failed account-deletion toast gets error tone

**Files:**

- Modify: `apps/web/src/settings/delete-account.tsx:68`

- [ ] **Step 1: Edit the generic onError branch**

```tsx
} else {
  toast(readError(error), { tone: "error", icon: <TriangleAlert size={17} /> });
}
```

- [ ] **Step 2: Verify + commit**

Run: `pnpm --filter @jarv1s/web typecheck` → exit 0.

```bash
git add apps/web/src/settings/delete-account.tsx
git commit -m "fix(settings): failed account deletion toast uses error tone (#683)"
```

### Task 6: Today kicker → mono eyebrow role

**Files:**

- Modify: `apps/web/src/styles/components-jarvis.css:413-420`

- [ ] **Step 1: Edit CSS**

Replace the `font-family` line only:

```css
.jds-brief__kicker {
  font-family: var(--font-mono);
  font-size: var(--text-2xs);
  font-weight: var(--weight-semibold);
  letter-spacing: var(--tracking-caps);
  text-transform: uppercase;
  color: var(--text-subtle);
}
```

- [ ] **Step 2: Verify + commit**

Run: `pnpm format:check` → exit 0.

```bash
git add apps/web/src/styles/components-jarvis.css
git commit -m "fix(today): brief kicker uses mono eyebrow type role (#683)"
```

### Task 7: Full gate + wrap-up

- [ ] Run: `pnpm format:check && pnpm lint && pnpm typecheck` — all exit 0.
- [ ] Run: `pnpm exec playwright test` (frontend e2e, mock REST — skip pg integration suite;
      frontend-only change).
- [ ] `git fetch origin main && git rebase origin/main`.
- [ ] Invoke `coordinated-wrap-up`: push, open PR to main, report PR URL + exit codes to
      Coordinator.

## Self-review

- Spec coverage: all six scope bullets map to Tasks 1–6; acceptance bullets covered (affordance
  → Tasks 1–2; no forced mono → Task 3; amber drift → Task 4; not success-styled → Task 5;
  mono kicker → Task 6; smallest tests → Task 1 e2e + gates).
- No placeholders; all code shown verbatim against current branch state.
- Type consistency: `Select` signature verified at `packages/settings-ui/src/index.tsx:146`.
