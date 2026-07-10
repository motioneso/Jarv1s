import type { DataContextRunner } from "@jarv1s/db";
import type { JarvisModuleManifest, ToolResult } from "@jarv1s/module-sdk";
import type { ExternalModuleDiscovery } from "@jarv1s/module-registry";
import {
  createExternalModuleRpcHandler,
  createExternalToolManifests,
  ExternalModuleWorkerRuntime
} from "@jarv1s/module-registry/node";
import { createModuleCredentialSecretCipher, type SettingsRepository } from "@jarv1s/settings";

export function createExternalModuleTools(input: {
  readonly discoveries: readonly ExternalModuleDiscovery[];
  readonly workerDataContext?: DataContextRunner;
  readonly appDataContext: DataContextRunner;
  readonly settingsRepository: SettingsRepository;
  readonly logger: { warn(data: Record<string, unknown>, message?: string): void };
}): {
  readonly runtime?: ExternalModuleWorkerRuntime;
  readonly manifests: readonly JarvisModuleManifest[];
} {
  if (!input.workerDataContext) return { manifests: [] };
  const runtime = new ExternalModuleWorkerRuntime({ logger: input.logger });
  const cipher = createModuleCredentialSecretCipher();
  const manifests = createExternalToolManifests(
    input.discoveries,
    async (module, tool, toolInput, context) => {
      const rpc = createExternalModuleRpcHandler({
        module,
        toolRisk: tool.risk,
        actorUserId: context.actorUserId,
        requestId: context.requestId,
        workerDataContext: input.workerDataContext!,
        cipher,
        isActorAdmin: () =>
          input.appDataContext.withDataContext(
            { actorUserId: context.actorUserId, requestId: context.requestId },
            async (scopedDb) =>
              (await input.settingsRepository.getUserById(scopedDb, context.actorUserId))
                ?.is_instance_admin === true
          )
      });
      return externalToolResult(await runtime.invoke(module, tool.handler, toolInput, rpc));
    }
  );
  return { runtime, manifests };
}

export function createExternalActiveModulesResolver(
  resolveEnabledModules: (actorUserId: string) => Promise<readonly JarvisModuleManifest[]>,
  externalModuleIds: ReadonlySet<string>,
  getActiveExternalModules: (actorUserId: string) => Promise<readonly { id: string }[]>
): (actorUserId: string) => Promise<readonly JarvisModuleManifest[]> {
  if (externalModuleIds.size === 0) return resolveEnabledModules;
  return async (actorUserId) => {
    const [enabled, activeExternal] = await Promise.all([
      resolveEnabledModules(actorUserId),
      getActiveExternalModules(actorUserId)
    ]);
    const activeIds = new Set(activeExternal.map((module) => module.id));
    return enabled.filter(
      (manifest) => !externalModuleIds.has(manifest.id) || activeIds.has(manifest.id)
    );
  };
}

function externalToolResult(value: unknown): ToolResult {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    if (record.data && typeof record.data === "object" && !Array.isArray(record.data)) {
      return value as ToolResult;
    }
    return { data: record };
  }
  return { data: { value } };
}
