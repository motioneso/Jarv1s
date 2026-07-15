import { afterEach, describe, expect, it, vi } from "vitest";

import {
  archivePerson,
  createPerson,
  getPeopleNotesDirectories,
  getPeopleNotesSettings,
  putPeopleNotesSettings,
  refreshPeopleNotes,
  updatePerson
} from "../apps/web/src/api/people-client.js";

afterEach(() => {
  vi.restoreAllMocks();
});

function mockFetch(body: unknown = {}) {
  const calls: Array<{ path: string; init: RequestInit | undefined }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string, init?: RequestInit) => {
      calls.push({ path, init });
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    })
  );
  return calls;
}

describe("people-client note methods", () => {
  it("uses the People notes settings endpoints", async () => {
    const calls = mockFetch({ folder: "People" });

    await getPeopleNotesSettings();
    await putPeopleNotesSettings({ folder: "People" });

    expect(calls[0]?.path).toBe("/api/people/notes-settings");
    expect(calls[1]?.path).toBe("/api/people/notes-settings");
    expect(calls[1]?.init?.method).toBe("PUT");
    expect(calls[1]?.init?.body).toBe(JSON.stringify({ folder: "People" }));
  });

  it("uses note-first People write endpoints", async () => {
    const calls = mockFetch({ person: { id: "p1" }, notePath: "People/Ada.md" });

    await refreshPeopleNotes();
    await createPerson({ displayName: "Ada", emails: ["ada@example.test"] });
    await updatePerson("p1", { displayName: "Ada Edited" });
    await archivePerson("p1");

    expect(calls.map((call) => call.path)).toEqual([
      "/api/people/notes/refresh",
      "/api/people",
      "/api/people/p1",
      "/api/people/p1/archive"
    ]);
    expect(calls.map((call) => call.init?.method)).toEqual(["POST", "POST", "PATCH", "POST"]);
  });

  it("keeps People directory paths relative and preserves all refresh counters", async () => {
    const calls = mockFetch({
      path: "People",
      directories: [{ name: "Family", path: "People/Family" }],
      discovered: 3,
      projected: 1,
      ignored: 1,
      candidates: 1
    });

    await getPeopleNotesDirectories("People");
    const refresh = await refreshPeopleNotes();

    expect(calls[0]?.path).toBe("/api/people/notes-directories?path=People");
    expect(calls[0]?.path).not.toContain("/data/vaults");
    expect(refresh).toMatchObject({ discovered: 3, projected: 1, ignored: 1, candidates: 1 });
  });
});
