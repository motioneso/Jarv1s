# #1226 Job Search Recovery Relay

## Scope

- Issue: #1226, part of #1193
- Plan: `docs/superpowers/plans/2026-07-20-job-search-recovery-dev-hitl.md`
- Branch: `fix/1226-job-search-recovery`
- Worktree: `~/Jarv1s/.claude/worktrees/job-search-recovery`
- Coordinator label/session: `Coordinator` / `019f7da3-2d14-7ee2-a42d-c0618a7d821e`
- Risk: sensitive; package-hash/distribution contract plus shared-chat dependency require explicit PR disclosure
- Collision boundary: outside #1179 batch; protected #1179 API/web PIDs `4078120`/`4009552` on ports 3020/5178 must remain untouched

## Current state

- Base: `origin/main` at `668f2709`; branch HEAD `89fee9bd`; clean tree at relay.
- Recovery implementation and acceptance plan are committed.
- Code-only dependency from `de501afd` is folded into `89fee9bd` for:
  - `packages/module-registry/src/distribution/pipeline.ts`
  - `packages/module-registry/src/external/hash.ts`
  - `tests/unit/external-hash.test.ts`
  - `tests/unit/module-distribution-pipeline.test.ts`
- Trusted deployment at `~/Jarv1s/data/modules/job-search` boots worker contract v1.
- Last recovery processes: API listener `3458816` on 3000, web listener `3398698` on 5173, worker `3458823`; roots `3398504`/`3398505`/`3398506`.
- Prior scoped checks: 191 focused unit tests, typecheck/external-module, design tokens, direct worker boot all green. Earlier full foundation and browser gates are recorded in branch history/plan.

## Proven live blocker

Normal Instance Modules enablement and real Anthropic CLI config succeeded. `job-search.onboarding.get-state` returns 200. `/api/chat/module-onboarding` hangs because long multiline prompt remains in Claude composer with no transcript ACK.

Live pane is `w1:pZ0`. ANSI-preserving probe was sanitized and proved parser sees nonempty composer:

```json
{"bytes":2940,"lines":27,"empty":false,"hasAnsi":true}
```

This falsifies parser hypothesis. Likely cause is `waitForUserAckWithEnterNudge()` in `packages/chat/src/live/cli-chat-engine.ts`: initial Enter plus two bounded nudges occur, then final nonempty composer falls into unbounded ACK wait.

Coordinator-approved files only:

- `packages/chat/src/live/cli-chat-engine.ts`
- `tests/unit/cli-chat-engine-verified-submit.test.ts`
- Parser files only if new evidence proves parser causal (current evidence says no)

Do not edit multiplexer adapter without a red test plus fresh coordinator approval. Manual Enter is not accepted.

Preserve invariants:

- Empty composer => never re-press Enter (duplicate risk).
- Any failure after Enter => `delivery_unknown`, invalidate/purge, never auto-resend.
- All waits bounded by verified-submit cancellation.

## Start here

1. Skip install when `node_modules` exists: `[ -d node_modules ] || pnpm install`.
2. Resume via `coordinated-build`; read only relevant plan sections.
3. Add deterministic red test using sanitized long multiline composer, no transcript ACK, `nudgeAfterMs: 0`, yielding `io.sleep`, and a short race deadline. Pre-fix should hang; post-fix should return `delivery_unknown`, kill once, and send initial Enter plus exactly two nudges.
4. Fix only bounded final-nudge handling in `waitForUserAckWithEnterNudge()`.
5. Run:

```bash
pnpm vitest run \
  tests/unit/composer-evidence.test.ts \
  tests/unit/cli-chat-engine-verified-submit.test.ts \
  tests/unit/chat-session-manager.test.ts \
  tests/unit/chat-session-manager-selfheal.test.ts
```

6. Commit chat dependency with conventional message, #1226 reference, safety explanation, release-note body, and `Co-Authored-By: Claude` trailer.
7. Clean exact stale chat pane/session without manual Enter; allow source restart; repeat real module-onboarding smoke with zero manual keys.
8. Finish fresh Firefox 1280x1800 journey and instrumented Webwright evidence under `/tmp/jarvis-1226-webwright/final_runs/run_<id>/`; never use `full_page=True`; visually inspect critical screenshots.
9. Rerun scoped browser/unit/type/design checks and full sensitive gate in freshly recreated isolated `jarvis_1226_gate`.
10. Run pre-push trio, fetch/rebase current main, rerun integrated checks if main moved, rebuild/deploy exact final artifact, and report hashes/HEAD/PIDs.
11. Use `coordinated-wrap-up`; push/open sensitive PR but never merge or move board. PR must disclose shared-chat and package-hash dependencies. Give Ben plan section 12 checklist and wait for explicit approve/reject.

## Webwright state

`/tmp/jarvis-1226-webwright` contains `plan.md`, exploration scripts/screenshots, and login/settings/module/CLI evidence. Final run still required.
