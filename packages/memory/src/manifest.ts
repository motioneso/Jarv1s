import { fileURLToPath } from "node:url";

import type { JarvisModuleManifest } from "@jarv1s/module-sdk";
import {
  getMemoryGraphCoreRouteSchema,
  getMemoryGraphRecallRouteSchema,
  postMemoryGraphEntityRouteSchema,
  postMemoryGraphFactRouteSchema,
  postMemoryGraphPinRouteSchema,
  postMemoryGraphSupersedeRouteSchema
} from "@jarv1s/shared";
import { memoryForgetExecute, memoryRecallExecute, memoryRememberExecute } from "./graph-tools.js";

const memoryRememberToolInputSchema = {
  type: "object",
  additionalProperties: false,
  required: ["predicate", "source"],
  properties: {
    subjectEntityId: { type: "string" },
    predicate: {
      type: "string",
      enum: [
        "prefers",
        "works_on",
        "has_goal",
        "has_constraint",
        "decided",
        "related_to",
        "owes",
        "waiting_on",
        "mentioned_in",
        "alias_of"
      ]
    },
    objectEntityId: { type: "string" },
    objectText: { type: "string" },
    confidence: { type: "number" },
    provenance: { type: "string", enum: ["volunteered", "inferred", "confirmed", "imported"] },
    importance: { type: "number" },
    pinned: { type: "boolean" },
    source: {
      type: "object",
      additionalProperties: false,
      required: ["sourceKind", "sourceRef", "excerpt"],
      properties: {
        sourceKind: {
          type: "string",
          enum: ["chat", "note", "task", "email", "calendar", "manual"]
        },
        sourceRef: { type: "string" },
        sourceLabel: { type: "string" },
        excerpt: { type: "string" }
      }
    }
  }
} as const;

export const MEMORY_MODULE_ID = "memory";
export const memorySqlMigrationDirectory = fileURLToPath(new URL("../sql", import.meta.url));

export const memoryModuleManifest: JarvisModuleManifest = {
  id: MEMORY_MODULE_ID,
  name: "Memory",
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
      "sql/0030_memory_index.sql",
      "sql/0032_memory_embedding_768.sql",
      "sql/0040_memory_chat_source.sql",
      "sql/0041_memory_facts.sql"
    ],
    migrationDirectories: ["packages/memory/sql"],
    ownedTables: [
      "app.memory_chunks",
      "app.memory_links",
      "app.memory_file_index",
      "app.chat_memory_facts",
      "app.memory_entities",
      "app.memory_facts",
      "app.memory_episodes",
      "app.memory_fact_sources",
      "app.memory_aliases",
      "app.memory_search_documents",
      "app.memory_legacy_fact_migrations",
      "app.memory_candidates"
    ]
  },
  routes: [
    {
      method: "GET",
      path: "/api/memory/graph/recall",
      responseSchema: getMemoryGraphRecallRouteSchema.response[200],
      permissionId: "memory.view"
    },
    {
      method: "GET",
      path: "/api/memory/graph/core",
      responseSchema: getMemoryGraphCoreRouteSchema.response[200],
      permissionId: "memory.view"
    },
    {
      method: "POST",
      path: "/api/memory/graph/entities",
      requestSchema: postMemoryGraphEntityRouteSchema.body,
      permissionId: "memory.manage"
    },
    {
      method: "POST",
      path: "/api/memory/graph/facts",
      requestSchema: postMemoryGraphFactRouteSchema.body,
      permissionId: "memory.manage"
    },
    {
      method: "POST",
      path: "/api/memory/graph/facts/:id/pin",
      requestSchema: postMemoryGraphPinRouteSchema.body,
      permissionId: "memory.manage"
    },
    {
      method: "POST",
      path: "/api/memory/graph/facts/:id/supersede",
      requestSchema: postMemoryGraphSupersedeRouteSchema.body,
      permissionId: "memory.manage"
    },
    {
      method: "DELETE",
      path: "/api/memory/graph/facts/:id",
      permissionId: "memory.manage"
    }
  ],
  assistantTools: [
    {
      name: "memory.recall",
      description: "Recall source-backed graph memory owned by the active actor.",
      permissionId: "memory.view",
      risk: "read",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["query"],
        properties: {
          query: { type: "string" },
          limit: { type: "number" }
        }
      },
      execute: memoryRecallExecute
    },
    {
      name: "memory.remember",
      description: "Create a source-backed graph memory fact for the active actor.",
      permissionId: "memory.manage",
      risk: "write",
      inputSchema: memoryRememberToolInputSchema,
      execute: memoryRememberExecute
    },
    {
      name: "memory.forget",
      description: "Forget a graph memory fact owned by the active actor.",
      permissionId: "memory.manage",
      risk: "destructive",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["factId"],
        properties: {
          factId: { type: "string" }
        }
      },
      execute: memoryForgetExecute
    }
  ]
};
