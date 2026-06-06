import { fileURLToPath } from "node:url";

import type { JarvisModuleManifest } from "@jarv1s/module-sdk";
import {
  createNoteRequestSchema,
  createNoteResponseSchema,
  getNoteResponseSchema,
  listNotesResponseSchema,
  updateNoteRequestSchema,
  updateNoteResponseSchema
} from "@jarv1s/shared";

export const NOTES_MODULE_ID = "notes";
export const notesModuleSqlMigrationDirectory = fileURLToPath(new URL("../sql", import.meta.url));

export const notesModuleManifest = {
  id: NOTES_MODULE_ID,
  name: "Notes",
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
    migrations: ["sql/0006_notes_module.sql", "sql/0007_tighten_workspace_update_rls.sql"],
    migrationDirectories: ["packages/notes/sql"],
    ownedTables: ["app.notes"]
  },
  navigation: [
    {
      id: "notes",
      label: "Notes",
      path: "/notes",
      icon: "file-text",
      order: 20,
      permissionId: "notes.view"
    }
  ],
  settings: [
    {
      id: "notes.workspace-settings",
      label: "Notes",
      path: "/settings/modules/notes",
      scope: "workspace",
      order: 20,
      permissionId: "notes.manage"
    }
  ],
  permissions: [
    {
      id: "notes.view",
      label: "View notes",
      description:
        "Read notes visible to the actor through ownership, grants, or workspace visibility.",
      scope: "workspace",
      actions: ["view"]
    },
    {
      id: "notes.create",
      label: "Create notes",
      description: "Create private notes or workspace-visible notes in joined workspaces.",
      scope: "workspace",
      actions: ["create"]
    },
    {
      id: "notes.update",
      label: "Update notes",
      description:
        "Update notes the actor owns or can manage through grants or workspace membership.",
      scope: "workspace",
      actions: ["update"]
    },
    {
      id: "notes.manage",
      label: "Manage notes module",
      description: "Manage Notes module settings and workspace-level note behavior.",
      scope: "workspace",
      actions: ["manage"]
    }
  ],
  featureFlags: [
    {
      id: "notes.module",
      label: "Notes module",
      description: "Enables the built-in Notes module surfaces and routes.",
      scope: "system",
      defaultEnabled: true
    }
  ],
  routes: [
    {
      method: "GET",
      path: "/api/notes",
      responseSchema: listNotesResponseSchema,
      permissionId: "notes.view"
    },
    {
      method: "POST",
      path: "/api/notes",
      requestSchema: createNoteRequestSchema,
      responseSchema: createNoteResponseSchema,
      permissionId: "notes.create"
    },
    {
      method: "GET",
      path: "/api/notes/:id",
      responseSchema: getNoteResponseSchema,
      permissionId: "notes.view"
    },
    {
      method: "PATCH",
      path: "/api/notes/:id",
      requestSchema: updateNoteRequestSchema,
      responseSchema: updateNoteResponseSchema,
      permissionId: "notes.update"
    }
  ],
  shareableResources: [
    {
      resourceType: "note",
      grantLevels: ["view", "contribute", "manage"]
    }
  ],
  assistantTools: [
    {
      name: "notes.listVisible",
      description: "List notes visible to the active actor and workspace context.",
      permissionId: "notes.view",
      risk: "read",
      inputSchema: {
        type: "object",
        properties: {}
      },
      outputSchema: listNotesResponseSchema
    }
  ]
} satisfies JarvisModuleManifest;
