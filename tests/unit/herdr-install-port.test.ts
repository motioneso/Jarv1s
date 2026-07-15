import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("node:child_process", () => ({ execFile: vi.fn((_cmd, _args, cb) => cb(null, "", "")) }));

describe("createHerdrInstallPort", () => {
  beforeEach(async () => {
    const { execFile } = await import("node:child_process");
    (execFile as unknown as ReturnType<typeof vi.fn>).mockClear();
  });

  it("always invokes bash with the fixed install script path and no other args", async () => {
    const { createHerdrInstallPort } = await import("../../apps/api/src/herdr-install-port.js");
    const { execFile } = await import("node:child_process");
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
    const log = { error: vi.fn(), warn: vi.fn() };
    const port = createHerdrInstallPort({ log } as never);
    const [a, b] = await Promise.all([port.install(), port.install()]);
    expect(execFile).toHaveBeenCalledTimes(1);
    expect(a).toEqual(b);
  });
});
