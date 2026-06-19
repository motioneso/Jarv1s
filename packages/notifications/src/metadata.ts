// Notification metadata projection — the single source of truth for the bounded shape
// that may be written to app.notifications.metadata and exposed via REST / assistant tool.
//
// Three layers of defense (see spec 2026-06-19-notifications-actor-scoped-hardening.md
// Decision 3): this helper is applied at INPUT (NotificationsRepository.create) and at
// OUTPUT (serializeNotification, which covers both the REST route and the
// notifications.listVisible assistant tool). The DB-level size CHECK (migration
// 0101_notifications_metadata_size_check.sql) is the third, language-agnostic backstop.
//
// The bound is intentionally primitives-only (`string | number | boolean | null`):
// every live producer today emits flat primitives, and a strict bound is cheaper to
// relax later than the reverse. Nested objects / arrays are dropped ENTIRELY (key and
// value), not coerced — projection never invents content.

import type { NotificationMetadata } from "@jarv1s/shared";

const MAX_KEYS = 16;
const MAX_STRING_LENGTH = 256;
const MAX_SERIALIZED_BYTES = 4096;
const KEY_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]{0,63}$/;

/**
 * Project arbitrary input into the bounded {@link NotificationMetadata} shape that the
 * V1 notifications contract permits. Pure, deterministic, side-effect free.
 *
 * Rules (applied in order):
 *   1. Non-object / array / null input → `{}`.
 *   2. Keep at most {@link MAX_KEYS} keys, in insertion order; drop the rest.
 *   3. Keep only keys matching {@link KEY_PATTERN} (`^[a-zA-Z_][a-zA-Z0-9_]{0,63}$`).
 *   4. Keep only JSON-primitive values (`string | number | boolean | null`); drop nested
 *      objects and arrays ENTIRELY (key discarded, not value-coerced).
 *   5. Truncate retained string values to {@link MAX_STRING_LENGTH} UTF-16 code units.
 *   6. If `JSON.stringify(result)` exceeds {@link MAX_SERIALIZED_BYTES}, drop trailing
 *      keys in insertion order until it fits, or return `{}` if even one value overflows.
 */
export function projectNotificationMetadata(raw: unknown): NotificationMetadata {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return {};
  }

  const source = raw as Record<string, unknown>;
  const out: NotificationMetadata = {};

  for (const key of Object.keys(source)) {
    if (Object.keys(out).length >= MAX_KEYS) {
      break;
    }
    if (!KEY_PATTERN.test(key)) {
      continue;
    }

    const value = source[key];
    let projected: string | number | boolean | null;
    if (typeof value === "string") {
      projected = value.length > MAX_STRING_LENGTH ? value.slice(0, MAX_STRING_LENGTH) : value;
    } else if (typeof value === "number" || typeof value === "boolean") {
      projected = value;
    } else if (value === null) {
      projected = null;
    } else {
      // object / array / undefined / symbol / function → drop key entirely
      continue;
    }

    out[key] = projected;
  }

  while (utf8ByteLength(JSON.stringify(out)) > MAX_SERIALIZED_BYTES) {
    const keys = Object.keys(out);
    if (keys.length === 0) {
      return {};
    }
    delete out[keys[keys.length - 1]!];
  }

  return out;
}

function utf8ByteLength(value: string): number {
  return Buffer.byteLength(value, "utf8");
}
