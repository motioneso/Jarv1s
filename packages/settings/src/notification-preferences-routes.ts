import type { FastifyInstance, FastifyRequest } from "fastify";

import type { AccessContext, DataContextDb, DataContextRunner } from "@jarv1s/db";
import { HttpError, type JarvisModuleManifest } from "@jarv1s/module-sdk";
import {
  listNotificationPreferencesRouteSchema,
  putNotificationPreferenceRouteSchema,
  type NotificationPreferenceDto,
  type PutNotificationPreferenceRequest
} from "@jarv1s/shared";

import type { ProfilePreferencesPort } from "./preferences-port.js";
import type { SettingsRepository } from "./repository.js";
import { handleSettingsRouteError } from "./route-error.js";
import { toMyModuleDto } from "./routes-serializers.js";

const KEY = (moduleId: string) => `notifications:${moduleId}`;

export interface NotificationUnreadPort {
  markModuleRead(scopedDb: DataContextDb, moduleId: string): Promise<number>;
}

interface NotificationPreferencesRoutesDependencies {
  readonly dataContext: DataContextRunner;
  readonly resolveAccessContext: (request: FastifyRequest) => Promise<AccessContext>;
  readonly listModuleManifests: () => readonly JarvisModuleManifest[];
  readonly preferencesRepository: ProfilePreferencesPort;
  readonly repository: SettingsRepository;
  readonly notificationUnreadPort?: NotificationUnreadPort;
}

export function registerNotificationPreferencesRoutes(
  server: FastifyInstance,
  dependencies: NotificationPreferencesRoutesDependencies
): void {
  server.get(
    "/api/me/notification-preferences",
    { schema: listNotificationPreferencesRouteSchema },
    async (request, reply) => {
      try {
        const accessContext = await dependencies.resolveAccessContext(request);
        const preferences = await dependencies.dataContext.withDataContext(
          accessContext,
          async (scopedDb) => listPreferences(scopedDb, dependencies, accessContext.actorUserId)
        );
        return { preferences };
      } catch (error) {
        return handleSettingsRouteError(error, reply);
      }
    }
  );

  server.put<{ Params: { moduleId: string } }>(
    "/api/me/notification-preferences/:moduleId",
    { schema: putNotificationPreferenceRouteSchema },
    async (request, reply) => {
      try {
        const accessContext = await dependencies.resolveAccessContext(request);
        const body = request.body as PutNotificationPreferenceRequest;
        const result = await dependencies.dataContext.withDataContext(
          accessContext,
          async (scopedDb) => {
            const manifest = dependencies
              .listModuleManifests()
              .find((m) => m.id === request.params.moduleId);
            if (!manifest) throw new HttpError(404, "Module not found");
            if (manifest.notifications?.supported !== true) {
              throw new HttpError(422, "Module does not support notifications");
            }
            const current = await toPreferenceDto(
              scopedDb,
              dependencies,
              manifest,
              accessContext.actorUserId
            );
            if (!current) throw new HttpError(422, "Module is not active for this user");

            const preference = { ...current, enabled: body.enabled };
            await dependencies.preferencesRepository.upsert(scopedDb, KEY(manifest.id), {
              enabled: body.enabled
            });
            const unreadCount =
              !body.enabled && body.clearUnread === true && dependencies.notificationUnreadPort
                ? await dependencies.notificationUnreadPort.markModuleRead(scopedDb, manifest.id)
                : null;
            return { preference, unreadCount };
          }
        );
        return result;
      } catch (error) {
        return handleSettingsRouteError(error, reply);
      }
    }
  );
}

async function listPreferences(
  scopedDb: DataContextDb,
  dependencies: NotificationPreferencesRoutesDependencies,
  actorUserId: string
): Promise<NotificationPreferenceDto[]> {
  const preferences: NotificationPreferenceDto[] = [];
  for (const manifest of dependencies.listModuleManifests()) {
    const dto = await toPreferenceDto(scopedDb, dependencies, manifest, actorUserId);
    if (dto) preferences.push(dto);
  }
  return preferences;
}

async function toPreferenceDto(
  scopedDb: DataContextDb,
  dependencies: NotificationPreferencesRoutesDependencies,
  manifest: JarvisModuleManifest,
  actorUserId: string
): Promise<NotificationPreferenceDto | null> {
  if (manifest.notifications?.supported !== true) return null;
  const rows = await dependencies.repository.listModuleDenyRowsForActor(scopedDb);
  const module = toMyModuleDto(
    manifest,
    rows.some((r) => r.scope === "instance" && r.module_id === manifest.id),
    rows.some((r) => r.scope === "user" && r.module_id === manifest.id && r.user_id === actorUserId)
  );
  if (!module.active) return null;
  const raw = await dependencies.preferencesRepository.get(scopedDb, KEY(manifest.id));
  return {
    moduleId: manifest.id,
    moduleName: manifest.name,
    enabled: normalizeEnabled(raw)
  };
}

function normalizeEnabled(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return true;
  const enabled = (value as { enabled?: unknown }).enabled;
  return typeof enabled === "boolean" ? enabled : true;
}
