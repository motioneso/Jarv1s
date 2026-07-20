# Handoff — #1187 QA-RED remediation (2026-07-20)

**Branch/worktree:** this worktree, `feedback/1187-module-library-clean`. PR #1202 (OPEN, do not merge).
**Trigger:** Opus security QA VERDICT RED on PR #1202 (comment 2026-07-20T00:44:22Z).

## QA findings (from PR #1202 comment)

- **BLOCKING:** `tests/uat/specs/job-search-install.uat.spec.ts` not updated for the #1187 UI
  rewrite — asserts strings the PR removed (`"Available modules"`, `[aria-label="Module
  registry"]`, `<li>` rows, button name `"Install"`). Live install→restart→enabled path unproven.
- non-blocking: capability disclosure drops host/tool/table specificity — **reserved for Ben's
  sign-off, do NOT touch.**
- non-blocking: `describeCapabilityConsequences` only unit-tested as pure fn; render test seeds
  `capabilities: null` everywhere, dialog copy never proven to render.

## Root cause / new DOM shape (verified by reading source)

`apps/web/src/settings/settings-instance-modules-pane.tsx` + `settings-module-registry-section.tsx`
now render everything via `Group`/`Row` from `packages/settings-ui/src/index.tsx`:
- `Group` → `<section class="pane__card">` with title in `.pane__cardtitle` (plain div, no heading
  role) — text "Module library" (not "Available modules").
- `Row` → `<div class="set-row">`, name in `.set-row__name`. **No `<li>`, no
  `aria-label="Module registry"` wrapper anymore.**
- `libraryAction()` (settings-module-registry-section.tsx:76) drives the primary control:
  - `not-installed` → `{kind:"install", label:"Download and install"}` — **no "Not installed" text
    renders anywhere for this state** (old test's `getByText("Not installed")` will never match).
  - `pending-restart` → `{kind:"none", label:"Downloaded — restart to apply"}` (unchanged text).
  - `installed-enabled` + `latestVersion != null` (registry-known, Job Search's case) →
    `{kind:"switch", label:"Disable"}` — **no "Installed" text renders**, only the Switch shows.
    Old test's post-restart `getByText("Installed")` will never match either.
- Install-confirm dialog: title `Install ${row.name}?` and confirm button `"Download"` are
  **unchanged** — only the row's primary button label changed (`"Install"` → `"Download and
  install"`).

## Fix plan

1. **UAT spec** (`tests/uat/specs/job-search-install.uat.spec.ts`):
   - `getByText("Available modules")` → `getByText("Module library")`.
   - Replace `[aria-label="Module registry"]` + `.locator("li", {hasText:...})` with:
     `page.locator(".pane__card", { hasText: "Module library" })` scoped, then
     `.locator(".set-row", { hasText: "Job Search" })` as `jobSearchRow`.
   - Drop the pre-install `getByText("Not installed")` assertion (never renders now) — go straight
     to `jobSearchRow.getByRole("button", { name: "Download and install" }).click()`.
   - Dialog title/confirm button assertions unchanged (`"Install Job Search?"`, `"Download"`).
   - `"Downloaded — restart to apply"` assertion unchanged.
   - Drop post-restart `getByText("Installed")` assertion (never renders for switch-kind action) —
     rely on the existing `enableSwitch` `toBeChecked()` assertion as the real proof, plus assert
     the `"Download and install"` button is gone (`not.toBeVisible()`) as the state-changed signal.
   - Do NOT weaken the live-path nature — keep real restart, no mocking.

2. **Render-path test for capability consequence copy** (non-blocking QA item, but required by
   Ben's remediation instructions):
   - `apps/web/src/settings/settings-feedback.tsx`'s `FeedbackProvider` has no way to seed the
     confirm dialog open for a `renderToString`-only test (repo has **no jsdom / no
     @testing-library/react** anywhere — confirmed via `pnpm-lock.yaml` — pattern already
     established in `tests/unit/settings-appearance-pane.test.tsx` line ~65 comment). Do NOT add
     jsdom as a new dependency — out of scope / repo convention avoids it.
   - Minimal fix: add an optional, backward-compatible `initialDialog?: ConfirmOptions | null` prop
     to `FeedbackProvider` (defaults preserve current behavior exactly), used only to seed
     `useState` for tests.
   - New/extended test (in `tests/unit/settings-instance-modules-pane-render.test.tsx` or a new
     sibling file): render `<FeedbackProvider initialDialog={{title, description:
     describeCapabilityConsequences(rowWithNonNullCapabilities), confirmLabel:"Download",
     onConfirm(){}}}>` and assert the consequence sentence (e.g. "This module can connect to the
     internet") appears in the rendered `.jds-dialog__desc` markup. This proves the actual dialog
     markup renders non-null-capability copy, closing the gap without needing click simulation.

3. Re-fetch/rebase onto `origin/main` (target `97b5bd52`).
4. Run pre-push trio (`format:check`, `lint`, `typecheck`) + the fixed UAT spec (must go green) +
   `pnpm test:unit` for the new/changed test files.
5. Push to PR #1202. **Never merge.** Report verified evidence back to the user.

## Explicit non-goals (per remediation instructions)

- Do NOT alter capability disclosure semantics (host/tool/table specificity) — Opus's non-blocking
  finding on that is reserved for Ben's explicit security sign-off, not this remediation.
- No merge, under any circumstance.

## Guardrails carried over from prior relays (still true)

- Never `git add -A` — explicit paths only.
- `.claude/context-meter.log` is hook-managed — don't stage/commit it.
- Isolate any DB-touching gate step via a throwaway `JARVIS_PGDATABASE`, never the shared `jarv1s` DB.
