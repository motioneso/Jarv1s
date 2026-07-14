# PR #1058 QA Remediation Implementation Plan

> **For coordinated build agents:** REQUIRED SUB-SKILL: Use
> `superpowers:test-driven-development`; repo rules disable generic execution/subagent skills.
> Obtain `UX Coordinator` approval before production edits.

**Goal:** Fix all five cycle-2 QA blockers on PR #1058 without changing its approved trust domains or product scope.

**Architecture:** Keep current chooser, People service/routes, settings pane, and stable-ID chat plumbing. Correct state discrimination at existing seams, centralize safe filesystem-error classification in People routes, and prove behavior through focused real-service/route tests plus one stateful Playwright flow at desktop and narrow widths.

**Tech Stack:** React, TanStack Query, Fastify, TypeScript, Vitest, Playwright.

---

## Verified current state

- Current branch/head: `ux/987-notes-people-implementation` at `a0a97b3e9672e2fccfbe9fb7fbba98d83d88370b`; worktree clean.
- Cycle-2 findings remain current. Only post-verdict commit adds the remediation handoff.
- Preserve `DataContextDb`, `VaultContext`, owner-relative responses, metadata-only payloads, module isolation, and safe non-leaking errors.
- No migrations, dependencies, raw product `fs`, approval-store/resolver changes, `tests/uat/**`, `docs/coordination/**`, #995, or PR #1050 work.

## File map

- Modify `apps/web/src/settings/settings-vault-chooser.tsx`: distinguish returned `People` roots from the synthetic recommendation; show Notes recovery only for 503/true-empty roots.
- Modify `tests/unit/settings-vault-chooser.test.tsx`: focused chooser-state regressions.
- Modify `packages/people/src/notes-service.ts`: reject absolute folders before normalization.
- Modify `packages/people/src/routes.ts`: map `ENOENT`/`ENOTDIR`/`EACCES` and `VaultPathError` through one safe classifier.
- Modify `packages/people/src/__tests__/notes-service.test.ts`: mixed-count, unavailable-folder, and service-level absolute-path regressions.
- Modify `packages/people/src/__tests__/routes.test.ts`: cross-owner, symlink, GET/PUT safe-error, and exact serialization coverage.
- Modify `tests/unit/module-registry-people-notes-source-behavior.test.ts`: prove after-sync catches only `PeopleNotesFolderUnavailableError`.
- Modify `apps/web/src/settings/settings-people-pane.tsx`: clear stale counts on refresh, add choose/clear recovery, disable manual form until configured, and place manual creation after synchronized People.
- Modify `tests/unit/settings-people-pane.test.tsx`: guidance, disabled-state, recovery, and hierarchy regressions.
- Create `tests/e2e/mock-notes-people-api.ts`: stateful API fixtures matching complete Notes/People response contracts.
- Modify `tests/e2e/mock-api.ts`: register the focused mock surface.
- Create `tests/e2e/settings-notes-people.spec.ts`: desktop+narrow folder and exact-ID focus acceptance.
- Conditional only `apps/web/src/styles/settings-panes-3.css`: smallest token-based fix if the 390px overflow assertion fails.

### Task 1: Correct chooser state discrimination

**Files:**

- Test: `tests/unit/settings-vault-chooser.test.tsx`
- Modify: `apps/web/src/settings/settings-vault-chooser.tsx`

- [ ] **Step 1: Add failing chooser tests**

Pre-seed TanStack Query with an existing returned `People` root and `People/Family`; render with
`current="People"` and assert `Family` appears. Keep the existing empty-root synthetic recommendation
test and assert it remains selectable without loading/failure. Exercise recovery classification:

```ts
expect(shouldShowNotesRootRecovery(undefined, 0)).toBe(true);
expect(shouldShowNotesRootRecovery(new ApiError(503, "Unavailable"), 0)).toBe(true);
expect(shouldShowNotesRootRecovery(new ApiError(500, "Unexpected"), 0)).toBe(false);
```

- [ ] **Step 2: Run RED**

Run: `pnpm vitest run tests/unit/settings-vault-chooser.test.tsx`

Expected: existing returned `People` root does not render `Family`; 500/empty roots still satisfy the current recovery render condition.

- [ ] **Step 3: Implement minimum chooser fix**

Compute whether `People` is synthetic from root response membership; disable child discovery only for that exact synthetic state:

```ts
const syntheticPeopleRecommendation =
  mode === "people" && path === "People" && !roots.some((root) => root.path === "People");
// directoriesQuery.enabled: path !== null && !syntheticPeopleRecommendation
```

Make `shouldShowNotesRootRecovery(error, rootCount)` return true only for `ApiError(503)` or no-error/zero-root state. Render recovery solely from that boolean; unrelated errors continue through `readError` and disable selection.

- [ ] **Step 4: Run GREEN and commit**

```bash
pnpm vitest run tests/unit/settings-vault-chooser.test.tsx
pnpm --filter @jarv1s/web typecheck
git add tests/unit/settings-vault-chooser.test.tsx apps/web/src/settings/settings-vault-chooser.tsx
git commit -m "fix(settings): distinguish selectable folder states

Users can browse existing People subfolders while Notes mount recovery remains limited to unavailable or empty roots.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

### Task 2: Close People vault error and regression gaps

**Files:**

- Test: `packages/people/src/__tests__/notes-service.test.ts`
- Test: `packages/people/src/__tests__/routes.test.ts`
- Test: `tests/unit/module-registry-people-notes-source-behavior.test.ts`
- Modify: `packages/people/src/notes-service.ts`
- Modify: `packages/people/src/routes.ts`

- [ ] **Step 1: Add failing service tests**

Add one mixed folder containing a valid canonical Markdown note, a parseable missing-ID note, an invalid-frontmatter Markdown file, and a non-Markdown file. Assert the exact result:

```ts
expect(result).toEqual({ discovered: 3, projected: 1, ignored: 1, candidates: 1 });
```

Then remove/make the configured folder unavailable and assert `PeopleNotesFolderUnavailableError`. Call `putSettings` directly with `"/People"` and assert rejection, proving service defense below route validation.

- [ ] **Step 2: Add failing route trust-boundary tests**

Parameterize `buildApp(actorUserId, vaultRunnerOverride)`. Prove user A root discovery excludes user B, user A cannot browse a symlink into user B, and fixed safe 400 bodies contain no vault root, actor UUID, attempted absolute path, or private directory name. Drive both GET and PUT through deterministic `ENOTDIR` and injected `EACCES` failures; assert both return exactly:

```ts
{
  error: "People notes folder is unavailable";
}
```

Upgrade refresh serialization from an empty-folder shape check to the mixed fixture’s exact four counters.

- [ ] **Step 3: Add failing after-sync narrow-catch test**

Capture the Notes registration’s real `afterSync` callback using the existing module registry/worker seam. Stub `PeopleNotesService.refreshFromFolder` first with `PeopleNotesFolderUnavailableError`, then with `Error("database failed")`; assert the first resolves and the second rejects unchanged. Do not modify `runNotesAfterSyncHook`.

- [ ] **Step 4: Run RED**

```bash
pnpm vitest run packages/people/src/__tests__/notes-service.test.ts packages/people/src/__tests__/routes.test.ts tests/unit/module-registry-people-notes-source-behavior.test.ts
```

Expected: absolute folder is normalized into `People`; GET/PUT leak uncaught `ENOTDIR`/`EACCES`; missing coverage assertions fail.

- [ ] **Step 5: Implement minimum server fix**

Use Node `path.isAbsolute` before any slash stripping in `normalizeFolder`. In `registerPeopleRoutes`, reuse one local predicate in GET and PUT catches:

```ts
const isUnavailableVaultError = (error: unknown) =>
  error instanceof VaultPathError ||
  ["ENOENT", "ENOTDIR", "EACCES"].includes((error as NodeJS.ErrnoException)?.code ?? "");
```

Keep the current fixed response text. Do not serialize underlying filesystem errors or add raw filesystem access to production People code.

- [ ] **Step 6: Run GREEN and commit**

```bash
pnpm vitest run packages/people/src/__tests__/notes-service.test.ts packages/people/src/__tests__/routes.test.ts tests/unit/module-registry-people-notes-source-behavior.test.ts
pnpm --filter @jarv1s/people typecheck
pnpm --filter @jarv1s/module-registry typecheck
git add packages/people/src/__tests__/notes-service.test.ts packages/people/src/__tests__/routes.test.ts packages/people/src/notes-service.ts packages/people/src/routes.ts tests/unit/module-registry-people-notes-source-behavior.test.ts
git commit -m "fix(people): keep vault failures recoverable

People folder validation now rejects absolute paths defensively and returns safe recovery errors for unreadable folders.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

### Task 3: Make stale People folders recoverable and restore hierarchy

**Files:**

- Test: `tests/unit/settings-people-pane.test.tsx`
- Modify: `apps/web/src/settings/settings-people-pane.tsx`

- [ ] **Step 1: Add failing presentation tests**

Pre-seed complete settings/people/candidate/source-behavior query data. Assert configured and unconfigured renders separately:

- zero-discovered and ignored guidance remains actionable;
- refresh error clears old counts and exposes `Choose another folder` plus `Clear folder`;
- unconfigured manual name/email controls are disabled;
- synchronized `People` heading precedes `Add a person manually`;
- configured folder enables manual controls.

- [ ] **Step 2: Run RED**

Run: `pnpm vitest run tests/unit/settings-people-pane.test.tsx`

Expected: stale success counts persist, no clear recovery action exists, inputs remain enabled, and manual group precedes People.

- [ ] **Step 3: Implement minimum pane fix**

Delete `folderDraft`; derive selected folder from cached server settings. Clear `refreshResult` on folder mutation and at refresh start. Render a safe refresh-error recovery block with choose-again and clear buttons. Disable both manual inputs and create button when no configured folder. Move the unchanged People list before the manual group. Keep current PUT/POST semantics and owner-relative values.

- [ ] **Step 4: Run GREEN and commit**

```bash
pnpm vitest run tests/unit/settings-people-pane.test.tsx
pnpm --filter @jarv1s/web typecheck
git add tests/unit/settings-people-pane.test.tsx apps/web/src/settings/settings-people-pane.tsx
git commit -m "fix(settings): recover from stale People folders

People settings clear stale results, offer folder recovery, and keep manual creation disabled and separate until a folder is selected.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

### Task 4: Prove desktop and narrow exact-ID flows

**Files:**

- Create: `tests/e2e/mock-notes-people-api.ts`
- Modify: `tests/e2e/mock-api.ts`
- Create: `tests/e2e/settings-notes-people.spec.ts`
- Conditional: `apps/web/src/styles/settings-panes-3.css`

- [ ] **Step 1: Add focused stateful mock registrar**

Mirror complete existing client contracts for Notes source GET/PUT, directory GET, last-sync GET, sync POST; People settings GET/PUT, directory GET, refresh POST, people/candidate GET, and manual person POST. Keep Notes paths container-absolute and People paths owner-relative. Register it from `mockApi` after the API catch-all.

- [ ] **Step 2: Write failing Playwright acceptance**

At 1440x900 and 390x844, exercise returned Notes descendant selection, no raw-path field, returned `People/Family` browsing, refresh four counters/guidance, and manual-create disabled/enabled placement. Override `/api/chat/stream` with one pending `notes.delete` record (`actionRequestId: "delete-987"`) plus a non-matching action request (`"other-987"`). Click `Review deletion`; assert:

```ts
await expect(page.locator('[data-action-request-id="delete-987"]')).toBeFocused();
await expect(page.locator('[data-action-request-id="other-987"]')).not.toBeFocused();
```

At narrow width, use keyboard activation for chooser actions and assert `scrollWidth <= clientWidth`.

- [ ] **Step 3: Run RED**

Run: `pnpm playwright test tests/e2e/settings-notes-people.spec.ts --project=chromium`

Expected: new mock/spec imports fail before registrar exists; after fixtures compile, current chooser and pane blockers fail behavior assertions.

- [ ] **Step 4: Complete fixtures, run GREEN, conditionally fix CSS, and commit**

```bash
pnpm playwright test tests/e2e/settings-notes-people.spec.ts --project=chromium
# Only if 390px proves overflow:
pnpm check:design-tokens
git add tests/e2e/mock-notes-people-api.ts tests/e2e/mock-api.ts tests/e2e/settings-notes-people.spec.ts
# Add apps/web/src/styles/settings-panes-3.css only if verified above.
git commit -m "test(settings): prove Notes and People recovery flows

Desktop and narrow browser checks now cover safe folder selection, People recovery, and exact pending-delete focus.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

### Task 5: Final verification and coordinated closeout

- [ ] **Step 1: Run focused regression suite**

```bash
pnpm vitest run tests/unit/settings-vault-chooser.test.tsx tests/unit/settings-people-pane.test.tsx packages/people/src/__tests__/notes-service.test.ts packages/people/src/__tests__/routes.test.ts tests/integration/vault.test.ts tests/unit/module-registry-people-notes-source-behavior.test.ts tests/unit/action-request-card-preview.test.tsx tests/unit/notes-source-directories.test.ts
pnpm playwright test tests/e2e/settings-notes-people.spec.ts --project=chromium
```

- [ ] **Step 2: Run sensitive/full and pre-push gates**

```bash
pnpm verify:foundation
pnpm format:check && pnpm lint && pnpm typecheck
git fetch origin main && git rebase origin/main
git diff --check
git status --short
```

- [ ] **Step 3: Invoke `coordinated-wrap-up`**

Push exact head to existing PR #1058 and report SHA plus command/exit evidence to exact label `UX Coordinator`. Do not merge, move board items, close issues, or claim coordinator-owned deployed Webwright UAT.
