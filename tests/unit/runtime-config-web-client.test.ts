import { afterEach, describe, expect, it, vi } from "vitest";

import { getRuntimeConfig, putRuntimeConfig } from "../../apps/web/src/api/client.js";
import { queryKeys } from "../../apps/web/src/api/query-keys.js";

describe("runtime config web client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses per-key runtime config query keys", () => {
    expect(queryKeys.ai.runtimeConfig("ai.embed_provider")).toEqual([
      "ai",
      "runtime-config",
      "ai.embed_provider"
    ]);
  });

  it("calls runtime config endpoints with encoded keys and value payloads", async () => {
    const fetchMock = vi.fn(
      async () => new Response('{"config":{"value":"stub","source":"instance"}}')
    );
    vi.stubGlobal("fetch", fetchMock);

    await getRuntimeConfig("ai.embed_provider");
    await putRuntimeConfig("ai.embed/provider", { value: "stub" });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/admin/runtime-config/ai.embed_provider",
      expect.objectContaining({ credentials: "include" })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/admin/runtime-config/ai.embed%2Fprovider",
      expect.objectContaining({ method: "PUT", body: JSON.stringify({ value: "stub" }) })
    );
  });
});
