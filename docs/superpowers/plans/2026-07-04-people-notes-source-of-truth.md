# People Notes Source Of Truth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development under `coordinated-build`. The usual executing-plans/subagent execution skills are disabled for this coordinated repo run. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make configured People notes the canonical source for People records, with note-first writes and review candidates for ambiguous or missing-note cases.

**Architecture:** Store the canonical person link in note frontmatter as `jarvisPersonId`, not a new DB column. People rows stay projections rebuilt from Markdown notes; route writes use `VaultContext` first, then refresh the projection through `DataContextDb`. Preferences store the configured People folder relative to the linked notes source.

**Tech Stack:** TypeScript, Fastify, Kysely/DataContextDb, VaultContext, existing preferences repository, React Query settings UI, Vitest.

---

## Verified Current State

- `apps/web/src/settings/settings-memory-pane.tsx` exists and already owns the Memory/People tab; the handoff file list was current, despite an earlier graph query omitting it.
- `packages/people` is DB-first today: `findOrCreatePerson`, `updatePerson`, and `archivePerson` write `app.person_context_people` directly.
- `packages/people` has no canonical note path/link, no `jarvisPersonId`, and no People folder preference.
- `packages/notes` sync ingests Markdown into memory only. People indexing is separate, and module-registry currently passes `providers: []` to `registerPersonIndexWorker`.
- Existing `source-behaviors` supports boolean default-on/default-off toggles, not a literal `off | suggest | auto` tri-state. The lazy compatible mapping for this slice is: off = disabled, suggest = enabled with review candidate, auto = enabled direct note write. Since the existing model cannot store tri-state, default to `suggest` behavior in People service and expose the existing toggle as whether Jarvis may propose People note updates. Escalate if full tri-state UI is required in this slice.
- No migration planned. If Coordinator wants DB-enforced uniqueness for note path/person mapping, assign a new People SQL migration before build.

## Files

- Create: `packages/people/src/notes-format.ts`
  - Parse/serialize canonical People note frontmatter.
  - Preserve human body text and only replace the Jarvis-managed section.
- Create: `packages/people/src/notes-service.ts`
  - Configure/read People folder preference.
  - Scan People folder via `VaultContext`.
  - Project notes into `person_context_people`, identities, links, and review candidates.
  - Create/edit/archive People by writing notes first.
- Modify: `packages/people/src/repository.ts`
  - Add minimal projection helpers: insert/update by explicit person id, find missing-note people, and find note candidates.
- Modify: `packages/people/src/types.ts`
  - Add People note settings/projection types.
- Modify: `packages/people/src/routes.ts`
  - Add People note settings, refresh, create, note-first patch, note-first archive.
- Modify: `packages/people/src/manifest.ts`
  - Add routes and source behavior declaration for People note updates.
- Modify: `packages/people/src/index.ts`
  - Export note service/constants needed by module-registry.
- Modify: `packages/notes/src/jobs.ts`
  - Add optional post-file/post-sync hook so composition can trigger People note projection after notes sync without notes importing People internals.
- Modify: `packages/notes/src/index.ts`
  - Export the hook type.
- Modify: `packages/module-registry/src/index.ts`
  - Wire People note hook and `VaultContextRunner` in the composition root.
- Modify: `apps/web/src/api/people-client.ts`
  - Add settings/create/update/archive/refresh client functions.
- Modify: `apps/web/src/api/query-keys.ts`
  - Add People note settings key.
- Modify: `apps/web/src/settings/settings-people-pane.tsx`
  - Add configured-folder surface and note-first create/edit/archive actions, reusing `VaultChooser`.
- Tests:
  - Create `packages/people/src/__tests__/notes-format.test.ts`
  - Create `packages/people/src/__tests__/notes-service.test.ts`
  - Modify `packages/people/src/__tests__/routes.test.ts`
  - Modify `packages/notes/src/__tests__/jobs.test.ts` only if tests already exist after build starts; otherwise keep hook covered through a small People service unit test.

## Task 1: Canonical Note Format

**Files:**
- Create: `packages/people/src/notes-format.ts`
- Create: `packages/people/src/__tests__/notes-format.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
import { describe, expect, it } from "vitest";
import {
  formatPeopleNote,
  parsePeopleNote,
  replaceJarvisManagedSection
} from "../notes-format.js";

describe("people note format", () => {
  it("parses stable frontmatter without body loss", () => {
    const parsed = parsePeopleNote(`---
jarvisPersonId: 00000000-0000-4000-8000-000000000001
displayName: Ada Lovelace
aliases:
  - Ada
emails:
  - ada@example.test
phones: []
status: active
---
# Ada

Human text stays.
`);
    expect(parsed.frontmatter.jarvisPersonId).toBe("00000000-0000-4000-8000-000000000001");
    expect(parsed.frontmatter.aliases).toEqual(["Ada"]);
    expect(parsed.body).toContain("Human text stays.");
  });

  it("formats frontmatter and preserves human section", () => {
    const output = formatPeopleNote({
      frontmatter: {
        jarvisPersonId: "00000000-0000-4000-8000-000000000002",
        displayName: "Grace Hopper",
        aliases: ["Grace"],
        emails: ["grace@example.test"],
        phones: [],
        status: "active"
      },
      body: "# Grace\n\nHuman notes."
    });
    expect(output).toContain("jarvisPersonId: 00000000-0000-4000-8000-000000000002");
    expect(output).toContain("- grace@example.test");
    expect(output).toContain("Human notes.");
  });

  it("replaces only the managed section", () => {
    const original = "# Person\n\nHuman before.\n\n<!-- jarvis:people:start -->\nold\n<!-- jarvis:people:end -->\n\nHuman after.";
    const next = replaceJarvisManagedSection(original, "new managed summary");
    expect(next).toContain("Human before.");
    expect(next).toContain("new managed summary");
    expect(next).toContain("Human after.");
    expect(next).not.toContain("\nold\n");
  });
});
```

- [ ] **Step 2: Run failing test**

Run: `pnpm vitest run packages/people/src/__tests__/notes-format.test.ts`

Expected: FAIL because `notes-format.ts` does not exist.

- [ ] **Step 3: Implement minimal parser/serializer**

Implement a tiny frontmatter parser for the known fields only. No YAML dependency. Accept strings and simple `- item` arrays; treat malformed frontmatter as `null` parse result so projection can create a review candidate instead of throwing away user content.

- [ ] **Step 4: Run passing test**

Run: `pnpm vitest run packages/people/src/__tests__/notes-format.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/people/src/notes-format.ts packages/people/src/__tests__/notes-format.test.ts
git commit -m "feat(people): define canonical people note format

Co-Authored-By: Claude <noreply@anthropic.com>"
```

## Task 2: Note Projection Service

**Files:**
- Create: `packages/people/src/notes-service.ts`
- Modify: `packages/people/src/repository.ts`
- Modify: `packages/people/src/types.ts`
- Create: `packages/people/src/__tests__/notes-service.test.ts`

- [ ] **Step 1: Write failing tests**

Cover:
- two notes with the same `jarvisPersonId` produce one pending review candidate, not two People rows.
- one valid note upserts exactly one People projection with identity rows for aliases/emails/phones.
- create/edit/archive writes the note through a branded `VaultContext`, then updates DB projection.
- user body text survives an edit.

Use `VaultContextRunner` over a temp dir and `DataContextRunner` with `resetFoundationDatabase()`, matching existing People tests.

- [ ] **Step 2: Run failing tests**

Run: `pnpm vitest run packages/people/src/__tests__/notes-service.test.ts`

Expected: FAIL because service/helpers do not exist.

- [ ] **Step 3: Implement projection helpers**

Add only these repository helpers:
- `upsertPersonProjection(scopedDb, { ownerUserId, personId, displayName, status, relationshipSummary, contextSummary, confidence })`
- `listPeopleMissingCanonicalNotes(scopedDb, ownerUserId, canonicalPersonIds)`
- `upsertReviewCandidate(scopedDb, params)` reusing existing `upsertMatchCandidate`.

No schema changes.

- [ ] **Step 4: Implement `PeopleNotesService`**

Use preference key `people-notes-folder`.

Methods:
- `getSettings(scopedDb, ownerUserId)`
- `putSettings(scopedDb, ownerUserId, { folder })`
- `refreshFromFolder(scopedDb, vaultCtx, ownerUserId)`
- `createPersonNote(scopedDb, vaultCtx, ownerUserId, input)`
- `updatePersonNote(scopedDb, vaultCtx, ownerUserId, personId, patch)`
- `archivePersonNote(scopedDb, vaultCtx, ownerUserId, personId)`

Rules:
- scan only `.md` files under configured folder with `listVaultFilesRecursive(vaultCtx, folder)`.
- a parsed note with `jarvisPersonId` is canonical for that person.
- duplicate `jarvisPersonId` or same display/email mapping to multiple notes creates review candidate and skips destructive overwrite.
- notes without `jarvisPersonId` but with recognizable display/email create `create_person` review candidates.
- existing People rows missing notes create `create_person` review candidates, not silent note creation.

- [ ] **Step 5: Run passing tests**

Run: `pnpm vitest run packages/people/src/__tests__/notes-service.test.ts packages/people/src/__tests__/repository.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/people/src/notes-service.ts packages/people/src/repository.ts packages/people/src/types.ts packages/people/src/__tests__/notes-service.test.ts
git commit -m "feat(people): project people from canonical notes

Co-Authored-By: Claude <noreply@anthropic.com>"
```

## Task 3: Routes And Source Behavior

**Files:**
- Modify: `packages/people/src/routes.ts`
- Modify: `packages/people/src/manifest.ts`
- Modify: `packages/people/src/index.ts`
- Modify: `packages/people/src/__tests__/routes.test.ts`

- [ ] **Step 1: Write failing route tests**

Cover:
- `GET /api/people/notes-settings` returns `{ folder: null }` by default.
- `PUT /api/people/notes-settings` stores a relative folder.
- `POST /api/people` creates a note and returns projected person when folder is configured.
- `PATCH /api/people/:id` preserves body and edits frontmatter/managed section.
- `POST /api/people/:id/archive` sets note status `archived` and does not delete the file.

- [ ] **Step 2: Run failing route tests**

Run: `pnpm vitest run packages/people/src/__tests__/routes.test.ts`

Expected: FAIL for missing routes.

- [ ] **Step 3: Implement routes**

Extend `PeopleRouteDependencies` with optional:
- `preferencesRepository`
- `vaultRunner`
- `peopleNotesService`

Add routes:
- `GET /api/people/notes-settings`
- `PUT /api/people/notes-settings`
- `POST /api/people/notes/refresh`
- `POST /api/people`

Change existing:
- `PATCH /api/people/:id`
- `POST /api/people/:id/archive`

Route invariant: if People folder is configured, write note first with `VaultContextRunner.withVaultContext(accessContext, ...)`, then projection in `DataContextDb`. If unconfigured, keep current DB-only behavior for existing unlinked People.

- [ ] **Step 4: Add source behavior manifest**

Add a People source behavior declaration:

```ts
sourceBehaviors: [
  {
    id: "people-notes",
    name: "People notes",
    description: "People records projected from your configured People notes folder.",
    behaviors: [
      {
        id: "people.notes.suggest-updates",
        name: "Suggest note updates",
        description: "Create review candidates for Jarvis-managed People note updates instead of silently changing human notes.",
        default: "default-on"
      }
    ]
  }
]
```

- [ ] **Step 5: Run passing tests**

Run: `pnpm vitest run packages/people/src/__tests__/routes.test.ts packages/people/src/__tests__/service.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/people/src/routes.ts packages/people/src/manifest.ts packages/people/src/index.ts packages/people/src/__tests__/routes.test.ts
git commit -m "feat(people): route people writes through notes

Co-Authored-By: Claude <noreply@anthropic.com>"
```

## Task 4: Notes Sync Hook

**Files:**
- Modify: `packages/notes/src/jobs.ts`
- Modify: `packages/notes/src/index.ts`
- Modify: `packages/module-registry/src/index.ts`

- [ ] **Step 1: Add failing focused test if notes tests exist**

If there is no notes job test file, do not add a new integration harness for this hook; keep verification in People route/service tests and typecheck the hook.

- [ ] **Step 2: Implement optional hook**

Add `afterMarkdownFile?: (input: { actorUserId: string; relativePath: string; sourcePath: string }) => Promise<void>` or `afterSync?: (input: { actorUserId: string; sourcePath: string }) => Promise<void>` to `RegisterNotesJobWorkersOptions`. Prefer `afterSync` to avoid per-file People scans.

Call it after successful notes ingest result and before `writeNotesLastSync`. Hook payload contains metadata only: actor id and source path/folder, no raw note content.

- [ ] **Step 3: Wire composition**

In `packages/module-registry/src/index.ts`, pass an `afterSync` hook that creates `PeopleNotesService` and `VaultContextRunner`, then calls `refreshFromFolder` inside normal `DataContextDb` and `VaultContext`. Do not import People internals into Notes.

- [ ] **Step 4: Run focused checks**

Run: `pnpm typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/notes/src/jobs.ts packages/notes/src/index.ts packages/module-registry/src/index.ts
git commit -m "feat(notes): refresh people projections after notes sync

Co-Authored-By: Claude <noreply@anthropic.com>"
```

## Task 5: Settings UI

**Files:**
- Modify: `apps/web/src/api/people-client.ts`
- Modify: `apps/web/src/api/query-keys.ts`
- Modify: `apps/web/src/settings/settings-people-pane.tsx`

- [ ] **Step 1: Add client methods**

Add:
- `getPeopleNotesSettings`
- `putPeopleNotesSettings`
- `refreshPeopleNotes`
- `createPerson`
- `updatePerson`
- `archivePerson`

- [ ] **Step 2: Update pane**

Add:
- People folder row using existing `VaultChooser`.
- Sync/refresh action.
- Create person form with display name.
- Inline edit/archive actions for list rows.
- Keep existing match-candidate review list.

Use existing `Group`, `Row`, `Badge`, `Switch`, and `jds-btn` classes. No new UI dependency.

- [ ] **Step 3: Run frontend checks**

Run: `pnpm typecheck`

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/api/people-client.ts apps/web/src/api/query-keys.ts apps/web/src/settings/settings-people-pane.tsx
git commit -m "feat(web): configure people notes source

Co-Authored-By: Claude <noreply@anthropic.com>"
```

## Task 6: Focused Gate

- [ ] **Step 1: Run focused People tests**

Run:

```bash
pnpm vitest run packages/people/src/__tests__/notes-format.test.ts packages/people/src/__tests__/notes-service.test.ts packages/people/src/__tests__/routes.test.ts packages/people/src/__tests__/repository.test.ts packages/people/src/__tests__/service.test.ts packages/people/src/__tests__/jobs.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run required fast checks**

Run:

```bash
pnpm format:check && pnpm lint && pnpm typecheck
```

Expected: PASS.

- [ ] **Step 3: Commit any final fixes by explicit path**

Only if checks changed files.

## Self-Review

- Spec coverage: configuration, note projection, note-first create/edit/archive, managed-section preservation, review candidates, notes-sync trigger, and focused tests are all mapped to tasks.
- Security: uses `VaultContext` for file I/O, `DataContextDb` for DB, metadata-only notes hook, no raw content in jobs/logs.
- Scope: touches People, Notes, Vault usage, module-registry composition, and People settings UI only. No Email/Calendar/Chat/notifications/docs coordination changes.
- Migration: intentionally skipped. Add only if Coordinator requires DB-level uniqueness.
