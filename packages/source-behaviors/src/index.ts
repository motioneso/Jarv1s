import type { DataContextDb, PreferencesPort } from "@jarv1s/db";
import { HttpError } from "@jarv1s/module-sdk";
import type {
  JarvisModuleManifest,
  SourceBehaviorDecl,
  SourceBehaviorSourceDecl
} from "@jarv1s/module-sdk";

export const SOURCE_BEHAVIOR_PREFERENCE_KEY = "sourceBehaviors";

/** Source behaviors read/write a user's stored toggle blob via the shared KV port. */
export type SourceBehaviorPreferencesPort = PreferencesPort;

export interface SourceBehaviorPolicyDeps {
  readonly manifests: readonly JarvisModuleManifest[];
  readonly preferencesRepository: SourceBehaviorPreferencesPort;
}

export interface SourceBehaviorState extends SourceBehaviorDecl {
  readonly enabled: boolean;
  readonly toggleable: boolean;
}

export interface SourceBehaviorSourceState {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly behaviors: readonly SourceBehaviorState[];
}

/** Sources across all manifests, sorted by source display name. */
export function collectSourceBehaviorSources(
  manifests: readonly JarvisModuleManifest[]
): SourceBehaviorSourceDecl[] {
  return manifests
    .flatMap((manifest) => manifest.sourceBehaviors ?? [])
    .slice()
    .sort((left, right) => left.name.localeCompare(right.name));
}

function findBehavior(
  manifests: readonly JarvisModuleManifest[],
  behaviorId: string
): SourceBehaviorDecl | undefined {
  return manifests
    .flatMap((manifest) => manifest.sourceBehaviors ?? [])
    .flatMap((source) => source.behaviors)
    .find((behavior) => behavior.id === behaviorId);
}

function toState(behavior: SourceBehaviorDecl, override: unknown): SourceBehaviorState {
  const toggleable = behavior.default !== "coming-soon";
  const enabled =
    toggleable && typeof override === "boolean" ? override : behavior.default === "default-on";
  return { ...behavior, enabled: toggleable ? enabled : false, toggleable };
}

export async function listSourceBehaviorStates(
  scopedDb: DataContextDb,
  deps: SourceBehaviorPolicyDeps
): Promise<SourceBehaviorSourceState[]> {
  const overrides = await readOverrides(scopedDb, deps);
  return collectSourceBehaviorSources(deps.manifests).map((source) => ({
    id: source.id,
    name: source.name,
    description: source.description,
    behaviors: source.behaviors.map((behavior) => toState(behavior, overrides[behavior.id]))
  }));
}

export async function isBehaviorEnabled(
  scopedDb: DataContextDb,
  deps: SourceBehaviorPolicyDeps,
  behaviorId: string
): Promise<boolean> {
  const behavior = findBehavior(deps.manifests, behaviorId);
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
): Promise<SourceBehaviorSourceState[]> {
  const behavior = findBehavior(deps.manifests, behaviorId);
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
