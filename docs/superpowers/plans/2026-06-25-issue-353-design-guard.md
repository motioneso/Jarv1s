# Issue 353 Design Guard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development. Coordinated-build exception: do not dispatch subagents or use executing-plans in this repo; execute task-by-task after Coordinator approval. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Jarv1s design-system drift harder to introduce by documenting the authored UI rules and adding a failing gate for raw CSS colors outside `tokens.css`.

**Architecture:** Keep this preventative and small. Reuse the existing `tsx` script pattern instead of adding stylelint. `apps/web/src/styles/tokens.css` remains the only CSS color-literal source; six existing CSS files get token replacements so the new check starts green.

**Tech Stack:** TypeScript script run by `tsx`, CSS custom properties, root `package.json` verification scripts.

---

## Verified Current State

- `apps/web/src/styles/tokens.css` already declares itself the only CSS file in `apps/web` allowed to contain hex / `rgb()` literals.
- No `check:design-tokens` script exists in root `package.json`.
- After stripping CSS comments, current raw color literals outside `tokens.css` are in:
  `settings-panes-2.css`, `settings-panes-3.css`, `wellness-1.css`, `wellness-2.css`,
  `onboarding.css`, and `tasks.css`.
- `docs/DEVELOPMENT_STANDARDS.md` does not yet document the type-pairing rule, `jds-*`
  contribution rule, or empty/loading-state rule.
- `CLAUDE.md` Scope Guardrails does not yet mention the design-system guardrail.

## Files

- Create: `scripts/check-design-tokens.ts`
- Modify: `package.json`
- Modify: `docs/DEVELOPMENT_STANDARDS.md`
- Modify: `CLAUDE.md`
- Modify: `apps/web/src/styles/tokens.css`
- Modify: `apps/web/src/styles/settings-panes-2.css`
- Modify: `apps/web/src/styles/settings-panes-3.css`
- Modify: `apps/web/src/styles/wellness-1.css`
- Modify: `apps/web/src/styles/wellness-2.css`
- Modify: `apps/web/src/styles/onboarding.css`
- Modify: `apps/web/src/tasks/tasks.css`

### Task 1: Add Design-Token Check

**Files:**

- Create: `scripts/check-design-tokens.ts`
- Modify: `package.json`

- [x] **Step 1: Write failing check script**

Create `scripts/check-design-tokens.ts`:

```ts
import { readdir, readFile } from "node:fs/promises";
import { extname, join, relative } from "node:path";

const rootDirectory = process.cwd();
const cssRoot = join(rootDirectory, "apps/web/src");
const allowedColorLiteralFile = "apps/web/src/styles/tokens.css";
const colorLiteralPattern = /#[0-9a-fA-F]{3,8}\b|\brgba?\([^)]*\)/g;
const stockIndigoPattern = /#(?:4f46e5|6366f1|4338ca|3730a3|818cf8|c7d2fe)\b/i;

interface Violation {
  readonly path: string;
  readonly line: number;
  readonly text: string;
}

const violations: Violation[] = [];

for await (const filePath of walk(cssRoot)) {
  if (extname(filePath) !== ".css") {
    continue;
  }

  const relativePath = normalizePath(relative(rootDirectory, filePath));
  const contents = await readFile(filePath, "utf8");
  const searchable = stripCssComments(contents);
  const lines = searchable.split(/\r\n|\r|\n/);
  const originalLines = contents.split(/\r\n|\r|\n/);

  lines.forEach((line, index) => {
    const hasForbiddenColorLiteral =
      relativePath !== allowedColorLiteralFile && colorLiteralPattern.test(line);
    colorLiteralPattern.lastIndex = 0;

    if (hasForbiddenColorLiteral || stockIndigoPattern.test(line)) {
      violations.push({
        path: relativePath,
        line: index + 1,
        text: originalLines[index]?.trim() ?? ""
      });
    }
  });
}

if (violations.length > 0) {
  console.error("Design-token violations:");
  console.error(`- CSS color literals must live in ${allowedColorLiteralFile}.`);
  console.error("- Stock-indigo literals are not part of the Jarv1s palette.");
  for (const violation of violations) {
    console.error(`- ${violation.path}:${violation.line} ${violation.text}`);
  }
  process.exitCode = 1;
} else {
  console.log("No design-token violations found.");
}

async function* walk(directory: string): AsyncGenerator<string> {
  const entries = await readdir(directory, { withFileTypes: true });

  for (const entry of entries) {
    const entryPath = join(directory, entry.name);

    if (entry.isDirectory()) {
      yield* walk(entryPath);
      continue;
    }

    if (entry.isFile()) {
      yield entryPath;
    }
  }
}

function stripCssComments(contents: string): string {
  return contents.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\r\n]/g, " "));
}

function normalizePath(path: string): string {
  return path.replaceAll("\\", "/");
}
```

- [x] **Step 2: Run it to verify it fails on current branch**

Run:

```bash
pnpm tsx scripts/check-design-tokens.ts
```

Expected: FAIL, listing the verified raw CSS color literals outside `tokens.css`.

- [x] **Step 3: Wire script into root verification**

Add scripts in `package.json`:

```json
"check:design-tokens": "tsx scripts/check-design-tokens.ts",
"verify:foundation": "pnpm lint && pnpm format:check && pnpm check:file-size && pnpm check:design-tokens && pnpm typecheck && pnpm test:unit && pnpm db:migrate && pnpm test:integration"
```

- [x] **Step 4: Run failing package script**

Run:

```bash
pnpm check:design-tokens
```

Expected: FAIL until Task 2 replaces existing raw CSS colors.

### Task 2: Move Existing CSS Color Literals To Tokens

**Files:**

- Modify: `apps/web/src/styles/tokens.css`
- Modify: `apps/web/src/styles/settings-panes-2.css`
- Modify: `apps/web/src/styles/settings-panes-3.css`
- Modify: `apps/web/src/styles/wellness-1.css`
- Modify: `apps/web/src/styles/wellness-2.css`
- Modify: `apps/web/src/styles/onboarding.css`
- Modify: `apps/web/src/tasks/tasks.css`

- [x] **Step 1: Add only missing semantic tokens**

Add these tokens to `:root` in `apps/web/src/styles/tokens.css` near the related bridge tokens:

```css
--scrim-strong: rgb(0 0 0 / 45%);
--surface-hover: rgba(38, 34, 28, 0.06);
--shadow-pop: 0 20px 50px rgb(0 0 0 / 25%);
--hairline-contrast: rgba(0, 0, 0, 0.06);
--white-translucent: rgba(255, 255, 255, 0.18);
--provenance-said: var(--pine-ink);
--provenance-said-bg: var(--pine-soft);
--provenance-said-border: var(--pine-soft-2);
--provenance-inferred: var(--amber-ink);
--provenance-inferred-bg: var(--amber-soft);
--provenance-inferred-border: var(--amber-soft-2);
--provenance-confirmed: var(--steel-ink);
--provenance-confirmed-bg: var(--steel-soft);
--provenance-confirmed-border: var(--steel);
```

- [x] **Step 2: Replace existing CSS literals with tokens**

Use these direct replacements:

```css
rgba(40, 92, 66, 0.16) -> var(--accent-soft-border-weak)
rgb(0 0 0 / 45%) -> var(--scrim-strong)
0 20px 50px rgb(0 0 0 / 25%) -> var(--shadow-pop)
rgba(0, 0, 0, 0.03) -> var(--shadow-xs)
rgba(0, 0, 0, 0.06) -> var(--hairline-contrast)
rgba(255, 255, 255, 0.18) -> var(--white-translucent)
#fff -> var(--white)
#1a73e8 -> var(--accent)
#14532d -> var(--provenance-said)
#dcfce7 -> var(--provenance-said-bg)
#86efac -> var(--provenance-said-border)
#713f12 -> var(--provenance-inferred)
#fef3c7 -> var(--provenance-inferred-bg)
#facc15 -> var(--provenance-inferred-border)
#1e3a8a -> var(--provenance-confirmed)
#dbeafe -> var(--provenance-confirmed-bg)
#93c5fd -> var(--provenance-confirmed-border)
```

- [x] **Step 3: Run design-token check**

Run:

```bash
pnpm check:design-tokens
```

Expected: PASS with `No design-token violations found.`

### Task 3: Document Design Guardrails

**Files:**

- Modify: `docs/DEVELOPMENT_STANDARDS.md`
- Modify: `CLAUDE.md`

- [x] **Step 1: Add design-system section to development standards**

Add to `docs/DEVELOPMENT_STANDARDS.md` after `Required Checks`:

```markdown
## Design System Guardrails

Jarv1s UI must keep the authored design-system shape:

- serif headings via Newsreader, mono eyebrow/section labels via IBM Plex Mono, sans body via Hanken Grotesk
- palette, radius, shadow, focus, and state colors come from `apps/web/src/styles/tokens.css`
- extend existing `jds-*` and local UI primitives; do not drop in unstyled shadcn, Radix, or Tailwind-default primitives
- new empty and loading states must match existing authored states: warm surface, sentence-case copy, tokenized color, and no generic placeholder cards

Run `pnpm check:design-tokens` before shipping frontend CSS changes.
```

- [x] **Step 2: Add concise CLAUDE scope guardrail**

Add under `CLAUDE.md` Scope Guardrails:

```markdown
- **Preserve the authored design system.** Keep serif headings / mono eyebrows / sans body,
  extend `jds-*` and local primitives, and keep raw CSS colors in
  `apps/web/src/styles/tokens.css` only. Empty/loading states must use existing authored patterns.
```

### Task 4: Verify

**Files:**

- No new files.

- [x] **Step 1: Run focused checks**

Run:

```bash
pnpm check:design-tokens
pnpm check:file-size
```

Expected: both PASS.

- [x] **Step 2: Run verification floor**

Run:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
```

Expected: all PASS.

- [ ] **Step 3: Commit scoped files only**

Run:

```bash
git add package.json scripts/check-design-tokens.ts docs/DEVELOPMENT_STANDARDS.md CLAUDE.md apps/web/src/styles/tokens.css apps/web/src/styles/settings-panes-2.css apps/web/src/styles/settings-panes-3.css apps/web/src/styles/wellness-1.css apps/web/src/styles/wellness-2.css apps/web/src/styles/onboarding.css apps/web/src/tasks/tasks.css docs/superpowers/plans/2026-06-25-issue-353-design-guard.md
git commit -m "chore: guard design tokens"
```

Commit message must include:

```text
Co-Authored-By: Claude <noreply@anthropic.com>
```

## Self-Review

- Spec coverage: type rule, tokens source of truth, raw color guard, verification wiring,
  contribution note, and empty/loading checklist are covered.
- Placeholder scan: no TBD/TODO/fill-later steps.
- Type consistency: script name is `check-design-tokens.ts`; package script is
  `check:design-tokens`; verification calls same script.
