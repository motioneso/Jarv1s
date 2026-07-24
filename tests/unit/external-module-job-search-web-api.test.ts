import { afterEach, describe, expect, it, vi } from "vitest";

import { runQueue } from "../../external-modules/job-search/src/web/api.js";

afterEach(() => vi.unstubAllGlobals());

describe("Job Search web queue API (#1232)", () => {
  it("queues metadata-only work through the module route", async () => {
    const fetchMock = vi.fn(async () => Response.json({ jobId: "job-1" }, { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      runQueue("refresh", "job-search.refresh", { profileId: "profile-1" })
    ).resolves.toEqual({
      kind: "queued"
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/modules/job-search/queues/refresh/run",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ jobKind: "job-search.refresh", params: { profileId: "profile-1" } })
      })
    );
  });

  it("distinguishes singleton dedupe and a disabled module", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(Response.json({ jobId: null }, { status: 202 }))
        .mockResolvedValueOnce(Response.json({ error: "Not found" }, { status: 404 }))
    );

    await expect(runQueue("refresh", "job-search.refresh")).resolves.toEqual({
      kind: "already-queued"
    });
    await expect(runQueue("refresh", "job-search.refresh")).resolves.toEqual({ kind: "disabled" });
  });
});
