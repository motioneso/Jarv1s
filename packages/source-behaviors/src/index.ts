import type { DataContextDb } from "@jarv1s/db";
import { HttpError } from "@jarv1s/module-sdk";
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

export interface SourceBehaviorState extends SourceBehaviorDecl {
  readonly enabled: boolean;
  readonly toggleable: boolean;
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

export async function listSourceBehaviorStates(
  scopedDb: DataContextDb,
  deps: SourceBehaviorPolicyDeps
): Promise<SourceBehaviorState[]> {
  const overrides = await readOverrides(scopedDb, deps);
  return collectSourceBehaviors(deps.manifests).map((behavior) => {
    const toggleable = behavior.default !== "coming-soon";
    const override = overrides[behavior.id];
    const enabled =
      toggleable && typeof override === "boolean" ? override : behavior.default === "default-on";
    return {
      ...behavior,
      enabled: toggleable ? enabled : false,
      toggleable
    };
  });
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

  const overrides = await readOverrides(scopedDb, deps);
  const override = overrides[behaviorId];
  if (typeof override === "boolean") {
    return override;
  }

  return behavior.default === "default-on";
}

export async function setSourceBehaviorOverride(
  scopedDb: DataContextDb,
  deps: SourceBehaviorPolicyDeps,
  behaviorId: string,
  enabled: boolean
): Promise<SourceBehaviorState[]> {
  const behavior = collectSourceBehaviors(deps.manifests).find((item) => item.id === behaviorId);
  if (!behavior) {
    throw new HttpError(404, "Source behavior not found");
  }
  if (behavior.default === "coming-soon") {
    throw new HttpError(422, "Source behavior is not available yet");
  }

  const overrides = await readOverrides(scopedDb, deps);
  await deps.preferencesRepository.upsert(scopedDb, SOURCE_BEHAVIOR_PREFERENCE_KEY, {
    ...overrides,
    [behaviorId]: enabled
  });
  return listSourceBehaviorStates(scopedDb, deps);
}

async function readOverrides(
  scopedDb: DataContextDb,
  deps: SourceBehaviorPolicyDeps
): Promise<Record<string, unknown>> {
  const stored = await deps.preferencesRepository.get(scopedDb, SOURCE_BEHAVIOR_PREFERENCE_KEY);
  return stored && typeof stored === "object" && !Array.isArray(stored)
    ? (stored as Record<string, unknown>)
    : {};
}
