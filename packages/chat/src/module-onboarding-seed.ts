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
    const state = await input.gateway.runReadToolForActor(
      actorUserId,
      `${moduleId}.onboarding.get-state`,
      {}
    );
    if (!state.ok) return undefined;
    return {
      moduleId,
      guidance: manifest.assistantOnboarding.guidance,
      state: state.data
    };
  };
}
