# Notes and People source-picker hardening (#987)

**Status:** Draft for Fable approval
**Date:** 2026-07-12
**Mechanical risk tier:** sensitive (owner-scoped vault discovery and a People refresh response
contract; no migration, auth, role, or RLS policy change)
**Grounded on:** `origin/main` `3ca138eb`
**Builds on:** #248, #449, #455, #727, #755, #756,
`2026-06-22-notes-folder-ingest.md`, `2026-07-04-people-notes-source-of-truth.md`, and
`2026-07-04-settings-data-sources-module-ownership.md`

## Problem

The two settings surfaces currently ask users to understand deployment paths that the product
should explain for them:

- Data sources has a mapped-folder browser, but it also offers a raw "path on the server" field.
  When no `JARVIS_NOTES_ROOTS` mount is available, the error does not say what the operator must do
  in a Docker deployment.
- People & context asks for a free-form folder string even though People notes live inside the
  signed-in owner's Jarv1s vault. Refresh reports only projected/candidate totals, so zero and
  partial results are not actionable.
- `Create person` is mixed into the synchronized list and looks like a competing source model.
- The Notes card's `delete approval` chip is static policy copy, not a real pending approval. It
  cannot name or open an action because none is represented there.

The two folder domains are intentionally different. External Notes sources are operator-mounted,
allowlisted container paths. Canonical People notes remain relative to the owner's `VaultContext`.
This issue makes both selectable without merging those trust domains.

## Decisions

1. **Notes selection is allowlist-only.** Keep the existing
   `GET /api/me/notes-source/directories` discovery route and its realpath/symlink containment.
   Remove the raw path input from `VaultChooser`. A user may select only a root or descendant the
   route returned; there is no host filesystem browser and no client-supplied escape hatch.
2. **Missing Notes roots have deployment-specific recovery.** When no mapped roots exist, show:
   "No notes folders are available to Jarv1s." An operator-only help block explains that the host
   folder must be mounted at `/data/external-notes`, `JARVIS_NOTES_ROOTS` must name that in-container
   path, and the Jarv1s container must be recreated. Link to `docs/operations/deploy.md#notes-mount`;
   never ask the user to type a host path into the web app.
3. **People selection stays inside `VaultContext`.** Add immediate-child directory discovery for
   the signed-in owner's vault. Requests and stored values use relative paths only; responses never
   expose `/data/vaults`, the actor UUID, or another owner's folders. Keep the fixed `People`
   default as a selectable recommended destination even before it exists; current note-first create
   behavior creates it safely through Vault operations.
4. **Reuse the chooser, not the storage model.** The current folder chooser becomes a small shared
   settings component with a Notes-mapped mode and a People-vault mode. It reuses authored styles,
   keyboard behavior, loading/error/empty states, and path crumbs. It does not generalize into a
   filesystem framework.
5. **People refresh returns truthful counts.** The result becomes
   `{ discovered, projected, ignored, candidates }`:
   - `discovered`: Markdown files found below the selected People folder;
   - `projected`: canonical notes successfully projected;
   - `ignored`: discovered Markdown files that are not parseable People notes;
   - `candidates`: review conditions created/upserted for missing IDs, duplicate canonical notes,
     or structured People records missing canonical notes.
     Non-Markdown files are outside all four counts.
6. **Refresh guidance follows the result.** Persist the last result in the pane for the current
   view. Zero discovered points to folder selection or manual creation; ignored files explain that
   People-note frontmatter was missing/invalid; candidates expose a "Review matches" action that
   focuses the existing owner-scoped review section. Folder-unavailable errors return a safe
   recoverable response and prompt the user to choose again.
7. **Manual creation is supported but separate.** The current POST is note-first and already uses
   `VaultContext`; do not delete a working capability. Move it out of the synchronized People list
   into a distinct "Add a person manually" group after the synced list. Explain that it creates a
   canonical Markdown People note in the selected Jarv1s folder. Hide/disable the form until a
   folder is selected.
8. **Remove the fake delete-approval state.** Delete the static chip. Keep one honest sentence:
   "Deleting a note always asks you in chat before anything is removed." Real `notes.delete`
   requests continue to render and resolve in their originating chat action card. #987 does not
   duplicate #985's approval UI or use the AI action-list endpoint as a second resolver. A review
   link must not appear unless a specific pending item can actually be opened; there is no such item
   on this card today.
9. **Security boundaries do not move.** Database access remains `DataContextDb`-only, all People
   folder discovery/read/write remains `VaultContext`-only, preferences and People records remain
   owner-only under existing RLS, and no path, note content, credential, or secret enters a job
   payload or log.

## User flows

### Link an external Notes source

1. Open Settings -> Data sources -> Notes & documents -> Browse.
2. Choose an operator-mapped root or one of its returned descendants.
3. Save, then run Sync now and read the existing ingest/error counts.
4. If no root exists, the picker stops at the recovery block; it never shows a text field.

### Choose and refresh People notes

1. Open Settings -> People & context -> People notes -> Choose folder.
2. Browse only relative directories inside the owner's Jarv1s vault, or choose the recommended
   `People` folder.
3. Refresh and see discovered/projected/ignored/review counts plus the relevant next action.
4. Add a manual person only from the separately labeled group; the write remains note-first.

## API and implementation contract

### Owner-vault directory discovery

Add `listVaultDirectories(vaultCtx, relativeDir = ".")` to `@jarv1s/vault`. It returns sorted
immediate child directory names/relative paths after the same `resolveVaultPath` and symlink-escape
checks used by existing Vault operations.

Expose it through:

```text
GET /api/people/notes-directories?path=<relative-or-empty>
-> { path: string | null, directories: [{ name, path }] }
```

The route must resolve `AccessContext`, enter `withVaultContext`, reject absolute/traversal/symlink
escape paths, and return only owner-relative values. `PUT /api/people/notes-settings` accepts only
`.`/`People` or a directory discoverable for that same owner. A stale configured folder remains
visible as unavailable so the user can replace or clear it.

### Refresh result

Update `PeopleNotesRefreshResult` and the frontend client to the four counters in Decision 5. The
service's folder scan returns parsed notes plus scan counts in one pass; do not rescan the tree.
Missing/unavailable folders must not be silently reported as a successful all-zero refresh.

No database migration, new table, new dependency, new job, or cross-module table query is needed.

## Build slices

### Slice 1 - mapped Notes chooser and recovery (`routine`)

- Remove raw path entry and accept selections only from discovery responses.
- Add honest no-root/unavailable states and deployment recovery copy.
- Remove the static delete-approval chip and keep the chat-approval explanation.

### Slice 2 - owner-vault People picker (`sensitive`)

- Add the smallest Vault directory-list operation and focused containment checks.
- Add the owner-scoped People directory route and client/query key.
- Reuse the chooser presentation for relative People folders and the fixed recommended `People`
  destination.

### Slice 3 - People outcome and information hierarchy (`sensitive`)

- Return and render the four refresh counters with recovery/focus guidance.
- Replace the raw folder input with the picker.
- Separate manual creation from the synchronized list without changing its note-first semantics.

### Slice 4 - browser acceptance (`routine`, after #986 selectors settle)

- Add focused mocked Playwright coverage at desktop and narrow widths.
- Run the same flows against the integrated app/deployment before closing #987.

## Exact path locks and collisions

Expected product paths:

- `~/Jarv1s/apps/web/src/settings/settings-vault-chooser.tsx`
- `~/Jarv1s/apps/web/src/settings/settings-personal-data-panes.tsx`
- `~/Jarv1s/apps/web/src/settings/settings-people-pane.tsx`
- `~/Jarv1s/apps/web/src/api/people-client.ts`
- `~/Jarv1s/apps/web/src/api/query-keys.ts`
- `~/Jarv1s/apps/web/src/styles/settings-panes-3.css` only if existing responsive rules are
  insufficient
- `~/Jarv1s/packages/vault/src/vault-ops.ts`
- `~/Jarv1s/packages/vault/src/index.ts`
- `~/Jarv1s/packages/people/src/routes.ts`
- `~/Jarv1s/packages/people/src/notes-service.ts`
- `~/Jarv1s/packages/people/src/types.ts`

Expected test paths:

- `~/Jarv1s/tests/unit/notes-source-directories.test.ts`
- `~/Jarv1s/tests/integration/vault.test.ts`
- `~/Jarv1s/packages/people/src/__tests__/notes-service.test.ts`
- `~/Jarv1s/packages/people/src/__tests__/routes.test.ts`
- `~/Jarv1s/tests/people-client.test.ts`
- `~/Jarv1s/tests/unit/settings-people-pane.test.tsx`
- `~/Jarv1s/tests/unit/settings-vault-chooser.test.tsx` (new)
- `~/Jarv1s/tests/e2e/mock-notes-people-api.ts` (new)
- `~/Jarv1s/tests/e2e/settings-notes-people.spec.ts` (new)

Collision rules:

- #986 owns settings shell/chrome/navigation and the People & access/Identity merge. #987 owns only
  the Data sources body, People & context body, and their chooser. Product work may proceed in
  parallel, but rebase/serialize if #986 touches either pane file; write final Playwright navigation
  selectors against post-#986 structure.
- #985 owns chat approval cards and approval behavior. #987 removes misleading settings copy only;
  it does not edit `action-request-card.tsx`, chat routes, gateway policy, or chat styles.
- The other Coordinator's #965/#1000 lane owns module run/install behavior and install-UI UAT. #987
  does not touch Instance modules, `RunNowButton`, module jobs, or their selectors.

## Verification

Focused automated checks must prove:

- Notes discovery returns only allowed realpaths, rejects traversal/symlink escape, and the web
  chooser has no raw path input.
- Zero mapped Notes roots renders deployment recovery without leaking a host path or accepting an
  arbitrary one.
- People directory discovery is owner-relative, rejects absolute/traversal/symlink escape paths,
  and cannot observe a second user's directory.
- Refresh counts distinguish discovered/projected/ignored/candidate outcomes in one scan and an
  unavailable folder is not reported as success.
- The People pane offers folder selection, actionable refresh guidance, and a separately labeled
  manual-create flow.
- The Notes card contains no fake pending-approval count/link; real delete approval remains in chat.
- `pnpm verify:foundation` and the relevant Playwright project are green.

Playwright acceptance in `settings-notes-people.spec.ts`:

- **Desktop:** link a returned mapped Notes descendant, verify no server-path field exists, run Sync
  now, choose a returned People folder, refresh, assert all four counts and focus the review section,
  then add a manual person from the separate group.
- **Desktop no-root recovery:** mock zero Notes roots and assert the Docker/mount recovery block;
  arbitrary path entry is impossible.
- **Narrow viewport:** repeat both pickers at the repository's supported narrow width; every folder,
  back/cancel/use action, refresh result, and review action is visible, keyboard reachable, and does
  not overflow horizontally.

Before production merge, run the desktop+narrow flow against the deployed candidate with a real
mapped Notes root and an owner vault containing one valid, one invalid, and one review-needed People
note.

## Non-goals

- Browsing the deployment host, uploading folders, configuring bind mounts from the web UI, or
  exposing host absolute paths.
- Moving People canonical notes into the external Notes-source mount or merging the two storage
  domains.
- Changing People note format, projection identity rules, match acceptance, or note-first
  create/edit/archive behavior.
- A new global approvals inbox or a second action resolver.
- Any migration, RLS policy change, shared-data model, secret, or background job.

## Approval questions

1. Approve keeping supported manual person creation as a clearly separate note-first flow, rather
   than removing it?
2. Approve keeping People canonical notes in the owner `VaultContext` and explicitly labeling that
   they are separate from the operator-mounted external Notes source? Moving them is a distinct
   architecture/data-migration decision and is not included here.
