import type { DataContextDb } from "@jarv1s/db";
import { HttpError, type JarvisModuleManifest } from "@jarv1s/module-sdk";
import type { NotificationPreferenceDto } from "@jarv1s/shared";

import type { NotificationPreferencesPort } from "./preferences-port.js";
import type { SettingsRepository } from "./repository.js";
import { computeMyModuleDto } from "./routes-serializers.js";
import type { NotificationUnreadPort } from "./notification-preferences-routes.js";

const KEY = (moduleId: string) => `notifications:${moduleId}`;

export interface NotificationPreferenceApplicationDeps {
  readonly listModuleManifests: () => readonly JarvisModuleManifest[];
  readonly preferencesRepository: NotificationPreferencesPort;
  readonly repository: SettingsRepository;
  readonly notificationUnreadPort?: NotificationUnreadPort;
}

// Contract owned by settings so the notificationPreference.setEnabled assistant tool never needs
// to import module-registry (would be circular — module-registry already depends on settings).
// The concrete implementation is built in the composition host (packages/chat).
export interface NotificationPreferenceWriteService {
  setEnabled(
    scopedDb: DataContextDb,
    actorUserId: string,
    moduleId: string,
    enabled: boolean,
    clearUnread: boolean
  ): Promise<{
    preference: NotificationPreferenceDto;
    unreadCount: number | null;
    previous: { value: unknown; revision: number | null };
  }>;
}

export async function setNotificationPreferenceEnabled(
  scopedDb: DataContextDb,
  deps: NotificationPreferenceApplicationDeps,
  actorUserId: string,
  moduleId: string,
  enabled: boolean,
  clearUnread: boolean
): Promise<{
  preference: NotificationPreferenceDto;
  unreadCount: number | null;
  previous: { value: unknown; revision: number | null };
}> {
  const manifest = deps.listModuleManifests().find((m) => m.id === moduleId);
  if (!manifest) throw new HttpError(404, "Module not found");
  if (manifest.notifications?.supported !== true) {
    throw new HttpError(422, "Module does not support notifications");
  }
  // Reuse computeMyModuleDto (not a hand-rolled deny-row check) so required/supportsUserDisable
  // modules keep exactly the same active semantics as every other settings surface.
  const module = await computeMyModuleDto(deps.repository, scopedDb, manifest, actorUserId);
  if (!module.active) throw new HttpError(422, "Module is not active for this user");

  const preference: NotificationPreferenceDto = {
    moduleId: manifest.id,
    moduleName: manifest.name,
    enabled
  };
  const key = KEY(manifest.id);
  const current = await deps.preferencesRepository.getWithRevision(scopedDb, key);
  await deps.preferencesRepository.upsertWithRevision(
    scopedDb,
    key,
    { enabled },
    current?.revision ?? null
  );
  const unreadCount =
    !enabled && clearUnread && deps.notificationUnreadPort
      ? await deps.notificationUnreadPort.markModuleRead(scopedDb, manifest.id)
      : null;
  return {
    preference,
    unreadCount,
    previous: { value: current?.value ?? null, revision: current?.revision ?? null }
  };
}
