import type { ActiveModulesResolver, AssistantToolGateway } from "@jarv1s/ai";

import type { ModuleOnboardingSeedSource } from "./live-routes.js";

export function createModuleOnboardingSeedResolver(input: {
  readonly resolveActiveModules: ActiveModulesResolver;
  readonly gateway: Pick<AssistantToolGateway, "runReadToolForActor">;
}): (actorUserId: string, moduleId: string) => Promise<ModuleOnboardingSeedSource | undefined> {
  return async (actorUserId, moduleId) => {
    const manifest = (await input.resolveActiveModules(actorUserId)).find(
      (candidate) => candidate.id === moduleId && candidate.assistantOnboarding?.guidance
    );
    if (!manifest?.assistantOnboarding) return undefined;
    const stateTool = manifest.assistantTools?.find(
      (tool) => tool.name === `${moduleId}.onboarding.get-state`
    );
    const state = stateTool
      ? await input.gateway.runReadToolForActor(actorUserId, stateTool.name, {})
      : { ok: true as const, data: {} };
    if (!state.ok) return undefined;
    return {
      moduleId,
      guidance: manifest.assistantOnboarding.guidance,
      state: state.data
    };
  };
}
