import type { PgBoss } from "./pg-boss.js";
import { UPGRADE_CHECK_QUEUE, assertMetadataOnlyPayload } from "./pg-boss.js";
import type { Kysely } from "kysely";
import type { JarvisDatabase } from "@jarv1s/db";

const UPGRADE_CHECK_CRON = "0 0 * * *"; // Daily at midnight
const UPGRADE_CHECK_KEY = "system.upgrade-check";

export async function reconcileUpgradeCheckSchedule(boss: PgBoss): Promise<void> {
  const data = { kind: "upgrade-check" as const };
  assertMetadataOnlyPayload(data);
  await boss.schedule(UPGRADE_CHECK_QUEUE, UPGRADE_CHECK_CRON, data, {
    tz: "UTC",
    key: UPGRADE_CHECK_KEY
  });
}

function compareVersions(a: string, b: string): number {
  const parse = (v: string) => v.replace(/^v/, "").split(".").map(Number);
  const pa = parse(a);
  const pb = parse(b);
  for (let i = 0; i < 3; i++) {
    const va = pa[i] || 0;
    const vb = pb[i] || 0;
    if (va > vb) return 1;
    if (va < vb) return -1;
  }
  return 0;
}

export async function handleUpgradeCheckJob(workerDb: Kysely<JarvisDatabase>): Promise<void> {
  const currentVersion = process.env.JARVIS_APP_VERSION;
  if (!currentVersion) {
    return; // Not running a tagged release, nothing to check
  }

  const res = await fetch("https://api.github.com/repos/motioneso/Jarv1s/releases/latest", {
    headers: {
      "User-Agent": "Jarvis-Upgrade-Checker",
      Accept: "application/vnd.github.v3+json"
    }
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch latest release: ${res.status}`);
  }

  const release = (await res.json()) as { tag_name: string; body: string };
  if (!release.tag_name) {
    throw new Error("Invalid release response: missing tag_name");
  }

  if (compareVersions(release.tag_name, currentVersion) > 0) {
    const value = {
      version: release.tag_name,
      notes: release.body || ""
    };

    await workerDb
      .insertInto("app.instance_settings")
      .values({
        key: "latest_release",
        value,
        updated_by_user_id: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .onConflict((oc) =>
        oc.column("key").doUpdateSet({
          value,
          updated_at: new Date().toISOString()
        })
      )
      .execute();
  }
}
