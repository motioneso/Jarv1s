import type { FastifyInstance, FastifyRequest } from "fastify";

import type { AccessContext, DataContextDb, DataContextRunner } from "@jarv1s/db";
import { HttpError, type JarvisModuleManifest } from "@jarv1s/module-sdk";
import {
  listNotificationPreferencesRouteSchema,
  getNotificationDigestPreferenceRouteSchema,
  putNotificationPreferenceRouteSchema,
  putNotificationDigestPreferenceRouteSchema,
  type NotificationDigestPreferenceDto,
  type NotificationPreferenceDto,
  type PutNotificationDigestPreferenceRequest,
  type PutNotificationPreferenceRequest
} from "@jarv1s/shared";
import {
  NOTIFICATION_DIGEST_PREFERENCE_KEY,
  digestPreferenceFromRaw,
  digestPreferenceToRaw,
  reconcileDigestSchedule,
  type NotificationDigestPreference
} from "@jarv1s/notifications";
import type { PgBoss } from "@jarv1s/jobs";

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
  readonly boss?: Pick<PgBoss, "schedule" | "unschedule">;
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

  server.get(
    "/api/me/notification-digest-preference",
    { schema: getNotificationDigestPreferenceRouteSchema },
    async (request, reply) => {
      try {
        const accessContext = await dependencies.resolveAccessContext(request);
        const digest = await dependencies.dataContext.withDataContext(
          accessContext,
          async (scopedDb) => readDigestDto(scopedDb, dependencies, accessContext.actorUserId)
        );
        return { digest };
      } catch (error) {
        return handleSettingsRouteError(error, reply);
      }
    }
  );

  server.put(
    "/api/me/notification-digest-preference",
    { schema: putNotificationDigestPreferenceRouteSchema },
    async (request, reply) => {
      try {
        const accessContext = await dependencies.resolveAccessContext(request);
        const body = request.body as PutNotificationDigestPreferenceRequest;
        const digest = await dependencies.dataContext.withDataContext(
          accessContext,
          async (scopedDb) => {
            const next: NotificationDigestPreference = {
              enabled: body.digest.enabled,
              cadence: body.digest.cadence,
              scheduleMetadata: { ...body.digest.scheduleMetadata },
              lastDigestSentAt: digestPreferenceFromRaw(
                await dependencies.preferencesRepository.get(
                  scopedDb,
                  NOTIFICATION_DIGEST_PREFERENCE_KEY
                )
              ).lastDigestSentAt
            };
            const availability = await digestAvailability(
              scopedDb,
              dependencies,
              accessContext.actorUserId
            );
            if (next.enabled && !availability.available) {
              throw new HttpError(
                422,
                availability.unavailableReason === "no_enabled_modules"
                  ? "Enable at least one notification module first"
                  : "Connect an email account first"
              );
            }
            await dependencies.preferencesRepository.upsert(
              scopedDb,
              NOTIFICATION_DIGEST_PREFERENCE_KEY,
              digestPreferenceToRaw(next)
            );
            if (dependencies.boss) {
              await reconcileDigestSchedule(dependencies.boss, accessContext.actorUserId, next);
            }
            return toDigestDto(next, availability);
          }
        );
        return { digest };
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

async function readDigestDto(
  scopedDb: DataContextDb,
  dependencies: NotificationPreferencesRoutesDependencies,
  actorUserId: string
): Promise<NotificationDigestPreferenceDto> {
  const raw = await dependencies.preferencesRepository.get(
    scopedDb,
    NOTIFICATION_DIGEST_PREFERENCE_KEY
  );
  return toDigestDto(
    digestPreferenceFromRaw(raw),
    await digestAvailability(scopedDb, dependencies, actorUserId)
  );
}

async function digestAvailability(
  scopedDb: DataContextDb,
  dependencies: NotificationPreferencesRoutesDependencies,
  actorUserId: string
): Promise<Pick<NotificationDigestPreferenceDto, "available" | "unavailableReason">> {
  const hasConnector = await hasActiveEmailConnector(scopedDb);
  if (!hasConnector) return { available: false, unavailableReason: "no_email_connector" };
  const preferences = await listPreferences(scopedDb, dependencies, actorUserId);
  if (!preferences.some((preference) => preference.enabled)) {
    return { available: false, unavailableReason: "no_enabled_modules" };
  }
  return { available: true, unavailableReason: null };
}

async function hasActiveEmailConnector(scopedDb: DataContextDb): Promise<boolean> {
  const row = await scopedDb.db
    .selectFrom("app.connector_accounts as accounts")
    .innerJoin(
      "app.connector_definitions as definitions",
      "definitions.provider_id",
      "accounts.provider_id"
    )
    .select("accounts.id")
    .where("accounts.status", "=", "active")
    .where("definitions.provider_type", "in", ["google", "imap"])
    .executeTakeFirst();
  return !!row;
}

function toDigestDto(
  preference: NotificationDigestPreference,
  availability: Pick<NotificationDigestPreferenceDto, "available" | "unavailableReason">
): NotificationDigestPreferenceDto {
  return {
    enabled: preference.enabled,
    cadence: preference.cadence,
    scheduleMetadata: toScheduleMetadataDto(preference.scheduleMetadata),
    ...availability
  };
}

function toScheduleMetadataDto(
  raw: Record<string, unknown>
): NotificationDigestPreferenceDto["scheduleMetadata"] {
  const targetTime = typeof raw.targetTime === "string" ? raw.targetTime : "07:00";
  const timezone = typeof raw.timezone === "string" && raw.timezone ? raw.timezone : "UTC";
  const dayOfWeek = typeof raw.dayOfWeek === "number" ? raw.dayOfWeek : undefined;
  return dayOfWeek === undefined ? { targetTime, timezone } : { targetTime, timezone, dayOfWeek };
}
