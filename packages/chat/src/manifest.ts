import { fileURLToPath } from "node:url";

import type { JarvisModuleManifest } from "@jarv1s/module-sdk";
import { listChatThreadsResponseSchema } from "@jarv1s/shared";

export const CHAT_MODULE_ID = "chat";
export const chatModuleSqlMigrationDirectory = fileURLToPath(new URL("../sql", import.meta.url));

export const chatModuleManifest = {
  id: CHAT_MODULE_ID,
  name: "Chat",
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
      "sql/0014_chat_module.sql",
      "sql/0034_chat_status_activity.sql",
      "sql/0035_chat_messages_update_grant.sql",
      "sql/0036_chat_worker_runtime_grants.sql",
      "sql/0038_chat_live_runtime.sql",
      "sql/0042_chat_memory_settings.sql"
    ],
    migrationDirectories: ["packages/chat/sql"],
    ownedTables: [
      "app.chat_threads",
      "app.chat_messages",
      "app.chat_user_memory_settings"
    ]
  },
  navigation: [
    {
      id: "chat",
      label: "Chat",
      path: "/chat",
      icon: "message-square",
      order: 45,
      permissionId: "chat.view"
    }
  ],
  permissions: [
    {
      id: "chat.view",
      label: "View chat",
      description: "Read chat threads and messages visible to the active actor and workspace.",
      scope: "workspace",
      actions: ["view"]
    },
    {
      id: "chat.create",
      label: "Create chat",
      description: "Create private or workspace-visible chat threads.",
      scope: "workspace",
      actions: ["create"]
    },
    {
      id: "chat.message",
      label: "Append chat messages",
      description:
        "Append user messages and record assistant-side safe routing/tool metadata without execution.",
      scope: "workspace",
      actions: ["create"]
    }
  ],
  featureFlags: [
    {
      id: "chat.module",
      label: "Chat module",
      description: "Enables the built-in Chat thin slice.",
      scope: "system",
      defaultEnabled: true
    }
  ],
  routes: [
    {
      method: "GET",
      path: "/api/chat/threads",
      responseSchema: listChatThreadsResponseSchema,
      permissionId: "chat.view"
    }
  ]
} satisfies JarvisModuleManifest;
