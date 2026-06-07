import { fileURLToPath } from "node:url";

import type { JarvisModuleManifest } from "@jarv1s/module-sdk";

export const MEMORY_MODULE_ID = "memory";
export const memorySqlMigrationDirectory = fileURLToPath(new URL("../sql", import.meta.url));

export const memoryModuleManifest: JarvisModuleManifest = {
  id: MEMORY_MODULE_ID,
  name: "Memory",
  version: "0.1.0",
  publisher: "jarv1s",
  lifecycle: "required",
  compatibility: {
    jarv1s: ">=0.0.0"
  },
  availability: {
    defaultEnabled: true,
    required: true
  },
  database: {
    migrations: ["sql/0030_memory_index.sql"],
    migrationDirectories: ["packages/memory/sql"],
    ownedTables: ["app.memory_chunks", "app.memory_links"]
  }
};
