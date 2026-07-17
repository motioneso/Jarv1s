import { readFileSync } from "node:fs";
import type { DataContextDb } from "@jarv1s/db";
import type { AppMapArtifact, AppMapItem } from "@jarv1s/shared";

export type AppMapQuery =
  | { readonly screenId: string; readonly limit?: number }
  | { readonly settingId: string; readonly limit?: number }
  | { readonly errorCode: string; readonly limit?: number }
  | { readonly query: string; readonly limit?: number };

export interface AppMapReadService {
  query(
    scopedDb: DataContextDb,
    actorUserId: string,
    input: AppMapQuery
  ): Promise<{
    kind: string;
    items: readonly AppMapItem[];
    build: { version: string; buildId: string };
    narrative: { authoritative: false; markdown: string } | null;
  }>;
  getBuildInfo(): { readonly version: string; readonly buildId: string };
}

export type ResolveFeatureFlagState = (featureFlagId: string) => boolean;

export function loadAppMap(path: string): AppMapArtifact {
  const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<AppMapArtifact>;
  if (parsed.schemaVersion !== 1 || !parsed.build || !Array.isArray(parsed.screens)) {
    throw new Error(`Invalid app-map artifact at ${path}`);
  }
  return parsed as AppMapArtifact;
}

export function createAppMapReadService(deps: {
  readonly artifact: AppMapArtifact;
  readonly resolveActiveModules: (actorUserId: string) => Promise<readonly { id: string }[]>;
  readonly resolveFeatureFlagState: ResolveFeatureFlagState;
  readonly getUser: (
    scopedDb: DataContextDb,
    userId: string
  ) => Promise<{ is_instance_admin?: boolean; isInstanceAdmin?: boolean } | undefined>;
  readonly logGap: (fields: { kind: string; value: string }) => void;
}): AppMapReadService {
  return {
    getBuildInfo: () => deps.artifact.build,
    async query(scopedDb, actorUserId, input) {
      const [active, user] = await Promise.all([
        deps.resolveActiveModules(actorUserId),
        deps.getUser(scopedDb, actorUserId)
      ]);
      const activeIds = new Set(["core", ...active.map((module) => module.id)]);
      const isAdmin = user?.is_instance_admin === true || user?.isInstanceAdmin === true;
      const limit = Math.max(1, Math.min(input.limit ?? 8, 8));
      const selector: readonly [string, string] =
        "screenId" in input
          ? ["screen", input.screenId]
          : "settingId" in input
            ? ["setting", input.settingId]
            : "errorCode" in input
              ? ["error", input.errorCode]
              : ["query", input.query];
      const [kind, raw] = selector;
      const source =
        kind === "screen"
          ? deps.artifact.screens
          : kind === "setting"
            ? deps.artifact.settings
            : kind === "error"
              ? deps.artifact.errors
              : [
                  ...deps.artifact.screens,
                  ...deps.artifact.settings,
                  ...deps.artifact.features,
                  ...deps.artifact.errors,
                  ...deps.artifact.remediations
                ];
      const needle = raw.trim().toLowerCase();
      const items = source
        .filter(
          (item: AppMapItem) =>
            activeIds.has(item.moduleId) &&
            (isAdmin || item.scope !== "admin") &&
            (item.featureFlagId === undefined ||
              deps.resolveFeatureFlagState(item.featureFlagId) === true) &&
            (kind === "query"
              ? JSON.stringify(item).toLowerCase().includes(needle)
              : item.id === raw || item.code === raw)
        )
        .slice(0, limit);
      if (items.length === 0) deps.logGap({ kind, value: raw.slice(0, 120) });
      const narrative =
        kind === "query" && /what'?s new|what can/i.test(raw)
          ? {
              authoritative: false as const,
              markdown: deps.artifact.narrative.markdown.slice(0, 4000)
            }
          : null;
      return {
        kind,
        items,
        build: deps.artifact.build,
        narrative
      };
    }
  };
}
