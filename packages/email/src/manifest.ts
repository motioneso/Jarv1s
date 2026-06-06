import { fileURLToPath } from "node:url";

import type { JarvisModuleManifest } from "@jarv1s/module-sdk";
import { getEmailMessageResponseSchema, listEmailMessagesResponseSchema } from "@jarv1s/shared";

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
    migrations: ["sql/0012_email_module.sql"],
    migrationDirectories: ["packages/email/sql"],
    ownedTables: ["app.email_messages"]
  },
  navigation: [
    {
      id: "email",
      label: "Email",
      path: "/email",
      icon: "mail",
      order: 40,
      permissionId: "email.view"
    }
  ],
  permissions: [
    {
      id: "email.view",
      label: "View email",
      description:
        "Read cached email messages owned by the actor or visible in the active joined workspace.",
      scope: "workspace",
      actions: ["view"]
    },
    {
      id: "email.manage",
      label: "Manage email module",
      description: "Manage Email module settings and connector-backed cache behavior.",
      scope: "workspace",
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
      description: "List cached email messages visible to the active actor and workspace context.",
      permissionId: "email.view",
      risk: "read",
      inputSchema: {
        type: "object",
        properties: {}
      },
      outputSchema: listEmailMessagesResponseSchema
    }
  ]
} satisfies JarvisModuleManifest;
