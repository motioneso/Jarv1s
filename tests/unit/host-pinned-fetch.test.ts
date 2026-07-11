import { describe, expect, it } from "vitest";

import { createHostPinnedFetch } from "../../packages/host-fetch/src/index.js";

describe("host-pinned fetch transport", () => {
  it("connects to the validated public address while forcing hostname SNI and Host", async () => {
    const requests: Array<Record<string, unknown>> = [];
    const fetchFn = createHostPinnedFetch(["api.example.com"], {
      resolve: async () => [{ address: "93.184.216.34", family: 4 }],
      request: async (request) => {
        requests.push(request as unknown as Record<string, unknown>);
        return {
          status: 200,
          headers: { "content-type": "application/json" },
          body: (async function* () {
            yield Buffer.from("{}");
          })()
        };
      }
    });

    const response = await fetchFn("https://api.example.com/data");

    expect(response.status).toBe(200);
    expect(requests).toEqual([
      expect.objectContaining({
        address: "93.184.216.34",
        servername: "api.example.com",
        host: "api.example.com",
        path: "/data"
      })
    ]);
  });

  it.each([
    ["private IPv4", "10.0.0.1", 4],
    ["deprecated 6to4 relay", "192.88.99.1", 4],
    ["multicast IPv4", "224.0.0.1", 4],
    ["ORCHIDv1 IPv6", "2001:10::1", 6],
    ["unique-local IPv6", "fd00::1", 6],
    ["multicast IPv6", "ff02::1", 6]
  ] as const)("rejects %s DNS answers", async (_name, address, family) => {
    let requested = false;
    const fetchFn = createHostPinnedFetch(["api.example.com"], {
      resolve: async () => [{ address, family }],
      request: async () => {
        requested = true;
        throw new Error("must not connect");
      }
    });

    await expect(fetchFn("https://api.example.com/data")).rejects.toMatchObject({
      code: "blocked_address"
    });
    expect(requested).toBe(false);
  });

  it("enforces one deadline across DNS resolution", async () => {
    const fetchFn = createHostPinnedFetch(["api.example.com"], {
      timeoutMs: 5,
      resolve: async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        return [{ address: "93.184.216.34", family: 4 }];
      },
      request: async () => ({
        status: 200,
        headers: {},
        body: (async function* () {})()
      })
    });

    await expect(fetchFn("https://api.example.com/data")).rejects.toMatchObject({
      code: "fetch_timeout"
    });
  });

  it("preserves bodyless 204 responses", async () => {
    const fetchFn = createHostPinnedFetch(["api.example.com"], {
      resolve: async () => [{ address: "93.184.216.34", family: 4 }],
      request: async () => ({
        status: 204,
        headers: {},
        body: (async function* () {})()
      })
    });

    await expect(fetchFn("https://api.example.com/data")).resolves.toMatchObject({ status: 204 });
  });
});
