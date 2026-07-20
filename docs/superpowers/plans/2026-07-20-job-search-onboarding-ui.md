# Job Search Onboarding UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `coordinated-build` and
> `superpowers:test-driven-development` to execute this plan task by task. Do not use the
> Superpowers execution/subagent skills in this repo.

**Goal:** Replace Job Search's first-run placeholder with the approved guided Jarvis conversation,
including real resume upload, durable phase advancement, profile/source controls, and the two
confirm-gated worker tools required by issue #1198.

**Architecture:** Keep module web reads on the existing read-only tool boundary and route every
write through `AssistantSurfaceHandleV1.submitTurn`. A small pure onboarding model derives the UI
phase from fresh worker state; focused React files render controls and orchestrate the host-owned
assistant surface. New worker handlers reuse existing resume and onboarding domain paths instead of
creating parallel persistence.

**Tech stack:** TypeScript, host-provided React runtime, Assistant Surface v1.1, module-sdk worker
ports, token-only `jds-*`/`jsm-*` CSS, Vitest, Playwright Chromium.

## Global Constraints

- Planning base: PR #1212 head `ffa8105d29380cbbdee72751e4ef8db2a1b0f85f`; implementation
  starts only after PR #1212 merges and this branch rebases onto fresh `origin/main`.
- No product code before `Coord 1193 Supervisor 3` approves this plan.
- Module web remains read-only. Every write is a confirm-gated assistant proposal.
- Worker `deriveStep`/`STEP_ORDER` remains the single server-side checkpoint authority.
- Advance UI only after a matching `action_result` with outcome `executed` triggers fresh reads
  whose returned state proves the checkpoint complete. Denied/error results retain active control.
- Profile answers batch into one `profile.save-draft` plus one `profile.approve`; enabled boards
  batch into one turn containing one `monitor.save` proposal per board.
- Dropzone accepts PDF/DOCX only and rejects files above 5 MiB before upload. Uploaded resume text
  never transits through module web or model tool arguments.
- Prototype copy is verbatim except mandated deltas: FileText glyph, no Workday, sans eyebrows,
  token mapping from approved spec, no emoji.
- Hostile strings render as React text only. Resume body never renders; CritiqueCard receives only
  designed critique/evidence fields.
- No new dependency. Reuse host Assistant Surface, module runtime, worker validation/domain helpers,
  Lane D `kit.tsx`, and existing mocked REST/browser seams.
- DB-less verification only until supervisor grants otherwise. Never run `verify:foundation`, create
  a DB, push, or open a PR without explicit supervisor grant.
- Stage explicit paths only. Every implementation commit includes a user-facing release-note
  summary and `Co-Authored-By: Claude` trailer.

## Verified Branch State

- Current branch is `feat/1198-onboarding-ui`, based on `fc72b7cb`; only lane handoff is untracked.
- Lane A and Lane C contracts are present: `AssistantSurfaceHandleV1`, module onboarding seeding,
  control context, `attachments.readText`, and actor-scoped attachment ownership checks.
- Job Search manifest guidance already names `resume.import-attachment`, but neither requested tool
  exists in manifest or worker registry.
- Current Job Search `WorkerPorts` does not expose `ctx.attachments`; `worker/index.ts` must adapt it.
- PR #1212's `root.tsx` has `FirstRunPlaceholder`, four final tabs, and no assistant-surface prop.
- PR #1212 supplies `kit.tsx` and final `styles.ts`; onboarding must extend, not duplicate, them.
- `profile.get` returns approved `active.fields` plus draft IDs only. It cannot restore buffered,
  unapproved profile values.
- `monitor.list` returns board identity/schedule metadata but intentionally omits private query data.
- Existing `resume.save-draft` manual path already enforces input size, immutable-original/history,
  idempotent revisions, and `resume_intake` advancement; import should call that path.

## Supervisor Decisions Required at Approval

1. **Mid-profile reload conflicts with one-write batching.** Required UAT reloads at compensation
   and restores the right sub-step/ProfileAside, but no approved server read exposes unapproved
   title values and the spec forbids a profile write before dealbreakers. Browser storage would hold
   private profile data without an actor-scoped key; per-step profile writes would violate batching
   and add confirmation cards. Recommended MVP: preserve one-write batching and restore the server
   checkpoint only; after reload, restart profile at Titles with approved fields prefilled. If exact
   comp-step restoration is mandatory, supervisor must choose a contract change.
2. **Reset scope is unspecified.** Recommended MVP: reset only the onboarding checkpoint record and
   local UI buffer, retaining approved resume/profile/monitor history. Existing approved values seed
   the restarted controls; new approvals supersede them. Destructive clearing of active pointers or
   monitors requires explicit product authorization and domain helpers.
3. **Prototype source values are not valid adapter configs.** Greenhouse, Lever, and Ashby each
   require a company-specific board token or URL (`query.board`/`query.url`); strings such as
   “Product Design · Remote US” cannot enable a fresh monitor. Recommended MVP: retain prototype
   board rows/copy but add one required board URL/token `AddInput` per enabled source, then send that
   validated value in `monitor.save`. Hardcoded company boards or silently failing proposals are not
   acceptable. Supervisor must approve this design delta or provide another source-discovery input.

---

### Task 1: Confirm-gated reset and deterministic attachment import

**Files:**

- Modify: `external-modules/job-search/src/worker/ai-port.ts`
- Modify: `external-modules/job-search/src/worker/index.ts`
- Modify: `external-modules/job-search/src/worker/handlers/onboarding.ts`
- Modify: `external-modules/job-search/src/worker/handlers/resume.ts`
- Modify: `external-modules/job-search/src/worker/registry.ts`
- Modify: `external-modules/job-search/jarvis.module.json`
- Modify: `tests/unit/external-module-job-search-handlers-onboarding.test.ts`
- Modify: `tests/unit/external-module-job-search-handlers-resume.test.ts`
- Modify: `tests/unit/external-module-job-search-manifest.test.ts`

**Interfaces:**

- Consumes: `ModuleWorkerContext.attachments.readText(attachmentId)`,
  `saveResumeDraftHandler(ports)`, `saveOnboardingState`, `STEP_ORDER`, manifest confirmation gateway.
- Produces: `onboarding.reset` and `resume.import-attachment` handlers; assistant tools
  `job-search.onboarding.reset` and `job-search.resume.import-attachment`.

- [ ] **Step 1: Write failing worker tests**

  Add focused cases proving:

  ```ts
  await expect(importResumeAttachmentHandler(ports)({ attachmentId: "att-1" })).resolves.toEqual({
    status: "ok",
    revisionId: "0",
    fileName: "resume.pdf"
  });
  expect((await getResumeHandler(ports)({ revisionId: "0" })).content).toBe(EXTRACTED_TEXT);
  expect((await getOnboardingState(kv))?.step).toBe("resume_critique");
  ```

  Also assert missing/foreign/image attachment (`readText -> null`) fails without KV writes, absent
  attachment port fails closed, repeat import follows existing manual revision semantics, and reset
  writes `{ schemaVersion: 1, step: "resume_intake", completed: {} }` while preserving revision and
  monitor records under the recommended non-destructive scope.

- [ ] **Step 2: Run tests and verify RED**

  Run:

  ```bash
  pnpm vitest run tests/unit/external-module-job-search-handlers-onboarding.test.ts tests/unit/external-module-job-search-handlers-resume.test.ts tests/unit/external-module-job-search-manifest.test.ts
  ```

  Expected: FAIL because handlers, registry keys, and manifest declarations do not exist; manifest
  count remains 16.

- [ ] **Step 3: Adapt the attachment port and implement minimal handlers**

  Add an optional older-host-safe worker port:

  ```ts
  readonly attachments?: {
    readText(attachmentId: string): Promise<{
      readonly fileName: string;
      readonly mimeType: string;
      readonly text: string;
    } | null>;
  };
  ```

  Map `ctx.attachments` in `worker/index.ts`. Implement import by reading actor-scoped extracted text,
  then delegating to the existing manual handler rather than duplicating size/history rules:

  ```ts
  const attachment = await ports.attachments?.readText(attachmentId);
  if (!attachment)
    throw new InputError("attachmentId must identify a readable document attachment");
  const saved = await saveResumeDraftHandler(ports)({ mode: "manual", content: attachment.text });
  return { ...saved, fileName: attachment.fileName };
  ```

  Implement recommended reset by overwriting only `NS.onboarding/keys.onboardingState` through
  `saveOnboardingState`; do not delete immutable revisions, active pointers, or monitors.

- [ ] **Step 4: Register strict confirm-gated manifest tools**

  Add `risk: "write"`, exact permission IDs, strict `additionalProperties: false`, required
  `attachmentId` for import, empty input for reset, and registry mappings:

  ```ts
  "onboarding.reset": resetOnboardingHandler,
  "resume.import-attachment": importResumeAttachmentHandler
  ```

  Update manifest test count to 18 and include both names in strict-schema/risk assertions.

- [ ] **Step 5: Run tests and verify GREEN**

  Run the Step 2 command.

  Expected: all three files PASS; imported content is byte-identical; registry and manifest expose
  both write tools.

- [ ] **Step 6: Commit task**

  ```bash
  git add external-modules/job-search/src/worker/ai-port.ts external-modules/job-search/src/worker/index.ts external-modules/job-search/src/worker/handlers/onboarding.ts external-modules/job-search/src/worker/handlers/resume.ts external-modules/job-search/src/worker/registry.ts external-modules/job-search/jarvis.module.json tests/unit/external-module-job-search-handlers-onboarding.test.ts tests/unit/external-module-job-search-handlers-resume.test.ts tests/unit/external-module-job-search-manifest.test.ts
  git commit -m "feat(job-search): add onboarding reset and resume import" -m "User-facing summary: Job Search setup can securely import an uploaded resume and restart its guided flow." -m "Co-Authored-By: Claude <noreply@anthropic.com>"
  ```

### Task 2: Pure phase model and Park Press controls

**Files:**

- Create: `external-modules/job-search/src/web/screens/onboarding/model.ts`
- Create: `external-modules/job-search/src/web/screens/onboarding/controls.tsx`
- Create: `tests/unit/job-search-web-onboarding.test.tsx`
- Modify: `external-modules/job-search/src/web/styles.ts`

**Interfaces:**

- Consumes: Lane D `Eyebrow`/`Strap`, host runtime hooks, durable read outputs, exact prototype copy.
- Produces: `OnboardingPhase`, `OnboardingSnapshot`, `derivePhase`, `expectedTools`, `ChipToggle`,
  `AddInput`, `MultiControl`, `SourcesControl`, `ResumeDropzone`, `CritiqueCard`, `ProfileAside`, and
  `Summary`.

- [ ] **Step 1: Write failing pure-model and render tests**

  Cover checkpoint mapping, profile field mapping, compensation parsing, user-bubble/control-context
  payloads, denied retry state, source filtering/config validation, 8-row aside count, exact
  intro/question/closing copy, accessibility names, FileText/no-emoji, and hostile-string escaping.

  Pin the model shape:

  ```ts
  export type OnboardingPhase =
    | "resume_intake"
    | "resume_critique"
    | "resume_approval"
    | "titles"
    | "comp"
    | "workmode"
    | "locations"
    | "dealbreakers"
    | "sources_schedule"
    | "done";

  export function derivePhase(snapshot: OnboardingSnapshot): OnboardingPhase;
  export function expectedTools(phase: OnboardingPhase): readonly string[];
  ```

- [ ] **Step 2: Run tests and verify RED**

  Run:

  ```bash
  pnpm vitest run tests/unit/job-search-web-onboarding.test.tsx
  ```

  Expected: FAIL because onboarding model and controls are absent.

- [ ] **Step 3: Implement minimum pure model**

  Keep worker checkpoint names canonical. For `profile`, derive the first unanswered local sub-step
  from buffered fields; after a reload under recommended MVP, start at Titles with approved active
  fields as defaults. `expectedTools` must include only tools that can advance the active durable
  checkpoint:

  ```ts
  const EXPECTED_TOOLS = {
    resume_intake: ["job-search.resume.import-attachment", "job-search.resume.save-draft"],
    resume_critique: ["job-search.resume.save-draft"],
    resume_approval: ["job-search.resume.approve"],
    dealbreakers: ["job-search.profile.save-draft", "job-search.profile.approve"],
    sources_schedule: ["job-search.monitor.save"]
  } as const;
  ```

  Do not treat an event as completion; it only requests a fresh durable snapshot.

- [ ] **Step 4: Implement controls and token-only styles**

  Recreate prototype controls with native buttons/inputs/file input and existing `jds-*` classes.
  Extend `MODULE_STYLES` with `.ob2` grid `1fr 320px; gap: 30px`, responsive single-column collapse,
  sticky aside, asymmetric bubbles supplied by Assistant Surface, dashed governor card, focus-visible
  states, dropzone states, and reduced-motion handling. Use CSS variables only.

  Resume validation constants remain local and literal:

  ```ts
  const MAX_RESUME_BYTES = 5 * 1024 * 1024;
  const RESUME_TYPES = new Set([
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ]);
  ```

  Extraction/upload failure re-arms the dropzone and reveals the paste textarea fallback. The paste
  path submits the user-provided text through `resume.save-draft` manual mode; it never renders that
  private body back into the onboarding UI. Under the recommended source decision, require one board
  token/URL for each enabled source and keep CTA disabled while any enabled row lacks it.

- [ ] **Step 5: Run tests and design checks**

  Run:

  ```bash
  pnpm vitest run tests/unit/job-search-web-onboarding.test.tsx
  pnpm check:design-tokens
  ```

  Expected: PASS; no raw colors, emoji, mono font, Workday, or resume content.

- [ ] **Step 6: Commit task**

  ```bash
  git add external-modules/job-search/src/web/screens/onboarding/model.ts external-modules/job-search/src/web/screens/onboarding/controls.tsx external-modules/job-search/src/web/styles.ts tests/unit/job-search-web-onboarding.test.tsx
  git commit -m "feat(job-search): add onboarding phase model and controls" -m "User-facing summary: Job Search setup now presents the approved resume, profile, and job-board controls." -m "Co-Authored-By: Claude <noreply@anthropic.com>"
  ```

### Task 3: Assistant Surface orchestration and root first-run gate

**Files:**

- Create: `external-modules/job-search/src/web/screens/onboarding/index.tsx`
- Modify: `external-modules/job-search/src/web/root.tsx`
- Modify: `tests/unit/job-search-web-onboarding.test.tsx`
- Modify: `tests/unit/job-search-web-screens.test.tsx`

**Interfaces:**

- Consumes: structural local mirror of `AssistantSurfaceHandleV1`, `invokeTool`, Task 2 model/controls,
  PR #1212 `RootView`, transcript `action_request`/`action_result` fields.
- Produces: `JobsOnboarding`, fresh `readOnboardingSnapshot`, optional assistant-surface fail-closed
  root state, full scripted flow.

- [ ] **Step 1: Write failing orchestration/root tests**

  Use a fake structural handle to assert:

  ```ts
  expect(seedOnboarding).toHaveBeenCalledOnce();
  expect(submitTurn).toHaveBeenCalledWith({
    text: "Staff Product Designer · Principal Designer",
    controlContext: {
      step: "profile",
      action: "titles",
      values: { targetTitles: ["Staff Product Designer", "Principal Designer"] }
    }
  });
  ```

  Assert free text returns `"handled"` and calls `submitTurn` with current `step/action`; root passes
  the host handle during first run, omits final tabs, and renders a fail-closed card when handle is
  absent.

- [ ] **Step 2: Run tests and verify RED**

  Run:

  ```bash
  pnpm vitest run tests/unit/job-search-web-onboarding.test.tsx tests/unit/job-search-web-screens.test.tsx
  ```

  Expected: FAIL because `JobsOnboarding` and root assistant-surface integration are absent.

- [ ] **Step 3: Implement seed, read, subscribe, and submit lifecycle**

  On mount, run `seedOnboarding()` and the durable-state/source reads in parallel:

  ```ts
  const [onboarding, profile, resume, monitors, sources] = await Promise.all([
    invokeTool<OnboardingState>("job-search.onboarding.get-state"),
    invokeTool<ProfileState>("job-search.profile.get"),
    invokeTool<ResumeState>("job-search.resume.get"),
    invokeTool<MonitorState>("job-search.monitor.list"),
    invokeTool<SourcesState>("job-search.sources.list")
  ]);
  ```

  Author explicit loading/error/older-host states. Render verbatim scripted rows via
  `Surface.localRows`, active control via `Surface.activeControl`, typing via `Surface.typing`, and
  all composer submits through `submitTurn` so current control context is never dropped.

- [ ] **Step 4: Implement durable event advancement**

  Subscribe once. Track action-request IDs whose `toolName` appears in `expectedTools(activePhase)`.
  For a matching result:

  ```ts
  if (
    record.kind === "action_result" &&
    record.outcome === "executed" &&
    record.actionRequestId &&
    pending.has(record.actionRequestId)
  ) {
    const fresh = await readOnboardingSnapshot();
    setSnapshot(fresh);
    setPhase(derivePhase(fresh));
  }
  ```

  Denied/error results append the scripted retry row and retain control. Ignore unmatched and
  `allowed` results. Serialize polls so duplicate stream deliveries cannot race phase state.

- [ ] **Step 5: Implement upload, batching, critique, summary, and reset**

  Validate client file first; call `uploadAttachment(file)`; submit filename text with FileText UI,
  `attachmentIds: [id]`, and this context:

  ```ts
  {
    step: "resume_intake",
    action: "import_resume",
    values: { attachmentId: id }
  }
  ```

  Never read the file body.

  After critique state is durable, render only `critiqueSummary` and bounded evidence labels. Submit
  profile fields together after dealbreakers. Submit enabled Greenhouse/Lever/Ashby monitor configs
  together with supervisor-approved board token/URL values, browser time zone, and selected `HH:MM`.
  Summary's “Go to Job Search” reloads the module route after durable `done`; “Start over” submits
  only `onboarding.reset`.

- [ ] **Step 6: Run focused unit checks and commit**

  Run the Step 2 command plus:

  ```bash
  pnpm build:external:job-search
  pnpm vitest run tests/unit/job-search-web-core.test.tsx tests/unit/external-module-job-search-bundle.test.ts
  ```

  Expected: PASS; bundle reuses host React and imports no core internals.

  ```bash
  git add external-modules/job-search/src/web/screens/onboarding/index.tsx external-modules/job-search/src/web/root.tsx tests/unit/job-search-web-onboarding.test.tsx tests/unit/job-search-web-screens.test.tsx
  git commit -m "feat(job-search): embed guided onboarding conversation" -m "User-facing summary: First-time Job Search setup now runs as a real Jarvis conversation and resumes from confirmed progress." -m "Co-Authored-By: Claude <noreply@anthropic.com>"
  ```

### Task 4: Mocked full-flow browser coverage

**Files:**

- Create: `tests/e2e/js1198-job-search-onboarding.spec.ts`

**Interfaces:**

- Consumes: real `dist/web/index.js`, mocked invoke/seed/upload/turn/SSE boundaries, existing
  `mockApi` and `mockExternalWebModuleFromDist` helpers.
- Produces: browser proof for first-run routing, upload, scripted controls, denied cards, durable
  advancement, summary, and reload behavior.

- [ ] **Step 1: Write failing Playwright scenario**

  Mock REST only. Capture `/api/chat/turn` bodies; serve controlled SSE records with action IDs;
  mutate invoke fixtures only when an `executed` result is emitted. Assert:
  - non-done state renders onboarding and no tabs;
  - seed route is called once;
  - invalid type and >5 MiB never hit upload;
  - valid PDF/DOCX upload sends attachment ID, filename text, and control context;
  - extraction/upload failure re-arms upload and paste fallback sends manual resume text through the
    assistant turn/gateway, never a module-web write;
  - every prototype question/control/copy appears in order;
  - denied profile approval retains Dealbreakers control and shows retry copy;
  - executed result alone does not advance until fresh tool state changes;
  - enabled boards require valid board URL/tokens and create one combined turn with no Workday;
  - done Summary appears, “Go to Job Search” reloads into final tabs;
  - page has no automated accessibility violations in authored controls.

- [ ] **Step 2: Run Playwright and verify RED**

  Run:

  ```bash
  pnpm exec playwright test tests/e2e/js1198-job-search-onboarding.spec.ts --project=chromium
  ```

  Expected: FAIL at first missing onboarding assertion.

- [ ] **Step 3: Add minimal mocks/fixture transitions inside the new spec**

  Keep helpers unchanged unless an existing helper cannot express a REST boundary. Use a local
  fixture state object and route handlers; no DB, worker process, or global e2e mutation.

- [ ] **Step 4: Run full onboarding and sibling screen browser checks**

  Run:

  ```bash
  pnpm exec playwright test tests/e2e/js1198-job-search-onboarding.spec.ts tests/e2e/js06-module-surface.spec.ts tests/e2e/assistant-surface.spec.ts --project=chromium
  ```

  Expected: PASS for onboarding, four-screen regression, and host drawer suppression.

- [ ] **Step 5: Commit task**

  ```bash
  git add tests/e2e/js1198-job-search-onboarding.spec.ts
  git commit -m "test(job-search): cover guided onboarding flow" -m "User-facing summary: Job Search onboarding now has browser coverage for upload, approvals, denial, recovery, and completion." -m "Co-Authored-By: Claude <noreply@anthropic.com>"
  ```

### Task 5: DB-less lane gate and supervisor handoff

**Files:**

- Modify only files required to fix failures from this lane.

**Interfaces:**

- Consumes: Tasks 1–4.
- Produces: clean, gate-ready branch for supervisor-controlled QA/push.

- [ ] **Step 1: Format changed files**

  Run `pnpm prettier --write` with every changed path listed explicitly.

- [ ] **Step 2: Run focused and static gates**

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

  Expected: every command exits 0; all source files stay under 1000 lines.

- [ ] **Step 3: Inspect scope and cleanliness**

  ```bash
  git diff --check
  git status --short
  git log --oneline origin/main..HEAD
  ```

  Expected: no whitespace errors; only intentional lane files; explicit green commits. Do not run
  `verify:foundation`.

- [ ] **Step 4: Report gate-ready**

  Re-resolve exactly one Herdr pane labeled `Coord 1193 Supervisor 3`; report commit list, command
  evidence, remaining UAT-only checks, and request supervisor grant for serialized push/PR handling.

## Exit Review

- First-run state replaces all final tabs with the real Assistant Surface conversation.
- PDF/DOCX files are client-gated, host-uploaded, then imported actor-scoped and byte-identical.
- Verbatim scripted copy and approved Park Press layout/controls render without emoji or raw colors.
- Matching executed action results trigger fresh state reads; durable truth alone advances phases.
- Denied/error/unmatched actions cannot advance or disable the active control.
- Profile and source writes follow supervisor-approved batching/resume decision.
- Reset follows supervisor-approved non-destructive/destructive scope.
- Missing Assistant Surface, seed/read failure, upload failure, empty/loading, and retry states are
  authored and fail closed.
- Worker/unit/browser/static DB-less gates are green; real-engine upload equivalence and screenshots
  remain Lane F UAT responsibilities.
