import { readdir } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { chatModuleManifest } from "@jarv1s/chat";

describe("chatModuleManifest", () => {
  it("lists every chat SQL migration file in order", async () => {
    const sqlFiles = (await readdir("packages/chat/sql"))
      .filter((file) => file.endsWith(".sql"))
      .sort()
      .map((file) => `sql/${file}`);

    expect(chatModuleManifest.database.migrations).toEqual(sqlFiles);
  });
});
