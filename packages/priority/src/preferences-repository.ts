/**
 * Priority model preferences repository.
 *
 * Wraps generic PreferencesRepository for priority.model.v1 key with defaults.
 */

import type { PriorityModelPreferenceV1 } from "@jarv1s/priority";

const DEFAULT_MODEL: PriorityModelPreferenceV1 = {
  version: 1,
  mode: "balanced",
  anchors: [],
  mutedSources: [],
  updatedAt: new Date().toISOString()
};

export class PriorityPreferencesRepository {
  get(raw: unknown): PriorityModelPreferenceV1 {
    const value = raw as PriorityModelPreferenceV1 | null | undefined;
    if (!value) return DEFAULT_MODEL;
    if (value.version !== 1) return DEFAULT_MODEL;
    return value;
  }

  defaults(): PriorityModelPreferenceV1 {
    return DEFAULT_MODEL;
  }
}

  defaults(): PriorityModelPreferenceV1 {
    return DEFAULT_MODEL;
  }
}
