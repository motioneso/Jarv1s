# Lane E #1198 onboarding UI — Task 4 relay

## Scope

- Plan: `docs/superpowers/plans/2026-07-20-job-search-onboarding-ui.md`, Task 4 (lines 419-479)
  and Task 5 Step 2 (lines 496-507). Read those ranges only.
- Branch/worktree: `feat/1198-onboarding-ui`, same worktree — do not create a new one.
- Supervisor: pane label `Coord 1193 Supervisor 5` — re-resolve fresh via `herdr pane list`
  before ANY escalation. Never push/PR without explicit grant.
- My pane label this session: `Build Lane E 1198 T3b` (session `27941069-3d24-4450-b360-8ae4c0999a57`).

## Status

- Task 1 `5e16e2da`, Task 2 `455fdc43`, **Task 3 `5d81154f` + `fd3fd322`** — done, green, do not
  touch (onboarding orchestration + root gate; 71/71 unit tests, build, check:external-modules,
  format, lint, typecheck all green).
- Reported Task-3-only as "gate-ready" — **DENIED by supervisor**: plan requires Task 4 (e2e) +
  full Task 5 gate before any lane gate-ready claim. Verbatim denial is in this session's
  transcript if needed, but the punch list below is complete.
- **Task 4: not started.** `tests/e2e/js1198-job-search-onboarding.spec.ts` does not exist yet.

## Critical finding — do not re-derive

**`assistantSurface` is ALWAYS provided by the real host**, unconditionally, whenever an external
module mounts (`apps/web/src/app.tsx` `ExternalModuleMount`, ~line 334-351, calls
`createAssistantSurfaceHandle(moduleId, subscribeRecords)` and passes it as a prop every time — no
gate). My Task 3 `FailClosedFirstRun` fallback in `root.tsx` is real defensive code but is
**unreachable in production** and probably unreachable in `js06-module-surface.spec.ts` too.

**This likely breaks an existing test**: `tests/e2e/js06-module-surface.spec.ts` line ~291-305,
`"first-run state still replaces every tab with the Lane E placeholder"` — it asserts heading
`"Setting up your job search"` with no tabs, mounted via `mockExternalWebModuleFromDist` (which
renders inside the REAL host, so `assistantSurface` WILL be present). With Task 3's code, that
means `JobsOnboarding` mounts instead of the fail-closed card, and its initial render is
`LoadingState label="Loading job search setup"` (eyebrow "Loading", not heading "Setting up your
job search"). **This test has not been run since Task 3 landed — run it first, fix/update as
needed** (likely: update the test's expectation to match `JobsOnboarding`'s real loading state, OR
confirm bootstrap resolves fast enough in the mock that a later assertion is more appropriate).

## API mechanics for the e2e mock (traced, not guessed)

- `handle.seedOnboarding()` → `POST /api/chat/module-onboarding` body `{moduleId}` →
  `{ok: boolean}` (`apps/web/src/api/client.ts:852`, `apps/web/src/chat/assistant-surface/handle.ts:12`).
- `handle.submitTurn({text, controlContext, attachmentIds})` → `POST /api/chat/turn` body
  `{text, controlContext?, attachmentIds?}` (`client.ts:836`).
- `handle.uploadAttachment(file)` → `POST /api/chat/attachments`, octet-stream body, headers
  `x-jarvis-mime-type`, `x-jarvis-file-name` (percent-encoded) (`client.ts:865`).
- `handle.subscribeRecords(listener)` is wired to the host's chat SSE stream
  (`GET /api/chat/stream`, `text/event-stream`, lines `data: {json}\n\n`). See
  `tests/e2e/assistant-surface.spec.ts` for the exact mocking pattern (mock the stream route once,
  serve `reply`/`action_request` records). **Still need to check**
  `apps/web/src/chat/use-chat-stream.ts` for the real `TranscriptRecord` union — specifically the
  `action_result` kind's field names/outcome values — to build accurate SSE fixtures matching
  Task 3's `AssistantRecordMirror` (`messageId`/`actionRequestId`/`toolName`/`outcome`). Not yet
  read this session.
- Tool reads (`job-search.onboarding.get-state`, `.profile.get`, `.resume.get`, `.sources.list`)
  go through `**/api/ai/assistant-tools/*/invoke*`, same as `js06-module-surface.spec.ts`'s
  `mockExternalWebModuleFromDist` fixtures dict.

## Files to read before writing the spec (none read yet this relay)

- `apps/web/src/chat/use-chat-stream.ts` — real `TranscriptRecord` kind union + field names.
- `external-modules/job-search/src/web/screens/onboarding/controls.tsx` — Task 2, already
  committed, DO NOT MODIFY — read for exact scripted question copy/order per phase (titles, comp,
  workmode, locations, dealbreakers, sources, review) to assert plan's "every scripted
  question/control in order".
- `apps/web/src/chat/assistant-surface/surface.tsx` — the real `Surface` component: composer
  selectors, file-upload UI, `.assistant-surface`/`.assistant-surface__row`/`.action-request-card`
  class names (already partly seen via `assistant-surface.spec.ts`).
- `tests/e2e/js06-module-surface.spec.ts` (full file already read this session, no need to re-read)
  and `tests/e2e/assistant-surface.spec.ts` (full file already read, no need to re-read) — both are
  the structural templates for the new spec.

## Task 4 exact requirements (plan lines 432-447, do not re-derive, just implement)

RED-then-GREEN Playwright spec asserting: non-done state renders onboarding + no tabs; seed route
called once; invalid type / >5MiB never upload; valid PDF/DOCX upload sends attachment id +
filename text + control context; extraction/upload failure re-arms upload AND paste fallback sends
manual resume text through the assistant turn (never a module-web write); every scripted
question/control/copy appears in order; denied profile approval retains Dealbreakers control +
retry copy; executed-alone does not advance until fresh tool state changes; boards require valid
URL/token and create one combined turn with no Workday; done Summary + "Go to Job Search" reloads
into final tabs; no a11y violations in authored controls (repo likely has an axe helper — grep
existing specs for `AxeBuilder` or similar before assuming one needs adding).

## Task 5 full gate (verbatim, plan lines 496-507 — previous report was missing e2e/tokens/file-size)

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

Playwright + chromium ARE installed in this worktree (`npx playwright --version` → 1.60.0,
`~/.cache/ms-playwright/chromium-1223` present) — confirmed runnable this session. If it fails for
environment reasons on the successor's run, STOP and report the exact error to the supervisor, do
not skip silently (explicit supervisor instruction).

## Next concrete steps

1. Read the 3 files listed above (by section, not full blind reads where avoidable).
2. Write RED spec, run it, confirm fails at first missing onboarding assertion (not a syntax
   error).
3. Implement minimal mocks/fixtures inline (no shared helper changes unless a REST boundary truly
   can't be expressed otherwise), get all 3 e2e specs green together, fixing `js06` if the
   first-run test needs updating for Task 3's real behavior.
4. Commit: `test(job-search): cover guided onboarding flow` (plan line 474-479 has exact message).
5. Run the full Task 5 gate above, capture every command's exit status as evidence.
6. Re-resolve `Coord 1193 Supervisor 5` fresh, report gate-ready with full commit list + command
   evidence (or report a blocking error verbatim, do not skip a check silently).

## Hard constraints (repeat, do not drop)

DB-less only: no `verify:foundation`, no DB, no push, no PR without explicit supervisor grant.
