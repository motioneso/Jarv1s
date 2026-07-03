# #685 Neutral Jarvis Glyph Implementation Plan

> **For agentic workers:** Coordinated build — execute inline, task by task (execution
> sub-skills are disabled in this repo). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace every app-UI `Sparkles`/sparkle-starburst AI marker with one neutral Jarvis
glyph treatment, and add a static check so `Sparkles` cannot return.

**Architecture:** Two-tier glyph treatment per the audit recommendation: the shell `BrandMark`
(extracted to its own file, size-parameterized) where the glyph stands for Jarvis-the-product
by name (chat drawer identity slots, onboarding "Ask Jarvis"); lucide `GitCommitHorizontal`
(already the app's Jarvis-held/generated marker in tasks/calendar/today) everywhere else.
Hand-rolled icon files (wellness, sports) get the same commit-glyph geometry inline, matching
their local no-lucide idiom. An ESLint `no-restricted-imports` rule bans `Sparkles` from
`lucide-react` in `apps/web`.

**Tech Stack:** React + lucide-react, ESLint flat config, no new dependencies.

## Global Constraints

- No new icon system or module-specific dialect (issue #685 acceptance).
- Preserve authored design system; raw colors only in `apps/web/src/styles/tokens.css`.
- `pnpm format:check && pnpm lint && pnpm typecheck` green per commit.
- Stage only each task's files; never `git add .`.
- Commit trailer: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

## Verified premises (grounded on branch `coord/685-neutral-jarvis-glyph`)

- 33 `Sparkles` mentions across 9 files (counts: chat-drawer 6, settings-ai-admin-pane 10,
  settings-ai-pane 5, settings-page 3, wellness-insights 3, tasks-page 2, onboarding-wizard 2,
  calendar-peek 2). Sports `SparkIcon` starburst at `sports-parts.tsx:61`.
- Backend wellness insights emit only `Activity|CloudRain|Sun|NotebookPen|Pill`
  (`packages/wellness/src/insights.ts`) — the `Sparkles` key in `INSIGHT_ICONS` is dead, and
  the lookup already falls back (`INSIGHT_ICONS[it.icon] ?? <ActivityIcon />`).
- `app-shell.tsx` imports `chat-drawer.tsx`, so BrandMark must move to its own file to be
  shared without an import cycle.
- No `✨` emoji tells in `apps/web/src`.

## Glyph decision map

| Site                                                                                                | Replacement                                                    |
| --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| chat-drawer header mark (16), waiting avatar (14), assistant msg avatar (14), empty-state mark (22) | `BrandMark` (identity — "Jarvis" is named beside it)           |
| onboarding "Ask Jarvis" button (16)                                                                 | `BrandMark`                                                    |
| chat-drawer ActivityPeek "Behind the scenes" (13)                                                   | `GitCommitHorizontal`                                          |
| settings-page nav icon ×2, settings-ai-pane ×5, settings-ai-admin-pane ×10                          | `GitCommitHorizontal`                                          |
| tasks-page interpret-search button (14)                                                             | `GitCommitHorizontal`                                          |
| calendar-peek held-block note (14)                                                                  | `GitCommitHorizontal` (file already uses it for blocks)        |
| wellness-insights bespoke `SparklesIcon` (header + dead map key)                                    | inline commit-glyph `JarvisMarkIcon`; drop dead `Sparkles` key |
| sports-parts bespoke `SparkIcon` starburst                                                          | rename to `JarvisMarkIcon`, commit-glyph geometry inline       |

---

### Task 1: Extract BrandMark to its own file with a size prop

**Files:**

- Create: `apps/web/src/shell/brand-mark.tsx`
- Modify: `apps/web/src/shell/app-shell.tsx:75-88` (delete local `BrandMark`, import instead)

**Interfaces:**

- Produces: `export function BrandMark(props: { readonly size?: number }): ReactNode` —
  default size 24, renders the existing strata-bars SVG scaled by `size`.

- [ ] **Step 1: Create `brand-mark.tsx`**

```tsx
/** Strata mark — neutral bars in currentColor, the active stratum in Pine. */
export function BrandMark({ size = 24 }: { readonly size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" aria-hidden="true">
      <rect x="4" y="5.5" width="13" height="3" rx="1.5" fill="currentColor" />
      <rect x="4" y="10.5" width="16" height="3" rx="1.5" fill="var(--accent)" />
      <rect x="4" y="15.5" width="9" height="3" rx="1.5" fill="currentColor" />
    </svg>
  );
}
```

- [ ] **Step 2: In `app-shell.tsx`, delete the local `BrandMark` function (lines 74-88 incl.
      its doc comment) and add `import { BrandMark } from "./brand-mark";` with the other relative
      imports. The `<BrandMark />` call site at line 160 is unchanged.**

- [ ] **Step 3: Verify**

Run: `pnpm typecheck && pnpm lint`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/shell/brand-mark.tsx apps/web/src/shell/app-shell.tsx
git commit -m "refactor(shell): extract BrandMark to its own file with size prop (#685)"
```

### Task 2: Chat drawer + onboarding — identity slots to BrandMark, activity to GitCommitHorizontal

**Files:**

- Modify: `apps/web/src/chat/chat-drawer.tsx` (import + 6 sites)
- Modify: `apps/web/src/onboarding/onboarding-wizard.tsx` (import + 1 site)

**Interfaces:**

- Consumes: `BrandMark` from Task 1.

- [ ] **Step 1: chat-drawer.tsx** — remove `Sparkles` from the lucide import, add
      `GitCommitHorizontal` to it, and add `import { BrandMark } from "../shell/brand-mark";`.
      Replace:
  - `:309` header `<Sparkles size={16} …/>` → `<BrandMark size={16} />`
  - `:386` waiting avatar `<Sparkles size={14} …/>` → `<BrandMark size={14} />`
  - `:576` ActivityPeek `<Sparkles size={13} …/>` → `<GitCommitHorizontal size={13} aria-hidden="true" />`
  - `:635` msg avatar `<Sparkles size={14} …/>` → `<BrandMark size={14} />`
  - `:851` empty-state `<Sparkles size={22} …/>` → `<BrandMark size={22} />`

  (BrandMark is already `aria-hidden`; drop the redundant attribute at converted sites.)

- [ ] **Step 2: onboarding-wizard.tsx** — remove `Sparkles` from the lucide import; replace
      `:436` `<Sparkles size={16} aria-hidden="true" />` → `<BrandMark size={16} />` with the
      matching relative import `import { BrandMark } from "../shell/brand-mark";`.

- [ ] **Step 3: Verify**

Run: `grep -n "Sparkles" apps/web/src/chat/chat-drawer.tsx apps/web/src/onboarding/onboarding-wizard.tsx; pnpm typecheck && pnpm lint`
Expected: grep no matches; checks exit 0. Spot-check drawer renders via `pnpm --filter @jarv1s/web dev` only if styling doubt arises (avatar slots are `currentColor`-friendly).

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/chat/chat-drawer.tsx apps/web/src/onboarding/onboarding-wizard.tsx
git commit -m "fix(design): replace Sparkles AI marker in chat and onboarding (#685)"
```

### Task 3: Settings surfaces to GitCommitHorizontal

**Files:**

- Modify: `apps/web/src/settings/settings-page.tsx` (import + `:128`, `:142` nav `icon:` refs)
- Modify: `apps/web/src/settings/settings-ai-pane.tsx` (import + `:103`, `:192`, `:268`, `:336`)
- Modify: `apps/web/src/settings/settings-ai-admin-pane.tsx` (import + 10 sites: toasts `:189/:323/:609/:796/:825/:835`, notes `:203/:994`, header `:893`)

- [ ] **Step 1:** In each file swap `Sparkles` → `GitCommitHorizontal` in the lucide import
      and mechanically replace every `Sparkles` JSX/reference with `GitCommitHorizontal`,
      preserving each site's exact `size`/props. `settings-page.tsx` passes the component itself
      (`icon: Sparkles`) — becomes `icon: GitCommitHorizontal`.

- [ ] **Step 2: Verify**

Run: `grep -rn "Sparkles" apps/web/src/settings/; pnpm typecheck && pnpm lint`
Expected: grep no matches; checks exit 0.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/settings/settings-page.tsx apps/web/src/settings/settings-ai-pane.tsx apps/web/src/settings/settings-ai-admin-pane.tsx
git commit -m "fix(design): replace Sparkles AI marker in settings (#685)"
```

### Task 4: Tasks + calendar to GitCommitHorizontal

**Files:**

- Modify: `apps/web/src/tasks/tasks-page.tsx` (import + `:230` interpret button)
- Modify: `apps/web/src/calendar/calendar-peek.tsx` (import + `:93` held-block note)

- [ ] **Step 1:** Same mechanical swap. `calendar-peek.tsx` already imports
      `GitCommitHorizontal` — just drop `Sparkles` from the import and swap the `:93` site
      (`<Sparkles size={14} />` → `<GitCommitHorizontal size={14} />`). `tasks-page.tsx` swaps the
      import name and the `:230` site keeping `size={14} aria-hidden="true"`.

- [ ] **Step 2: Verify**

Run: `grep -n "Sparkles" apps/web/src/tasks/tasks-page.tsx apps/web/src/calendar/calendar-peek.tsx; pnpm typecheck && pnpm lint`
Expected: grep no matches; checks exit 0.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/tasks/tasks-page.tsx apps/web/src/calendar/calendar-peek.tsx
git commit -m "fix(design): replace Sparkles AI marker in tasks and calendar (#685)"
```

### Task 5: Bespoke sparkle icons — wellness + sports

**Files:**

- Modify: `apps/web/src/wellness/wellness-insights.tsx:5-24` (`SparklesIcon`), `:146` (dead map key), `:165` (header)
- Modify: `apps/web/src/sports/sports-parts.tsx:61-77` (`SparkIcon`), `:41` (RationaleChip call)

Both files are deliberately lucide-free (hand-rolled token-only SVGs) — keep that idiom and
inline the commit-glyph geometry.

- [ ] **Step 1: wellness-insights.tsx** — replace `SparklesIcon` with:

```tsx
function JarvisMarkIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M3 12h6" />
      <path d="M15 12h6" />
    </svg>
  );
}
```

Delete the dead `Sparkles: <SparklesIcon />` entry from `INSIGHT_ICONS` (backend never emits
it; lookup falls back to `ActivityIcon`). Header `:165` uses `<JarvisMarkIcon />`.

- [ ] **Step 2: sports-parts.tsx** — rename `SparkIcon` → `JarvisMarkIcon` (update the
      `RationaleChip` call at `:41` and any other references) and replace the starburst paths with
      the same commit-glyph geometry at the existing 13×13 size:

```tsx
export function JarvisMarkIcon(): ReactNode {
  return (
    <svg
      viewBox="0 0 24 24"
      width="13"
      height="13"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M3 12h6" />
      <path d="M15 12h6" />
    </svg>
  );
}
```

Check external consumers first: `grep -rn "SparkIcon" apps/web/src` — update every reference.

- [ ] **Step 3: Verify**

Run: `grep -rn "Sparkles\|SparkIcon\|starburst" apps/web/src; pnpm typecheck && pnpm lint`
Expected: grep no matches anywhere in `apps/web/src`; checks exit 0.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/wellness/wellness-insights.tsx apps/web/src/sports/sports-parts.tsx
git commit -m "fix(design): replace bespoke sparkle icons in wellness and sports (#685)"
```

### Task 6: Static check — ESLint ban on Sparkles imports

**Files:**

- Modify: `eslint.config.mjs` (the existing `apps/web/**/*.{js,ts,tsx}` block)

**Interfaces:**

- Produces: `pnpm lint` fails on any `import { Sparkles } from "lucide-react"` under `apps/web`.

- [ ] **Step 1:** Add to the `apps/web` files block a `rules` entry:

```js
rules: {
  "no-restricted-imports": [
    "error",
    {
      paths: [
        {
          name: "lucide-react",
          importNames: ["Sparkles"],
          message:
            "Sparkles is a banned AI-tell marker (#685). Use GitCommitHorizontal for Jarvis-held/generated items or BrandMark for product identity."
        }
      ]
    }
  ]
}
```

- [ ] **Step 2: Negative test (rule actually fires)**

```bash
printf 'import { Sparkles } from "lucide-react";\nexport const x = Sparkles;\n' > apps/web/src/sparkles-negative-test.tsx
pnpm lint; echo "exit=$?"   # expect nonzero, error mentions #685
rm apps/web/src/sparkles-negative-test.tsx
```

Expected: lint fails with the restricted-import message; after `rm`, `pnpm lint` exits 0.

- [ ] **Step 3: Commit**

```bash
git add eslint.config.mjs
git commit -m "chore(lint): ban lucide Sparkles imports in app UI (#685)"
```

### Task 7: Final verification + evidence

- [ ] **Step 1: Before/after proof** — record output of:

```bash
git log --oneline origin/main..HEAD
grep -rn "Sparkles\|SparkIcon" apps/web/src || echo "CLEAN"
```

- [ ] **Step 2: Full pre-push trio + rebase**

```bash
pnpm format:check && pnpm lint && pnpm typecheck; echo "exit=$?"
git fetch origin main && git rebase origin/main
```

- [ ] **Step 3:** Invoke `coordinated-wrap-up` (gate, push, PR, report exit codes + proof to Coordinator).

## Exit-criteria coverage

- "No imported lucide `Sparkles` in app UI" → Tasks 2-4, proven Task 7.
- "No bespoke sparkle/starburst marker" → Task 5.
- "Consistent glyphs, no per-module dialect" → decision map above (two sanctioned treatments only).
- "Static check fails if Sparkles returns" → Task 6 with negative test.
