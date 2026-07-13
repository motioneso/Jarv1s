# Relay 3 — #989 Sports settings dogfood hardening

**Worktree:** `~/Jarv1s/.claude/worktrees/ux-989-sports-settings-build` (already checked out — do NOT re-clone, do NOT `pnpm install`, `node_modules` present)
**Branch:** `ux/989-sports-settings-build`
**Plan:** `docs/superpowers/plans/2026-07-12-sports-settings-dogfood-hardening.md` — **PLAN ALREADY APPROVED by coordinator, no fork, no re-send.**
**Build skill:** `coordinated-build` (this repo's `.claude/skills/coordinated-build/SKILL.md`)
**Supervising coordinator:** label `UX Coordinator` — **re-resolve session id fresh via `herdr pane list` before messaging, do not trust any id written here.**

## Status: Tasks 1–4 DONE and committed. Resume at Task 5.

Commits so far: `827d37fe` (Task 1), `0b0d95b4` (Task 2), `146172c6` (Task 3), `26e2a2f1`
(Task 4). Working tree clean except unrelated `.claude/context-meter.log`.
`pnpm vitest run tests/unit/settings-sports-pane.test.tsx` → 26/26 PASS.
`pnpm --filter @jarv1s/sports typecheck` and `pnpm check:design-tokens` both clean as of Task 4.

## What's next — resume here

1. Re-resolve pane fresh via `herdr pane list`; message `UX Coordinator` your new pane
   label + `agent_session.value` (one line, caveman), confirming you're driving Task 5.
2. Read plan Task 5 only (`docs/superpowers/plans/2026-07-12-sports-settings-dogfood-hardening.md`,
   "### Task 5: Playwright acceptance spec") — do not re-read the whole plan/spec.
3. **Verified during research (not yet applied):** the plan's Task 5 Step 1 code snippet for
   `mockSportsSettings`'s `/api/sports/teams/search*` route returns `{ teams, partial: false }`
   but the current `SportsTeamSearchResponse` shape (`packages/shared/src/sports-api.ts:268`) also
   requires `degraded: boolean`. Add `degraded: false` to that mock fulfillment or the response is
   shaped wrong (frontend doesn't currently branch on missing vs false, so it likely still renders
   fine either way — but match the real DTO shape, don't leave a field out).
4. **Verified: the deep link is real.** `/settings?section=modules&module=sports` works exactly as
   the plan snippet assumes — `settings-page.tsx` handles `?section=modules` → `ModulesPane`
   (`apps/web/src/settings/settings-personal-data-panes.tsx`), which reads `?module=` via
   `resolveModuleSettingsDeepLink` and renders the sports module's contributed settings surface
   (heading text is "Sports", confirmed against `SportsSettings`'s `pane__title`). No need to
   deviate to a click-through nav — Task 5 Step 3's fallback ("read apps/web/src/pages/settings*")
   should not be needed, but re-verify if `page.goto` doesn't land as expected.
5. Create `tests/e2e/sports-settings.spec.ts` per Task 5 Step 1 (literal code is in the plan) with
   the `degraded: false` fix from point 3 above, run `pnpm exec playwright test
   tests/e2e/sports-settings.spec.ts`, fix any real selector mismatches (don't change production
   copy to fit the test), commit per Step 4.
6. Continue Task 6 (full gate + exit-criteria sign-off) same TDD/verification discipline.
7. Stay inside the 4 locked paths: `packages/sports/src/settings/index.tsx`,
   `packages/sports/src/settings/sports-2.css`, `tests/unit/settings-sports-pane.test.tsx`,
   `tests/e2e/sports-settings.spec.ts`. No shell/routes/service/repository/SQL edits.
8. Pre-push trio before any push: `pnpm format:check && pnpm lint && pnpm typecheck`, then
   `git fetch origin main && git rebase origin/main`.
9. On Tasks 5–6 + exit-criteria walkthrough done: invoke `coordinated-wrap-up` (gate, push, PR,
   report to coordinator). Never merge/board/touch `docs/coordination/`.
10. Relay again yourself on the next 70% warning/compaction — same procedure.

## Predecessor session (safe to reap once you confirm driving)
Resolve fresh by label — do not trust a baked-in id/pane number here (they reflow). Ask the
coordinator to reap the pane that just relayed you if it doesn't already know.
