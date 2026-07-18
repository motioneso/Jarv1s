import { fileURLToPath } from "node:url";

import type { JarvisModuleManifest } from "@jarv1s/module-sdk";
import {
  getChatPrivacyStateResponseSchema,
  listChatThreadMessagesResponseSchema,
  listChatThreadsResponseSchema,
  listMemoryCorrectionsResponseSchema
} from "@jarv1s/shared";

import { chatListTodaysTurnsExecute } from "./tools.js";
import { chatGetCurrentViewExecute, chatGetCurrentViewOutputSchema } from "./current-view-tool.js";
import { chatReadAttachmentExecute } from "./attachment-tool.js";

const CHAT_MODULE_ID = "chat";
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
      "sql/0025_chat_owner_or_share.sql",
      "sql/0034_chat_status_activity.sql",
      "sql/0035_chat_messages_update_grant.sql",
      "sql/0036_chat_worker_runtime_grants.sql",
      "sql/0038_chat_live_runtime.sql",
      "sql/0042_chat_memory_settings.sql",
      "sql/0049_chat_conversation_summary.sql",
      "sql/0057_revoke_app_runtime_chat_update.sql",
      "sql/0058_chat_threads_incognito_immutable.sql",
      "sql/0060_chat_memory_settings_to_role.sql",
      "sql/0146_private_chat_cleanup.sql",
      "sql/0149_chat_skills.sql"
    ],
    migrationDirectories: ["packages/chat/sql"],
    ownedTables: [
      "app.chat_threads",
      "app.chat_messages",
      "app.chat_user_memory_settings",
      "app.chat_skills"
    ]
  },
  navigation: [
    {
      id: "chat",
      label: "Chat",
      description: "Talk with Jarvis and review prior conversations.",
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
      description: "Read chat threads and messages visible to the active actor.",
      scope: "user",
      actions: ["view"]
    },
    {
      id: "chat.create",
      label: "Create chat",
      description: "Create chat threads for the active actor.",
      scope: "user",
      actions: ["create"]
    },
    {
      id: "chat.message",
      label: "Append chat messages",
      description:
        "Append user messages and record assistant-side safe routing/tool metadata without execution.",
      scope: "user",
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
      method: "GET",
      path: "/api/chat/threads/:id/messages",
      responseSchema: listChatThreadMessagesResponseSchema,
      permissionId: "chat.view"
    },
    { method: "POST", path: "/api/chat/turn", permissionId: "chat.message" },
    // #1133 — file/image upload staged for the next turn; sending is what needs the
    // message permission, so the upload shares it.
    { method: "POST", path: "/api/chat/attachments", permissionId: "chat.message" },
    { method: "POST", path: "/api/chat/evening-interview", permissionId: "chat.message" },
    { method: "POST", path: "/api/chat/turn/cancel", permissionId: "chat.message" },
    { method: "GET", path: "/api/chat/stream", permissionId: "chat.view" },
    { method: "POST", path: "/api/chat/clear", permissionId: "chat.message" },
    { method: "POST", path: "/api/chat/private/end", permissionId: "chat.message" },
    {
      method: "GET",
      path: "/api/chat/privacy",
      responseSchema: getChatPrivacyStateResponseSchema,
      permissionId: "chat.view"
    },
    { method: "POST", path: "/api/chat/switch", permissionId: "chat.message" },
    { method: "PUT", path: "/api/chat/page-context", permissionId: "chat.message" },
    { method: "POST", path: "/api/chat/threads/:id/resume", permissionId: "chat.message" },
    { method: "GET", path: "/api/chat/settings", permissionId: "chat.view" },
    { method: "PUT", path: "/api/chat/settings", permissionId: "chat.message" },
    { method: "GET", path: "/api/chat/memory/settings", permissionId: "chat.view" },
    { method: "PATCH", path: "/api/chat/memory/settings", permissionId: "chat.message" },
    { method: "GET", path: "/api/chat/memory/facts", permissionId: "chat.view" },
    {
      method: "GET",
      path: "/api/chat/memory/corrections",
      responseSchema: listMemoryCorrectionsResponseSchema,
      permissionId: "chat.view"
    },
    { method: "DELETE", path: "/api/chat/memory/facts/:id", permissionId: "chat.message" },
    { method: "PATCH", path: "/api/chat/memory/facts/:id", permissionId: "chat.message" },
    { method: "POST", path: "/api/chat/memory/facts/:id/confirm", permissionId: "chat.message" },
    { method: "POST", path: "/api/chat/memory/facts/:id/reject", permissionId: "chat.message" },
    {
      method: "POST",
      path: "/api/chat/action-requests/:id/resolve",
      permissionId: "chat.message"
    },
    {
      method: "GET",
      path: "/api/chat/messages/:messageId/provenance",
      permissionId: "chat.view"
    },
    {
      method: "GET",
      path: "/api/chat/messages/:messageId/provenance/:supportId/dereference",
      permissionId: "chat.view"
    },
    { method: "POST", path: "/api/mcp", permissionId: "chat.message" },
    { method: "POST", path: "/internal/permission", permissionId: "chat.message" },
    { method: "GET", path: "/api/chat/skills", permissionId: "chat.view" },
    { method: "GET", path: "/api/chat/skills/:id", permissionId: "chat.view" },
    { method: "POST", path: "/api/chat/skills", permissionId: "chat.message" },
    { method: "PATCH", path: "/api/chat/skills/:id", permissionId: "chat.message" },
    { method: "PATCH", path: "/api/chat/skills/:id/enabled", permissionId: "chat.message" },
    { method: "DELETE", path: "/api/chat/skills/:id", permissionId: "chat.message" },
    { method: "POST", path: "/api/chat/skills/import", permissionId: "chat.message" }
  ],
  assistantTools: [
    {
      name: "chat.listTodaysTurns",
      description: "List today's non-incognito chat turns for the active actor.",
      permissionId: "chat.view",
      risk: "read",
      inputSchema: { type: "object", properties: {} },
      execute: chatListTodaysTurnsExecute
    },
    {
      name: "chat.getCurrentView",
      description:
        "Read the active actor's latest bounded, redacted Jarvis web view and capability-level server facts.",
      permissionId: "chat.view",
      risk: "read",
      inputSchema: { type: "object", additionalProperties: false, properties: {} },
      outputSchema: chatGetCurrentViewOutputSchema,
      execute: chatGetCurrentViewExecute
    },
    {
      name: "chat.readAttachment",
      description:
        "Read a file the user attached to the current chat turn, by attachmentId from the turn's <attachments> manifest. Images return as viewable images; PDFs and text files return extracted text.",
      permissionId: "chat.view",
      risk: "read",
      // #1133 — no outputSchema: the image case returns a `media` payload that schema
      // projection would drop (see gateway.runHandler media pass-through).
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["attachmentId"],
        properties: { attachmentId: { type: "string" } }
      },
      execute: chatReadAttachmentExecute
    }
  ]
} satisfies JarvisModuleManifest;
