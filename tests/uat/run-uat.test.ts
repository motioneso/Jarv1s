import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  provisionForUat: vi.fn(),
  spawn: vi.fn()
}));

vi.mock("./provisioner.js", () => ({ provisionForUat: mocks.provisionForUat }));
vi.mock("node:child_process", () => ({ spawn: mocks.spawn }));

const originalArgv = process.argv;

describe("run-uat CLI (#1027/#1047)", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.provisionForUat.mockResolvedValue({
      baseURL: "http://127.0.0.1:4321",
      projectName: "uat-test",
      teardown: vi.fn().mockResolvedValue(undefined)
    });
    mocks.spawn.mockReturnValue({
      on: (event: string, listener: (code: number) => void) => {
        if (event === "exit") listener(0);
      }
    });
    vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
  });

  afterEach(() => {
    process.argv = originalArgv;
    vi.restoreAllMocks();
  });

  it("forwards a resolved spec filter to Playwright", async () => {
    process.argv = ["node", "tests/uat/run-uat.ts", "job-search-install"];

    await import("./run-uat.js");

    const [command, args] = mocks.spawn.mock.calls[0] ?? [];
    expect(command).toBe("npx");
    expect(args).toEqual([
      "playwright",
      "test",
      "--config=tests/uat/playwright.uat.config.ts",
      "job-search-install"
    ]);
  });

  it("only excludes job-search for the install spec", async () => {
    process.argv = ["node", "tests/uat/run-uat.ts", "future-advisory-spec"];

    await import("./run-uat.js");

    expect(mocks.provisionForUat).toHaveBeenCalledWith("admin+data", { excludeChunks: [] });
  });
});
