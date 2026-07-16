import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

/**
 * The mocked `execFile` must behave like the real node:child_process API for the
 * behavior under test here: it returns a ChildProcess-shaped handle (`.kill`, `.once`)
 * synchronously, and invokes the callback asynchronously (or never, for the timeout
 * tests) — see #1088 F2, which needs the actual child handle to kill it.
 */
function fakeChild() {
  const exitHandlers: Array<() => void> = [];
  return {
    kill: vi.fn(),
    once: vi.fn((event: string, handler: () => void) => {
      if (event === "exit") exitHandlers.push(handler);
    }),
    emitExit: () => {
      for (const handler of exitHandlers) handler();
    }
  };
}

vi.mock("node:child_process", () => ({ execFile: vi.fn() }));

describe("createHerdrInstallPort", () => {
  beforeEach(async () => {
    const { execFile } = await import("node:child_process");
    (execFile as unknown as ReturnType<typeof vi.fn>).mockReset();
  });

  it("always invokes bash with the fixed install script path and no other args", async () => {
    const { createHerdrInstallPort } = await import("../../apps/api/src/herdr-install-port.js");
    const { execFile } = await import("node:child_process");
    const child = fakeChild();
    (execFile as unknown as ReturnType<typeof vi.fn>).mockImplementation((_cmd, _args, cb) => {
      cb(null, "", "");
      return child;
    });
    const log = { error: vi.fn(), warn: vi.fn() };
    const port = createHerdrInstallPort({ log } as never);
    await port.install();
    const call = (execFile as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(call[0]).toBe("bash");
    expect(call[1]).toHaveLength(1);
    expect(call[1][0]).toMatch(/scripts\/install-herdr\.sh$/);
  });

  it("collapses concurrent calls into one execFile invocation (single-flight)", async () => {
    const { createHerdrInstallPort } = await import("../../apps/api/src/herdr-install-port.js");
    const { execFile } = await import("node:child_process");
    (execFile as unknown as ReturnType<typeof vi.fn>).mockImplementation((_cmd, _args, cb) => {
      cb(null, "", "");
      return fakeChild();
    });
    const log = { error: vi.fn(), warn: vi.fn() };
    const port = createHerdrInstallPort({ log } as never);
    const [a, b] = await Promise.all([port.install(), port.install()]);
    expect(execFile).toHaveBeenCalledTimes(1);
    expect(a).toEqual(b);
  });

  describe("#1088 F2 — timeout kills the child instead of leaking it", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it("SIGTERMs the child when the install hangs past the timeout, then SIGKILLs after the grace period", async () => {
      const { createHerdrInstallPort } = await import("../../apps/api/src/herdr-install-port.js");
      const { execFile } = await import("node:child_process");
      const child = fakeChild();
      // Simulate a hung install: the callback never fires on its own.
      (execFile as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => child);
      const log = { error: vi.fn(), warn: vi.fn() };
      const port = createHerdrInstallPort({ log } as never);

      const installPromise = port.install();
      // Attach a rejection handler immediately so Node doesn't flag this as an
      // unhandled rejection while fake timers are advanced below.
      const settled = installPromise.then(
        (v) => v,
        (e) => e
      );

      await vi.advanceTimersByTimeAsync(60_000);
      expect(child.kill).toHaveBeenCalledWith("SIGTERM");
      expect(child.kill).not.toHaveBeenCalledWith("SIGKILL");

      await vi.advanceTimersByTimeAsync(5_000);
      expect(child.kill).toHaveBeenCalledWith("SIGKILL");

      const result = await settled;
      expect(result).toEqual({ ok: false, timedOut: true });
    });

    it("does not SIGKILL a child that exits promptly after SIGTERM", async () => {
      const { createHerdrInstallPort } = await import("../../apps/api/src/herdr-install-port.js");
      const { execFile } = await import("node:child_process");
      const child = fakeChild();
      (execFile as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => child);
      const log = { error: vi.fn(), warn: vi.fn() };
      const port = createHerdrInstallPort({ log } as never);

      const installPromise = port.install();
      const settled = installPromise.then(
        (v) => v,
        (e) => e
      );

      await vi.advanceTimersByTimeAsync(60_000);
      expect(child.kill).toHaveBeenCalledWith("SIGTERM");
      child.emitExit(); // process honored SIGTERM and exited

      await vi.advanceTimersByTimeAsync(5_000);
      expect(child.kill).not.toHaveBeenCalledWith("SIGKILL");

      await settled;
    });
  });
});
