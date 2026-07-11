import { describe, expect, it } from "vitest";

import {
  createHostRateLimiter,
  RateLimitExceededError
} from "../../packages/web-research/src/rate-limit.js";

describe("createHostRateLimiter", () => {
  it("spaces requests to the same host case-insensitively", async () => {
    let now = 0;
    const waits: number[] = [];
    const limiter = createHostRateLimiter({
      minIntervalMs: 100,
      now: () => now,
      sleep: async (ms) => {
        waits.push(ms);
        now += ms;
      }
    });

    await limiter.acquire("Example.COM");
    await limiter.acquire("example.com");

    expect(waits).toEqual([100]);
  });

  it("does not delay different hosts", async () => {
    const sleep = async (): Promise<void> => {
      throw new Error("unexpected wait");
    };
    const limiter = createHostRateLimiter({ now: () => 0, sleep });

    await limiter.acquire("one.example");
    await limiter.acquire("two.example");
  });

  it("rejects waits beyond the configured maximum", async () => {
    const limiter = createHostRateLimiter({
      minIntervalMs: 100,
      maxWaitMs: 50,
      now: () => 0
    });

    await limiter.acquire("example.com");
    await expect(limiter.acquire("example.com")).rejects.toBeInstanceOf(
      RateLimitExceededError
    );
  });
});
