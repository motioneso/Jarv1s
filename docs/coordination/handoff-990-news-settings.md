# Build Handoff — #990 News settings dogfood hardening

**Spec (approved):** `docs/superpowers/specs/2026-07-12-news-settings-dogfood-hardening.md`
**Approval:** Fable verdict on PR #1008
**Risk tier:** `routine`
**Worktree:** `~/Jarv1s/.claude/worktrees/ux-990-news-settings-build`
**Branch:** `ux/990-news-settings-build` from green `origin/main` `3ca138eb`
**Build skill:** `~/Jarv1s/.claude/skills/coordinated-build/SKILL.md`
**Supervising coordinator:** label `UX Coordinator`, session
`019f5a2e-03fd-71c3-95ab-1934cb1de973`
**Final merge authority:** label `Coordinator`, session
`58a78927-385c-4b1d-8fa0-94db20255d6f`

## Start and locks

1. Before planning, fetch and rebase on current `origin/main`; #981's
   `packages/news/src/settings/index.tsx` is a live collision file. Stop and report any conflict.
2. Run `[ -d node_modules ] || pnpm install`, invoke `coordinated-build`, ground with codebase-memory
   MCP, and send a compact plan to `UX Coordinator` before feature edits.
3. Stay inside the News product/style/client/unit/E2E paths listed by the spec. Do not edit routes,
   repositories, policy validation, jobs, shared contracts, SQL, module wiring, #899 capture files,
   #906 feedback, or Settings shell files.
4. Reuse the existing PATCH contract and preserve #981's final safe user-language error copy.
5. Build pane-owned behavior now. Rebase after #986 before final integrated Playwright proof if its
   shell navigation changes the module deep-link path.
6. Stage explicit paths only; never edit `docs/coordination/`, run repo-wide formatting, update
   tracking, or merge. Finish through `coordinated-wrap-up`.
