# #1109 runtime-context — relay checkpoint 7

Branch/worktree: `build/1109-runtime-context` @ `/home/ben/Jarv1s/.claude/worktrees/build-1109-runtime-context`.

Plan: `docs/superpowers/plans/2026-07-16-1109-runtime-context-plan.md` (1152 lines, 7 tasks).
Read by SECTION per task, never in full.

## Done — Tasks 1-6 all committed

Task 6 committed this session at `09af162c` ("test(context): enforce tier-one privacy boundary") —
added the 3 privacy-boundary tests from plan lines 965-1050 to `tests/unit/page-context.test.ts`,
`tests/unit/current-view-tool.test.ts`, `tests/unit/chat-runtime-persona.test.ts`, and added the
`// #1109 v1 intentionally ships Tier 1 only...` deviation comment above
`chatGetCurrentViewOutputSchema` in `packages/chat/src/current-view-tool.ts` (the only source change
needed — the persona line and `page-context.ts` guard already satisfied their tests pre-existing).
Verified: red→green TDD loop, `pnpm format:check && pnpm lint && pnpm typecheck` all clean, negative
grep for `screenshot` in the runtime-context path clean (only the persona-prompt string and the new
deviation comment mention it — no implementation).

## Next step — Task 7 (final task), NOT YET WRITTEN

Read plan lines 1052-1152 fresh (already read this session, re-grep to confirm no drift). It asks
for `tests/uat/specs/runtime-context.uat.spec.ts` with 3 tests that literally send real chat
messages and assert real LLM replies (e.g. "hello" back, or a screenshot-refusal message).

**Key discovery this session — the plan's literal spec CANNOT run as written.** The UAT harness has
no chat-capable AI provider seeded at any level (confirmed via two existing sibling specs' own
scope notes: `tests/uat/specs/app-map-grounding.uat.spec.ts` lines 10-22, and
`tests/uat/specs/1089-1090-chat-drawer-private.uat.spec.ts` lines 24-31 — "the only seeded AI
provider/model ... is a deliberately fake provider bound solely to `module.news` capability — no
seed level can drive a real chat turn"). This exact gap is tracked in open issue **#1121** ("UAT
harness: deterministic scriptable chat engine for real-LLM e2e"), which both sibling specs already
defer real-LLM assertions to via `test.fixme` + citation. Do NOT attempt to build a scriptable chat
engine here — that's #1121's own spec-gated scope, not this task's.

### Adapted plan (verified via code reading, ready to write — not yet written to disk)

1. **"ordinary chat turn sends no snapshot and performs no current-view pull" — REAL, achievable.**
   `apps/web/src/api/client.ts:835-840` `sendChatTurn` posts only `{ text }` (proves Task 5's push
   deletion holds). With no chat-capable model, the server 400s
   ("No active chat-capable model is configured.", `packages/chat/src/live-routes.ts:448`), the
   drawer's `isNoActiveChatModelError` catch (`apps/web/src/chat/chat-drawer.tsx:241-246`) sets
   `needsProvider`, which renders `ConnectProviderEmpty` ("Connect a provider to start chatting",
   `apps/web/src/chat/connect-provider-empty.tsx`) **additively above** the composer (textbox stays
   mounted, `apps/web/src/chat/composer.tsx:231` vs `:263+`). This is a **deterministic terminal
   state** — use it instead of the plan's "hello" reply: capture `turnBody` via `page.on("request")`
   on `/api/chat/turn`, send the message, wait for the `ConnectProviderEmpty` text to appear, then
   assert `turnBody` deep-equals `{ text: "..." }` (no `pageContext` field) and that no additional
   current-view-pull request fired.
2. **"no model-reachable screenshot path exists" — split.** Keep real: `page.evaluate(() =>
   fetch("/api/ai/assistant-tools").then(r => r.json()))` (`packages/ai/src/routes.ts:599-616`,
   cookie-authed, no chat turn needed) → assert `JSON.stringify(tools).toLowerCase()` excludes
   "screenshot". `test.fixme` the `ask()`-driven refusal-text half (needs real LLM), citing #1121.
3. **"News screen error is pulled and resolved against the map" — mostly `test.fixme`.** The
   News-error-render half is already proven deterministically by
   `app-map-grounding.uat.spec.ts`'s `"declared prerequisite surfaces the News no-json-model
   error"` test — don't duplicate it. The NEW part (proving `chat.getCurrentView` actually gets
   called to ground the answer) needs real LLM tool-calling → `test.fixme`, citing #1121, and citing
   the unit-level coverage that already exists: `tests/unit/current-view-tool.test.ts` (schema +
   read-service, Tasks 4/6), `tests/unit/chat-runtime-persona.test.ts` (persona instructs calling
   `chat.getCurrentView` for screen-scoped questions, Task 6).

`uatLevel`: use `{ level: "solo-admin", without: [] } as const` (matches
`1089-1090-chat-drawer-private.uat.spec.ts` / `cli-terminal.uat.spec.ts` precedent) — the real
tests only need a logged-in admin with app-shell chat access, no News/AI seed data.

Confirmed selectors: chat-open button = `aria-label="Chat with Jarvis"` topbar icon button
(`apps/web/src/shell/app-shell.tsx:255` — NOT the drawer's own `role="dialog"
aria-label="Chat with Jarvis"`, a different element with the same accessible name). Send button
aria-label toggles `"Send"`/`"Stop generating"` (`composer.tsx:302`). Textbox
`aria-label="Message Jarvis"` (`composer.tsx:266`).

`package.json` already has `"test:uat": "tsx tests/uat/run-uat.ts"` — plan Step 3 is already
satisfied, no `package.json` change expected (only stage it if it actually changed).

**Unresolved thread:** was mid-checking whether the `solo-admin` seed level completes onboarding
automatically before relaying (grep for "onboarding" in `tests/uat/seed/admin.ts` returned nothing
— inconclusive). Before writing `signIn()`, read `app-map-grounding.uat.spec.ts`'s `signIn()`
helper (lines 33-53, already includes the conditional "Skip setup → Skip anyway" onboarding
handling) and reuse that exact pattern — cheaper than re-deriving it.

### Remaining steps in order

1. Confirm/finish the onboarding-skip check above, then write
   `tests/uat/specs/runtime-context.uat.spec.ts` per the adapted plan, following the file-header
   SCOPE NOTE convention from `app-map-grounding.uat.spec.ts` (cite #1109, #1121, this checkpoint).
2. Before running the real harness: `df -h /` (see memory `dev-box-disk-full-uat-images` — UAT
   images fill disk) and check no other session's UAT run is mid-flight (memory
   `uat-docker-subnet-map`, `uat-seed-shared-db-no-reset`).
3. Run `pnpm test:uat -- runtime-context`, then the full Step 4 command from the plan — but
   **re-verify the file list first**, don't trust it verbatim: `ls tests/unit/ | grep page-context`
   to confirm `chat-page-context.test.ts`, `page-context-store.test.ts`,
   `page-context-sync.test.ts` still exist under those exact names before including them in the
   vitest run command.
4. Commit: `git add tests/uat/specs/runtime-context.uat.spec.ts package.json` (only add
   `package.json` if changed) → `git commit -m "test(context): prove pull-based awareness in real
   UAT"`. This is the LAST task in the plan — after a clean commit, message the coordinator that
   #1109 is fully implemented and ready for QA, rather than continuing to a Task 8 that doesn't
   exist.

## Coordinator

Re-resolve fresh via `herdr pane list` before messaging — do not trust any label/session id from
this or earlier checkpoint docs; panes/labels have moved before (see relay-6's own warning about
the stale `g5` label). Confirm `agent_status` before escalating.

## Process reminders

- TDD per task: red → green → format/lint → commit, `git add` explicit paths only (never `-A`).
- Relay again on context-meter 70% warning or compaction-summary sighting — don't wait for felt %.
- Never merge/board/close, never touch `docs/coordination/`.
- `node_modules` already present in this worktree — skip `pnpm install`.
