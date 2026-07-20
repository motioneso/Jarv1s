import type { ProfileFields } from "./model";

export interface ProfileBufferStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const PROFILE_BUFFER_PREFIX = "jobsearch:onboarding:profile:";

function keyFor(actorScopeKey: string): string {
  // #1213: actorScopeKey is an opaque host-provided token used only to isolate this tab-local key.
  return `${PROFILE_BUFFER_PREFIX}${actorScopeKey}`;
}

function isStringList(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function parseFields(value: unknown): ProfileFields {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const fields = value as Record<string, unknown>;
  const titles = fields["targetTitles"];
  const workmode = fields["remotePreference"];
  const locations = fields["locations"];
  const dealbreakers = fields["dealbreakers"];
  const compensation = fields["compensation"];
  if (
    (titles !== undefined && !isStringList(titles)) ||
    (workmode !== undefined && !isStringList(workmode)) ||
    (locations !== undefined && !isStringList(locations)) ||
    (dealbreakers !== undefined && !isStringList(dealbreakers))
  ) {
    return {};
  }
  if (
    compensation !== undefined &&
    (!compensation ||
      typeof compensation !== "object" ||
      Array.isArray(compensation) ||
      (compensation as Record<string, unknown>)["currency"] !== "USD" ||
      typeof (compensation as Record<string, unknown>)["minimum"] !== "number" ||
      !Number.isFinite((compensation as Record<string, unknown>)["minimum"]) ||
      ((compensation as Record<string, unknown>)["minimum"] as number) <= 0)
  ) {
    return {};
  }
  return {
    ...(titles === undefined ? {} : { targetTitles: titles }),
    ...(compensation === undefined
      ? {}
      : {
          compensation: compensation as ProfileFields["compensation"]
        }),
    ...(workmode === undefined ? {} : { remotePreference: workmode }),
    ...(locations === undefined ? {} : { locations }),
    ...(dealbreakers === undefined ? {} : { dealbreakers })
  };
}

export function readProfileBuffer(
  storage: ProfileBufferStorage,
  actorScopeKey: string
): ProfileFields {
  // #1213: browser storage is untrusted and can be unavailable or corrupt; onboarding restarts safely.
  try {
    const raw = storage.getItem(keyFor(actorScopeKey));
    return raw === null ? {} : parseFields(JSON.parse(raw));
  } catch {
    return {};
  }
}

export function writeProfileBuffer(
  storage: ProfileBufferStorage,
  actorScopeKey: string,
  fields: ProfileFields
): void {
  // #1213: storage failure must not prevent the durable approve flow from continuing.
  try {
    storage.setItem(keyFor(actorScopeKey), JSON.stringify(fields));
  } catch {
    // Best-effort restore aid only; durable assistant approval remains available.
  }
}

export function clearProfileBuffer(storage: ProfileBufferStorage, actorScopeKey: string): void {
  // #1213: profile approval makes the tab-local restore aid redundant.
  try {
    storage.removeItem(keyFor(actorScopeKey));
  } catch {
    // Best-effort cleanup; an unavailable store cannot expose a readable stale buffer.
  }
}
