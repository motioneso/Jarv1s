import { fileURLToPath } from "node:url";

import type { JarvisModuleManifest, ToolExecute } from "@jarv1s/module-sdk";
import {
  createConnectorAccountRequestSchema,
  createConnectorAccountResponseSchema,
  listAdminConnectorAccountsResponseSchema,
  listConnectorAccountsResponseSchema,
  listConnectorProvidersResponseSchema,
  revokeConnectorAccountResponseSchema,
  updateConnectorAccountRequestSchema,
  updateConnectorAccountResponseSchema
} from "@jarv1s/shared";

export const CONNECTORS_MODULE_ID = "connectors";
export const connectorsModuleSqlMigrationDirectory = fileURLToPath(
  new URL("../sql", import.meta.url)
);

export const connectorsModuleManifest = {
  id: CONNECTORS_MODULE_ID,
  name: "Connectors",
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
    migrations: ["sql/0009_connectors_module.sql", "sql/0010_connector_admin_safe_metadata.sql"],
    migrationDirectories: ["packages/connectors/sql"],
    ownedTables: ["app.connector_definitions", "app.connector_accounts"]
  },
  settings: [
    {
      id: "connectors.user-settings",
      label: "Connectors",
      path: "/settings/connectors",
      scope: "user",
      order: 30,
      permissionId: "connectors.manage"
    },
    {
      id: "connectors.admin-settings",
      label: "Connector Accounts",
      path: "/settings/admin/connectors",
      scope: "admin",
      order: 30,
      permissionId: "connectors.admin"
    }
  ],
  permissions: [
    {
      id: "connectors.view",
      label: "View connectors",
      description: "View configured connector providers and safe account metadata.",
      scope: "user",
      actions: ["view"]
    },
    {
      id: "connectors.manage",
      label: "Manage connector accounts",
      description: "Create, update, and revoke connector authorizations owned by the active actor.",
      scope: "workspace",
      actions: ["create", "update", "manage"]
    },
    {
      id: "connectors.admin",
      label: "View connector account metadata",
      description: "View safe connector account metadata without token or secret material.",
      scope: "admin",
      actions: ["view"]
    }
  ],
  featureFlags: [
    {
      id: "connectors.module",
      label: "Connectors module",
      description: "Enables the built-in connector account and encrypted secret foundation.",
      scope: "system",
      defaultEnabled: true
    }
  ],
  routes: [
    {
      method: "GET",
      path: "/api/connectors/providers",
      responseSchema: listConnectorProvidersResponseSchema,
      permissionId: "connectors.view"
    },
    {
      method: "GET",
      path: "/api/connectors/accounts",
      responseSchema: listConnectorAccountsResponseSchema,
      permissionId: "connectors.view"
    },
    {
      method: "POST",
      path: "/api/connectors/accounts",
      requestSchema: createConnectorAccountRequestSchema,
      responseSchema: createConnectorAccountResponseSchema,
      permissionId: "connectors.manage"
    },
    {
      method: "PATCH",
      path: "/api/connectors/accounts/:id",
      requestSchema: updateConnectorAccountRequestSchema,
      responseSchema: updateConnectorAccountResponseSchema,
      permissionId: "connectors.manage"
    },
    {
      method: "POST",
      path: "/api/connectors/accounts/:id/revoke",
      responseSchema: revokeConnectorAccountResponseSchema,
      permissionId: "connectors.manage"
    },
    {
      method: "GET",
      path: "/api/admin/connectors/accounts",
      responseSchema: listAdminConnectorAccountsResponseSchema,
      permissionId: "connectors.admin"
    }
  ],
  assistantTools: [
    {
      name: "connectors.startGoogleGuidance",
      description:
        "Explain, step by step, how the user connects their Google account (Gmail + Calendar). Read-only guidance; the user completes the secret-entry steps in Settings.",
      permissionId: "connectors.view",
      risk: "read",
      inputSchema: { type: "object", additionalProperties: false, properties: {} },
      outputSchema: {
        type: "object",
        properties: {
          steps: { type: "array", items: { type: "string" } },
          settingsUrl: { type: "string" }
        }
      },
      execute: (async (_scopedDb, _input, _ctx) => ({
        data: {
          steps: [
            "In Google Cloud Console, create a project and enable the Gmail API and Google Calendar API.",
            "Configure the OAuth consent screen and add yourself as a test user.",
            "Create an OAuth client of type 'Desktop app' and copy the client ID and secret.",
            "Open Jarv1s Settings → Connect Google, paste the client ID and secret, and start authorization.",
            "Approve in the browser. The http://localhost:1 page will fail to load (expected). Copy the full address-bar URL and paste it back in Settings to finish."
          ],
          settingsUrl: "/settings"
        }
      })) as ToolExecute
    }
  ]
} satisfies JarvisModuleManifest;
