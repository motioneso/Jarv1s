import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { DataContextDb, PreferencesPort } from "@jarv1s/db";
import {
  getBuiltInModuleRegistrations,
  isPeopleNotesSuggestUpdatesEnabled
} from "@jarv1s/module-registry";
import { PeopleNotesFolderUnavailableError, PeopleNotesService } from "@jarv1s/people";
import { SOURCE_BEHAVIOR_PREFERENCE_KEY } from "@jarv1s/source-behaviors";
import type * as NotesModule from "@jarv1s/notes";
import type * as StructuredStateModule from "@jarv1s/structured-state";

const notesWorkerCapture = vi.hoisted(() => ({
  afterSync: undefined as
    | ((input: {
        readonly actorUserId: string;
        readonly sourcePath: string | null;
      }) => Promise<unknown>)
    | undefined
}));

vi.mock("@jarv1s/notes", async (importOriginal) => {
  const actual = await importOriginal<typeof NotesModule>();
  return {
    ...actual,
    registerNotesJobWorkers: vi.fn(
      async (
        _boss: unknown,
        _dataContext: unknown,
        options: {
          readonly afterSync?: (input: {
            readonly actorUserId: string;
            readonly sourcePath: string | null;
          }) => Promise<unknown>;
        }
      ) => {
        notesWorkerCapture.afterSync = options.afterSync;
        return ["notes-test-worker"];
      }
    )
  };
});

vi.mock("@jarv1s/structured-state", async (importOriginal) => {
  const actual = await importOriginal<typeof StructuredStateModule>();
  return {
    ...actual,
    PreferencesRepository: class extends actual.PreferencesRepository {
      override async get(): Promise<null> {
        return null;
      }
    }
  };
});

const fakeScopedDb = { db: {} } as DataContextDb;

function prefRepo(values: Record<string, unknown>): PreferencesPort {
  return {
    get: async (_scopedDb, key) => values[key] ?? null,
    getWithMetadata: async () => null,
    upsert: async (_scopedDb, key, value) => {
      values[key] = value;
    }
  };
}

describe("People notes source behavior gate", () => {
  it("uses the built-in behavior default when no user override exists", async () => {
    await expect(isPeopleNotesSuggestUpdatesEnabled(fakeScopedDb, prefRepo({}))).resolves.toBe(
      true
    );
  });

  it("honors a user override that disables automatic People note updates", async () => {
    await expect(
      isPeopleNotesSuggestUpdatesEnabled(
        fakeScopedDb,
        prefRepo({
          [SOURCE_BEHAVIOR_PREFERENCE_KEY]: { "people.notes.suggest-updates": false }
        })
      )
    ).resolves.toBe(false);
  });
});

describe("People notes after-sync recovery", () => {
  let vaultRoot = "";
  const previousVaultRoot = process.env["JARVIS_VAULT_ROOT"];

  beforeAll(async () => {
    vaultRoot = await mkdtemp(join(tmpdir(), "jarvis-people-after-sync-"));
    process.env["JARVIS_VAULT_ROOT"] = vaultRoot;

    const registration = getBuiltInModuleRegistrations().find(
      (item) => item.manifest.id === "notes"
    );
    const dataContext = {
      withDataContext: async (_accessContext: unknown, work: (db: DataContextDb) => unknown) =>
        work(fakeScopedDb)
    };
    await registration?.registerWorkers?.({} as never, {
      rootDb: {} as never,
      dataContext: dataContext as never
    });
  });

  afterAll(async () => {
    if (previousVaultRoot === undefined) delete process.env["JARVIS_VAULT_ROOT"];
    else process.env["JARVIS_VAULT_ROOT"] = previousVaultRoot;
    if (vaultRoot) await rm(vaultRoot, { recursive: true, force: true });
  });

  it("catches only unavailable People folders", async () => {
    expect(notesWorkerCapture.afterSync).toBeTypeOf("function");
    const refresh = vi.spyOn(PeopleNotesService.prototype, "refreshFromFolder");
    refresh.mockRejectedValueOnce(new PeopleNotesFolderUnavailableError());
    await expect(
      notesWorkerCapture.afterSync?.({ actorUserId: "user-a", sourcePath: null })
    ).resolves.toBeUndefined();

    refresh.mockRejectedValueOnce(new Error("database failed"));
    await expect(
      notesWorkerCapture.afterSync?.({ actorUserId: "user-a", sourcePath: null })
    ).rejects.toThrow("database failed");
    refresh.mockRestore();
  });
});
