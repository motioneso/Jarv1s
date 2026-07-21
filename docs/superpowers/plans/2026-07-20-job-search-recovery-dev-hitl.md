# Job Search Recovery and Dev HITL Implementation Plan

**Status:** Proposed — code is blocked pending Ben's explicit approval  
**Date:** 2026-07-20  
**Parent:** #1193  
**Spec:** `docs/superpowers/specs/2026-07-20-job-search-recovery-dev-hitl.md`

## Goal

Make the first Job Search journey work on the dev instance:

`resume upload → real critique → resume approval → durable reload`

Stop after Ben tests and approves this slice. Do not build profile intake, sources, monitoring,
registry promotion, or production deployment.

## Build Approach

Use one fresh worktree from current `origin/main` and execute the tasks sequentially in the root
agent. This is a small, tightly coupled recovery slice: both gateway fixes touch the same hot file,
and the UI tasks share the same transcript contract. Parallel build agents would add coordination
without shortening the critical path.

Use TDD one seam at a time. The approved spec already confirms these public seams:

1. `AssistantToolGateway.requestNativeToolPermission()` for native transport permission;
2. `AssistantToolGateway.callTool()` and transcript records for logical action completion;
3. the external-module `ai` callback for structured critique generation;
4. `AssistantSurfaceHandleV1` plus rendered module UI for onboarding behavior;
5. the exact dev artifact and real browser journey for human acceptance.

No new dependency, executor, permission store, state machine, or UAT framework is needed.

## Task 0: Create the recovery issue and isolated worktree

**Files:**

- Add the approved spec and this plan to the recovery branch.

### Steps

1. Create one GitHub `task` issue titled `Job Search recovery: resume upload, critique, and
approval`. Its body must say `Part of #1193`, link the spec and plan, repeat the hard HITL stop,
   and include a user-facing summary. Add the native parent/child relationship to #1193.
2. Add the issue to project `Jarv1s Roadmap` and move only that child item to `In Progress`. Do not
   move or use parent #1193 as the implementation issue. Do not attach it to the #1179 batch.
3. Fetch without changing the shared checkout, then create:

   ```bash
   git fetch origin
   git worktree add ~/Jarv1s/.claude/worktrees/job-search-recovery \
     -b fix/<issue>-job-search-recovery origin/main
   ```

4. Add the approved spec and plan to that worktree using explicit paths. Confirm the worktree is
   otherwise clean and record its starting SHA.
5. Notify the Herdr pane labeled `Coordinator` of the child issue, branch, worktree, and exact file
   boundary before touching product code.

**Gate:** A dedicated child issue exists, the branch is based on current `origin/main`, and the
Coordinator confirms no overlap.

## Task 1: Remove raw Jarvis transport prompts and emit terminal auto-run results

**Files:**

- Modify: `packages/ai/src/gateway/gateway.ts`
- Modify: `tests/unit/mcp-gateway-units.test.ts`

### 1A. Jarvis MCP transport

1. Add one failing gateway test proving a valid first-party `mcp__jarvis__...` tool name returns
   `allow` from `requestNativeToolPermission()` without a pending action row, notifier record,
   timezone lookup, or YOLO lookup.
2. Add a table-driven failing test proving an empty suffix, a near-match namespace, another MCP
   server, and an ordinary native tool remain outside that allow rule.
3. Run:

   ```bash
   pnpm vitest run tests/unit/mcp-gateway-units.test.ts
   ```

   Expected: RED because Jarvis MCP transport still enters the native confirmation path.

4. Add the smallest exact predicate at the current `NATIVE_READONLY_AUTO_ALLOW` fast path. It may
   allow only a normalized name in the first-party `mcp__jarvis__<non-empty-tool>` namespace. Do
   not add arbitrary MCP names to the existing set.
5. Re-run the focused test and expect GREEN.

### 1B. Logical tool terminal results

1. Add a failing `callTool()` test for a successful non-read YOLO action. Assert one standalone
   `action_result` with the logical tool name, stable request ID, and `executed` outcome.
2. Add the same assertion for a successful policy-driven trusted-auto action and an `error` result
   for handler failure. Confirmed actions retain their existing request/result pair.
3. Run the focused file and verify RED on the trusted-auto event, which is currently absent.
4. Reuse the gateway's existing notifier call shape. Emit one terminal result after every non-read
   direct execution, for both YOLO and policy-auto branches. Do not create a synthetic
   `action_request` and do not change confirmation or audit policy.
5. Re-run and expect GREEN.

### Task 1 commit

Stage only the two files and commit with the child issue number, a release-note summary, and the
required co-author trailer.

## Task 2: Wire the existing CLI structured adapter into the module AI bridge

**Files:**

- Modify: `apps/api/src/external-module-ai-bridge.ts`
- Modify: `apps/api/src/server.ts`
- Create: `tests/unit/external-module-ai-bridge.test.ts`
- Modify: `external-modules/job-search/src/worker/handlers/resume.ts`
- Modify: `tests/unit/external-module-job-search-handlers-resume.test.ts`

### 2A. Bridge wiring

1. Add one failing bridge test with:
   - a CLI-auth provider/model selected by the repository seam;
   - an injected structured adapter returning known schema-valid JSON;
   - an assertion that the module receives only `{ ok: true, object }`;
   - assertions that CLI credential decryption is not attempted and provider/model/usage metadata
     does not cross the module boundary.

2. Run:

   ```bash
   pnpm vitest run tests/unit/external-module-ai-bridge.test.ts
   ```

   Expected: RED because `createModuleAiBridge()` does not accept or pass a CLI adapter.

3. Add the existing `createCliStructuredAdapter` dependency to `createModuleAiBridge()` and pass it
   unchanged to `generateStructured()`.
4. In the API composition root, create it with the already-exported
   `createCliStructuredAdapterFactory(options.chatEngineFactory)`. Do not introduce a provider name,
   model ID, second router, or wrapper factory.
5. Re-run the focused bridge test and `pnpm typecheck`; expect GREEN.

### 2B. Truthful critique failure

1. Add one failing resume-handler test proving `needs_config` returns a provider-agnostic question
   that says structured AI is not configured for this instance. Keep the existing generic retry
   language for `provider_error` and `validation_failed`.
2. Run:

   ```bash
   pnpm vitest run tests/unit/external-module-job-search-handlers-resume.test.ts
   ```

3. Add the single `needs_config` branch at the existing `result.ok === false` boundary. Do not add
   UI/provider-specific error types.
4. Re-run and expect GREEN.

### Task 2 commit

Stage only the five listed files and commit with the child issue number, release-note summary, and
co-author trailer.

## Task 3: Advance onboarding from confirmed or standalone terminal results

**Files:**

- Modify: `external-modules/job-search/src/web/screens/onboarding/index.tsx`
- Modify: `tests/unit/job-search-web-onboarding.test.tsx`

### Steps

1. Add failing tests around `advanceOnDurableEvent()` proving:
   - the existing paired request/result path still refreshes;
   - a standalone `executed` result refreshes when its `toolName` is expected by the active phase;
   - standalone `error`, `allowed`, stale, unmatched, and duplicate results do not advance;
   - denied confirmed actions mark retry without advancing.

2. Add a component-level failing test proving overlapping result deliveries cause one serialized
   bootstrap at a time and only fresh durable state changes the phase.
3. Run:

   ```bash
   pnpm vitest run tests/unit/job-search-web-onboarding.test.tsx
   ```

   Expected: RED because standalone results currently require a pending action request.

4. Extend the existing event helper and subscription with the minimum state needed to recognize and
   deduplicate terminal logical action results. Preserve request/result correlation for confirmed
   actions. Keep `bootstrapOnboarding()` as the only advancement authority and serialize refreshes.
5. Re-run and expect GREEN.

### Task 3 commit

Stage only the two listed files and commit with the child issue number, release-note summary, and
co-author trailer.

## Task 4: Restore the intended onboarding shell and composer behavior

**Files:**

- Modify: `external-modules/job-search/src/web/screens/onboarding/index.tsx`
- Modify if required by the existing class contract:
  `external-modules/job-search/src/web/styles.ts`
- Modify: `tests/unit/job-search-web-onboarding.test.tsx`
- Modify: `apps/web/src/chat/assistant-surface/surface.tsx`
- Modify: `apps/web/src/chat/assistant-surface/assistant-surface.css`
- Modify: `tests/e2e/assistant-surface.spec.ts`

### 4A. Right rail and authored failures

1. Add a failing Job Search render test proving resume intake uses the approved two-column shell,
   renders the existing `ProfileAside`, and shows its Resume row as not yet set.
2. Add a failing test proving blocked/disabled/error bootstrap results render the existing authored
   `ErrorState` with truthful copy rather than an empty generic Assistant Surface.
3. Reuse `ProfileAside`, `ErrorState`, and existing `ob2`/`jsm-*` classes. Add CSS only if the
   approved grid or responsive collapse is not already present. Do not redesign the rail.

### 4B. Jarvis identity and keyboard behavior

1. Extend the existing Assistant Surface browser test to prove local Jarvis rows and typing/control
   rows have the approved visible Jarvis mark/identity.
2. Add browser assertions that:
   - Enter submits one non-empty turn;
   - Shift+Enter inserts a newline without submitting;
   - composition does not submit prematurely;
   - the Send button remains equivalent.

3. Run:

   ```bash
   pnpm exec playwright test tests/e2e/assistant-surface.spec.ts --project=chromium
   ```

   Expected: RED because the textarea has no key handler and local rows have no visible identity.

4. Add the established Enter/Shift+Enter semantics directly to the existing form textarea, guarded
   for composition. Add the smallest token-only avatar/identity markup and CSS needed by the
   approved Assistant Surface design. Do not add a second composer component.
5. Run:

   ```bash
   pnpm vitest run tests/unit/job-search-web-onboarding.test.tsx
   pnpm exec playwright test tests/e2e/assistant-surface.spec.ts --project=chromium
   pnpm check:design-tokens
   ```

   Expected: GREEN.

### Task 4 commit

Stage only files actually changed from the list above and commit with the child issue number,
release-note summary, and co-author trailer.

## Task 5: Prove the exact first slice in the built bundle

**Files:**

- Modify: `tests/e2e/js1198-job-search-onboarding.spec.ts`
- Modify only if a regression requires it:
  `tests/unit/external-module-job-search-bundle.test.ts`

### Steps

1. Extend the existing real-bundle/mocked-boundary browser suite with one narrow resume-flow
   scenario. Cover:
   - valid upload sends the attachment ID and import control context;
   - no raw transport permission content renders;
   - confirm-run refreshes only after the terminal result and changed durable state;
   - auto-run refreshes from a standalone terminal result;
   - an unchanged durable snapshot leaves the dropzone active;
   - a changed snapshot removes the dropzone and renders the critique/approval phase;
   - approval followed by reload restores the approved checkpoint;
   - the right rail and Jarvis identity remain visible.

2. Build before running the real-bundle test:

   ```bash
   pnpm build:external:job-search
   pnpm exec playwright test \
     tests/e2e/js1198-job-search-onboarding.spec.ts \
     tests/e2e/assistant-surface.spec.ts \
     tests/e2e/js06-module-surface.spec.ts \
     --project=chromium
   pnpm vitest run \
     tests/unit/external-module-job-search-bundle.test.ts \
     tests/unit/job-search-web-core.test.tsx \
     tests/unit/job-search-web-screens.test.tsx
   ```

3. Expect all commands GREEN. Do not add a second browser harness or publish a registry artifact.
4. Commit the focused browser proof with the child issue number, release-note summary, and co-author
   trailer.

## Task 6: Run gates, deploy to dev, and stop for Ben

### Automated gate

Run focused checks first, then the repository gate:

```bash
pnpm build:external:job-search
pnpm vitest run \
  tests/unit/mcp-gateway-units.test.ts \
  tests/unit/external-module-ai-bridge.test.ts \
  tests/unit/external-module-job-search-handlers-resume.test.ts \
  tests/unit/job-search-web-onboarding.test.tsx \
  tests/unit/job-search-web-core.test.tsx \
  tests/unit/job-search-web-screens.test.tsx \
  tests/unit/external-module-job-search-bundle.test.ts
pnpm exec playwright test \
  tests/e2e/js1198-job-search-onboarding.spec.ts \
  tests/e2e/assistant-surface.spec.ts \
  tests/e2e/js06-module-surface.spec.ts \
  --project=chromium
pnpm check:design-tokens
pnpm verify:foundation
pnpm audit:release-hardening
git diff --check
```

Fix only failures caused by this slice. Record every command and exit code.

### Exact dev artifact

1. Record the source commit and exact build hashes:

   ```bash
   git rev-parse HEAD
   sha256sum \
     external-modules/job-search/jarvis.module.json \
     external-modules/job-search/dist/worker.js \
     external-modules/job-search/dist/web/index.js
   ```

2. Put that exact build on the dev instance using the existing local external-module path; do not
   publish or install through the production registry.
3. Confirm the dev account has a real CLI-auth model with JSON capability selected through the
   normal service router. Record capability and route outcome, never credentials.
4. Before handing off to Ben, run the real journey once through the API, gateway, worker,
   actor-scoped attachment extraction/storage, and CLI structured-AI bridge. No AI stub is allowed.
5. Provide Ben the checklist from approved spec §12 plus the commit, artifact checksum, dev URL, and
   any expected outcome-based action cards.

### Hard stop

Stop and wait for Ben's explicit `approve` or `reject with notes` verdict. Do not start the next Job
Search phase, promote an artifact, open a production deployment, or change the app-wide permission
default.

## Exit Criteria

- Raw `mcp__jarvis__...` permission cards are gone; logical gateway policy remains enforced.
- YOLO, trusted-auto, and confirmed writes all emit/consume the correct terminal result shape.
- Job Search critique reaches the configured CLI structured adapter and returns real critique data.
- Resume import removes the stale dropzone only after durable state proves completion.
- Enter, Shift+Enter, and composition behavior are correct.
- The approved right rail, Jarvis identity, and truthful failure state render in the dev build.
- Focused checks, full gates, exact-artifact smoke, and Ben's checklist are green.
- No later Job Search phase, registry promotion, or production change has begun.
