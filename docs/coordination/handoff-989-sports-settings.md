# Build Handoff — #989 Sports settings dogfood hardening

**Spec (approved):** `docs/superpowers/specs/2026-07-12-sports-settings-dogfood-hardening.md`
**Approval:** Fable verdict on PR #1008
**Risk tier:** `routine`
**Worktree:** `~/Jarv1s/.claude/worktrees/ux-989-sports-settings-build`
**Branch:** `ux/989-sports-settings-build` from green `origin/main` `3ca138eb`
**Build skill:** `~/Jarv1s/.claude/skills/coordinated-build/SKILL.md`
**Supervising coordinator:** label `UX Coordinator`, session
`019f5a2e-03fd-71c3-95ab-1934cb1de973`
**Final merge authority:** label `Coordinator`, session
`58a78927-385c-4b1d-8fa0-94db20255d6f`

## Start and locks

1. Run `[ -d node_modules ] || pnpm install`, invoke `coordinated-build`, ground with codebase-memory
   MCP, and send a compact plan to `UX Coordinator` before feature edits.
2. Stay inside the Sports module product/style/unit/E2E paths listed by the spec. Do not edit Sports
   routes, services, repositories, shared contracts, SQL, providers, or Settings shell files.
3. Preserve #855 competition-scoped identity and #903 service ownership. Reuse shipped query and
   mutation seams; no new dependency, endpoint, or optimistic storage model.
4. Build pane-owned behavior now. Rebase after #986 before final integrated Playwright proof if its
   shell navigation changes the module deep-link path.
5. Stage explicit paths only; never edit `docs/coordination/`, run repo-wide formatting, update
   tracking, or merge. Finish through `coordinated-wrap-up`.
