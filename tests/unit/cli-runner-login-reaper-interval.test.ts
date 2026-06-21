/**
 * v0.1.3: the CliRunnerServer drives the max-age login reaper on a periodic interval while it
 * runs, and clears the timer on stop(). This is the disk-level BACKSTOP that releases the §L.6.1
 * single-active gate from a hung/abandoned login (the per-flow in-memory deadline alone can be
 * starved or stranded). Uses fake timers + a stub host so no real tmux/socket is needed.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CliRunnerServer } from "../../packages/cli-runner/src/server.js";
import type { CliChatEngineHost } from "../../packages/cli-runner/src/engine-host.js";

let socketDir: string;

beforeEach(async () => {
  socketDir = await mkdtemp(path.join(tmpdir(), "jarv1s-reaper-"));
});

afterEach(async () => {
  vi.useRealTimers();
  await rm(socketDir, { recursive: true, force: true }).catch(() => undefined);
});

function stubHost(reap: () => Promise<void>): CliChatEngineHost {
  return {
    startupSweep: async () => undefined,
    reapStaleLogins: reap
  } as unknown as CliChatEngineHost;
}

describe("CliRunnerServer max-age login reaper interval (v0.1.3)", () => {
  it("drives host.reapStaleLogins on the configured interval, and stop() clears it", async () => {
    vi.useFakeTimers();
    const reap = vi.fn(async () => undefined);
    const server = new CliRunnerServer({
      host: stubHost(reap),
      socketPath: path.join(socketDir, "cli-runner.sock"),
      socketDir,
      secret: "s",
      loginReaperIntervalMs: 50
    });

    await server.start();
    expect(reap).not.toHaveBeenCalled(); // nothing yet

    await vi.advanceTimersByTimeAsync(50);
    expect(reap).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(100);
    expect(reap).toHaveBeenCalledTimes(3);

    await server.stop();
    await vi.advanceTimersByTimeAsync(500);
    expect(reap).toHaveBeenCalledTimes(3); // no further ticks after stop
  });

  it("does not arm the reaper when the interval is 0 (off)", async () => {
    vi.useFakeTimers();
    const reap = vi.fn(async () => undefined);
    const server = new CliRunnerServer({
      host: stubHost(reap),
      socketPath: path.join(socketDir, "cli-runner.sock"),
      socketDir,
      secret: "s",
      loginReaperIntervalMs: 0
    });
    await server.start();
    await vi.advanceTimersByTimeAsync(1000);
    expect(reap).not.toHaveBeenCalled();
    await server.stop();
  });
});
