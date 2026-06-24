import { fileURLToPath } from "node:url";

import type { JarvisModuleManifest } from "@jarv1s/module-sdk";
import {
  postNotesSyncRouteSchema,
  notesSearchInputSchema,
  notesSearchResponseSchema
} from "@jarv1s/shared";

import { notesSearchExecute } from "./tools.js";

export const NOTES_MODULE_ID = "notes";
export const NOTES_SYNC_QUEUE = "notes.sync";

export const notesModuleSqlMigrationDirectory = fileURLToPath(new URL("../sql", import.meta.url));

export const notesModuleManifest = {
  id: NOTES_MODULE_ID,
  name: "Notes",
  version: "0.0.0",
  publisher: "jarv1s",
  lifecycle: "user-toggleable",
  compatibility: { jarv1s: ">=0.0.0" },
  availability: {
    defaultEnabled: true,
    required: false,
    supportsUserDisable: true
  },
  database: {
    migrations: [],
    migrationDirectories: [notesModuleSqlMigrationDirectory],
    ownedTables: []
  },
  permissions: [
    {
      id: "notes.sync",
      label: "Sync notes",
      description: "Trigger a notes folder sync job.",
      scope: "user",
      actions: ["create"]
    },
    {
      id: "notes.search",
      label: "Search notes",
      description: "Semantically search the user's ingested notes.",
      scope: "user",
      actions: ["view"]
    }
  ],
  routes: [
    {
      method: "POST",
      path: "/api/notes/sync",
      responseSchema: postNotesSyncRouteSchema.response[202],
      permissionId: "notes.sync"
    }
  ],
  assistantTools: [
    {
      name: "notes.search",
      description:
        "Search the user's own ingested notes (Obsidian vault) by meaning. Returns matching note excerpts with file path and line range for citation.",
      permissionId: "notes.search",
      risk: "read",
      inputSchema: notesSearchInputSchema,
      outputSchema: notesSearchResponseSchema,
      externalContent: true,
      execute: notesSearchExecute
    }
  ]
} satisfies JarvisModuleManifest;
