# #1109 runtime-context — relay checkpoint 1

Branch/worktree: `build/1109-runtime-context` @ `/home/ben/Jarv1s/.claude/worktrees/build-1109-runtime-context` (branched off `build/1110-app-map`, inherits `appMapService` DI seam — verified match, no drift).

Plan: `docs/superpowers/plans/2026-07-16-1109-runtime-context-plan.md` (1152 lines, 7 tasks). Read by SECTION per task, never in full.

## Coordinator label — UNRESOLVED, resolve fresh before escalating

Dispatch said `Coord-1109-1110-g4`; handoff doc said `Coord-1109-1110-g3`. At relay time
`herdr pane list` showed **neither** — only `Coord-1109-1110-g5`, cwd
`coord-2026-06-30-rfa-fleet` (looks like an unrelated coordinator worktree), `agent_status: "done"`.
Zero live matches for either expected label → per `coordinated-build` red-flag rule, did **not**
guess-message any pane. **Successor: re-run `herdr pane list` fresh, find whichever
`Coord-1109-1110-*` pane is actually alive/working, and escalate there — do not reuse g3/g4/g5
blindly.** If still zero live matches, halt and surface this to Ben rather than guessing.

## Done — Task 1 (commit `1c1191a7`)

"Project structured screen errors through Tier-1 pipeline." Added `JarvisError`/`JarvisErrorClass`
re-export + `errors` field to `PageContextSnapshotDto` (`packages/shared/src/chat-api.ts`);
client-side collection `collectPageContextErrors`/`projectPageContextErrorAttributes`
(`apps/web/src/chat/page-context.ts`) reading `data-jarvis-error-code/-class/-remediation-ref`;
server-side re-validation `boundedErrors` (`packages/chat/src/live/page-context.ts`), allow-list
only, drops undeclared keys, caps 10 entries / 160 chars. Deliberately did NOT touch
`renderPageContextBlock` — that whole `<page_context>` prompt-rendering path is deleted in Task 5.
58/58 unit tests green, typecheck clean, formatted, linted. 6 files changed (see commit).

## Next — Tasks 2-7, in order, plan line ranges

1. **Task 2** (plan lines 252-417): TTL-backed actor-keyed current-view store + authenticated
   `PUT /api/chat/page-context`. New `packages/chat/src/live/page-context-store.ts` wrapping
   `resolveCachedPageContext` (already in `packages/chat/src/live/page-context.ts`); new
   `tests/unit/page-context-store.test.ts`; route added to `packages/chat/src/live-routes.ts`.
   Per plan's File Structure notes: **delete** `tests/unit/chat-session-manager-page-context.test.ts`
   after moving its still-relevant TTL cases into the new store test file (do not just leave both).
   RLS/actor-isolation requirement: one actor must never read another's stored view.
2. **Task 3** (lines 418-559): debounced live sync off the chat-turn path. New
   `apps/web/src/chat/use-page-context-sync.ts`; modifies `apps/web/src/api/client.ts`,
   `apps/web/src/chat/chat-drawer.tsx`, `apps/web/src/shell/app-shell.tsx`.
3. **Task 4** (lines 560-858): `chat.getCurrentView` risk:"read" tool. New
   `packages/chat/src/live/current-view.ts`, `packages/chat/src/current-view-tool.ts`; new
   `tests/unit/current-view-tool.test.ts`; modifies `packages/chat/src/manifest.ts`,
   `packages/chat/src/routes.ts`, `packages/module-registry/src/index.ts`. Must consume
   `dependencies.appMapService.getBuildInfo()` (top-level DI field, verified present from #1110).
4. **Task 5** (lines 859-964): delete the per-turn push + `<page_context>` prompt path. Remove
   `pageContext` from `SendChatTurnRequest`/`/api/chat/turn`; delete `renderPageContextBlock` and
   related in `packages/chat/src/live/page-context.ts`; strip cache/turn params + injection from
   `packages/chat/src/live/chat-session-manager.ts` and `engine-text.ts`.
5. **Task 6** (lines 965-1051): privacy-floor + Tier-1-only boundary tests (actor isolation,
   redaction floor, no raw-DOM/screenshot leakage).
6. **Task 7** (lines 1052-1152): real `tests/uat/specs/runtime-context.uat.spec.ts` Playwright UAT
   (News grounding, idle-turn, no-screenshot acceptance) + full `pnpm verify:foundation` gate.

## Process reminders

- TDD per task: red → green → format/lint → commit, `git add` explicit paths only (never `-A`).
- Relay again on context-meter 70% warning or compaction-summary sighting — don't wait for felt %.
- Never merge/board/close, never touch `docs/coordination/`.
