# Chat Feedback Layout Stability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep assistant chat response text width stable when feedback status controls show `Saved` and `Undo`.

**Architecture:** The current assistant row is one flex line: avatar, body, freshness footer, and feedback menu are siblings, so inline status content can take horizontal space from the body. Keep the existing feedback behavior and move assistant feedback/status to its own full-width row aligned under the message body using CSS grid. User-message feedback keeps the current compact inline layout.

**Tech Stack:** React 19, CSS in `apps/web/src/styles/kit-chat.css`, Vitest for a focused static CSS regression check.

---

## Verified Premises

- Grounded on `origin/main@ec6b8569`.
- `apps/web/src/chat/chat-drawer.tsx` renders assistant rows as `.chatd-msg` with `.chatd-bubble`, optional `ChatFreshnessFooter`, then `ChatFeedbackMenu`.
- `ChatFeedbackMenu` renders `Saved` and `Undo` inside `.feedback-menu__status`; feedback persistence and undo semantics are already correct and stay untouched.
- `apps/web/src/styles/kit-chat.css` currently makes `.chatd-msg` a flex row and `.feedback-menu` an inline-flex sibling, so feedback/status width can squeeze the body column.

## File Structure

- Modify `apps/web/src/styles/kit-chat.css`: change assistant message row layout from flex row to two-column grid, place assistant feedback on a second row under the body, and preserve user-message alignment.
- Create `tests/unit/chat-feedback-layout-css.test.ts`: assert the CSS contract that prevents `.feedback-menu__status` from sharing the assistant body row.
- No JSX or API changes planned.

### Task 1: Lock Layout Contract With Focused Test

**Files:**

- Create: `tests/unit/chat-feedback-layout-css.test.ts`

- [ ] **Step 1: Write failing CSS contract test**

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync("apps/web/src/styles/kit-chat.css", "utf8");

function rule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`${escaped}\\s*\\{(?<body>[^}]*)\\}`, "m"));
  return match?.groups?.body ?? "";
}

describe("chat feedback layout CSS", () => {
  it("keeps assistant feedback out of the body text column", () => {
    expect(rule(".chatd-msg")).toContain("grid-template-columns: 26px minmax(0, 1fr)");
    expect(rule(".chatd-msg .feedback-menu")).toContain("grid-column: 2");
    expect(rule(".chatd-msg .feedback-menu")).toContain("max-width: 100%");
    expect(rule(".feedback-menu__status")).toContain("white-space: nowrap");
  });

  it("keeps user feedback aligned with the outgoing bubble", () => {
    expect(rule(".chatd-msg--me")).toContain("display: flex");
    expect(rule(".chatd-msg--me .feedback-menu")).toContain("align-self: flex-end");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/chat-feedback-layout-css.test.ts`

Expected: FAIL because `.chatd-msg` still uses flex and `.chatd-msg .feedback-menu` has no grid placement.

- [ ] **Step 3: Leave the failing test unstaged**

Do not commit yet. The next task makes this test pass, then commits the green change.

### Task 2: Move Assistant Feedback To Its Own Row

**Files:**

- Modify: `apps/web/src/styles/kit-chat.css:135-184`

- [ ] **Step 1: Replace assistant row flex layout with grid**

Change the affected CSS to:

```css
.chatd-msg {
  display: grid;
  grid-template-columns: 26px minmax(0, 1fr);
  column-gap: 10px;
  row-gap: 6px;
  margin-bottom: 16px;
}
.chatd-msg__av {
  grid-column: 1;
  grid-row: 1;
  width: 26px;
  height: 26px;
  border-radius: 8px;
  flex: none;
  background: var(--pine-soft);
  color: var(--accent-fg);
  display: flex;
  align-items: center;
  justify-content: center;
}
.chatd-bubble {
  grid-column: 2;
  grid-row: 1;
  font-family: var(--font-serif);
  font-size: 15px;
  line-height: 1.55;
  color: var(--text);
  padding-top: 2px;
  min-width: 0; /* #395 - allow flex child to shrink so wide content (tables, code) stays in-column */
}
.chatd-freshness {
  grid-column: 2;
}
.chatd-msg .feedback-menu {
  grid-column: 2;
  max-width: 100%;
}
```

- [ ] **Step 2: Restore user-message flex behavior**

Keep outgoing messages compact with:

```css
.chatd-msg--me {
  display: flex;
  justify-content: flex-end;
}
```

- [ ] **Step 3: Run focused test**

Run: `pnpm vitest run tests/unit/chat-feedback-layout-css.test.ts`

Expected: PASS.

- [ ] **Step 4: Run focused UI regression**

Run: `pnpm exec playwright test tests/e2e/chat-drawer.spec.ts`

Expected: PASS. If local services required by the existing e2e setup are unavailable, record the exact failure and continue with unit plus static verification.

- [ ] **Step 5: Commit implementation**

```bash
git add apps/web/src/styles/kit-chat.css tests/unit/chat-feedback-layout-css.test.ts
git commit -m "fix: stabilize chat feedback layout"
```

### Task 3: Final Verification

**Files:**

- No file edits.

- [ ] **Step 1: Run required focused test**

Run: `pnpm vitest run tests/unit/chat-feedback-layout-css.test.ts`

Expected: PASS.

- [ ] **Step 2: Run required gate**

Run: `pnpm format:check && pnpm lint && pnpm typecheck`

Expected: PASS.

- [ ] **Step 3: Run pre-push freshness check**

Run: `git fetch origin main && git rebase origin/main`

Expected: branch remains cleanly based on `origin/main`.

## Self-Review

- Spec coverage: body width stability is covered by grid row separation; mobile accessibility is preserved by full-width second-row controls and existing button semantics; persistence semantics stay untouched.
- Placeholder scan: no TBD/TODO/fill-in steps.
- Type consistency: no TypeScript API changes.
