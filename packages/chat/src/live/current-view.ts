import type { AiModelCapability, AppBuildInfo, CurrentViewSnapshotDto } from "@jarv1s/shared";
import type { DataContextDb } from "@jarv1s/db";
import type { PageContextStore } from "./page-context-store.js";

export interface CurrentViewReadService {
  get(scopedDb: DataContextDb, actorUserId: string): Promise<CurrentViewSnapshotDto>;
}

export function createCurrentViewReadService(deps: {
  readonly store: Pick<PageContextStore, "get">;
  readonly getModelCapabilities: (scopedDb: DataContextDb) => Promise<readonly AiModelCapability[]>;
  readonly getBuildInfo: () => AppBuildInfo;
}): CurrentViewReadService {
  return {
    async get(scopedDb, actorUserId) {
      const stored = deps.store.get(actorUserId);
      const modelCapabilities = await deps.getModelCapabilities(scopedDb);
      const build = deps.getBuildInfo();
      return {
        available: stored !== undefined,
        view: stored?.snapshot ?? null,
        serverFacts: {
          appVersion: build.version,
          buildId: build.buildId,
          platform: stored?.platform ?? "web",
          modelCapabilities
        }
      };
    }
  };
}
