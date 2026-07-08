import { fileURLToPath } from "node:url";

import type { JarvisModuleManifest } from "@jarv1s/module-sdk";
import {
  aiDiscoverModelsResponseSchema,
  createAiConfiguredModelRequestSchema,
  createAiConfiguredModelResponseSchema,
  createAiProviderConfigRequestSchema,
  createAiProviderConfigResponseSchema,
  discoverAiProviderModelsResponseSchema,
  getAiSummaryResponseSchema,
  getChatModelOverrideSettingsResponseSchema,
  getAiAdminUserPinResponseSchema,
  invokeAiAssistantToolRequestSchema,
  invokeAiAssistantToolResponseSchema,
  listAiCapabilityRoutesResponseSchema,
  listAiAssistantActionsResponseSchema,
  listAiAssistantToolsResponseSchema,
  listAiConfiguredModelsResponseSchema,
  listAiProviderConfigsResponseSchema,
  lookupAiCapabilityRouteResponseSchema,
  putAiCapabilityRouteRequestSchema,
  putAiCapabilityRouteResponseSchema,
  putAdminChatModelOverrideRequestSchema,
  putAiAdminUserPinRequestSchema,
  putChatModelOverrideRequestSchema,
  resolveAiAssistantActionRequestSchema,
  resolveAiAssistantActionResponseSchema,
  revokeAiProviderConfigResponseSchema,
  testAiProviderConfigResponseSchema,
  transcribeAudioResponseSchema,
  updateAiConfiguredModelRequestSchema,
  updateAiConfiguredModelResponseSchema,
  updateAiProviderConfigRequestSchema,
  updateAiProviderConfigResponseSchema,
  aiCapabilityTierPreferencesResponseSchema,
  patchAiCapabilityTierPreferenceRequestSchema,
  getAiActionPoliciesResponseSchema,
  patchAiActionPolicyRequestSchema,
  patchAiActionPolicyResponseSchema,
  listActionAuditLogRouteSchema
} from "@jarv1s/shared";

export const AI_MODULE_ID = "ai";
export const aiModuleSqlMigrationDirectory = fileURLToPath(new URL("../sql", import.meta.url));

export const aiModuleManifest = {
  id: AI_MODULE_ID,
  name: "AI",
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
      "sql/0013_ai_module.sql",
      "sql/0016_ai_assistant_actions.sql",
      "sql/0033_ai_auth_method.sql",
      "sql/0037_ai_worker_read_grants.sql",
      "sql/0048_ai_model_tier.sql",
      "sql/0091_chat_model_override.sql",
      "sql/0098_ai_cancel_stale_assistant_actions.sql",
      "sql/0127_jarvis_action_audit_log.sql",
      "sql/0145_jarvis_error_log.sql"
    ],
    migrationDirectories: ["packages/ai/sql"],
    ownedTables: [
      "app.ai_provider_configs",
      "app.ai_configured_models",
      "app.ai_assistant_action_requests",
      "app.jarvis_action_audit_log",
      "app.jarvis_error_log"
    ]
  },
  settings: [
    {
      id: "ai.user-settings",
      label: "AI Providers",
      path: "/settings/ai",
      scope: "user",
      order: 40,
      permissionId: "ai.manage"
    }
  ],
  permissions: [
    {
      id: "ai.view",
      label: "View AI configuration",
      description: "View safe AI provider and model configuration metadata for the active actor.",
      scope: "user",
      actions: ["view"]
    },
    {
      id: "ai.manage",
      label: "Manage AI configuration",
      description: "Create, update, deactivate, and revoke AI provider and model configuration.",
      scope: "user",
      actions: ["create", "update", "manage"]
    },
    {
      id: "ai.route",
      label: "Route AI capability",
      description: "Resolve an active configured model for a declared AI capability.",
      scope: "user",
      actions: ["view"]
    },
    {
      id: "ai.assistant-actions",
      label: "Confirm assistant actions",
      description:
        "View and resolve pending risky assistant action requests without executing them.",
      scope: "user",
      actions: ["view", "update"]
    }
  ],
  featureFlags: [
    {
      id: "ai.module",
      label: "AI module",
      description: "Enables BYO AI provider metadata and capability-routing configuration.",
      scope: "system",
      defaultEnabled: true
    }
  ],
  routes: [
    {
      method: "GET",
      path: "/api/ai/summary",
      responseSchema: getAiSummaryResponseSchema,
      permissionId: "ai.view"
    },
    {
      method: "GET",
      path: "/api/ai/providers",
      responseSchema: listAiProviderConfigsResponseSchema,
      permissionId: "ai.view"
    },
    {
      method: "POST",
      path: "/api/ai/providers",
      requestSchema: createAiProviderConfigRequestSchema,
      responseSchema: createAiProviderConfigResponseSchema,
      permissionId: "ai.manage"
    },
    {
      method: "PATCH",
      path: "/api/ai/providers/:id",
      requestSchema: updateAiProviderConfigRequestSchema,
      responseSchema: updateAiProviderConfigResponseSchema,
      permissionId: "ai.manage"
    },
    {
      method: "POST",
      path: "/api/ai/providers/:id/revoke",
      responseSchema: revokeAiProviderConfigResponseSchema,
      permissionId: "ai.manage"
    },
    {
      method: "POST",
      path: "/api/ai/providers/:id/test",
      responseSchema: testAiProviderConfigResponseSchema,
      permissionId: "ai.manage"
    },
    {
      method: "POST",
      path: "/api/ai/providers/:id/discover-models",
      responseSchema: discoverAiProviderModelsResponseSchema,
      permissionId: "ai.manage"
    },
    {
      method: "GET",
      path: "/api/ai/providers/:id/models/discover",
      responseSchema: aiDiscoverModelsResponseSchema,
      permissionId: "ai.manage"
    },
    {
      method: "GET",
      path: "/api/ai/models",
      responseSchema: listAiConfiguredModelsResponseSchema,
      permissionId: "ai.view"
    },
    {
      method: "POST",
      path: "/api/ai/models",
      requestSchema: createAiConfiguredModelRequestSchema,
      responseSchema: createAiConfiguredModelResponseSchema,
      permissionId: "ai.manage"
    },
    {
      method: "PATCH",
      path: "/api/ai/models/:id",
      requestSchema: updateAiConfiguredModelRequestSchema,
      responseSchema: updateAiConfiguredModelResponseSchema,
      permissionId: "ai.manage"
    },
    {
      method: "GET",
      path: "/api/ai/capability-route/:capability",
      responseSchema: lookupAiCapabilityRouteResponseSchema,
      permissionId: "ai.route"
    },
    {
      method: "GET",
      path: "/api/ai/capability-routes",
      responseSchema: listAiCapabilityRoutesResponseSchema,
      permissionId: "ai.view"
    },
    {
      method: "PUT",
      path: "/api/ai/capability-routes/:capability",
      requestSchema: putAiCapabilityRouteRequestSchema,
      responseSchema: putAiCapabilityRouteResponseSchema,
      permissionId: "ai.manage"
    },
    {
      method: "POST",
      path: "/api/ai/transcriptions",
      responseSchema: transcribeAudioResponseSchema,
      permissionId: "ai.route"
    },
    {
      method: "GET",
      path: "/api/ai/capability-tier-preferences",
      responseSchema: aiCapabilityTierPreferencesResponseSchema,
      permissionId: "ai.view"
    },
    {
      method: "PATCH",
      path: "/api/ai/capability-tier-preferences",
      requestSchema: patchAiCapabilityTierPreferenceRequestSchema,
      permissionId: "ai.route"
    },
    {
      method: "GET",
      path: "/api/ai/chat-model-override",
      responseSchema: getChatModelOverrideSettingsResponseSchema,
      permissionId: "ai.view"
    },
    {
      method: "PUT",
      path: "/api/ai/chat-model-override",
      requestSchema: putChatModelOverrideRequestSchema,
      responseSchema: getChatModelOverrideSettingsResponseSchema,
      permissionId: "ai.route"
    },
    {
      method: "PUT",
      path: "/api/admin/ai/chat-model-override",
      requestSchema: putAdminChatModelOverrideRequestSchema,
      responseSchema: getChatModelOverrideSettingsResponseSchema,
      permissionId: "ai.manage"
    },
    {
      method: "GET",
      path: "/api/admin/users/:userId/ai-pin",
      responseSchema: getAiAdminUserPinResponseSchema,
      permissionId: "ai.manage"
    },
    {
      method: "PUT",
      path: "/api/admin/users/:userId/ai-pin",
      requestSchema: putAiAdminUserPinRequestSchema,
      responseSchema: getAiAdminUserPinResponseSchema,
      permissionId: "ai.manage"
    },
    {
      method: "GET",
      path: "/api/ai/assistant-tools",
      responseSchema: listAiAssistantToolsResponseSchema,
      permissionId: "ai.view"
    },
    {
      method: "POST",
      path: "/api/ai/assistant-tools/:name/invoke",
      requestSchema: invokeAiAssistantToolRequestSchema,
      responseSchema: invokeAiAssistantToolResponseSchema,
      permissionId: "ai.route"
    },
    {
      method: "GET",
      path: "/api/ai/assistant-actions",
      responseSchema: listAiAssistantActionsResponseSchema,
      permissionId: "ai.assistant-actions"
    },
    {
      method: "POST",
      path: "/api/ai/assistant-actions/:id/resolve",
      requestSchema: resolveAiAssistantActionRequestSchema,
      responseSchema: resolveAiAssistantActionResponseSchema,
      permissionId: "ai.assistant-actions"
    },
    {
      method: "GET",
      path: "/api/ai/action-policy",
      responseSchema: getAiActionPoliciesResponseSchema,
      permissionId: "ai.view"
    },
    {
      method: "PATCH",
      path: "/api/ai/action-policy/:moduleId/:actionFamilyId",
      requestSchema: patchAiActionPolicyRequestSchema,
      responseSchema: patchAiActionPolicyResponseSchema,
      permissionId: "ai.manage"
    },
    {
      method: "GET",
      path: "/api/ai/action-audit",
      responseSchema: listActionAuditLogRouteSchema.response[200],
      permissionId: "ai.assistant-actions"
    }
  ]
} satisfies JarvisModuleManifest;
