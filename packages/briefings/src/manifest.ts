import { fileURLToPath } from "node:url";

import type { JarvisModuleManifest } from "@jarv1s/module-sdk";
import {
  briefingRunPayloadSchema,
  createBriefingDefinitionRequestSchema,
  createBriefingDefinitionResponseSchema,
  listBriefingDefinitionsResponseSchema,
  listBriefingRunsResponseSchema,
  runBriefingDefinitionRequestSchema,
  runBriefingDefinitionResponseSchema,
  updateBriefingDefinitionRequestSchema,
  updateBriefingDefinitionResponseSchema
} from "@jarv1s/shared";

export const BRIEFINGS_MODULE_ID = "briefings";
export const BRIEFINGS_RUN_QUEUE = "briefings-run";
export const briefingsModuleSqlMigrationDirectory = fileURLToPath(
  new URL("../sql", import.meta.url)
);

export const briefingsModuleManifest = {
  id: BRIEFINGS_MODULE_ID,
  name: "Briefings",
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
    migrations: ["sql/0015_briefings_module.sql"],
    migrationDirectories: ["packages/briefings/sql"],
    ownedTables: ["app.briefing_definitions", "app.briefing_runs"]
  },
  navigation: [
    {
      id: "briefings",
      label: "Briefings",
      path: "/briefings",
      icon: "newspaper",
      order: 50,
      permissionId: "briefings.view"
    }
  ],
  permissions: [
    {
      id: "briefings.view",
      label: "View briefings",
      description:
        "Read briefing definitions and runs visible to the actor through ownership or workspace visibility.",
      scope: "workspace",
      actions: ["view"]
    },
    {
      id: "briefings.create",
      label: "Create briefings",
      description: "Create private or workspace-visible briefing definitions.",
      scope: "workspace",
      actions: ["create"]
    },
    {
      id: "briefings.update",
      label: "Update briefings",
      description: "Update briefing definitions owned by the active actor.",
      scope: "workspace",
      actions: ["update"]
    },
    {
      id: "briefings.run",
      label: "Run briefings",
      description: "Queue metadata-only briefing runs over selected read-risk assistant tools.",
      scope: "workspace",
      actions: ["execute"]
    }
  ],
  featureFlags: [
    {
      id: "briefings.module",
      label: "Briefings module",
      description: "Enables scheduled read-only briefing summaries.",
      scope: "system",
      defaultEnabled: true
    }
  ],
  routes: [
    {
      method: "GET",
      path: "/api/briefings/definitions",
      responseSchema: listBriefingDefinitionsResponseSchema,
      permissionId: "briefings.view"
    },
    {
      method: "POST",
      path: "/api/briefings/definitions",
      requestSchema: createBriefingDefinitionRequestSchema,
      responseSchema: createBriefingDefinitionResponseSchema,
      permissionId: "briefings.create"
    },
    {
      method: "PATCH",
      path: "/api/briefings/definitions/:id",
      requestSchema: updateBriefingDefinitionRequestSchema,
      responseSchema: updateBriefingDefinitionResponseSchema,
      permissionId: "briefings.update"
    },
    {
      method: "POST",
      path: "/api/briefings/definitions/:id/run",
      requestSchema: runBriefingDefinitionRequestSchema,
      responseSchema: runBriefingDefinitionResponseSchema,
      permissionId: "briefings.run"
    },
    {
      method: "GET",
      path: "/api/briefings/definitions/:id/runs",
      responseSchema: listBriefingRunsResponseSchema,
      permissionId: "briefings.view"
    }
  ],
  jobs: [
    {
      queueName: BRIEFINGS_RUN_QUEUE,
      payloadSchema: briefingRunPayloadSchema,
      metadataOnly: true,
      permissionId: "briefings.run"
    }
  ]
} satisfies JarvisModuleManifest;
