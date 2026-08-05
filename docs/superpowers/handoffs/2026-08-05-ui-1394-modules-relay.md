# #1394 relay — 2026-08-05

Branch `feat/1394-ui-modules`, worktree `/home/ben/Jarv1s/.claude/worktrees/ui-1394-modules`.
Coordinator is agent "DESIGN ELEMENTS" (herdr pane — resolve fresh via `herdr pane list` every
time, pane ids are ephemeral, do not reuse one from this doc).

Read this in full before touching anything.

## Current state

HEAD is `bc54cff5`. Tree is clean apart from `.claude/context-meter.log`. Six commits, in order:

1. `ee4f19c6` — Task 1 Finance. **HELD, do not touch further.**
   `tsc -p external-modules/finance` is red (classic-JSX tsconfig pulls in `@jarv1s/ui`'s
   modern-runtime `.tsx` transitively) — escalated to Ben, not builder's to fix. Verified correct
   via the real `esbuild build:external:finance` path instead (exits 0).
2. `fd7ebae4` — News CSS split: `news-1.css`/`news-2.css`/`news-settings.css` → layout stays,
   visual half moved to new `packages/ui/src/styles/components-news.css`, `nw-*` names unchanged.
3. `ef46266e` — Sports CSS split: all 6 `sports-*.css` files → layout stays, visual halves moved
   to new `components-sports-1.css`/`components-sports-2.css`, `sp-*` names unchanged, zero TSX
   touched.
4. `3780446c` — wires the 3 new `@import` lines into `packages/ui/src/styles.css`, after the
   wellness pair.
5. `3b960e35` — News settings TSX: all 13 raw `jds-btn` elements across
   `add-source.tsx`/`describe-topics.tsx`/`index.tsx` → `<Button>` from `@jarv1s/module-web-sdk`.
6. `bc54cff5` — fixes 3 stale assertions in `tests/unit/news-settings-pane.test.tsx` broken by
   commit 5 (asserted raw pre-migration class strings, including two classes — `nw-set__addbtn`,
   `nw-set__exadd` — that were never defined in any CSS file, at base or now; not a CSS deletion,
   say it that way in the PR body). 26/26 green after; full news+sports unit suite (5 files, 101
   tests) also clean. `npx tsc --noEmit -p .` clean, 0 errors.

Coordinator has independently verified and closed Task 2 (sports+news): split check already run
— **news 115 selectors / 0 shared properties, sports 308 / 0, 423 total, 0 banned declarations
remain in the 9 layout files. Do not re-run it, put these numbers straight in the PR body.**

The one design call this branch made (primary variant on the exclusion-form "Add" button, base
was bare unmodified `.jds-btn`) is made, justified in commit 6's message, and coordinator-accepted
— nothing further needed there.

**The rebase onto origin/main (`a027995a`, #1393) has NOT started.**

## Your task: do the rebase, four constraints, verbatim from the coordinator

- Merge or rebase onto origin/main at `a027995a`. `packages/ui/src/styles.css` will conflict
  against #1395's added `@import` lines — resolve it as a UNION, keep both sides' imports, never
  take one side wholesale.
- Recompute both guard absolutes by counting the lists after the merge, not by adding the
  coordinator's arithmetic. Their 23 CSS / 59 TSX is a prediction, not a measurement. Merged main
  is 14/56 and this branch's deltas are +9/+3. If the count comes out anything other than 23/59,
  the count wins and you tell them.
- Prove the guard registration bit red-before/green-after. Both guards catch `{ continue }` on an
  unreadable path, so a typo'd entry reads GREEN.
- Do NOT open the PR. Do NOT merge. Do NOT close the issue. The PR is held for the coordinator's
  explicit go-ahead.

## Standing hard constraints (unchanged all session)

No edits to `check-ui-classes.ts` / `check-design-tokens.ts` / `check-migrated-sections.ts`
registration logic beyond what the guard-registration proof above requires — the actual new
entries are yours to add for sports+news, but don't touch unrelated parts of those scripts. No
`verify:foundation`/full gate run. Finance (`ee4f19c6`) stays held, untouched, un-reverted — do
not attempt to fix or unblock the typecheck seam yourself.

This is a shared multi-agent worktree. Never `git add -A`/`.`, never bare `git commit` — commit
with explicit paths only. `git diff` before staging a shared/ambiguous file, `git show --name-only
HEAD` after every commit to confirm exactly what landed. During the `styles.css` conflict:
resolve by hand, `git add packages/ui/src/styles.css` explicitly, `git diff --cached` to confirm
before continuing the rebase.

Report the recomputed numbers, the guard red/green proof, and the rebase confirmation to
coordinator DESIGN ELEMENTS via `herdr-pane-message` (resolve the pane fresh, don't reuse one from
this doc).
