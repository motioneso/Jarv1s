import type {
  ExternalModuleAssistantToolDeclaration,
  JarvisModuleManifest,
  ToolContext,
  ToolInput,
  ToolResult
} from "@jarv1s/module-sdk";

import type { ExternalModuleDiscovery } from "./types.js";

export type ExternalToolInvoker = (
  module: ExternalModuleDiscovery,
  tool: ExternalModuleAssistantToolDeclaration,
  input: ToolInput,
  context: ToolContext
) => Promise<ToolResult>;

export function createExternalToolManifests(
  discoveries: readonly ExternalModuleDiscovery[],
  invoke: ExternalToolInvoker
): JarvisModuleManifest[] {
  return discoveries
    .filter((module) => module.manifest.runtime && module.manifest.assistantTools?.length)
    .map((module) => ({
      id: module.id,
      name: module.manifest.name,
      version: module.manifest.version,
      publisher: module.manifest.publisher,
      lifecycle: module.manifest.lifecycle,
      compatibility: module.manifest.compatibility,
      assistantOnboarding: module.manifest.assistantOnboarding,
      availability: {
        defaultEnabled: false,
        supportsUserDisable: module.manifest.lifecycle === "user-toggleable"
      },
      assistantTools: module.manifest.assistantTools?.map((tool) => ({
        name: tool.name,
        description: tool.description,
        permissionId: tool.permissionId,
        risk: tool.risk,
        inputSchema: tool.inputSchema,
        outputSchema: tool.outputSchema,
        execute: (_scopedDb, input, context) => invoke(module, tool, input, context)
      }))
    }));
}
