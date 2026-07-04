# People PATCH/Archive Canonical-Note Fallback Implementation Plan

> **For agentic workers:** This plan is executed directly by the build agent, task by task, using
> TDD — `executing-plans`/`subagent-driven-development` are disabled for this repo. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix GitHub issue #755 — `PATCH /api/people/:id` and `POST /api/people/:id/archive` 500
when a People notes folder is configured but the target person has no canonical `.md` note yet
(true for every person projected from email/calendar sync, since `refreshFromFolder` only files a
review candidate and never creates the note itself).

**Architecture:** `PeopleNotesService.findCanonicalNote` currently throws a plain `Error("Canonical
People note not found")` that propagates unhandled through `updatePersonNote`/`archivePersonNote`
into the Fastify route handlers, producing an unhandled 500. Introduce a dedicated
`CanonicalNoteNotFoundError` class thrown from `findCanonicalNote`, and catch exactly that error
type in the two route handlers (`PATCH /api/people/:id`, `POST /api/people/:id/archive`) to fall
back to the existing DB-only path (`repo.updatePerson` / `repo.archivePerson`) — the same path
already used when no notes folder is configured at all.

**Tech Stack:** TypeScript, Fastify, Vitest, `@jarv1s/vault` (VaultContext), `@jarv1s/db`
(DataContextDb). No schema/migration change.

## Global Constraints

- No new dependencies. No schema/migration changes — this is pure application-logic bug fix.
- Preserve all existing passing behavior: when a canonical note *does* exist, PATCH/archive must
  still go through the note-write path unchanged.
- Preserve behavior when no folder is configured at all (existing `else` branch untouched).
- Only catch the specific missing-note case — do not swallow unrelated errors from the vault
  write path (e.g. genuine vault I/O failures must still surface as errors).
- Stay inside `packages/people/**` — no other module's files.

---

### Task 1: Typed error for missing canonical note + service-level test

**Files:**
- Modify: `packages/people/src/notes-service.ts:1` (add error class export), `:269-282`
  (`findCanonicalNote` — throw the new type instead of plain `Error`)
- Test: `packages/people/src/__tests__/notes-service.test.ts`

**Interfaces:**
- Produces: `export class CanonicalNoteNotFoundError extends Error {}` from
  `packages/people/src/notes-service.ts`, thrown by `findCanonicalNote` (and therefore by
  `updatePersonNote`/`archivePersonNote`, which call it). Later tasks (route handler) import and
  `instanceof`-check this class.

- [ ] **Step 1: Write the failing test**

Add to `packages/people/src/__tests__/notes-service.test.ts`, inside the existing
`describe("PeopleNotesService", ...)` block (after the last `it(...)`, before the closing `});` on
line 299):

```ts
  it("throws CanonicalNoteNotFoundError when updating a person with no canonical note", async () => {
    const service = new PeopleNotesService();
    const repo = new PeopleRepository();
    let personId = "";

    await runner.withDataContext(
      { actorUserId: ids.userA, requestId: "settings-no-note" },
      async (sdb) => {
        await service.putSettings(sdb, ids.userA, { folder: "PeopleNoNote" });
        const person = await repo.upsertPerson(sdb, {
          ownerUserId: ids.userA,
          displayName: "No Note Person",
          confidence: 0.8
        });
        personId = person.id;
      }
    );

    await withUserVault(async (vaultCtx) => {
      await expect(
        runner.withDataContext({ actorUserId: ids.userA, requestId: "update-no-note" }, (sdb) =>
          service.updatePersonNote(sdb, vaultCtx, ids.userA, personId, { displayName: "X" })
        )
      ).rejects.toThrow(CanonicalNoteNotFoundError);
    });
  });
```

Add `CanonicalNoteNotFoundError` to the existing import from `"../notes-service.js"` on line 12:

```ts
import { CanonicalNoteNotFoundError, PeopleNotesService } from "../notes-service.js";
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @jarv1s/people test -- notes-service.test.ts`
Expected: FAIL — `CanonicalNoteNotFoundError` is not exported from `notes-service.js` (TS/import
error), or the thrown error is a plain `Error` so `toThrow(CanonicalNoteNotFoundError)` fails.

- [ ] **Step 3: Implement the minimal code**

In `packages/people/src/notes-service.ts`, add the class near the top (after the existing imports,
before `export const PEOPLE_NOTES_FOLDER_PREFERENCE_KEY`, i.e. after line 21):

```ts
export class CanonicalNoteNotFoundError extends Error {
  constructor(personId: string) {
    super(`Canonical People note not found for person ${personId}`);
    this.name = "CanonicalNoteNotFoundError";
  }
}
```

Change `findCanonicalNote` (current lines 269-282) to throw it with the `personId`:

```ts
  private async findCanonicalNote(
    scopedDb: DataContextDb,
    vaultCtx: VaultContext,
    ownerUserId: string,
    personId: string
  ): Promise<LoadedPeopleNote> {
    const { folder } = await this.getSettings(scopedDb, ownerUserId);
    if (!folder) throw new Error("People notes folder is not configured");
    const matches = (await this.loadPeopleNotes(vaultCtx, folder)).filter(
      (note) => note.parsed.frontmatter.jarvisPersonId === personId
    );
    if (matches.length !== 1) throw new CanonicalNoteNotFoundError(personId);
    return matches[0]!;
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @jarv1s/people test -- notes-service.test.ts`
Expected: PASS (all tests in the file, including the new one).

- [ ] **Step 5: Commit**

```bash
git add packages/people/src/notes-service.ts packages/people/src/__tests__/notes-service.test.ts
git commit -m "fix(people): throw typed CanonicalNoteNotFoundError from findCanonicalNote"
```

---

### Task 2: Route fallback to DB-only path + route-level regression test

**Files:**
- Modify: `packages/people/src/routes.ts:8` (import), `:257-276` (PATCH handler),
  `:278-297` (archive handler)
- Test: `packages/people/src/__tests__/routes.test.ts`

**Interfaces:**
- Consumes: `CanonicalNoteNotFoundError` exported from `packages/people/src/notes-service.ts`
  (Task 1).

- [ ] **Step 1: Write the failing test**

Add to `packages/people/src/__tests__/routes.test.ts`, inside the existing
`describe("People note write routes", ...)` block (after the existing `it(...)`, before its
closing `});` on line 114):

```ts
  it("falls back to DB-only update/archive when person has no canonical note", async () => {
    const app = buildApp();
    await app.ready();

    await app.inject({
      method: "PUT",
      url: "/api/people/notes-settings",
      payload: { folder: "PeopleNoNoteRoute" }
    });

    const repo = new PeopleRepository();
    let personId = "";
    await runner.withDataContext(
      { actorUserId: ids.userA, requestId: "no-note-setup" },
      async (sdb) => {
        const person = await repo.upsertPerson(sdb, {
          ownerUserId: ids.userA,
          displayName: "Projected Person",
          confidence: 0.8
        });
        personId = person.id;
      }
    );

    const patched = await app.inject({
      method: "PATCH",
      url: `/api/people/${personId}`,
      payload: { displayName: "Projected Person Edited" }
    });
    expect(patched.statusCode).toBe(200);
    expect(JSON.parse(patched.body).person.displayName).toBe("Projected Person Edited");

    const archived = await app.inject({ method: "POST", url: `/api/people/${personId}/archive` });
    expect(archived.statusCode).toBe(200);
    expect(JSON.parse(archived.body)).toEqual({ archived: true });

    await runner.withDataContext(
      { actorUserId: ids.userA, requestId: "no-note-assert" },
      async (sdb) => {
        const person = await repo.getPerson(sdb, ids.userA, personId);
        expect(person.displayName).toBe("Projected Person Edited");
        expect(person.status).toBe("archived");
      }
    );

    await app.close();
  });
```

This test needs `runner` in scope — it already is (declared at file top, line 19) — and
`PeopleRepository` is already imported (line 13). No new imports needed for this file.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @jarv1s/people test -- routes.test.ts`
Expected: FAIL — PATCH request returns 500 (unhandled `CanonicalNoteNotFoundError`/`Error` thrown
inside the route handler), so `expect(patched.statusCode).toBe(200)` fails.

- [ ] **Step 3: Implement the minimal code**

In `packages/people/src/routes.ts`, add the import on line 8 (next to the existing
`PeopleNotesService` import):

```ts
import { CanonicalNoteNotFoundError, PeopleNotesService } from "./notes-service.js";
```

Replace the PATCH handler body (current lines 264-275):

```ts
      return deps.dataContext.withDataContext(ac, async (sdb) => {
        const settings = await notesService.getSettings(sdb, ac.actorUserId);
        if (settings.folder && deps.vaultRunner) {
          try {
            const result = await deps.vaultRunner.withVaultContext(ac, (vaultCtx) =>
              notesService.updatePersonNote(sdb, vaultCtx, ac.actorUserId, id, updates)
            );
            return { person: result.person, notePath: result.notePath };
          } catch (err) {
            if (!(err instanceof CanonicalNoteNotFoundError)) throw err;
          }
        }
        const person = await repo.updatePerson(sdb, ac.actorUserId, id, updates);
        return { person };
      });
```

Replace the archive handler body (current lines 285-296):

```ts
      return deps.dataContext.withDataContext(ac, async (sdb) => {
        const settings = await notesService.getSettings(sdb, ac.actorUserId);
        if (settings.folder && deps.vaultRunner) {
          try {
            const result = await deps.vaultRunner.withVaultContext(ac, (vaultCtx) =>
              notesService.archivePersonNote(sdb, vaultCtx, ac.actorUserId, id)
            );
            return { archived: true, person: result.person, notePath: result.notePath };
          } catch (err) {
            if (!(err instanceof CanonicalNoteNotFoundError)) throw err;
          }
        }
        await repo.archivePerson(sdb, ac.actorUserId, id);
        return { archived: true };
      });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @jarv1s/people test -- routes.test.ts`
Expected: PASS (all tests in the file, including the new one and the pre-existing
"creates, edits, and archives through the canonical note" test — confirming the note-write path is
unchanged when a canonical note does exist).

- [ ] **Step 5: Commit**

```bash
git add packages/people/src/routes.ts packages/people/src/__tests__/routes.test.ts
git commit -m "fix(people): fall back to DB-only path when canonical note is missing on PATCH/archive"
```

---

### Task 3: Full package + workspace gate

**Files:** none (verification only)

- [ ] **Step 1: Run the full people package test suite**

Run: `pnpm --filter @jarv1s/people test`
Expected: PASS, all suites green (no regressions in `service.test.ts`, `repository.test.ts`,
`notes-format.test.ts`, `jobs.test.ts`, `tools.test.ts`, `matching.test.ts`,
`provider-contract.test.ts`, `types.test.ts`).

- [ ] **Step 2: Run format/lint/typecheck (pre-push trio)**

Run: `pnpm format:check && pnpm lint && pnpm typecheck`
Expected: all exit 0.

- [ ] **Step 3: No commit needed — this task only verifies. Proceed to `coordinated-wrap-up` for the full gate, rebase, push, and PR.**
