# Build Handoff — a11y-contrast-polish (#354)

**Spec (approved):** GitHub issue #354 (this handoff scopes the batch slice)
**GitHub issue:** #354
**Risk tier:** `routine`
**Worktree:** ~/Jarv1s/.claude/worktrees/a11y-contrast-polish
**Branch:** a11y-contrast-polish (off origin/main @ 92b16488)
**Coordinator label:** `Coordinator` (UNIQUE — escalate via `herdr pane run <pane> "<msg>"`)
**Coordinator session id:** `ses_111f40556ffeVraVZu2X8ScJ`
**Run manifest:** docs/coordination/2026-06-24-chat-stability-batch.md

## ⚠️ CI STATUS (temporary — read first)

GitHub Actions is **disabled — billing paused**. **Local gate is the source of truth.** Do NOT run `gh pr checks`. Run `pnpm format:check && pnpm lint && pnpm typecheck` + relevant tests before push; record exit codes.

## Your task (#354 — scoped: contrast fixes + 2 hardening items)

The full #354 issue lists 6 contrast fixes + 6 hardening items. **This lane does the contrast fixes (minus the ones already done) + 2 hardening items.** Defer the rest.

### Contrast fixes (tokens.css + settings-panes-2.css)

**#1 (dark primary button 4.21:1) — ALREADY DONE.** Line 296 `--btn-primary-bg: var(--pine-active)` with explicit #354 comment. Do NOT redo. Skip.

**#2 (dark accent text 3.93:1) — PARTIAL, finish it.** `--accent-fg` (`#6bc093`, 7.93:1) exists at `tokens.css:292` and is used in some components. Audit remaining usages where `--pine` (or `--accent`) is used as **readable text color** (not as fills/backgrounds) and route them through `--accent-fg`. Grep `apps/web/src/` for `color: var(--pine)` / `color: var(--accent)` that aren't on buttons/badges. Keep `--pine` for fills/large only.

**#3 (`--text-faint` / `--ink-4` as readable color, 2.17:1 light / 2.99:1 dark) — NOT DONE, biggest hit.** `apps/web/src/styles/settings-panes-2.css` uses `color: var(--text-faint)` as readable color in ~8 places (L33, L95, L508, more). Fix: lighten `--text-faint` (or introduce a `--text-muted` that's AA-compliant) to ~`#9a958a` (light) / ~`#736e60` (dark), OR restrict `--text-faint` to purely decorative use and swap readable usages to a compliant token. Read the audit report at `~/jarvis-design-review/REPORT-a11y-contrast.md` if it exists for the exact recommendation.

**#4 (dark error text `--red` 4.47:1) — NOT DONE.** `tokens.css:282` dark `--red` is `#cf5f51`. Nudge to ~`#d4685a` (~4.6:1), OR restrict to large/icon only. Prefer the nudge (single-line token edit).

**#5 (light `--focus-ring` 0.32 alpha) — NOT DONE for light.** `tokens.css:~108` light `--focus-ring` is `rgba(47, 135, 94, 0.32)`. Dark is already 0.45 (L293). Bump light to ~0.45 to match (`tokens.css:~108`). Single-line edit.

**#6 (light `--amber` drift text 4.10:1) — NOT DONE.** Convention: use `--amber-strong` (5.66:1) for normal-size drift text; reserve `--amber` for large/UI. Grep for drift-text usages of `--amber` and route to `--amber-strong`. `--amber-ink` (8.5:1) for chip text.

### Hardening items (2 of 6)

**H1 — aria-live `assertive` region for errors.** Today all live regions are `polite` (`chat-drawer.tsx:252,356`, `notifications-page.tsx:76`, `settings-feedback.tsx:84`). Errors (save failures, connector failures) queue behind chat output. Add a `role="alert"` / `aria-live="assertive"` region for true errors. Precedent: `onboarding/cli-auth-step.tsx:303` already uses `role="alert"`. Add a dedicated assertive error region in `settings-feedback.tsx` (or wherever save/connector errors surface) alongside the existing polite toast region.

**H2 — 44px touch hit area on `--sm` controls.** `.jds-btn--sm` (`components-core.css:45`) and `.jds-iconbtn--sm` (`components-core.css:158`) are 30px. Add a `@media (pointer: coarse)` block that gives them a 44px touch hit area (can be via padding/min-size — doesn't have to change visual size, just the tappable region).

## Files

- `apps/web/src/styles/tokens.css` — fixes #2 (dark block accent), #4 (dark red), #5 (light focus-ring)
- `apps/web/src/styles/settings-panes-2.css` — fix #3 (text-faint readability)
- `apps/web/src/styles/components-core.css` — H2 (touch hit area @media block)
- `apps/web/src/settings/settings-feedback.tsx` — H1 (assertive error region)
- Possibly other component files for #2 accent-text routing (grep-driven)

## Verify (your gate)

```bash
pnpm typecheck
pnpm exec prettier --check <your files>
pnpm exec eslint <your files>
pnpm exec vitest run tests/unit/ 2>/dev/null | tail -5   # confirm no token-import regressions
pnpm build:web   # confirm the CSS still compiles
```
No new tests required for token edits (they're CSS values). For H1/H2, if there's an existing a11y/component test, extend it; otherwise manual verification (build passes, UI renders).

Record exit codes.

## Build workflow

1. **Orient.** `cd ~/Jarv1s/.claude/worktrees/a11y-contrast-polish`. Confirm branch = `a11y-contrast-polish`. `pnpm install` if node_modules missing.
2. **Read CLAUDE.md Hard Invariants.** None directly apply to CSS tokens, but the design-system-erosion guard (#353, companion issue) matters — don't introduce NEW tokens when an existing one fits; prefer routing through existing tokens.
3. **Plan is pre-approved** (the scoped items above). Execute directly. Do NOT write a separate plan doc.
4. **Order:** contrast fixes first (#2 → #3 → #4 → #5 → #6, skip #1), then H1, then H2. Commit per logical group.
5. **Commit:**
   ```
   fix(a11y): contrast token polish (#2-#6) + assertive error region + touch hit area

   - #2 route dark accent text through --accent-fg (7.93:1)
   - #3 lighten --text-faint for readable use (was 2.17:1 light / 2.99:1 dark)
   - #4 nudge dark --red to #d4685a (~4.6:1)
   - #5 bump light --focus-ring alpha 0.32 → 0.45
   - #6 use --amber-strong for normal-size drift text
   - H1 add aria-live=assertive error region (errors no longer queue behind chat)
   - H2 44px touch hit area on --sm controls via @media (pointer: coarse)

   (#1 dark primary button was already fixed at tokens.css:296.)

   Closes #354
   ```
   - `git add` only your files. NEVER `git add -A` — another session may have uncommitted work.
6. **Pre-push trio + rebase.**
7. Push, open PR, report to coordinator (caveman-terse).
8. **Stop.**

## Your compact (non-negotiable)

- Work only in your worktree on `a11y-contrast-polish`.
- CI down — local gate truth; record exit codes.
- Plan pre-approved — execute directly.
- Escalate blockers to `Coordinator` label via `herdr pane run`.
- Never touch board/milestones/issues/merge.
- Caveman for coordinator messages; conventional for commits/PR/code.
- Pre-push trio before every push.
- **Scope discipline:** touch ONLY the files listed. Do NOT stage prettier-reformatted files outside your lane.

## Collision notes

- You touch `apps/web/src/styles/tokens.css`, `settings-panes-2.css`, `components-core.css`, `settings-feedback.tsx` (+ grep-driven accent-text routing in components).
- `chat-heartbeat-stop` lane touches `packages/chat/` + `apps/web/src/chat/` — NO overlap with your styles/settings files.
- No migrations, no schema, no auth.
