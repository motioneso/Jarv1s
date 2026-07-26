# PDF attachment extraction in the production bundle — Implementation Plan

> **Issue:** [#1179](https://github.com/motioneso/Jarv1s/issues/1179)  
> **Grounded on:** `origin/main` at `01fd7d41` (2026-07-19). A 5.6-luna collision scout verified the only drift from the original `f35ca3f9` grounding touched unrelated settings UI/test files.

**Goal:** Make text-based PDF attachments readable from the shipped `dist/server.js` bundle and leave a safe warning when extraction genuinely fails.

**Root cause:** esbuild inlines `pdf-parse`/pdf.js into `dist/server.js`; pdf.js then resolves its fake worker as `./pdf.worker.mjs`, but the API build does not place that asset in `dist/`. The existing tsx test passes because the unbundled dependency resolves its own adjacent worker.

**Approach:** Keep `pdf-parse` bundled. During the API build, copy the worker exposed by the installed `pdf-parse/worker` package into `dist/pdf.worker.mjs`. In the extraction function, use the public `PDFParse.setWorker()` API with the adjacent asset's absolute file URL when that asset exists; otherwise preserve the dependency's working unbundled default. Add one regression that bundles and executes the real extraction path, plus one focused warning test.

**Non-goals:** No PDF library replacement, Dockerfile-only copy, attachment protocol/UI change, scriptable UAT chat engine, timeout tuning, or retry logic. If the reported ~157-second tool timeout remains after extraction works, file a separate issue with fresh evidence.

## Global constraints

- Never log attachment bytes, extracted text, filenames, actor IDs, or vault paths. The warning contains only a fixed prefix and the parser error message.
- Use Node stdlib and the already-installed `pdf-parse`; add no dependency or new runtime abstraction.
- Keep build behavior identical for the worker target; only the API target needs the PDF worker asset.
- All paths in commands are repo-relative from `~/Jarv1s`.
- Run the bundled regression serially because it writes the shared `dist/` build output.

---

## Task 1: Ship and select the pdf.js worker from the API bundle

**Files:**

- Modify: `scripts/build-app.ts`
- Modify: `packages/chat/src/attachments-service.ts`
- Create: `tests/unit/pdf-attachment-bundle.test.ts`

**Behavioral contract:** `pnpm build:api` produces `dist/pdf.worker.mjs`; a bundled copy of the real `extractPdfText` path reads the existing one-page PDF fixture and returns `Hello attachment`. Unbundled tsx execution continues using pdf-parse's package-local default.

- [ ] **Step 1: Write the failing bundled regression**

  Create `tests/unit/pdf-attachment-bundle.test.ts` with one test (120-second timeout) that:
  1. Runs `pnpm build:api` from the repository root.
  2. Asserts `dist/pdf.worker.mjs` exists.
  3. Creates a temporary directory with `mkdtemp` and registers cleanup with `rm(..., { recursive: true, force: true })`.
  4. Uses the installed `esbuild` API to bundle a tiny stdin entry that imports the real `extractPdfText` from `packages/chat/src/attachments-service.ts`, embeds the same minimal one-page PDF bytes already used by `tests/integration/chat-attachments-service.test.ts`, calls the function, and writes the extracted text to stdout. Use the production settings that matter to this bug: `bundle: true`, `platform: "node"`, `target: "node24"`, and `format: "esm"`.
  5. Copies the built `dist/pdf.worker.mjs` beside the temporary bundle, executes it with `process.execPath`, and expects stdout to contain `Hello attachment` and not the fallback note.

  Export `extractPdfText` directly from `attachments-service.ts` for this test; do not re-export it from the package barrel. It remains an internal module seam, not a new public package API.

- [ ] **Step 2: Run the test and confirm the production-shaped failure**

  Run:

  ```bash
  pnpm exec vitest run tests/unit/pdf-attachment-bundle.test.ts --maxWorkers=1
  ```

  Expected: FAIL because `pnpm build:api` does not create `dist/pdf.worker.mjs` (and, if execution continues, pdf.js cannot set up its fake worker).

- [ ] **Step 3: Copy the installed worker during API builds**

  In `scripts/build-app.ts`:
  - Import `copyFileSync` from `node:fs` and `createRequire` from `node:module`.
  - Create a resolver rooted at `packages/chat/package.json`, so pnpm resolves the dependency declared by `@jarv1s/chat` rather than assuming a root-hoisted package.
  - Resolve the exported `pdf-parse/worker` entry and derive its sibling `../pdf.worker.mjs` path.
  - After the API bundle succeeds, copy that file to the directory containing the API outfile as `pdf.worker.mjs`.
  - Leave the worker target unchanged. Building both targets naturally retains the asset copied by the API target.

  Keep this in the build script rather than the Dockerfile so bare `node dist/server.js` deployments receive the same artifact.

- [ ] **Step 4: Select the adjacent asset without breaking tsx/dev**

  In `packages/chat/src/attachments-service.ts`:
  - Import `existsSync` from `node:fs`.
  - Define the candidate once as `new URL("./pdf.worker.mjs", import.meta.url)`.
  - Immediately after dynamically importing `{ PDFParse }`, call `PDFParse.setWorker(candidate.href)` only when `existsSync(candidate)` is true.

  In a production bundle, `import.meta.url` points at `dist/server.js`, so the URL is absolute and matches the copied file. In tsx/dev, no worker sits beside `attachments-service.ts`, so the code leaves pdf-parse's currently working package-local default alone.

- [ ] **Step 5: Run focused checks**

  Run:

  ```bash
  pnpm exec vitest run tests/unit/pdf-attachment-bundle.test.ts --maxWorkers=1
  pnpm exec vitest run tests/integration/chat-attachments-service.test.ts
  pnpm typecheck
  ```

  Expected: all PASS; `dist/pdf.worker.mjs` exists after the bundle test.

- [ ] **Step 6: Commit green**

  ```bash
  git add scripts/build-app.ts packages/chat/src/attachments-service.ts tests/unit/pdf-attachment-bundle.test.ts
  git commit -m "fix(chat): ship pdf worker with api bundle (#1179)"
  ```

---

## Task 2: Warn safely when PDF extraction fails

**Files:**

- Modify: `packages/chat/src/attachments-service.ts`
- Modify: `tests/integration/chat-attachments-service.test.ts`

**Behavioral contract:** Parser failures still return `[PDF text extraction failed for this attachment]`, but emit exactly one warn-level diagnostic containing the error message and no attachment data.

- [ ] **Step 1: Write the failing warning test**

  In `tests/integration/chat-attachments-service.test.ts`:
  - Add `vi` to the Vitest import.
  - Spy on `console.warn` and suppress its test output.
  - Save bytes that pass the `%PDF` magic-byte check but are deliberately invalid and contain a unique sentinel string.
  - Call `readContent` and assert the existing fallback note is returned.
  - Assert `console.warn` was called once with a fixed PDF-extraction prefix and a string error message.
  - Assert the serialized warning arguments do not contain the sentinel, filename, attachment ID, or actor ID.
  - Restore the spy in `finally` so a failing assertion cannot leak it into sibling tests.

- [ ] **Step 2: Run the test and confirm it fails**

  Run:

  ```bash
  pnpm exec vitest run tests/integration/chat-attachments-service.test.ts
  ```

  Expected: FAIL because the current catch silently returns the fallback.

- [ ] **Step 3: Log only the parser error message**

  Change `extractPdfText`'s outer `catch` to capture `error`, call `console.warn` once with a stable `[chat-attachments] PDF text extraction failed:` prefix and `error instanceof Error ? error.message : "Unknown PDF parser error"`, then return the unchanged fallback note.

  Do not pass the `Error` object itself: a fixed prefix plus the message is the minimum useful prod diagnostic and avoids incidental object fields or stack/context leakage.

- [ ] **Step 4: Run focused checks and commit green**

  ```bash
  pnpm exec vitest run tests/integration/chat-attachments-service.test.ts
  pnpm lint
  pnpm format:check
  pnpm typecheck
  git add packages/chat/src/attachments-service.ts tests/integration/chat-attachments-service.test.ts
  git commit -m "fix(chat): warn when PDF extraction fails (#1179)"
  ```

---

## Task 3: Verify the real artifact and user flow

**Files:** none unless verification exposes a defect.

- [ ] **Step 1: Run the repository gates**

  ```bash
  pnpm verify:foundation
  pnpm audit:release-hardening
  pnpm build:api
  test -f dist/pdf.worker.mjs
  node --check dist/server.js
  ```

  Expected: every command exits 0.

- [ ] **Step 2: Run the existing real attachment UAT**

  ```bash
  pnpm test:uat -- 1133-chat-attachments
  ```

  Expected: PASS. This protects the real drawer upload, vault write, and turn-ID wiring. Do not add a mocked Playwright PDF-response test; it cannot execute pdf.js and would not catch this regression.

- [ ] **Step 3: Perform live dev acceptance with a configured chat provider**

  On a dev instance using the #1000 production-shaped stack and an already-authorized chat provider:
  1. Open the chat drawer.
  2. Attach a text-based PDF containing a unique phrase.
  3. Ask Jarv1s to quote that phrase.
  4. Confirm the assistant answers from the PDF, with neither the fallback note nor a tool timeout.

  Record the result on #1179. This remains manual because the current #1000 seed intentionally has no chat-capable provider; implementing the separately tracked scriptable engine is outside this bug fix.

- [ ] **Step 4: Verify after deployment**

  Repeat the same PDF turn in production and confirm successful extracted-text output. If extraction fails, capture the new fixed-prefix warning without copying private content into GitHub. If the ~157-second timeout reproduces after successful extraction, open a separate issue rather than adding timeout/retry changes here.

## Exit criteria

- `dist/server.js` and adjacent `dist/pdf.worker.mjs` are produced by `pnpm build:api` outside Docker.
- The production-shaped bundled regression extracts `Hello attachment`.
- The existing unbundled PDF extraction test remains green.
- A malformed PDF returns the same user-safe fallback and emits one content-free warning.
- Real dev and production drawer turns answer from a text-based PDF without timing out.
