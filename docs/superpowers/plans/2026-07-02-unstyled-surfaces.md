# Unstyled Surfaces Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: coordinated build flow overrides normal execution. Do not implement until Coordinator approves this plan. After approval, use superpowers:test-driven-development task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Style only the #686 raw surfaces: chat source chips/tray, chat memory panel, onboarding OAuth code paste input, error boundary fallback, and settings activity pane.

**Architecture:** Reuse existing JDS tokens and local CSS families. Add missing CSS where components already emit stable classes; remove settings/error-boundary inline styling only where it is the defect.

**Tech Stack:** React 19, Vite, Vitest SSR render tests, CSS token layer in `apps/web/src/styles/tokens.css`.

---

## Premise Verification

- `gh issue view 686 --json ...` returns body `<<ccr:eccc1309e9d9,string,1.0KB>>`; local handoff plus design audit identify accepted surfaces.
- `apps/web/src/chat/answer-provenance.tsx` still renders `.source-chip` / `.source-tray`; no CSS rules exist for these classes.
- `apps/web/src/chat/memory-panel.tsx` still renders `.memory-panel` classes; no CSS rules exist.
- `apps/web/src/onboarding/cli-auth-step.tsx` still renders `.onb-auth__paste` / `.onb-auth__code`; no CSS rules exist for those two.
- `apps/web/src/shell/error-boundary.tsx` still uses inline `system-ui`, raw `#555`, `#ccc`, `#fff`, and pixel styling.
- `apps/web/src/settings/settings-activity-pane.tsx` still duplicates activity row/filter layout with inline styles. Existing `.audfilter`, `.aud`, `.aud__row`, `.aud__when`, `.aud__empty` styles exist in `settings-panes-2.css`.

## Files

- Modify: `apps/web/src/chat/answer-provenance.tsx` only if markup needs tiny class hook.
- Modify: `apps/web/src/chat/memory-panel.tsx` only if markup needs tiny class hook.
- Modify: `apps/web/src/onboarding/cli-auth-step.tsx` only if test needs stronger class assertion.
- Modify: `apps/web/src/settings/settings-activity-pane.tsx` to reuse `.aud*` classes and remove inline row/filter/list styles.
- Modify: `apps/web/src/shell/error-boundary.tsx` to move fallback styles to tokenized classes.
- Modify: `apps/web/src/styles/kit-chat.css` for chat source and memory panel CSS.
- Modify: `apps/web/src/styles/onboarding-design.css` for OAuth paste/input CSS.
- Modify: `apps/web/src/styles/settings-panes-2.css` only if `.aud*` needs one small class for this pane.
- Modify: `tests/unit/error-boundary.test.tsx`.
- Modify: `tests/unit/onboarding-provider-connect-step.test.tsx`.
- Create: `tests/unit/unstyled-surfaces-css.test.ts`.

## Task 1: CSS Coverage Test

- [ ] Add `tests/unit/unstyled-surfaces-css.test.ts` that reads CSS files and asserts required class selectors exist:

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = [
  "apps/web/src/styles/kit-chat.css",
  "apps/web/src/styles/onboarding-design.css",
  "apps/web/src/styles/settings-panes-2.css"
]
  .map((path) => readFileSync(path, "utf8"))
  .join("\n");

describe("#686 unstyled surface CSS", () => {
  it("styles chat source, memory, onboarding auth, and activity classes", () => {
    for (const selector of [
      ".source-chips",
      ".source-chip",
      ".source-tray",
      ".memory-panel",
      ".memory-toggle",
      ".onb-auth__paste",
      ".onb-auth__code",
      ".audfilter",
      ".aud__row"
    ]) {
      expect(css).toContain(selector);
    }
  });
});
```

- [ ] Run `pnpm vitest run tests/unit/unstyled-surfaces-css.test.ts`; expected fail on missing chat/memory/onboarding selectors.
- [ ] Commit after Task 1 is green with CSS tasks or keep unstaged until first green commit if repo expects no red commits.

## Task 2: Chat Source + Memory CSS

- [ ] Add tokenized CSS to `apps/web/src/styles/kit-chat.css` for:
  - `.source-chips`, `.source-chips__row`
  - `.source-chip`, `.source-chip__label`, `:hover`, `:focus-visible`, `[aria-expanded="true"]`
  - `.source-tray`, `.source-tray__close`, `__kind`, `__label`, `__title`, `__state`, `__confidence`, `__time`, `__snippet`
  - `.memory-panel`, `.memory-panel-header`, `.panel-heading`, `.memory-settings`, `.memory-toggle`, `.memory-facts`
- [ ] Use only existing tokens: `--surface`, `--surface-2`, `--border`, `--border-strong`, `--text`, `--text-muted`, `--text-subtle`, `--accent`, `--accent-soft`, `--focus-ring`, `--shadow-sm`, `--radius-*`, `--font-*`, `--space-*`.
- [ ] Run `pnpm vitest run tests/unit/unstyled-surfaces-css.test.ts`; expected pass for chat/memory selectors.

## Task 3: Onboarding OAuth Paste Styling

- [ ] Add CSS to `apps/web/src/styles/onboarding-design.css`:
  - `.onb-auth__paste` as responsive inline flex row with gap.
  - `.onb-auth__code` as tokenized input with sans font, border, focus ring, disabled-safe sizing.
  - mobile wrap rule if needed under existing onboarding media area.
- [ ] Extend `tests/unit/onboarding-provider-connect-step.test.tsx` token-input test:

```ts
expect(html).toContain('class="onb-auth__paste"');
expect(html).toContain('class="onb-auth__code"');
```

- [ ] Run `pnpm vitest run tests/unit/onboarding-provider-connect-step.test.tsx tests/unit/unstyled-surfaces-css.test.ts`; expected pass.

## Task 4: Error Boundary Token Classes

- [ ] Replace inline styles in `apps/web/src/shell/error-boundary.tsx` with class names:
  - `jds-crash`
  - `jds-crash__title`
  - `jds-crash__copy`
  - existing `jds-btn jds-btn--primary`
- [ ] Add `.jds-crash*` CSS to `apps/web/src/styles/components-core.css` or `components-jarvis.css`. Use CSS variables only; no raw colors, no `system-ui`.
- [ ] Extend `tests/unit/error-boundary.test.tsx` fallback test:

```ts
expect(html).toContain('class="jds-crash"');
expect(html).toContain("jds-btn");
expect(html).not.toContain("system-ui");
expect(html).not.toContain("#555");
```

- [ ] Run `pnpm vitest run tests/unit/error-boundary.test.tsx`; expected pass.

## Task 5: Settings Activity Pane Inline Cleanup

- [ ] Update `apps/web/src/settings/settings-activity-pane.tsx`:
  - Remove inline style from filter wrapper; keep `className="audfilter"`.
  - Wrap result list with `<ul className="aud">`.
  - Use `<li className="aud__row">`.
  - Use `.aud__what`, `.aud__cat`, `.aud__when`; keep existing JDS badges.
  - Keep `Select` from `settings-ui.tsx`.
- [ ] Add only minimal `.aud__meta` / `.aud__badges` CSS if existing `.aud*` classes cannot express layout.
- [ ] Run `pnpm typecheck`; expected pass.

## Task 6: Final Checks + Commit

- [ ] Run targeted checks:

```bash
pnpm vitest run tests/unit/unstyled-surfaces-css.test.ts tests/unit/onboarding-provider-connect-step.test.tsx tests/unit/error-boundary.test.tsx
pnpm check:design-tokens
pnpm --filter @jarv1s/web typecheck
```

- [ ] Run required gate:

```bash
pnpm format:check && pnpm lint && pnpm typecheck
```

- [ ] Commit only touched files:

```bash
git add apps/web/src/chat/answer-provenance.tsx apps/web/src/chat/memory-panel.tsx apps/web/src/onboarding/cli-auth-step.tsx apps/web/src/settings/settings-activity-pane.tsx apps/web/src/shell/error-boundary.tsx apps/web/src/styles/kit-chat.css apps/web/src/styles/onboarding-design.css apps/web/src/styles/settings-panes-2.css apps/web/src/styles/components-core.css tests/unit/error-boundary.test.tsx tests/unit/onboarding-provider-connect-step.test.tsx tests/unit/unstyled-surfaces-css.test.ts
git commit -m "fix(web): style audit b raw surfaces"
```

## Self-Review

- Scope maps to handoff guardrails only; no unrelated audit items included.
- No new component framework or dependency.
- Error boundary keeps fallback self-contained and tokenized.
- Tests are cheap SSR/CSS assertions; no screenshot harness added.
