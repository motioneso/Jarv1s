# Lane E #1198 onboarding UI — Task 4 relay (f)

Same worktree/branch (`feat/1198-onboarding-ui`), don't create a new one. Supervisor: pane label
`Coord 1193 Supervisor 5` — re-resolve fresh via `herdr pane list`, never reuse a pane_id from any
doc. No push/PR without explicit supervisor grant. DB-less only: no `verify:foundation`, no DB.

Full Task 4 assertion list + Task 5 gate command block: relay (b)
(`docs/superpowers/handoffs/2026-07-20-lane-e-1198-onboarding-ui-task4-relay-b.md`) — still
authoritative, don't re-read design mockup/plan. Relay (e) — same dir, `-relay-e.md` — has the
now-completed js06 fix writeup, superseded by state below.

## State

HEAD `34fb2559`, clean tree, all 3 relay-e edits done + green + committed:
1. Global mock route `POST /api/chat/module-onboarding` in `tests/e2e/mock-chat-api.ts`
   (`registerMockChatRoutes`, after the `/api/chat/privacy` route).
2. `tests/e2e/js06-module-surface.spec.ts` fixture key `claim`→`claimText` (matches
   `index.tsx`'s `ResumeReadResult.evidence[].claimText`).
3. `js06-module-surface.spec.ts` first-run assertion rewritten for the real composed render
   (dealbreakers `MultiControl` visible — `"Set dealbreakers"`/`"None of these"` buttons — no
   section nav). Confirmed 9/9 green via
   `pnpm exec playwright test tests/e2e/js06-module-surface.spec.ts --project=chromium`.

Step 0 wiring (`index.tsx` phase computation in render) was already done in prior commits
(`f636ebab`/`5a71cf93`) — don't re-derive, confirmed by direct read this run.

## Next: relay (b) steps 6-9, not yet started

6. Write RED `tests/e2e/js1198-job-search-onboarding.spec.ts` skeleton per relay (b)'s exact
   requirements list (§"Task 4 exact requirements", copy verbatim from that doc). **Commit the
   moment it's RED for the right reason** — hard supervisor directive, repeated 4x now across
   relays. Don't do deep fixture work before that commit.
7. Implement fixtures/mocks inline, get all three e2e specs green together (`js1198` + `js06` +
   `assistant-surface`). Commit message (exact, from relay (b)):
   ```
   test(job-search): cover guided onboarding flow

   User-facing summary: Job Search onboarding now has browser coverage for upload, approvals, denial, recovery, and completion.

   Co-Authored-By: Claude <noreply@anthropic.com>
   ```
8. Run the full Task 5 gate (verbatim in relay (b)), capture every command's exit status:
   ```bash
   pnpm build:external:job-search
   pnpm vitest run tests/unit/external-module-job-search-handlers-onboarding.test.ts tests/unit/external-module-job-search-handlers-resume.test.ts tests/unit/external-module-job-search-manifest.test.ts tests/unit/job-search-web-onboarding.test.tsx tests/unit/job-search-web-screens.test.tsx tests/unit/job-search-web-core.test.tsx tests/unit/external-module-job-search-bundle.test.ts
   pnpm exec playwright test tests/e2e/js1198-job-search-onboarding.spec.ts tests/e2e/js06-module-surface.spec.ts tests/e2e/assistant-surface.spec.ts --project=chromium
   pnpm check:design-tokens
   pnpm check:file-size
   pnpm format:check
   pnpm lint
   pnpm typecheck
   ```
   All must exit 0 — vitest-only is explicitly NOT accepted as gate-ready evidence.
9. Re-resolve `Coord 1193 Supervisor 5` fresh via `herdr pane list`, report gate-ready with full
   commit list + command evidence, or report any blocking error verbatim.

## Open research question (where prior session stopped, unsolved)

How to script a **two-wave** SSE sequence over the mocked `/api/chat/stream`: an `action_request`
record, then later (after the simulated user interaction triggers a `submitTurn` POST to
`/api/chat/turn`) an `action_result` record with `outcome:"executed"`, to test
`advanceOnDurableEvent` (in `index.tsx`) actually advancing the phase — and separately, a
`denied`/`error` outcome that must NOT advance (control stays for retry).

Constraint: the repo's existing `/api/chat/stream` mock (`tests/e2e/mock-chat-api.ts` lines
38-50) fulfills the HTTP response body **once** per test, then holds all reconnects open forever
(never closes) — a deliberate anti-churn design, not a bug. `tests/e2e/assistant-surface.spec.ts`
(read in full, 62 lines) is the only existing example of scripting an `action_request` via this
stream — a single-shot fulfill with two `data:` lines (`reply` + `action_request`). It does NOT
demonstrate a subsequent `action_result` wave. No other spec in `tests/e2e/` does either (grepped
for `action_result`/`actionRequestId`/`/api/chat/action-requests` — no matches).

Two candidate approaches, unevaluated:
- (a) Register a **test-local override** of `/api/chat/stream` (Playwright routes registered
  later take precedence) with a custom fulfill body containing BOTH the `action_request` AND the
  eventual `action_result` as sequential `data:` lines in one response — EventSource parses
  multiple `data:` lines from one body sequentially, so both could arrive "at once" from the
  test's POV, with the assertions checking UI state after each is processed (may need a
  `page.waitForTimeout` or state-based wait between them, not truly simulating a time-gap, but
  may be sufficient since the code path doesn't care about real elapsed time).
  - **Also verify:** the codebase's `subscribeRecords`/`useChatStream` plumbing — check whether
    the SSE stream is even reachable in-page before writing this override, or whether it's easier
    to mock `submitTurn`'s POST response directly to carry the result state instead. Not yet
    checked this run.
- (b) Some other mocking technique (queued/controllable stream) — not investigated.

Relevant already-read files for this (don't re-read, use notes): `index.tsx` (`advanceOnDurableEvent`,
`bootstrapOnboarding`), `controls.tsx` (all control components + exact button/role labels),
`model.ts` (`derivePhase`, `expectedTools`), `mock-modules.ts` (`mockExternalWebModuleFromDist`,
invoke-route mock pattern), `apps/web/src/chat/assistant-surface/handle.ts` (network call mapping:
`submitTurn`→POST `/api/chat/turn`, `uploadAttachment`→POST `/api/chat/attachments`,
`seedOnboarding`→POST `/api/chat/module-onboarding`), `apps/web/src/chat/use-chat-stream.ts`
(EventSource wiring, `TranscriptRecord` shape, strict `parseRecord`).

No `@axe-core/playwright` exists in this repo (confirmed absent) — meet the "no a11y violations"
requirement via existing role/aria Playwright assertions, don't add a new dependency.

## Constraints (unchanged, repeat)

DB-less only (no `verify:foundation`, no DB). No push/PR without explicit supervisor grant. Stage
only your own files when committing (never `git add -A` on the shared worktree). Leave the
untracked stale doc `docs/superpowers/handoffs/2026-07-20-lane-e-1198-onboarding-ui.md` alone —
not superseded by us, not ours to clean up.
