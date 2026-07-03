# Build Handoff — 708 dead chat CLI exports

**Spec (approved):** GitHub issue #708
**GitHub issue:** #708
**Risk tier:** `routine`
**Worktree:** `~/Jarv1s/.claude/worktrees/708-dead-chat-cli-exports` **Branch:** `coord/708-dead-chat-cli-exports` off current green `origin/main`
**Build skill path:** `~/Jarv1s/.claude/skills/coordinated-build/SKILL.md`
**Coordinator label:** `Coordinator`
**Coordinator session id:** `019f25f9-9b63-76f3-9505-a015196d4a41`
**Relay threshold:** ~80-100k tokens or compaction summary.

## Source

Issue #708 from `docs/audits/2026-07-02-dead-code-audit.md` added by commit `9cc00803`.

## Scope

Re-confirm and clean these chat / cli-runner / module-registry findings:

- `UidSlot` in `packages/cli-runner/src/uid-allocator.ts` — safe to un-export or inline; only same-file type use.
- `ChatTurnSeed` in `packages/chat/src/live/types.ts` — zero references.
- `RpcInstallProgress` in `packages/chat/src/live/install-contract.ts` — reserved future frame shape, zero references.
- `renderContextLineWithSupportId` in `packages/chat/src/live/answer-provenance.ts` — zero callers.
- `CHAT_MODULE_ID` in `packages/chat/src/manifest.ts` — only self-use.
- Same-file over-exported helpers: `handleEmbedTurnJob`, `createRpcEngineFactory`, `supportIdForIndex`.
- `loadCatalog` in `packages/cli-runner/src/catalog.ts` — intended test seam never wired.
- Unused `cli-runner` barrel re-exports: `NotLaunchedError`, `newNonce`, `Mutex`, `readConfig`, `createCliRunner`, `LOGIN_ADAPTER_ISSUES`.
- `RouteCoverageInput` in `packages/module-registry/src/route-guard.ts` — same-file structural type only.

## Required Flow

1. `[ -d node_modules ] || pnpm install`.
2. Read AGENTS.md, CLAUDE.md, this handoff, and the coordinated-build skill.
3. Re-confirm zero external consumers on current `origin/main`.
4. Submit a compact plan for coordinator approval before code.
5. Prefer un-exporting or inlining where implementation is live internally; delete only true orphan symbols. Do not break live relative imports inside `cli-runner`.
6. Run focused chat/cli-runner/module-registry tests plus typecheck; include exact commands and exits in wrap-up.

## Collision Notes

Wave 1 is parallel-safe with #701, #702, #703, and #707. Do not touch `docs/coordination/` from the build branch. Use explicit staging only.
