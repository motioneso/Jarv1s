import type { AccessContext, DataContextDb, DataContextRunner } from "@jarv1s/db";
import type { JarvisModuleManifest, ToolResult } from "@jarv1s/module-sdk";
import {
  reconcileExternalModules,
  type ExternalModuleDiscovery,
  type ReconciledExternalModule
} from "@jarv1s/module-registry";
import {
  createExternalModuleRpcHandler,
  createExternalToolManifests,
  ExternalModuleWorkerRuntime,
  type ExternalModuleAiRequest,
  type ExternalModuleAiResult
} from "@jarv1s/module-registry/node";
import { createModuleCredentialSecretCipher, type SettingsRepository } from "@jarv1s/settings";

export function createExternalModuleTools(input: {
  readonly discoveries: readonly ExternalModuleDiscovery[];
  readonly workerDataContext?: DataContextRunner;
  readonly appDataContext: DataContextRunner;
  readonly settingsRepository: SettingsRepository;
  readonly logger: { warn(data: Record<string, unknown>, message?: string): void };
  // ctx.ai bridge (#932, spec D6): injected from server.ts so module-registry never
  // imports @jarv1s/ai. Only this synchronous tool-dispatch path gets it — the
  // queued-jobs handler (apps/worker) is built without it and fails closed.
  readonly ai?: (
    scopedDb: DataContextDb,
    moduleId: string,
    request: ExternalModuleAiRequest
  ) => Promise<ExternalModuleAiResult>;
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
          ),
        // Bind the module id here so the rpc host stays module-agnostic; the host
        // still enforces risk gating, the composition guard, and the call cap.
        ...(input.ai ? { ai: (db, req) => input.ai!(db, module.id, req) } : {})
      });
      // FIN-04 (#1149, spec delta "Host change 2"): hand the worker the
      // host-resolved actor identity in tool input, matching the queue job
      // envelope's actorUserId field. The host value MUST stay spread LAST:
      // validateToolInput deliberately does not enforce additionalProperties
      // (#133), so a caller CAN smuggle an `actorUserId` key through schema
      // validation — spread order, not schema rejection, is the spoof defense.
      return externalToolResult(
        await runtime.invoke(
          module,
          tool.handler,
          { ...toolInput, actorUserId: context.actorUserId },
          rpc
        )
      );
    }
  );
  return { runtime, manifests };
}

/**
 * Per-actor active-module resolver: instance-enabled minus the actor's deny
 * rows. Extracted from server.ts composition (#932) — behavior unchanged.
 * #996/#860: always-defined now — external modules are always-on, so there is
 * no "disabled by config" case to return undefined for.
 */
export function createActiveExternalModulesResolverForApi(input: {
  readonly appDataContext: DataContextRunner;
  readonly settingsRepository: SettingsRepository;
  readonly discoveries: readonly ExternalModuleDiscovery[];
}): (accessContext: AccessContext) => Promise<readonly ReconciledExternalModule[]> {
  return async (accessContext) => {
    const { states, denyRows } = await input.appDataContext.withDataContext(
      accessContext,
      async (scopedDb) => ({
        states: await input.settingsRepository.listExternalModuleStates(scopedDb),
        denyRows: await input.settingsRepository.listModuleDenyRowsForActor(scopedDb)
      })
    );
    const { modules } = reconcileExternalModules(input.discoveries, states);
    const disabled = new Set(denyRows.map((row) => row.module_id));
    return modules.filter((module) => module.active && !disabled.has(module.id));
  };
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
