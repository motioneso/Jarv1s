import { fileURLToPath } from "node:url";

import type { JarvisModuleManifest } from "@jarv1s/module-sdk";
import {
  appendChatUserMessageRequestSchema,
  appendChatUserMessageResponseSchema,
  createChatThreadRequestSchema,
  createChatThreadResponseSchema,
  getChatThreadResponseSchema,
  listChatMessagesResponseSchema,
  listChatThreadsResponseSchema
} from "@jarv1s/shared";

export const CHAT_MODULE_ID = "chat";
export const CHAT_EXECUTION_QUEUE = "chat-execution";
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
    migrations: ["sql/0014_chat_module.sql", "sql/0034_chat_status_activity.sql"],
    migrationDirectories: ["packages/chat/sql"],
    ownedTables: ["app.chat_threads", "app.chat_messages"]
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
    },
    {
      method: "POST",
      path: "/api/chat/threads",
      requestSchema: createChatThreadRequestSchema,
      responseSchema: createChatThreadResponseSchema,
      permissionId: "chat.create"
    },
    {
      method: "GET",
      path: "/api/chat/threads/:id",
      responseSchema: getChatThreadResponseSchema,
      permissionId: "chat.view"
    },
    {
      method: "GET",
      path: "/api/chat/threads/:id/messages",
      responseSchema: listChatMessagesResponseSchema,
      permissionId: "chat.view"
    },
    {
      method: "POST",
      path: "/api/chat/threads/:id/messages",
      requestSchema: appendChatUserMessageRequestSchema,
      responseSchema: appendChatUserMessageResponseSchema,
      permissionId: "chat.message"
    }
  ]
} satisfies JarvisModuleManifest;
