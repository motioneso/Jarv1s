/**
 * #679 — server-side handling of the client-captured "page context" snapshot.
 *
 * Mirrors the notifications module's bounded-projection pattern
 * (packages/notifications/src/metadata.ts `projectNotificationMetadata`): arbitrary
 * request-body input is re-projected into a strict, size-capped shape before it is
 * allowed anywhere near a prompt. This is defense in depth — the client (Task's
 * apps/web/src/chat/page-context.ts) already redacts and caps client-side, but the
 * server treats the request body as untrusted input regardless of what the client
 * claims to have sent.
 *
 * #1109 — the projected snapshot is held only in `PageContextStore` (page-context-store.ts)
 * and read on demand by the `chat.getCurrentView` pull tool; it is never folded into engine
 * text on a per-turn basis and never passed to `persistence.recordTurn`, so it never reaches
 * the `chat_messages` table, the rolling summary, or a pg-boss job payload.
 */
import type { PageContextFocusedElementDto, PageContextSnapshotDto } from "@jarv1s/shared";
import type { JarvisError, JarvisErrorClass } from "@jarv1s/module-sdk";

const MAX_ROUTE_LENGTH = 200;
const MAX_TITLE_LENGTH = 200;
const MAX_STRING_LENGTH = 200;
const MAX_SELECTED_TEXT_LENGTH = 500;
const MAX_LIST_ITEMS = 20;
const MAX_SERIALIZED_BYTES = 6000;
const MAX_ERROR_STRING_LENGTH = 160;
const MAX_ERRORS = 10;
const ERROR_CLASSES = new Set<JarvisErrorClass>([
  "prerequisite",
  "transient",
  "validation",
  "permission",
  "bug"
]);

/**
 * Project arbitrary input into the bounded {@link PageContextSnapshotDto} shape, or
 * `null` when the input isn't even structurally usable (missing route/pageTitle).
 * Pure, deterministic, side-effect free — never throws.
 */
export function projectPageContextSnapshot(raw: unknown): PageContextSnapshotDto | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }

  const source = raw as Record<string, unknown>;
  const route = boundedString(source.route, MAX_ROUTE_LENGTH);
  const pageTitle = boundedString(source.pageTitle, MAX_TITLE_LENGTH);
  if (route === null || pageTitle === null) {
    return null;
  }

  const snapshot: PageContextSnapshotDto = {
    route,
    pageTitle,
    headings: boundedStringList(source.headings),
    buttons: boundedStringList(source.buttons),
    labels: boundedStringList(source.labels),
    visibleText: boundedStringList(source.visibleText),
    focused: boundedFocused(source.focused),
    selectedText: boundedNullableString(source.selectedText, MAX_SELECTED_TEXT_LENGTH),
    errors: boundedErrors(source.errors),
    capturedAt: typeof source.capturedAt === "string" ? source.capturedAt : new Date().toISOString()
  };

  return capToByteBudget(snapshot);
}

function boundedString(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  return trimmed.length > maxLength ? trimmed.slice(0, maxLength) : trimmed;
}

function boundedNullableString(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  return trimmed.length > maxLength ? trimmed.slice(0, maxLength) : trimmed;
}

function boundedStringList(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const entry of value) {
    if (out.length >= MAX_LIST_ITEMS) break;
    if (typeof entry !== "string") continue;
    const trimmed = entry.trim();
    if (trimmed.length === 0) continue;
    out.push(trimmed.length > MAX_STRING_LENGTH ? trimmed.slice(0, MAX_STRING_LENGTH) : trimmed);
  }
  return out;
}

function boundedFocused(value: unknown): PageContextFocusedElementDto | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const tag = typeof source.tag === "string" ? source.tag.slice(0, 40) : null;
  if (!tag) return null;
  return {
    tag,
    role: typeof source.role === "string" ? source.role.slice(0, 60) : null,
    label: typeof source.label === "string" ? source.label.slice(0, MAX_STRING_LENGTH) : null
  };
}

/**
 * Re-project a raw error entry (already a plain object member of `source.errors`) into
 * a {@link JarvisError}, matching the client-side allow-list in
 * apps/web/src/chat/page-context.ts so a malicious or malformed request body can't
 * smuggle extra keys or an unclassified error through the server. Never drops
 * structured errors ahead of visible prose in {@link capToByteBudget} — the error code
 * is the grounding key a tool caller needs, not decoration.
 */
function boundedErrors(value: unknown): PageContextSnapshotDto["errors"] {
  if (!Array.isArray(value)) return [];
  const errors: JarvisError[] = [];
  for (const entry of value) {
    if (errors.length === MAX_ERRORS) break;
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const source = entry as Record<string, unknown>;
    const code = boundedString(source.code, MAX_ERROR_STRING_LENGTH);
    const errorClass =
      typeof source.class === "string" && ERROR_CLASSES.has(source.class as JarvisErrorClass)
        ? (source.class as JarvisErrorClass)
        : null;
    if (!code || !errorClass) continue;
    if (errorClass === "prerequisite") {
      const remediationRef = boundedString(source.remediationRef, MAX_ERROR_STRING_LENGTH);
      if (!remediationRef) continue;
      errors.push({ code, class: errorClass, remediationRef });
    } else {
      errors.push({ code, class: errorClass });
    }
  }
  return errors;
}

/**
 * Drop trailing `visibleText` items (then `labels`, then `buttons`, then `headings`)
 * until the serialized snapshot fits {@link MAX_SERIALIZED_BYTES}, mirroring the
 * notifications projection's "shrink by dropping trailing items" backstop.
 */
function capToByteBudget(snapshot: PageContextSnapshotDto): PageContextSnapshotDto {
  let candidate = snapshot;
  const shrinkOrder: (keyof PageContextSnapshotDto)[] = [
    "visibleText",
    "labels",
    "buttons",
    "headings"
  ];
  let shrinkIndex = 0;
  while (utf8ByteLength(JSON.stringify(candidate)) > MAX_SERIALIZED_BYTES) {
    if (shrinkIndex >= shrinkOrder.length) {
      // Nothing left to drop — return the smallest possible shape rather than
      // an oversized payload.
      return {
        ...candidate,
        headings: [],
        buttons: [],
        labels: [],
        visibleText: [],
        selectedText: null
      };
    }
    const key = shrinkOrder[shrinkIndex]!;
    const list = candidate[key] as readonly string[];
    if (list.length === 0) {
      shrinkIndex += 1;
      continue;
    }
    candidate = { ...candidate, [key]: list.slice(0, -1) };
  }
  return candidate;
}

function utf8ByteLength(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

/** A page-context snapshot held on a live session, plus when it was captured. */
export interface CachedPageContext {
  readonly snapshot: PageContextSnapshotDto;
  readonly capturedAt: number;
}

/**
 * #679 — resolve which page-context snapshot (if any) applies to the current turn, and
 * what the session should cache afterward. A newly attached snapshot always wins and
 * replaces the cache; otherwise the cached snapshot is reused as long as it is within
 * `ttlMs` of `now`, and dropped once stale. Pure function (no session/clock access of
 * its own) so ChatSessionManager's TTL/reuse policy is unit-testable in isolation.
 */
export function resolveCachedPageContext(
  cached: CachedPageContext | undefined,
  incoming: PageContextSnapshotDto | undefined,
  now: number,
  ttlMs: number
): { resolved: PageContextSnapshotDto | undefined; nextCached: CachedPageContext | undefined } {
  if (incoming) {
    const nextCached = { snapshot: incoming, capturedAt: now };
    return { resolved: incoming, nextCached };
  }
  if (!cached || now - cached.capturedAt > ttlMs) {
    return { resolved: undefined, nextCached: undefined };
  }
  return { resolved: cached.snapshot, nextCached: cached };
}
