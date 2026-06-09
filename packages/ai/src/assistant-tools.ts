import type { JarvisModuleManifest } from "@jarv1s/module-sdk";
import type { AiAssistantToolDto } from "@jarv1s/shared";

export function listAssistantToolsFromManifests(
  moduleManifests: readonly JarvisModuleManifest[]
): AiAssistantToolDto[] {
  return moduleManifests.flatMap((module) =>
    (module.assistantTools ?? []).map((tool) => ({
      moduleId: module.id,
      moduleName: module.name,
      name: tool.name,
      description: tool.description,
      permissionId: tool.permissionId,
      risk: tool.risk,
      inputSchema: tool.inputSchema ?? null,
      outputSchema: tool.outputSchema ?? null
    }))
  );
}

export function findAssistantToolFromManifests(
  moduleManifests: readonly JarvisModuleManifest[],
  toolName: string
): AiAssistantToolDto | undefined {
  return listAssistantToolsFromManifests(moduleManifests).find((tool) => tool.name === toolName);
}

/**
 * Metadata-only summary of a tool's input for persisting on an action request and
 * rendering the Approve/Deny card. Never includes the raw values — only key names
 * and count, so private content never lands in the action-requests table.
 */
export function summarizeAssistantToolInput(
  input: Record<string, unknown>
): Record<string, unknown> {
  const inputKeys = Object.keys(input).sort();

  return {
    inputKeys,
    inputKeyCount: inputKeys.length
  };
}
