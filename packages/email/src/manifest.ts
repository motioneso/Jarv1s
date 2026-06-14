import { fileURLToPath } from "node:url";

import type { JarvisModuleManifest } from "@jarv1s/module-sdk";
import { getEmailMessageResponseSchema, listEmailMessagesResponseSchema } from "@jarv1s/shared";

import { emailListVisibleMessagesExecute } from "./tools.js";

export const EMAIL_MODULE_ID = "email";
export const emailModuleSqlMigrationDirectory = fileURLToPath(new URL("../sql", import.meta.url));

export const emailModuleManifest = {
  id: EMAIL_MODULE_ID,
  name: "Email",
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
      "sql/0012_email_module.sql",
      "sql/0067_email_summary_signals_columns.sql",
      "sql/0068_email_worker_grants_and_google_insert.sql"
    ],
    migrationDirectories: ["packages/email/sql"],
    ownedTables: ["app.email_messages"]
  },
  // No user-facing surface: email is an ingestion source for Jarv1s (assistant tools +
  // cache), not a screen the user browses. The viewer was retired; the assistant tool and
  // REST cache APIs remain so Jarvis can read/learn from messages.
  navigation: [],
  permissions: [
    {
      id: "email.view",
      label: "View email",
      description: "Read cached email messages owned by or shared with the active actor.",
      scope: "user",
      actions: ["view"]
    },
    {
      id: "email.manage",
      label: "Manage email module",
      description: "Manage Email module settings and connector-backed cache behavior.",
      scope: "user",
      actions: ["manage"]
    }
  ],
  featureFlags: [
    {
      id: "email.module",
      label: "Email module",
      description: "Enables the built-in connector-backed Email read surface.",
      scope: "system",
      defaultEnabled: true
    }
  ],
  routes: [
    {
      method: "GET",
      path: "/api/email/messages",
      responseSchema: listEmailMessagesResponseSchema,
      permissionId: "email.view"
    },
    {
      method: "GET",
      path: "/api/email/messages/:id",
      responseSchema: getEmailMessageResponseSchema,
      permissionId: "email.view"
    }
  ],
  assistantTools: [
    {
      name: "email.listVisibleMessages",
      description: "List cached email messages owned by or shared with the active actor.",
      permissionId: "email.view",
      risk: "read",
      inputSchema: {
        type: "object",
        properties: {}
      },
      outputSchema: listEmailMessagesResponseSchema,
      execute: emailListVisibleMessagesExecute
    }
  ]
} satisfies JarvisModuleManifest;
