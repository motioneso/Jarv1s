import { afterEach, describe, expect, it, vi } from "vitest";

import { handleUpgradeCheckJob, UPGRADE_NOTIFY_QUEUE } from "@jarv1s/jobs";

function dbWithOwner(ownerId = "00000000-0000-4000-8000-000000000001") {
  const executeTakeFirst = vi.fn(async () => ({ id: ownerId }));
  const execute = vi.fn(async () => undefined);
  const executeTakeFirstOrThrow = vi.fn(async () => ({ value: { version: "1.0.0" } }));
  const db = {
    selectFrom: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      executeTakeFirst,
      executeTakeFirstOrThrow
    })),
    insertInto: vi.fn(() => ({
      values: vi.fn().mockReturnThis(),
      onConflict: vi.fn().mockReturnThis(),
      execute
    }))
  };
  return { db, executeTakeFirst, execute };
}

describe("handleUpgradeCheckJob", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.JARVIS_APP_VERSION;
  });

  it.each([403, 429, 500])("soft-skips GitHub status %s", async (status) => {
    process.env.JARVIS_APP_VERSION = "1.0.0";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status }))
    );
    const boss = { send: vi.fn() };
    const { db } = dbWithOwner();

    await expect(handleUpgradeCheckJob(db as never, boss as never)).resolves.toBeUndefined();

    expect(boss.send).not.toHaveBeenCalled();
  });

  it("caches a newer release and enqueues one owner-scoped notification job", async () => {
    process.env.JARVIS_APP_VERSION = "1.0.0";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ tag_name: "v1.1.0", body: "notes" })
      }))
    );
    const boss = { send: vi.fn(async () => "job-1") };
    const { db } = dbWithOwner("11111111-1111-4111-8111-111111111111");

    await handleUpgradeCheckJob(db as never, boss as never);

    expect(boss.send).toHaveBeenCalledWith(
      UPGRADE_NOTIFY_QUEUE,
      {
        kind: "upgrade-notify",
        actorUserId: "11111111-1111-4111-8111-111111111111",
        version: "v1.1.0"
      },
      { singletonKey: "upgrade-notify:11111111-1111-4111-8111-111111111111:v1.1.0" }
    );
  });
});
