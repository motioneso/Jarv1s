import type { DataContextDb } from "@jarv1s/db";
import type { JarvisModuleManifest, SourceBehaviorDecl } from "@jarv1s/module-sdk";

export const SOURCE_BEHAVIOR_PREFERENCE_KEY = "sourceBehaviors";

export interface SourceBehaviorPreferencesPort {
  get(scopedDb: DataContextDb, key: string): Promise<unknown>;
  upsert(scopedDb: DataContextDb, key: string, value: unknown): Promise<void>;
}

export interface SourceBehaviorPolicyDeps {
  readonly manifests: readonly JarvisModuleManifest[];
  readonly preferencesRepository: SourceBehaviorPreferencesPort;
}

export function collectSourceBehaviors(
  manifests: readonly JarvisModuleManifest[]
): SourceBehaviorDecl[] {
  return manifests
    .flatMap((manifest) => manifest.sourceBehaviors ?? [])
    .slice()
    .sort(
      (left, right) =>
        left.sourceName.localeCompare(right.sourceName) || left.name.localeCompare(right.name)
    );
}

export async function isBehaviorEnabled(
  scopedDb: DataContextDb,
  deps: SourceBehaviorPolicyDeps,
  behaviorId: string
): Promise<boolean> {
  const behavior = collectSourceBehaviors(deps.manifests).find((item) => item.id === behaviorId);
  if (!behavior || behavior.default === "coming-soon") {
    return false;
  }

  const stored = await deps.preferencesRepository.get(scopedDb, SOURCE_BEHAVIOR_PREFERENCE_KEY);
  const overrides = stored && typeof stored === "object" ? (stored as Record<string, unknown>) : {};
  const override = overrides[behaviorId];
  if (typeof override === "boolean") {
    return override;
  }

  return behavior.default === "default-on";
}
