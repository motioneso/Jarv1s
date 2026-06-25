import { mkdtemp, mkdir, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { listNotesSourceDirectories } from "../../packages/settings/src/notes-source-routes.js";

describe("listNotesSourceDirectories", () => {
  it("lists only allowed roots and child directories", async () => {
    const base = await mkdtemp(join(tmpdir(), "jarv1s-notes-roots-"));
    const root = join(base, "root");
    const outside = join(base, "outside");
    await mkdir(join(root, "alpha"), { recursive: true });
    await mkdir(join(root, "beta"), { recursive: true });
    await mkdir(outside);
    await writeFile(join(root, "note.md"), "# note");
    await symlink(outside, join(root, "escape"));

    const env = { JARVIS_NOTES_ROOTS: root } as NodeJS.ProcessEnv;

    await expect(listNotesSourceDirectories({ env })).resolves.toEqual({
      path: null,
      directories: [{ name: "root", path: root }]
    });
    await expect(listNotesSourceDirectories({ env, path: root })).resolves.toEqual({
      path: root,
      directories: [
        { name: "alpha", path: join(root, "alpha") },
        { name: "beta", path: join(root, "beta") }
      ]
    });
  });

  it("reports configured roots that are not mounted", async () => {
    const base = await mkdtemp(join(tmpdir(), "jarv1s-notes-missing-root-"));
    const env = { JARVIS_NOTES_ROOTS: join(base, "missing") } as NodeJS.ProcessEnv;

    await expect(listNotesSourceDirectories({ env })).rejects.toMatchObject({
      statusCode: 503,
      message: "Configured notes roots are not available on this server"
    });
  });
});
