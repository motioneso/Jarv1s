export interface HostRateLimiter {
  acquire(host: string): Promise<void>;
}

export class RateLimitExceededError extends Error {}

export function createHostRateLimiter(
  opts: {
    minIntervalMs?: number;
    maxWaitMs?: number;
    now?: () => number;
    sleep?: (ms: number) => Promise<void>;
  } = {}
): HostRateLimiter {
  const minIntervalMs = opts.minIntervalMs ?? 1_000;
  const maxWaitMs = opts.maxWaitMs ?? 10_000;
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const nextFreeByHost = new Map<string, number>();

  return {
    async acquire(host) {
      const current = now();
      const key = host.toLowerCase();
      const wait = Math.max(0, (nextFreeByHost.get(key) ?? current) - current);
      if (wait > maxWaitMs) throw new RateLimitExceededError("Host rate-limit wait exceeded");
      nextFreeByHost.set(key, current + wait + minIntervalMs);
      if (nextFreeByHost.size > 1_024) {
        for (const [candidate, nextFree] of nextFreeByHost) {
          if (nextFree <= current) nextFreeByHost.delete(candidate);
        }
        if (nextFreeByHost.size > 1_024) nextFreeByHost.delete(nextFreeByHost.keys().next().value!);
      }
      if (wait > 0) await sleep(wait);
    }
  };
}
