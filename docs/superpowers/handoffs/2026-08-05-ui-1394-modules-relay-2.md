# #1394 relay 2 — 2026-08-05

Branch `feat/1394-ui-modules`, worktree `/home/ben/Jarv1s/.claude/worktrees/ui-1394-modules`.
Coordinator is agent "DESIGN ELEMENTS" (herdr pane — resolve fresh via `herdr pane list` every
time, pane ids are ephemeral, do not reuse one from this doc). Supersedes
`docs/superpowers/handoffs/2026-08-05-ui-1394-modules-relay.md` (pre-rebase snapshot only).

Read this in full before touching anything.

## Current state

HEAD is `60d85778`. Tree is clean apart from `.claude/context-meter.log`. Commit list, oldest
first, branch base `5ff2423d`:

1. `ee4f19c6` — Task 1 Finance migration to @jarv1s/ui. **Now reverted, see `7bba666d` below.**
2. `fd7ebae4` — News CSS split: layout-only + new `components-news.css`.
3. `ef46266e` — Sports CSS split: layout-only + new `components-sports-{1,2}.css`, zero TSX.
4. `3780446c` — wires the 3 new `@import` lines into `packages/ui/src/styles.css`.
5. `3b960e35` — News settings TSX: 13 raw `jds-btn` → `<Button>` from `@jarv1s/module-web-sdk`.
6. `bc54cff5` — fixes 3 stale test assertions broken by commit 5. 26/26 green.
7. `bf086b7f` — relay-1 handoff doc (superseded by this file).
8. `c0f2a14f` — merge `origin/main` (`a027995a`, #1393 Tasks + Notifications) into this branch.
   Clean, no conflict markers; `packages/ui/src/styles.css` needed no manual union-resolve because
   #1395 (the predicted conflicting party) hasn't merged to main yet.
9. `d6d6a3ce` — registers #1394's guard entries: `MIGRATED_SECTION_CSS_FILES` +9,
   `MIGRATED_SECTION_PATHS` +3 (news settings TSX only — sports is CSS-only, 0 TSX paths).
10. `7bba666d` — **revert of `ee4f19c6`**. See below for why. References #1418 and coordinator
    comment 5195931009 in its body.
11. `60d85778` — prettier fix on 4 files the gate caught (`add-source.tsx`,
    `components-news.css`, `components-sports-2.css`, `news-settings-pane.test.tsx`) —
    whitespace only, no logic change.

## Guard absolutes: 23 CSS / 59 TSX

Measured directly off `MIGRATED_SECTION_CSS_FILES` (`scripts/check-design-tokens.ts`) and
`MIGRATED_SECTION_PATHS` (`scripts/check-migrated-sections.ts`) by parsing the arrays and counting
entries — not by trusting arithmetic. Merged-main base (post-#1393) was 14/56; this branch adds +9
CSS (news 3 + sports 6) / +3 TSX (news settings only). Coordinator independently re-measured and
confirmed: counts match, all 82 registered paths resolve to real files on disk, `a027995a` and
`origin/main` both confirmed ancestors, zero conflict markers, `d6d6a3ce` touches exactly 2 files.
Recounted again after the finance revert (`7bba666d`) — **unchanged at 23/59**, since finance lives
under `external-modules/`, outside the pnpm workspace, and no finance path was ever in either list.

**Registration proven live, not just present**: injected a temporary `style={{ color: "red" }}`
probe into `packages/news/src/settings/index.tsx` (a registered path), ran
`check-migrated-sections.ts`, got a real red at the exact line/property, reverted, confirmed green
again. This matters because both guards silently `{ continue }` past an unreadable path — a
typo'd registration entry would otherwise read GREEN. Coordinator separately confirmed all 82
registered paths exist on disk, which is the complement this single-file proof doesn't cover.

## Why `ee4f19c6` (finance) was reverted

Ben's original ruling was option (a): emit `.d.ts` for `@jarv1s/ui` and `@jarv1s/module-web-sdk`,
point finance's paths at them. Coordinator tried it and it does not work: adding the paths entries
fixes the 4 `TS2307` module-not-found errors, but exposes ~20 `Type 'unknown' is not assignable to
type 'ReactNode'` errors plus `Property 'key' does not exist on type 'ButtonProps'`. Root cause:
`packages/module-web-sdk/src/runtime.ts:12` and finance's own hand-rolled
`external-modules/finance/src/web/runtime.ts` both declare `export type ReactNodeLike = unknown`,
while `@jarv1s/ui` component props are typed with React's real `ReactNode`. A `.d.ts` boundary
still emits `children?: ReactNode` — it cannot bridge two different JSX type universes.
`check:external-modules` runs inside `pnpm typecheck`, part of `verify:foundation`, and pre-#1394
finance imported nothing from the SDK and was green — so this red is #1394's own, introduced by
`ee4f19c6`.

Ben re-ruled: **option C** — revert `ee4f19c6`, drop finance from #1394, file the SDK/runtime shim
work as its own module-platform task. Coordinator recorded the scope reduction on #1394 as
**comment 5195931009** and filed the deferred work as **#1418** ("Finance module cannot typecheck
against @jarv1s/ui — ReactNodeLike shim is `unknown`"). The revert (`7bba666d`) cleanly reverted
all 8 files from `ee4f19c6` (7 finance files + the `.jds-progress--current` CSS modifier in
`components-jarvis.css`, whose only consumer was `finance/reports.tsx:88` and which appears
nowhere in `catalogue.json`/`OPTIONS.md`) — no conflicts, since nothing later touched those lines.
Post-revert: `tsc -p external-modules/finance --noEmit` EXIT=0, `pnpm typecheck` EXIT=0.

## PR-body requirements (coordinator's explicit list — carry all of these)

- Scope reduction stated plainly: Task 1 (finance) is REVERTED and dropped from this section. Cost
  is 1 of 732 banned declarations epic-wide. Reason: finance's migration is module-platform work
  (the `ReactNodeLike` shim), not UI consolidation, and can't land without changing
  `packages/module-web-sdk` — outside epic #1387. Deferred to #1418, not abandoned.
- The specific error classes above (TS2307 resolution vs. the deeper `ReactNode`/`unknown`
  mismatch), so a reviewer doesn't re-litigate the `.d.ts` idea.
- Guard absolutes 23 CSS / 59 TSX stated as a delta off merged main's 14/56, noting #1395
  (Settings) is still in flight and will land after this PR.
- The split-check result coordinator ran: news 115 selectors compared / 0 shared properties,
  sports 308 / 0.
- The registration proof (injected violation → real red → reverted → green) AND that all 82
  registered paths were confirmed to exist on disk, since both guards `catch { continue }` on an
  unreadable path.
- That `Verify foundation and app` in CI runs the browser suite (`test:e2e`) and the local gate
  does not.

## Standing constraints, unchanged

**Do NOT merge. Do NOT close issue #1394.** PR is held for coordinator (DESIGN ELEMENTS) review
after it's opened. Do not file or reference a module-platform issue number for the finance shim
work beyond #1418, which the coordinator already filed — it is coordinator's to own, not
builder's. Never `git add -A`/`.`, never bare `git commit` — explicit paths only; this is a shared
multi-agent worktree.

## Next step if you're picking this up cold

1. Check gate status: `scripts/run-gate.sh status` (log path changes each run — the script tracks
   the latest for this worktree automatically, no need to pass `--log`).
2. If gate passed (`DONE rc=0`): run `pnpm test:e2e` separately and unpiped (verify:foundation
   excludes it — #1393 sat on a red CI job behind a green local gate for exactly this reason).
3. If gate failed: read the log tail, fix forward (same discipline as the prettier fix in
   `60d85778` — diagnose, fix, commit with explicit paths, re-run `scripts/run-gate.sh start
   --gate verify:foundation` for a fresh DB), don't assume it's finance-related again unless the
   log says so.
4. Once both gate and e2e are green, open the PR with the body requirements above. Report to
   coordinator: revert SHA (`7bba666d`), both typecheck EXIT codes (0, 0), recounted guard numbers
   (23/59, unchanged), gate result, e2e result, PR number.
