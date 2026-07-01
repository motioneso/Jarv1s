# Relay handoff — #656 sports module (r11 → r12)

**Continuation of a coordinated build.** Successor to `Build-656-sports-r11`. Same worktree, same
branch, under the Coordinator. Read this IN FULL, then resume via `coordinated-build`. Resume at
**Task 15, Step 3** (full local gate) — Steps 1–2 (README + seam-tag grep-verify) are DONE.

Run: `2026-06-30-rfa-fleet` · Issue: #656

## Coordinates

- **Worktree:** `~/Jarv1s/.claude/worktrees/656-sports-module`
- **Branch:** `coord/656-sports-module`, HEAD **`715be45c`** (do NOT branch off; keep committing here)
- **Bootstrap:** `[ -d node_modules ] || pnpm install` — already installed, skip.
- **Coordinator:** Herdr label **`Coordinator`**. Re-resolve fresh by label each time; confirm
  EXACTLY ONE pane holds it before messaging (was `w1:p10`, codex, session
  `019f1f70-fb27-7cb1-9ce0-2af0329763a8` as of r11 — pane number reflows, re-resolve).
- **Plan:** `docs/superpowers/plans/2026-07-01-sports-module.md` — Task 15 at L1364.
- **Spec:** `docs/superpowers/specs/2026-06-30-sports-module.md`.

## What r11 did (commits, newest first)

- `715be45c` docs(sports): loader-seam ledger (Task 15, partial) — `packages/sports/README.md`
  (all 6 loader-seams documented, §4.8 deviation noted, §9 fast-follows noted) + added the missing
  `// LOADER-SEAM(sports) 3` comment tag to `packages/briefings/src/compose.ts` (Task 11 wired the
  briefing section but never tagged it — comment-only, no logic change).
- `52856fae` docs(sports): fix pre-existing prettier formatting in relay handoffs — two handoff
  docs from r10's commit (`03365857`) were failing `format:check`; fixed so the Task 15 full gate
  can run clean. Not a build-agent mistake — inherited breakage, fixed in scope.
- `eea12a95` feat(sports): settings follow-picker pane (Task 14, DONE) — `packages/sports/src/settings/index.tsx`
  (`SportsSettings` default export), `./settings` exports subpath + react/react-query/settings-ui
  deps in `packages/sports/package.json`, `apps/web/src/styles/sports-2.css` (new, `sp-*` prefix),
  imported from `apps/web/src/settings/settings-page.tsx`. `tests/unit/settings-sports-pane.test.tsx`
  — 3/3 green. Typecheck clean (`packages/sports`, `apps/web`). Lint clean on all touched files.

**Grep-verified seam tags** (plan Task 15 Step 2 — already done, don't re-derive):

```
packages/sports/src/source/sports-source.ts:3   LOADER-SEAM(sports): swappable data-source contract
packages/sports/src/source/espn-source.ts:15     LOADER-SEAM(sports): adapter, all ESPN calls through here
packages/module-registry/src/index.ts:789        LOADER-SEAM(sports) 1: BUILT_IN_MODULES entry
packages/module-registry/src/index.ts:794        LOADER-SEAM(sports) 2: registerSportsRoutes DI + source construction
packages/briefings/src/compose.ts:700            LOADER-SEAM(sports) 3: briefing section wiring
```

Seams 4/5/6 (web nav/route, shared contracts, foundation.test.ts migration row) are cross-file by
design — the README is their ledger, not an inline tag. Matches plan's expected grep output exactly.

## What's left — Task 15, Steps 3–5 (plan L1389–1409)

1. **Step 3: Full local gate.**

   ```bash
   pnpm verify:foundation
   ```

   Last attempt (r11) failed only on the two now-fixed handoff docs at the `format:check` stage —
   lint had already passed clean. **Nothing else has been run yet**: `check:file-size`,
   `check:design-tokens`, `check:no-ambient-dates`, `typecheck` (full monorepo — only
   `packages/sports` + `apps/web` typechecked individually so far), `test:unit` (full suite — only
   the new sports test run individually so far), `db:migrate`, `test:integration` (incl.
   `foundation.test.ts` — confirm the `0133_sports_follows.sql` migration row is present; it was
   added in an earlier task per git log, should already be there).
   Then:

   ```bash
   pnpm audit:release-hardening
   ```

   Expected PASS on both. Fix anything red — don't skip or weaken a check.

2. **Step 4: Manual acceptance (spec §7).** Start dev server with `--host` (headless machine —
   see CLAUDE.md dev-environment memory). Walk: follow a team in settings → persists; open
   `/sports` on a quiet day → scores+headlines render; game day → team highlighted; change follows
   → highlighted set changes; briefing shows a followed-team fact; second user sees only their own
   follows (RLS); simulate ESPN failure (temporarily point `fetchFn` at a throwing stub in a scratch
   test, don't commit the stub) → page shows `degraded` authored empty state, no 500.
   **This is a functional-completeness pass, not a design pass** — ship the functional default,
   don't second-guess visuals (Ben annotates look separately later, see memory).

3. **Step 5: Commit.** The plan says `git add packages/sports/README.md` — README is already
   committed (r11, `715be45c`), so this step is effectively done; if the gate run touches anything
   else (e.g. a foundation.test.ts fix), commit that separately with an explicit file list, never
   `git add -A`/`.`.

4. **Then `coordinated-wrap-up`**: clean tree, own gate already run above, pre-push trio
   (`format:check && lint && typecheck` + `git fetch origin main && git rebase origin/main`), push,
   open PR, report PR + verified evidence to Coordinator. **Coordinator owns QA/merge/board — do
   not do those yourself.**

## Constraints (verbatim intent — KEEP)

- **Explicit staging only.** Never `git add -A`/`.`. **Do NOT stage** `.claude/context-meter.log`,
  `docs/coordination/…` copies, or `docs/superpowers/plans/2026-07-01-sports-task11-briefing-section.md`
  (untracked by design — leave them). This handoff doc IS an intentional commit — stage it with
  your first commit as r12, same pattern as r9–r11 did for their own handoffs.
- No repo-wide format (single-file `prettier --write` on your own new/edited files is fine — that's
  what r11 did for the two pre-existing handoff docs, scoped, not `prettier --write .`).
- Single chat-visible tool `sports.followedFactsToday` — no new tools. RLS/DataContextDb/
  AccessContext untouched (`AccessContext = {actorUserId, requestId}`). Tests only in `tests/unit`
  - `tests/integration`. Raw CSS colors only in `tokens.css`; result colors NEVER red.
- Relay again at ~80–100k tokens / on any compaction summary — don't wait for a hard stop.

## First actions

1. Confirm branch `coord/656-sports-module`, HEAD `715be45c` or later (`git log --oneline -3`).
2. `coordinated-build` required recalls (state row; RLS/migration row given `test:integration`
   is next).
3. Message Coordinator (`Coordinator` label, verify fresh via `herdr pane list`): "r12 driving,
   resuming Task 15 Step 3 (full gate) — Steps 1-2 done by r11 (README+seam tags)."
4. Run `pnpm verify:foundation` in full, fix anything red, then `pnpm audit:release-hardening`,
   then manual acceptance, then `coordinated-wrap-up`.
