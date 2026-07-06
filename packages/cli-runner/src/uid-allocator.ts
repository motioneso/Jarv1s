/**
 * Per-user UID/GID slot allocator for the cli-runner (#347).
 *
 * Maps each actorUserId to a stable OS UID + GID slot so every user's CLI subprocess
 * runs under a distinct identity. Slot assignments are persisted to a JSON file on the
 * auth volume so they survive container restarts.
 *
 * All I/O here is synchronous — this runs once per session start on a local volume,
 * not on a hot message path. Atomic writes (tmp → rename) prevent partial-write
 * corruption on the slot file.
 */

import * as fs from "node:fs";
import * as path from "node:path";

const UID_BASE = 100_000;
const GID_BASE = 100_000;
const MAX_SLOTS = 1_000;

const SLOT_FILE = "uid-slots.json";

interface UidSlot {
  uid: number;
  gid: number;
}

/**
 * Return the stable UID/GID for `actorUserId`, allocating a new slot if needed.
 * Slot file lives at `path.join(homeBase, "uid-slots.json")`.
 * Throws if MAX_SLOTS would be exceeded.
 */
export function allocateUidSlot(homeBase: string, actorUserId: string): UidSlot {
  const slotFilePath = path.join(homeBase, SLOT_FILE);
  let slots: Record<string, number> = {};

  if (fs.existsSync(slotFilePath)) {
    try {
      slots = JSON.parse(fs.readFileSync(slotFilePath, "utf8")) as Record<string, number>;
    } catch {
      slots = {};
    }
  }

  if (actorUserId in slots) {
    const slot = slots[actorUserId] as number;
    return { uid: UID_BASE + slot, gid: GID_BASE + slot };
  }

  const existing = Object.values(slots);
  // Slot 0 is reserved as sentinel; real slots start at 1.
  const nextSlot = existing.length === 0 ? 1 : Math.max(...existing) + 1;
  if (nextSlot > MAX_SLOTS) {
    throw new Error("[cli-runner] UID slot overflow: maximum user slots exhausted");
  }

  slots[actorUserId] = nextSlot;

  // Atomic write: tmp → rename (atomic on Linux, same filesystem).
  // Mode 0600: root-only; the map contains actorUserIds (PII, not for per-user UID reads).
  const tmpPath = slotFilePath + ".tmp";
  fs.writeFileSync(tmpPath, JSON.stringify(slots), { encoding: "utf8", mode: 0o600 });
  fs.chmodSync(tmpPath, 0o600); // override umask — must be root-only before rename
  fs.renameSync(tmpPath, slotFilePath);

  return { uid: UID_BASE + nextSlot, gid: GID_BASE + nextSlot };
}

/**
 * Best-effort: chown an existing per-session neutral dir to the newly allocated
 * uid/gid and set mode 0700. Called once on first slot allocation so files from
 * the old shared-UID era become accessible to the per-user UID.
 */
export function migrateNeutralDir(neutralDir: string, uid: number, gid: number): void {
  if (!fs.existsSync(neutralDir)) return;
  try {
    fs.chownSync(neutralDir, uid, gid);
    fs.chmodSync(neutralDir, 0o700);
  } catch {
    /* best-effort */
  }
  let entries: string[];
  try {
    entries = fs.readdirSync(neutralDir);
  } catch {
    return;
  }
  for (const name of entries) {
    try {
      fs.chownSync(path.join(neutralDir, name), uid, gid);
    } catch {
      /* best-effort */
    }
  }
}
