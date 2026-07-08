import type { PgBoss } from "pg-boss";

import { assertMetadataOnlyPayload } from "@jarv1s/jobs";
import { cronExprFor, timezoneFor, type NotificationDto } from "@jarv1s/shared";

export const DIGEST_COMPOSE_QUEUE = "notifications.digest.compose";
export const NOTIFICATION_DIGEST_PREFERENCE_KEY = "notifications:digest";

export type NotificationDigestCadence = "daily" | "weekly";

export interface NotificationDigestPreference {
  readonly enabled: boolean;
  readonly cadence: NotificationDigestCadence;
  readonly scheduleMetadata: Record<string, unknown>;
  readonly lastDigestSentAt: Date | null;
}

export interface DigestComposeJobPayload {
  readonly actorUserId: string;
  readonly reason: "scheduled-digest";
  readonly idempotencyKey: string;
}

const DEFAULT_DIGEST_PREFERENCE: NotificationDigestPreference = {
  enabled: false,
  cadence: "daily",
  scheduleMetadata: { targetTime: "07:00", timezone: "UTC" },
  lastDigestSentAt: null
};

export function digestPreferenceFromRaw(raw: unknown): NotificationDigestPreference {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return DEFAULT_DIGEST_PREFERENCE;
  const value = raw as Record<string, unknown>;
  const enabled = value.enabled === true;
  const cadence = value.cadence === "weekly" ? "weekly" : "daily";
  const scheduleMetadata =
    value.scheduleMetadata && typeof value.scheduleMetadata === "object"
      ? (value.scheduleMetadata as Record<string, unknown>)
      : DEFAULT_DIGEST_PREFERENCE.scheduleMetadata;
  const lastDigestSentAt =
    typeof value.lastDigestSentAt === "string" ? parseDate(value.lastDigestSentAt) : null;
  return { enabled, cadence, scheduleMetadata, lastDigestSentAt };
}

export function digestPreferenceToRaw(preference: NotificationDigestPreference) {
  return {
    enabled: preference.enabled,
    cadence: preference.cadence,
    scheduleMetadata: preference.scheduleMetadata,
    lastDigestSentAt: preference.lastDigestSentAt?.toISOString() ?? null
  };
}

export function digestScheduleData(actorUserId: string): DigestComposeJobPayload {
  return {
    actorUserId,
    reason: "scheduled-digest",
    idempotencyKey: `digest:${actorUserId}`
  };
}

export async function reconcileDigestSchedule(
  boss: Pick<PgBoss, "schedule" | "unschedule">,
  actorUserId: string,
  preference: NotificationDigestPreference
): Promise<void> {
  const key = digestScheduleKey(actorUserId);
  if (!preference.enabled) {
    await boss.unschedule(DIGEST_COMPOSE_QUEUE, key);
    return;
  }
  const data = digestScheduleData(actorUserId);
  assertMetadataOnlyPayload(data);
  await boss.schedule(
    DIGEST_COMPOSE_QUEUE,
    cronExprFor(preference.cadence, preference.scheduleMetadata),
    data,
    { tz: timezoneFor(preference.scheduleMetadata), key }
  );
}

export function digestScheduleKey(actorUserId: string): string {
  return `digest:${actorUserId}`;
}

export function renderNotificationDigest(input: {
  readonly baseUrl: string;
  readonly notifications: readonly NotificationDto[];
}): { subject: string; text: string; html: string } {
  const settingsUrl = `${input.baseUrl.replace(/\/$/, "")}/settings?section=notifications`;
  const lines = [
    "Jarvis notification digest",
    "",
    ...input.notifications.flatMap((notification) => [
      `- ${notification.title}`,
      ...(notification.body ? [`  ${notification.body}`] : [])
    ]),
    "",
    `Manage digest settings: ${settingsUrl}`
  ];
  const items = input.notifications
    .map((notification) => {
      const body = notification.body ? `<p>${escapeHtml(notification.body)}</p>` : "";
      return `<li><strong>${escapeHtml(notification.title)}</strong>${body}</li>`;
    })
    .join("");

  return {
    subject: "Jarvis notification digest",
    text: lines.join("\n"),
    html: `<h1>Jarvis notification digest</h1><ul>${items}</ul><p><a href="${escapeHtml(settingsUrl)}">Manage digest settings</a></p>`
  };
}

function parseDate(value: string): Date | null {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
