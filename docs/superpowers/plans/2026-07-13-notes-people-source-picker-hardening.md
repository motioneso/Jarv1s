# Notes and People source-picker hardening (#987) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development to
> implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This is a
> sensitive build: keep every vault operation inside `VaultContext` and every protected database
> operation inside `DataContextDb`.

**Goal:** Replace raw Notes and People path entry with safe folder selection, explain how an
operator exposes a missing Notes mount, return truthful People refresh outcomes, and separate
manual person creation from synchronized People records without changing its note-first behavior.

**Architecture:** Add one immediate-child directory-list operation to `@jarv1s/vault`, then expose
it through the People module using the existing `AccessContext` -> `withVaultContext` boundary.
Keep external Notes discovery on its existing allowlisted absolute-path route. Generalize the
existing settings chooser only as a two-mode component: mapped Notes paths and owner-relative
People paths share presentation, not storage rules. Change the People scan to return parsed notes
and counters from one filesystem pass, then keep the last explicit refresh result in the pane for
actionable guidance. For delete review, reuse `AppShell`'s owner-scoped transcript and thread the
existing stable action-request ID through `ChatControls` and `ChatDrawer`; the matching existing
card remains the only resolver.

**Tech Stack:** Node filesystem/path standard library, Fastify + TypeBox, `DataContextDb`,
`VaultContext`, React + TanStack Query, existing Jarv1s settings primitives/CSS, Vitest, and
Playwright.

## Global constraints

- The approved spec is
  `docs/superpowers/specs/2026-07-12-notes-people-source-picker-hardening.md`; both approval
  questions were accepted on PR #1008.
- Preserve the separate trust domains: external Notes paths remain operator-mounted absolute
  paths returned by `/api/me/notes-source/directories`; People paths remain relative to the
  signed-in owner's `VaultContext`.
- Preserve `AccessContext`, `DataContextDb`, `VaultContext`, owner-only RLS, and metadata-only job
  payload invariants. Do not add raw filesystem access outside `@jarv1s/vault`.
- Do not add a migration, table, dependency, job, shared-data model, provider/model choice, or
  cross-module table query.
- Do not edit `tests/uat/**`, `docs/coordination/**`, chat approval resolution/policy, chat routes,
  gateway policy, chat styles, module install/run files, or settings shell/navigation outside the
  four UI paths Ben approved on PR #1044. Reuse the existing owner-scoped live action request;
  shell/chat changes are limited to carrying its stable ID, opening chat, and focusing its card.
- The refresh response schema, if present, must declare all four counters: `discovered`,
  `projected`, `ignored`, and `candidates`. Prove the serialized response with `app.inject`.
- Requests, stored People folder values, and People directory responses are relative paths only.
  Reject absolute paths, traversal, and symlink escape; error responses must not expose a vault
  root, actor UUID, or another owner's directory names.
- Reuse the authored `jds-*`, chooser, `Group`, `Row`, `Note`, loading, error, and empty-state
  patterns. Do not add raw colors. Start with the existing responsive rules in
  `apps/web/src/styles/settings-panes-3.css`; edit that file only if the narrow Playwright check
  demonstrates a real overflow/reachability failure.
- Stage only the explicit files named by each task. Never use `git add -A` or `git add .`.

---

## File map

### Product files

- Modify: `packages/vault/src/vault-ops.ts` — add sorted immediate-child directory discovery using
  existing path and symlink containment.
- Modify: `packages/vault/src/index.ts` — export the new vault operation/type.
- Modify: `packages/people/src/routes.ts` — add owner-relative directory discovery, validate saved
  folders in the same owner's vault, and serialize the four-counter refresh result.
- Modify: `packages/people/src/notes-service.ts` — tighten relative-folder normalization and return
  one-pass scan counts.
- Modify: `packages/people/src/types.ts` — expand `PeopleNotesRefreshResult` to four counters.
- Modify: `packages/people/src/index.ts` — publicly export the module-owned unavailable-folder
  error consumed by the module registry.
- Modify: `packages/module-registry/src/index.ts` — keep an unavailable People folder from failing
  the unrelated Notes after-sync worker.
- Modify: `apps/web/src/api/people-client.ts` — add People directory contracts/client and expand the
  refresh result contract.
- Modify: `apps/web/src/api/query-keys.ts` — add path-keyed People directory cache keys.
- Modify: `apps/web/src/settings/settings-vault-chooser.tsx` — remove raw entry and support only the
  two approved chooser modes.
- Modify: `apps/web/src/settings/settings-personal-data-panes.tsx` — use mapped-Notes mode, render
  recovery copy, and remove the fake delete-approval chip.
- Modify: `apps/web/src/settings/settings-people-pane.tsx` — use owner-vault mode, render refresh
  outcomes, focus review, and separate manual creation.
- Modify: `apps/web/src/shell/chat-controls-context.ts` — expose the current pending delete summary
  and one stable-ID open/focus command to Settings.
- Modify: `apps/web/src/shell/app-shell.tsx` — derive unresolved owner-scoped `notes.delete` records
  and own the one-shot chat action target.
- Modify: `apps/web/src/chat/chat-drawer.tsx` — pass the target only to the transcript card whose
  `actionRequestId` matches.
- Modify: `apps/web/src/chat/action-request-card.tsx` — focus/scroll its existing root when it is
  the requested target, then acknowledge the one-shot focus.
- Conditional only: `apps/web/src/styles/settings-panes-3.css` — minimal responsive correction if
  the new narrow acceptance test fails with the existing rules.

### Test files

- Modify: `tests/unit/notes-source-directories.test.ts`
- Modify: `tests/integration/vault.test.ts`
- Modify: `packages/people/src/__tests__/notes-service.test.ts`
- Modify: `packages/people/src/__tests__/routes.test.ts`
- Modify: `tests/people-client.test.ts`
- Modify: `tests/unit/settings-people-pane.test.tsx`
- Modify: `tests/unit/module-registry-people-notes-source-behavior.test.ts`
- Modify: `tests/unit/action-request-card-preview.test.tsx`
- Create: `tests/unit/settings-vault-chooser.test.tsx`
- Create: `tests/e2e/mock-notes-people-api.ts`
- Modify: `tests/e2e/mock-api.ts`
- Create: `tests/e2e/settings-notes-people.spec.ts`

No deployment-doc edit is needed: `docs/operations/deploy.md#notes-mount` already documents the
mount. Link the UI to that existing section.

---

### Task 1: Add the owner-vault directory-list primitive

**Files:**

- Modify: `tests/integration/vault.test.ts`
- Modify: `packages/vault/src/vault-ops.ts`
- Modify: `packages/vault/src/index.ts`

**Interface:**

```ts
export interface VaultDirectoryEntry {
  readonly name: string;
  readonly path: string;
}

export function listVaultDirectories(
  ctx: VaultContext,
  relativeDir?: string
): Promise<VaultDirectoryEntry[]>;
```

The returned `path` is relative to the current `VaultContext` root. This operation lists immediate
children only; it is not a general filesystem browser.

- [ ] **Step 1: Write failing containment and result-shape tests**

  In `tests/integration/vault.test.ts`, import `listVaultDirectories` and add focused tests that:
  - create `People`, `Archive`, a nested `People/Family`, and a regular file;
  - expect the root call to return sorted `[{ name: "Archive", path: "Archive" },
{ name: "People", path: "People" }]` only;
  - expect `listVaultDirectories(ctx, "People")` to return only
    `{ name: "Family", path: "People/Family" }`;
  - reject `../other-user`, the in-vault traversal `People/../Archive`, an absolute path (including
    an absolute path that happens to point inside the current vault), and a requested directory
    reached through a symlink escaping the vault;
  - prove a context for user A never returns a directory created in user B's vault.

- [ ] **Step 2: Run the focused test and confirm RED**

  Run: `pnpm vitest run tests/integration/vault.test.ts`

  Expected: FAIL because `listVaultDirectories` is not exported.

- [ ] **Step 3: Implement the smallest vault operation**

  In `packages/vault/src/vault-ops.ts`:
  - before normalization or `resolveVaultPath`, reject an absolute `relativeDir` and any raw path
    segment exactly equal to `..`; this must reject in-vault traversal such as
    `People/../Archive`, which resolution alone would normalize to an allowed path;
  - call `assertVaultContext`, `resolveVaultPath`, and the existing `assertNoSymlinkEscape` exactly
    as `listVaultFiles`/`listVaultFilesRecursive` do;
  - call `readdir(fullPath, { withFileTypes: true })` once;
  - keep only real immediate directory entries (`entry.isDirectory()`), build owner-relative paths,
    and sort by name with `localeCompare`;
  - return only `{ name, path }`; never return `fullPath`, `vaultRoot`, or `actorUserId`.

  Export the function and entry type from `packages/vault/src/index.ts`. Do not expose
  `assertNoSymlinkEscape` or create a second path-containment helper.

- [ ] **Step 4: Run GREEN checks**

  Run:

  ```bash
  pnpm vitest run tests/integration/vault.test.ts
  pnpm --filter @jarv1s/vault typecheck
  ```

  Expected: PASS.

- [ ] **Step 5: Commit explicit paths**

  ```bash
  git add tests/integration/vault.test.ts packages/vault/src/vault-ops.ts packages/vault/src/index.ts
  git commit -m "feat(vault): list owner-relative child directories"
  ```

---

### Task 2: Expose owner-scoped People discovery and validate saved folders

**Files:**

- Modify: `packages/people/src/__tests__/routes.test.ts`
- Modify: `packages/people/src/notes-service.ts`
- Modify: `packages/people/src/routes.ts`

**HTTP contract:**

```text
GET /api/people/notes-directories?path=<relative-or-empty>
-> { path: string | null, directories: [{ name: string, path: string }] }
```

`PUT /api/people/notes-settings` accepts `null`, `.`, the fixed `People` destination, or an
existing directory discoverable in that same owner's vault. `People` is allowed before creation;
all other non-null folders must exist at save time.

- [ ] **Step 1: Write failing route tests**

  Extend the route harness so `buildApp(actorUserId = ids.userA)` can mount the same routes for two
  actors. Add `app.inject` tests that prove:
  - root discovery returns only sorted immediate, owner-relative child directories;
  - `?path=People` returns relative descendants and never contains the vault base path or actor ID;
  - `GET /api/people/notes-directories?path=People/../Archive` returns the same safe 400 response as
    other invalid paths;
  - user A cannot observe user B's private directory through root listing, traversal, an absolute
    user-B path, or a symlink from A's vault;
  - invalid path requests receive a safe 400 response whose body contains no attempted absolute
    path, vault root, actor UUID, or private directory name;
  - PUT accepts `People` even when it does not exist yet, accepts an existing nested directory,
    accepts `.` and `null`, and rejects an absolute/traversal/nonexistent non-default folder;
  - PUT with `{ folder: "People/../Archive" }` returns the same safe 400 response, without an
    attempted path, vault root, actor UUID, or private directory name in the body;
  - a previously stored folder can still be returned by GET after it is removed, while a new PUT
    of that stale value is rejected. This preserves visibility so the UI can replace or clear it.

- [ ] **Step 2: Run the route suite and confirm RED**

  Run: `pnpm vitest run packages/people/src/__tests__/routes.test.ts`

  Expected: FAIL because the discovery route and validation do not exist.

- [ ] **Step 3: Tighten stored-folder normalization**

  In `packages/people/src/notes-service.ts`, keep `normalizeFolder` small but stop converting an
  absolute path into a relative one by stripping leading slashes. Before normalization, reject any
  raw path segment exactly equal to `..`, including `People/../Archive`; then normalize the trimmed
  path with the Node path standard library, allow `.`, and reject empty, absolute, or traversal
  results. This is defense in depth; vault ownership/existence validation remains in the route
  because it requires a `VaultContext`.

- [ ] **Step 4: Add route schemas and vault-scoped handlers**

  In `packages/people/src/routes.ts`:
  - define one reusable TypeBox directory-entry/response schema near `notesSettingsSchema`;
  - add `GET /api/people/notes-directories` with an optional string query parameter;
  - reject any raw GET query path or PUT folder containing a segment exactly equal to `..` before
    normalization, before allowing `People`/`.`, and before checking directory discoverability;
  - resolve `AccessContext`, require the existing `vaultRunner`, enter `withVaultContext`, and call
    `listVaultDirectories(vaultCtx, requestedPath || ".")`;
  - return `path: null` for the root request and the requested relative path otherwise;
  - map `VaultPathError`, missing-directory, and symlink failures to one safe 400 message such as
    `People notes folder is unavailable`; do not serialize the underlying filesystem error;
  - wrap PUT validation in the same actor's `withVaultContext`; allow `People` and `.` directly,
    otherwise list the selected folder's parent and require an exact returned path match before
    calling `notesService.putSettings` inside `withDataContext`;
  - let `folder: null` clear the preference without filesystem discovery.

  Do not query another module's tables and do not add a raw `fs` import to the People package.

- [ ] **Step 5: Run GREEN checks**

  Run:

  ```bash
  pnpm vitest run packages/people/src/__tests__/routes.test.ts
  pnpm --filter @jarv1s/people typecheck
  ```

  Expected: PASS.

- [ ] **Step 6: Commit explicit paths**

  ```bash
  git add packages/people/src/__tests__/routes.test.ts packages/people/src/notes-service.ts packages/people/src/routes.ts
  git commit -m "feat(people): browse and validate owner-vault folders"
  ```

---

### Task 3: Return truthful People refresh counts in one scan

**Files:**

- Modify: `packages/people/src/__tests__/notes-service.test.ts`
- Modify: `packages/people/src/__tests__/routes.test.ts`
- Modify: `packages/people/src/notes-service.ts`
- Modify: `packages/people/src/types.ts`
- Modify: `packages/people/src/routes.ts`
- Modify: `packages/people/src/index.ts`
- Modify: `packages/module-registry/src/index.ts`
- Modify: `tests/unit/module-registry-people-notes-source-behavior.test.ts`

**Interface:**

```ts
export interface PeopleNotesRefreshResult {
  readonly discovered: number;
  readonly projected: number;
  readonly ignored: number;
  readonly candidates: number;
}
```

- [ ] **Step 1: Write failing service outcome tests**

  Update existing assertions to compare all four counters, then add one mixed-folder test with:
  - one valid canonical Markdown note;
  - one parseable note missing `jarvisPersonId` (a candidate, not ignored);
  - one Markdown file with invalid/missing People frontmatter (ignored);
  - one non-Markdown file (outside every count).

  Expect `discovered: 3`, `projected: 1`, `ignored: 1`, and `candidates: 1`, plus the existing
  candidate record. Add a stale/missing configured-folder test that rejects rather than returning
  a successful all-zero result. Preserve `{ 0, 0, 0, 0 }` only when no folder is configured; the
  explicit UI already disables refresh in that state, and the background Notes after-sync hook
  relies on the no-preference case being a no-op.

  In `tests/unit/module-registry-people-notes-source-behavior.test.ts`, add a regression test for
  the automatic Notes after-sync caller: a refresh that rejects with
  `PeopleNotesFolderUnavailableError` must resolve without failing Notes sync. A different error
  must still reject so programming/database failures are not hidden. Import the error from the
  public `@jarv1s/people` entry point so this test also fails if the barrel export is missing.

- [ ] **Step 2: Write the failing serialized route test**

  In `packages/people/src/__tests__/routes.test.ts`, configure a folder with the mixed files, POST
  `/api/people/notes/refresh`, and assert the parsed body exactly contains all four counters. This
  is the fast-json-stringify regression check: no counter may disappear from the response.

  Also POST with a stale selected folder and assert a safe non-2xx response that tells the caller
  to choose another folder without exposing an absolute path.

- [ ] **Step 3: Run RED**

  Run:

  ```bash
  pnpm --filter @jarv1s/people test
  pnpm vitest run tests/unit/module-registry-people-notes-source-behavior.test.ts
  ```

  Expected: FAIL on the old two-counter result, silent missing-folder behavior, and the unhandled
  stale-folder exception in the automatic Notes after-sync caller.

- [ ] **Step 4: Make the scan return notes plus counts**

  In `PeopleNotesService`, change the private loader from `LoadedPeopleNote[]` to one result object
  containing `notes`, `discovered`, and `ignored`:
  - call `listVaultFilesRecursive` once;
  - filter Markdown paths once;
  - set `discovered` from that list;
  - read/parse each Markdown file once, pushing parsed notes and incrementing `ignored` when
    `parsePeopleNote` returns null;
  - do not rescan or reread to calculate counts;
  - translate a configured folder that no longer exists/is readable into one module-owned
    `PeopleNotesFolderUnavailableError` without embedding a path.

  Update `refreshFromFolder` to consume that result, preserve the existing duplicate/missing-ID/
  missing-canonical candidate logic, and return all four counters.

- [ ] **Step 5: Add the explicit refresh response schema**

  Define `peopleNotesRefreshResultSchema` with all four required numeric properties and attach it
  as the 200 response schema for POST `/api/people/notes/refresh`. Catch only
  `PeopleNotesFolderUnavailableError` and convert it to a safe recoverable HTTP error; do not hide
  unrelated database/programming failures.

  In the module registry's Notes `afterSync` callback, catch only
  `PeopleNotesFolderUnavailableError` around `refreshFromFolder` and return without People
  projection. This automatic best-effort caller must not turn a stale optional People preference
  into a failed Notes sync. Do not put the catch in `runNotesAfterSyncHook`: other hook failures
  must still propagate, and the explicit People refresh route must still return its safe non-2xx
  recovery response. Export the error from `packages/people/src/index.ts`, and import it in the
  module registry from the public `@jarv1s/people` entry point rather than a package-internal path.

- [ ] **Step 6: Run GREEN checks**

  Run:

  ```bash
  pnpm --filter @jarv1s/people test
  pnpm --filter @jarv1s/people typecheck
  pnpm vitest run tests/unit/module-registry-people-notes-source-behavior.test.ts
  pnpm --filter @jarv1s/module-registry typecheck
  ```

  Expected: PASS, including the exact `app.inject` four-counter body.

- [ ] **Step 7: Commit explicit paths**

  ```bash
  git add packages/people/src/__tests__/notes-service.test.ts packages/people/src/__tests__/routes.test.ts packages/people/src/notes-service.ts packages/people/src/types.ts packages/people/src/routes.ts packages/people/src/index.ts packages/module-registry/src/index.ts tests/unit/module-registry-people-notes-source-behavior.test.ts
  git commit -m "feat(people): report truthful notes refresh outcomes"
  ```

---

### Task 4: Add thin People directory and refresh web contracts

**Files:**

- Modify: `tests/people-client.test.ts`
- Modify: `apps/web/src/api/people-client.ts`
- Modify: `apps/web/src/api/query-keys.ts`

- [ ] **Step 1: Write failing client tests**

  Extend `tests/people-client.test.ts` to prove:
  - `getPeopleNotesDirectories(null)` calls `/api/people/notes-directories`;
  - a nested relative path is encoded in `?path=` and no absolute vault prefix is invented;
  - `refreshPeopleNotes()` preserves a mocked body containing all four counters.

- [ ] **Step 2: Run RED**

  Run: `pnpm vitest run tests/people-client.test.ts`

  Expected: FAIL because the directory client and expanded refresh type do not exist.

- [ ] **Step 3: Add only the needed contracts and functions**

  In `people-client.ts`, add local DTOs matching the route and a
  `getPeopleNotesDirectories(path: string | null)` wrapper using `URLSearchParams` for non-null
  paths. Replace the anonymous two-counter refresh return type with a named four-counter DTO.

  In `query-keys.ts`, add:

  ```ts
  notesDirectories: (path: string | null) => ["people", "notes-directories", path] as const;
  ```

  Keep these contracts local to the existing People client; do not add a new shared package file
  for a single web consumer.

- [ ] **Step 4: Run GREEN checks**

  Run:

  ```bash
  pnpm vitest run tests/people-client.test.ts
  pnpm --filter @jarv1s/web typecheck
  ```

  Expected: PASS.

- [ ] **Step 5: Commit explicit paths**

  ```bash
  git add tests/people-client.test.ts apps/web/src/api/people-client.ts apps/web/src/api/query-keys.ts
  git commit -m "feat(web): add People folder discovery contracts"
  ```

---

### Task 5: Make the chooser selection-only in Notes and People modes

**Files:**

- Create: `tests/unit/settings-vault-chooser.test.tsx`
- Modify: `tests/unit/action-request-card-preview.test.tsx`
- Modify: `apps/web/src/settings/settings-vault-chooser.tsx`
- Modify: `apps/web/src/settings/settings-personal-data-panes.tsx`
- Modify: `apps/web/src/shell/chat-controls-context.ts`
- Modify: `apps/web/src/shell/app-shell.tsx`
- Modify: `apps/web/src/chat/chat-drawer.tsx`
- Modify: `apps/web/src/chat/action-request-card.tsx`
- Conditional only: `apps/web/src/styles/settings-panes-3.css`

**Component contract:** Keep the exported `VaultChooser` and add one discriminant such as
`mode: "notes" | "people"`; do not introduce a filesystem-provider framework or new component
hierarchy.

- [ ] **Step 1: Write failing render tests**

  Build the new test with the repository's existing `renderToString` + pre-seeded `QueryClient`
  pattern. Cover:
  - Notes mode renders only returned mapped roots/children and has no textbox, `Type a path on the
server`, `Go`, or arbitrary-path affordance;
  - an empty/503 Notes-root state renders the exact headline
    `No notes folders are available to Jarv1s.` plus `/data/external-notes`,
    `JARVIS_NOTES_ROOTS`, container recreation guidance, and a link to the Notes Mount docs;
  - People mode renders owner-relative returned directories plus a recommended `People` choice
    even when it was not returned because it does not exist yet;
  - `SourcesPane` never renders a static delete-approval count; with no concrete pending deletion it
    renders `Deleting a note always asks you in chat before anything is removed.` and no review
    link;
  - with a concrete owner-scoped pending `notes.delete`, `SourcesPane` renders the item awaiting
    deletion, explains that destructive deletion requires explicit approval, and renders
    `Review deletion` for that request's stable `actionRequestId`.

  In `tests/unit/action-request-card-preview.test.tsx`, assert an action card exposes its unchanged
  `actionRequestId` on the focusable root and that the existing Approve/Reject controls and preview
  contract remain unchanged. The full matching/non-matching focus behavior is exercised in Task 7
  with a real browser because server rendering has no focus API.

- [ ] **Step 2: Run RED**

  Run: `pnpm vitest run tests/unit/settings-vault-chooser.test.tsx`

  Expected: FAIL on the old raw input, missing People mode, missing recovery, and fake chip.

- [ ] **Step 3: Convert `VaultChooser` to two explicit modes**

  In `settings-vault-chooser.tsx`:
  - delete `typed`, `submitTyped`, the server-path input, and its now-unused icon import;
  - select the query key/function and user copy directly from the two modes;
  - Notes mode continues to use `getNotesSourceDirectories` and absolute mapped paths returned by
    that route;
  - People mode uses `getPeopleNotesDirectories` and owner-relative paths only;
  - synthesize the fixed recommended `People` destination at the root when absent; selecting that
    missing recommendation must remain usable without issuing a failing child-directory query;
  - preserve the current loading/error/empty list, root buttons, path crumb, cancel, and
    `Use this folder` behavior;
  - for a stale non-default People selection, keep its value visible, render it unavailable, and
    leave root choices/cancel reachable so it can be replaced;
  - distinguish a Notes-root 503/empty result from unrelated failures. Render the operator recovery
    block only for the former; render `readError(error)` for other failures;
  - link to the repository's public
    `docs/operations/deploy.md#notes-mount` page in a new tab with `rel="noopener noreferrer"`.

  Only values from a discovery response or the fixed `People` recommendation can reach
  `onChoose`.

- [ ] **Step 4: Update the Notes card honestly**

  In `SourcesPane`, pass Notes mode, remove the static lock/delete-approval chip (and an unused
  `Lock` import only if no other use remains). Extend the existing `ChatControls` value with only:
  - `pendingNotesDelete: { actionRequestId: string; summary: string } | null`;
  - `openActionRequest(actionRequestId: string): void`.

  In `AppShell`, derive `pendingNotesDelete` from its existing owner-scoped live transcript: choose
  the latest `action_request` with `toolName === "notes.delete"`, a non-empty
  `actionRequestId`, and no matching `action_result`. Do not fetch another endpoint or copy the
  approval state into Settings. Make `openActionRequest` store that stable ID and open the drawer.

  Pass the one-shot target ID into `ChatDrawer`. `RecordRow` must mark only the
  `ActionRequestCard` whose `actionRequestId` exactly matches. On that card's existing focusable
  root, expose the stable ID, scroll it into view, focus it when targeted, and acknowledge success
  so `AppShell` clears the target; also clear it when the drawer closes. A different action card
  must not focus. This is prop/context plumbing only: do not use a global DOM query, add a new chat
  state store, or change resolve behavior.

  `SourcesPane` consumes that context: when `pendingNotesDelete` exists, show its safe item
  summary, explain why destructive deletion requires explicit approval, and make
  `Review deletion` call `openActionRequest` with that exact ID. When none exists, render only the
  approved honest sentence and no review link. Do not add a second resolver, query another
  module's table, or fabricate a count.

- [ ] **Step 5: Run GREEN checks**

  Run:

  ```bash
  pnpm vitest run tests/unit/settings-vault-chooser.test.tsx tests/unit/action-request-card-preview.test.tsx tests/unit/notes-source-directories.test.ts
  pnpm --filter @jarv1s/web typecheck
  ```

  Expected: PASS.

- [ ] **Step 6: Keep CSS evidence-driven**

  Do not edit CSS now. Task 7 exercises the existing 620px chooser rule at 390px. If that test
  demonstrates overflow or unreachable actions, make the smallest token-only correction in
  `settings-panes-3.css`, rerun `pnpm check:design-tokens`, and include the path in this task's
  commit. Do not create a new stylesheet.

- [ ] **Step 7: Commit explicit paths**

  ```bash
  git add tests/unit/settings-vault-chooser.test.tsx tests/unit/action-request-card-preview.test.tsx apps/web/src/settings/settings-vault-chooser.tsx apps/web/src/settings/settings-personal-data-panes.tsx apps/web/src/shell/chat-controls-context.ts apps/web/src/shell/app-shell.tsx apps/web/src/chat/chat-drawer.tsx apps/web/src/chat/action-request-card.tsx
  # Add apps/web/src/styles/settings-panes-3.css only if Step 6 produced a verified fix.
  git commit -m "feat(settings): replace Notes path entry with safe folder choices"
  ```

---

### Task 6: Render actionable People outcomes and separate manual creation

**Files:**

- Modify: `tests/unit/settings-people-pane.test.tsx`
- Modify: `apps/web/src/settings/settings-people-pane.tsx`

- [ ] **Step 1: Write failing presentation/helper tests**

  Because this repo's unit harness uses server rendering rather than DOM event simulation, add one
  small pure helper in the pane for refresh guidance and test its branches directly. Prove:
  - zero discovered points to choosing a folder or manual creation;
  - ignored > 0 explains invalid/missing People-note frontmatter;
  - candidates > 0 enables a `Review matches` action;
  - the rendered pane has `Choose folder` rather than a free-form `People folder` textbox;
  - `People` (the synchronized list) appears before a distinct `Add a person manually` group;
  - the manual form is absent/disabled until a folder is selected, and its copy says it creates a
    canonical Markdown People note in the selected Jarv1s folder.

- [ ] **Step 2: Run RED**

  Run: `pnpm vitest run tests/unit/settings-people-pane.test.tsx`

  Expected: FAIL on the raw input, missing guidance helper, and mixed manual/synchronized group.

- [ ] **Step 3: Replace folder draft entry with the People chooser**

  In `SettingsPeoplePane`:
  - replace `folderDraft` with a `choosingFolder` boolean;
  - make the save mutation accept the selected relative path and pass People mode to
    `VaultChooser`;
  - keep the configured folder visible in the summary; add clear/replace actions so a stale value
    can be removed without re-saving it;
  - on selection, save via PUT, update `queryKeys.people.notesSettings`, and close the chooser;
  - never prepend `/data/vaults`, the actor ID, or any absolute prefix.

- [ ] **Step 4: Persist and render the last explicit refresh result**

  Add local `PeopleNotesRefreshResultDto | null` state. On successful refresh, store the result,
  invalidate People/candidates queries as today, and render all four labeled counts in a
  `role="status"` region. Use the tested helper for guidance:
  - `discovered === 0`: choose another folder or add a person manually;
  - `ignored > 0`: explain invalid/missing People-note frontmatter;
  - `candidates > 0`: render a real `Review matches` button.

  Give the existing review group a ref and programmatic focus target (`tabIndex={-1}`); the button
  scrolls/focuses that exact owner-scoped section. On a stale-folder refresh error, retain the
  configured value and show safe choose-again guidance; do not replace it with an all-zero result.

- [ ] **Step 5: Separate the manual note-first flow**

  Remove the create row from the synchronized `People` group. After the People list, add
  `Add a person manually` with the approved explanation. Keep the existing POST and note-first
  mutation unchanged; hide the form (or render a disabled explanatory row) until a folder is
  selected. Do not change edit/archive semantics.

- [ ] **Step 6: Run GREEN checks**

  Run:

  ```bash
  pnpm vitest run tests/unit/settings-people-pane.test.tsx
  pnpm --filter @jarv1s/web typecheck
  ```

  Expected: PASS.

- [ ] **Step 7: Commit explicit paths**

  ```bash
  git add tests/unit/settings-people-pane.test.tsx apps/web/src/settings/settings-people-pane.tsx
  git commit -m "feat(settings): make People refresh outcomes actionable"
  ```

---

### Task 7: Prove desktop, no-root, keyboard, and narrow flows in Playwright

**Files:**

- Create: `tests/e2e/mock-notes-people-api.ts`
- Modify: `tests/e2e/mock-api.ts`
- Create: `tests/e2e/settings-notes-people.spec.ts`
- Conditional only: `apps/web/src/styles/settings-panes-3.css`

- [ ] **Step 1: Add a focused stateful mock registrar**

  Follow the existing `mock-*-api.ts` pattern. Define a small mutable state for only the endpoints
  this flow mounts and register handlers for:
  - Notes source GET/PUT, directory GET, last-sync GET, and sync POST;
  - People notes settings GET/PUT, directory GET, refresh POST, People/candidate GET, and manual
    person POST;
  - one concrete owner-scoped pending `notes.delete` chat action with an item summary and stable
    action-request ID, plus one non-matching action card so exact targeting is observable.

  The directory fixtures must preserve the two path domains: mapped Notes paths are container
  absolute paths; People paths are owner-relative. Support a zero-roots Notes fixture and a mixed
  four-counter refresh fixture. Extend `MockApiState` and call the registrar from `mockApi` after
  the catch-all so existing specs remain unchanged.

- [ ] **Step 2: Write the desktop happy-path test**

  At 1440x900:
  1. Open `/settings?section=sources`, browse a returned mapped Notes descendant, assert no
     server-path textbox exists, select it, and run Sync now. Assert the concrete pending deletion
     names its item and explains approval, activate `Review deletion`, and assert the chat drawer
     opens, the card with the same stable `actionRequestId` receives focus, and the non-matching
     action card does not.
  2. Open `/settings?section=memory`, activate the `People & context` segment, choose a returned
     owner-relative folder, and refresh.
  3. Assert `discovered`, `projected`, `ignored`, and `candidates` values are all visible.
  4. Activate `Review matches` and assert the existing review section receives focus.
  5. Add a manual person from the separate group and assert the stateful refetch renders it in the
     People list.

- [ ] **Step 3: Write the desktop no-root recovery test**

  Mock zero/unavailable Notes roots. Assert the exact recovery headline, mount path, env variable,
  recreate guidance, and docs link. Assert no textbox or arbitrary path submission exists.

- [ ] **Step 4: Write the narrow keyboard/reachability test**

  At 390x844, repeat both chooser paths using keyboard activation for folder/use/back/cancel where
  applicable. Assert refresh results and review action remain visible and keyboard reachable.
  Finish with:

  ```ts
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth
    )
  ).toBe(true);
  ```

- [ ] **Step 5: Run the new spec and correct only demonstrated CSS failures**

  Run:

  ```bash
  pnpm playwright test tests/e2e/settings-notes-people.spec.ts --project=chromium
  ```

  Expected: PASS. If the narrow assertion fails because of chooser/action layout, make the minimum
  token-only change in `settings-panes-3.css`, then rerun the Playwright command and
  `pnpm check:design-tokens`.

- [ ] **Step 6: Commit explicit paths**

  ```bash
  git add tests/e2e/mock-notes-people-api.ts tests/e2e/mock-api.ts tests/e2e/settings-notes-people.spec.ts
  # Add apps/web/src/styles/settings-panes-3.css only if Step 5 required it.
  git commit -m "test(settings): cover Notes and People folder selection"
  ```

---

### Task 8: Run the sensitive-build verification gate and hand off live acceptance

**Files:** No planned product changes.

- [ ] **Step 1: Run focused regression suites**

  ```bash
  pnpm vitest run \
    tests/unit/notes-source-directories.test.ts \
    tests/integration/vault.test.ts \
    packages/people/src/__tests__/notes-service.test.ts \
    packages/people/src/__tests__/routes.test.ts \
    tests/people-client.test.ts \
    tests/unit/module-registry-people-notes-source-behavior.test.ts \
    tests/unit/action-request-card-preview.test.tsx \
    tests/unit/settings-people-pane.test.tsx \
    tests/unit/settings-vault-chooser.test.tsx
  pnpm playwright test tests/e2e/settings-notes-people.spec.ts --project=chromium
  ```

  Expected: PASS.

- [ ] **Step 2: Run the full foundation gate**

  Run: `pnpm verify:foundation`

  Expected: exit 0. This includes lint, formatting, file-size, design-token, package-boundary,
  typecheck, unit, migration, and integration checks.

- [ ] **Step 3: Verify scope and secrets**

  ```bash
  git diff --check
  git status --short
  git diff --name-only origin/main...HEAD
  ```

  Confirm no `tests/uat/**`, `docs/coordination/**`, migration, chat approval resolution/policy,
  chat route/gateway/style, module install/run, secret, absolute vault path, actor ID, or private
  content entered the diff/log/job payloads. The only chat UI paths are the four approved stable-ID
  open/focus files from Task 5.

- [ ] **Step 4: Record the coordinator-owned deployed acceptance gate**

  Before production merge, the UX Coordinator runs the desktop+narrow flow against the deployed
  candidate with a real mapped Notes root and an owner vault containing one valid, one invalid, and
  one review-needed People note. The builder reports the commit SHA, focused commands/exit codes,
  foundation result, Playwright result, and any conditional CSS change; the builder does not edit
  `tests/uat/**`, merge, or update tracking.

---

## Deliberate omissions

- No host filesystem browser or host-path input: the Notes allowlist route already owns safe
  discovery.
- No generalized filesystem adapter: a two-mode chooser covers the two approved domains.
- No new shared API package contract: the People web client is the only consumer.
- No second approvals inbox/action resolver: settings links a concrete pending deletion to its
  existing chat action card and otherwise shows no review link.
- No chat redesign or new state store: the existing transcript, context provider, drawer, and card
  carry one stable ID and clear the one-shot focus target.
- No People-note migration or move into the external Notes mount.
- No speculative CSS: add it only when the narrow acceptance check proves it necessary.
