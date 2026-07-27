import { randomUUID } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import type { AccessContext, DataContextRunner } from "@jarv1s/db";
import type { ExternalModuleDiscovery } from "@jarv1s/module-registry";
import { createExternalModuleRpcHandler } from "@jarv1s/module-registry/node";
import type { CreateNotificationInput } from "@jarv1s/notifications";

describe("external worker ctx.notify port (Task 2b, #1283)", () => {
  const module = {
    id: "job-search",
    dir: "/unused",
    manifest: {
      schemaVersion: 1,
      id: "job-search",
      name: "Job Search",
      version: "1.0.0",
      publisher: "Jarvis",
      lifecycle: "optional",
      compatibility: { jarv1s: ">=0.0.0" }
    },
    manifestHash: "sha256:a",
    packageHash: "sha256:a"
  } satisfies ExternalModuleDiscovery;

  // notify.post is served before withDataContext, same harness shape as the
  // embed/attachments port tests — the null casts below are never dereferenced.
  const rpcFor = (
    toolRisk: "read" | "write",
    postNotification?: (access: AccessContext, input: CreateNotificationInput) => Promise<void>
  ) =>
    createExternalModuleRpcHandler({
      module,
      toolRisk,
      actorUserId: randomUUID(),
      requestId: randomUUID(),
      workerDataContext: null as unknown as DataContextRunner,
      cipher: null as never,
      isActorAdmin: async () => false,
      embeddingProvider: null as never,
      postNotification
    });

  it("posts a notification with the caller's fields and no extras", async () => {
    const postNotification = vi.fn().mockResolvedValue(undefined);

    await expect(
      rpcFor("write", postNotification)(
        "notify.post",
        { key: "sync-complete", title: "Sync complete", body: "42 postings found", href: "/jobs" },
        () => undefined
      )
    ).resolves.toBeUndefined();

    expect(postNotification).toHaveBeenCalledTimes(1);
    const [access, input] = postNotification.mock.calls[0] as [
      AccessContext,
      CreateNotificationInput
    ];
    expect(access).toMatchObject({
      actorUserId: expect.any(String),
      requestId: expect.any(String)
    });
    // key is renamed to eventKey ONLY at this host boundary — never before it.
    expect(input).toEqual({
      moduleId: "job-search",
      title: "Sync complete",
      body: "42 postings found",
      eventKey: "sync-complete",
      href: "/jobs"
    });
  });

  it("omits href entirely when the caller does not supply one", async () => {
    const postNotification = vi.fn().mockResolvedValue(undefined);

    await rpcFor("write", postNotification)(
      "notify.post",
      { key: "k", title: "t", body: "b" },
      () => undefined
    );

    const [, input] = postNotification.mock.calls[0] as [AccessContext, CreateNotificationInput];
    expect(input).not.toHaveProperty("href");
  });

  it("rejects an oversized key, title, or body without calling postNotification", async () => {
    const postNotification = vi.fn().mockResolvedValue(undefined);
    const rpc = rpcFor("write", postNotification);

    await expect(
      rpc("notify.post", { key: "k".repeat(201), title: "t", body: "b" }, () => undefined)
    ).rejects.toMatchObject({ code: "invalid_rpc", detail: /at most 200/ });
    await expect(
      rpc("notify.post", { key: "k", title: "t".repeat(201), body: "b" }, () => undefined)
    ).rejects.toMatchObject({ code: "invalid_rpc", detail: /at most 200/ });
    await expect(
      rpc("notify.post", { key: "k", title: "t", body: "b".repeat(2001) }, () => undefined)
    ).rejects.toMatchObject({ code: "invalid_rpc", detail: /at most 2000/ });
    expect(postNotification).not.toHaveBeenCalled();
  });

  it("rejects a non-same-origin href (absolute URL, protocol-relative, or scheme)", async () => {
    const postNotification = vi.fn().mockResolvedValue(undefined);
    const rpc = rpcFor("write", postNotification);

    for (const href of ["https://evil.example.com", "//evil.example.com", "javascript:alert(1)"]) {
      await expect(
        rpc("notify.post", { key: "k", title: "t", body: "b", href }, () => undefined)
      ).rejects.toMatchObject({ code: "invalid_rpc", detail: /same-origin path/ });
    }
    expect(postNotification).not.toHaveBeenCalled();
  });

  it("rate-limits after 5 calls in one invocation", async () => {
    const postNotification = vi.fn().mockResolvedValue(undefined);
    const rpc = rpcFor("write", postNotification);
    const post = (key: string) =>
      rpc("notify.post", { key, title: "t", body: "b" }, () => undefined);

    await post("1");
    await post("2");
    await post("3");
    await post("4");
    await post("5");
    await expect(post("6")).rejects.toMatchObject({ code: "rate_limited" });

    expect(postNotification).toHaveBeenCalledTimes(5);
  });

  it("rejects notify.post for a read-risk tool call, mirroring kv.set/setCredential/ai calls", async () => {
    const postNotification = vi.fn().mockResolvedValue(undefined);

    await expect(
      rpcFor("read", postNotification)(
        "notify.post",
        { key: "k", title: "t", body: "b" },
        () => undefined
      )
    ).rejects.toMatchObject({ code: "forbidden_notify_mutation" });

    expect(postNotification).not.toHaveBeenCalled();
  });
});
