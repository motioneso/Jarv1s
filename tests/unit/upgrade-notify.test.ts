import { describe, expect, it, vi } from "vitest";

import { handleUpgradeNotifyJob } from "@jarv1s/jobs";

const job = {
  id: "job-1",
  data: {
    kind: "upgrade-notify",
    actorUserId: "11111111-1111-4111-8111-111111111111",
    version: "v1.1.0"
  }
};

describe("handleUpgradeNotifyJob", () => {
  it("skips when the owner already has a notification for the version", async () => {
    const repository = {
      listVisible: vi.fn(async () => ({
        unreadCount: 1,
        notifications: [{ metadata: { kind: "upgrade_available", version: "v1.1.0" } }]
      })),
      create: vi.fn()
    };

    await handleUpgradeNotifyJob(job as never, {} as never, { repository: repository as never });

    expect(repository.create).not.toHaveBeenCalled();
  });

  it("creates a metadata-only upgrade notification for the scoped owner", async () => {
    const repository = {
      listVisible: vi.fn(async () => ({ unreadCount: 0, notifications: [] })),
      create: vi.fn(async () => ({}))
    };

    await handleUpgradeNotifyJob(job as never, {} as never, { repository: repository as never });

    expect(repository.create).toHaveBeenCalledWith(
      {},
      {
        title: "Jarvis v1.1.0 is available",
        body: "A newer version of Jarvis is available. View the release notes and upgrade from Settings -> Diagnostics.",
        urgency: "normal",
        metadata: { kind: "upgrade_available", version: "v1.1.0" }
      }
    );
  });
});
