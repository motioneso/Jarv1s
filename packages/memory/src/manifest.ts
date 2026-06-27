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
    migrations: [
      "sql/0030_memory_index.sql",
      "sql/0032_memory_embedding_768.sql",
      "sql/0040_memory_chat_source.sql",
      "sql/0041_memory_facts.sql"
    ],
    migrationDirectories: ["packages/memory/sql"],
    ownedTables: [
      "app.memory_chunks",
      "app.memory_links",
      "app.memory_file_index",
      "app.chat_memory_facts",
      "app.memory_entities",
      "app.memory_facts",
      "app.memory_episodes",
      "app.memory_fact_sources",
      "app.memory_aliases",
      "app.memory_search_documents",
      "app.memory_legacy_fact_migrations"
    ]
  }
};
