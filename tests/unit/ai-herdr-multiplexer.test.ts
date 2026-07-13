import { describe, expect, it, vi } from "vitest";
import { HerdrMultiplexer } from "../../packages/ai/src/adapters/herdr-multiplexer.js";

function makeIo(overrides: Record<string, { code: number; stdout: string }> = {}) {
  const run = vi.fn(async (cmd: string, args: readonly string[]) => {
    const key = [cmd, ...args].join(" ");
    for (const prefix of Object.keys(overrides)) {
      const o = overrides[prefix];
      if (o && key.startsWith(prefix)) return { code: o.code, stdout: o.stdout, stderr: "" };
    }
    return { code: 0, stdout: "", stderr: "" };
  });
  return {
    run,
    sleep: vi.fn().mockResolvedValue(undefined),
    readFile: vi.fn().mockResolvedValue(""),
    writeFile: vi.fn().mockResolvedValue(undefined)
  };
}

// Realistic herdr v0.6.8 envelopes; pane ids look like "p_51" (server/workspace-assigned).
const SPLIT_JSON =
  '{"id":"cli:pane:split","result":{"pane":{"pane_id":"p_77"}},"type":"pane_info"}';

describe("HerdrMultiplexer", () => {
  it("open() splits from the explicit root pane, parses the new pane id, types the launch line, and returns the id", async () => {
    const io = makeIo({ "herdr pane split": { code: 0, stdout: SPLIT_JSON } });
    const mux = new HerdrMultiplexer(io, { rootPane: "p_51" });
    const handle = await mux.open({
      name: "jarv1s-live-x",
      cols: 220,
      rows: 50,
      launchLine: "cd '/n' && claude"
    });

    expect(handle).toBe("p_77");
    const flat = io.run.mock.calls.map((c: unknown[]) => [c[0], ...(c[1] as string[])].join(" "));
    expect(
      flat.some((c) => c.startsWith("herdr pane split p_51 --direction down --no-focus"))
    ).toBe(true);
    const textIdx = flat.findIndex((c) => c.startsWith("herdr pane send-text p_77"));
    const enterIdx = flat.findIndex(
      (c) => c.startsWith("herdr pane send-keys p_77") && c.includes("Enter")
    );
    expect(textIdx).toBeGreaterThanOrEqual(0);
    expect(enterIdx).toBeGreaterThan(textIdx);
  });

  it("open() resolves the root pane from HERDR_PANE_ID when no override is given (NOT from `pane list`)", async () => {
    const io = makeIo({ "herdr pane split": { code: 0, stdout: SPLIT_JSON } });
    const mux = new HerdrMultiplexer(io, { env: { HERDR_PANE_ID: "p_51" } });
    await mux.open({ name: "x", cols: 220, rows: 50, launchLine: "claude" });
    const flat = io.run.mock.calls.map((c: unknown[]) => [c[0], ...(c[1] as string[])].join(" "));
    expect(flat.some((c) => c.startsWith("herdr pane list"))).toBe(false); // never enumerates other operators' panes
    expect(flat.some((c) => c.startsWith("herdr pane split p_51"))).toBe(true);
  });

  it("open() throws when no root pane can be resolved (no override, no env)", async () => {
    const mux = new HerdrMultiplexer(makeIo(), { env: {} });
    await expect(mux.open({ name: "x", cols: 1, rows: 1, launchLine: "c" })).rejects.toThrow(
      /root pane/i
    );
  });

  it("open() throws a clear error when herdr returns non-JSON", async () => {
    const io = makeIo({ "herdr pane split": { code: 0, stdout: "not json" } });
    await expect(
      new HerdrMultiplexer(io, { rootPane: "p_51" }).open({
        name: "x",
        cols: 1,
        rows: 1,
        launchLine: "c"
      })
    ).rejects.toThrow(/herdr/i);
  });

  it("open() throws when `pane split` exits non-zero", async () => {
    const io = makeIo({ "herdr pane split": { code: 1, stdout: "" } });
    await expect(
      new HerdrMultiplexer(io, { rootPane: "p_51" }).open({
        name: "x",
        cols: 1,
        rows: 1,
        launchLine: "c"
      })
    ).rejects.toThrow(/split failed/i);
  });

  it("open() throws AND closes the just-split pane when send-text fails (no orphaned pane)", async () => {
    const io = makeIo({
      "herdr pane split": { code: 0, stdout: SPLIT_JSON },
      "herdr pane send-text": { code: 1, stdout: "" }
    });
    await expect(
      new HerdrMultiplexer(io, { rootPane: "p_51" }).open({
        name: "x",
        cols: 1,
        rows: 1,
        launchLine: "c"
      })
    ).rejects.toThrow(/send-text failed/i);
    // The split pane (p_77) must be closed so nothing is orphaned.
    const flat = io.run.mock.calls.map((c: unknown[]) => [c[0], ...(c[1] as string[])].join(" "));
    expect(flat.some((c) => c.startsWith("herdr pane close p_77"))).toBe(true);
  });

  it("exposes clear, capture, paste, and Enter as separate observed-submit primitives", async () => {
    const io = makeIo();
    io.run.mockImplementation(async (cmd: string, args: readonly string[]) => ({
      code: 0,
      stdout: cmd === "herdr" && args[0] === "pane" && args[1] === "read" ? "pane snapshot" : "",
      stderr: ""
    }));
    const mux = new HerdrMultiplexer(io, { rootPane: "p_51" });

    await mux.clearComposer("p_77");
    await expect(mux.capturePane("p_77")).resolves.toBe("pane snapshot");
    await mux.paste("p_77", "hello");

    const flat = io.run.mock.calls.map((c: unknown[]) => [c[0], ...(c[1] as string[])].join(" "));
    const textIdx = flat.findIndex((c) => c.startsWith("herdr pane send-text p_77"));
    expect(textIdx).toBeGreaterThanOrEqual(0);
    expect(flat.some((c) => c.startsWith("herdr pane read p_77"))).toBe(true);
    expect(flat.some((c) => c.includes("send-keys p_77 C-u"))).toBe(true);
    expect(flat.some((c) => c.includes("send-keys p_77 Enter"))).toBe(false);

    await mux.pressEnter("p_77");
    expect(
      io.run.mock.calls.some(
        (c: unknown[]) =>
          [c[0], ...(c[1] as string[])].join(" ") === "herdr pane send-keys p_77 Enter"
      )
    ).toBe(true);
  });

  it("submit() throws when send-text exits non-zero", async () => {
    const io = makeIo({ "herdr pane send-text": { code: 1, stdout: "" } });
    await expect(
      new HerdrMultiplexer(io, { rootPane: "p_51" }).submit("p_77", "hi")
    ).rejects.toThrow(/send-text failed/i);
  });

  it("isAlive() maps `pane get` exit code to a boolean", async () => {
    const ioAlive = makeIo({ "herdr pane get p_77": { code: 0, stdout: "{}" } });
    expect(await new HerdrMultiplexer(ioAlive, { rootPane: "p_51" }).isAlive("p_77")).toBe(true);
    const ioDead = makeIo({ "herdr pane get p_77": { code: 1, stdout: "" } });
    expect(await new HerdrMultiplexer(ioDead, { rootPane: "p_51" }).isAlive("p_77")).toBe(false);
  });

  it("kill() closes the pane and ignores the exit code (idempotent)", async () => {
    const io = makeIo({ "herdr pane close p_77": { code: 1, stdout: "" } });
    await expect(
      new HerdrMultiplexer(io, { rootPane: "p_51" }).kill("p_77")
    ).resolves.toBeUndefined();
    const flat = io.run.mock.calls.map((c: unknown[]) => [c[0], ...(c[1] as string[])].join(" "));
    expect(flat.some((c) => c.startsWith("herdr pane close p_77"))).toBe(true);
  });

  it("attachCommand() returns a human-runnable herdr attach hint", () => {
    const mux = new HerdrMultiplexer(makeIo(), { rootPane: "p_51" });
    expect(mux.attachCommand("p_77")).toContain("herdr");
  });

  const TAB_LIST = (label: string | null) =>
    JSON.stringify({
      result: { tabs: label ? [{ tab_id: "w:4", label }] : [], type: "tab_list" }
    });
  const PANE_LIST = JSON.stringify({
    result: { panes: [{ pane_id: "p_root4", tab_id: "w:4" }], type: "pane_list" }
  });

  it("open() with JARVIS_HERDR_ROOT_TAB splits a pane inside the existing labelled tab", async () => {
    const io = makeIo({
      "herdr tab list": { code: 0, stdout: TAB_LIST("Jarvis") },
      "herdr pane list": { code: 0, stdout: PANE_LIST },
      "herdr pane split": { code: 0, stdout: SPLIT_JSON }
    });
    const mux = new HerdrMultiplexer(io, { env: { JARVIS_HERDR_ROOT_TAB: "Jarvis" } });
    const handle = await mux.open({ name: "x", cols: 220, rows: 50, launchLine: "claude" });

    expect(handle).toBe("p_77");
    const flat = io.run.mock.calls.map((c: unknown[]) => [c[0], ...(c[1] as string[])].join(" "));
    // Splits from the tab's pane (p_root4), never creates the tab (it already exists).
    expect(flat.some((c) => c.startsWith("herdr pane split p_root4"))).toBe(true);
    expect(flat.some((c) => c.startsWith("herdr tab create"))).toBe(false);
  });

  it("open() creates the tab when the label is missing, then splits inside it (self-heal)", async () => {
    let created = false;
    const io = {
      run: vi.fn(async (cmd: string, args: readonly string[]) => {
        const key = [cmd, ...args].join(" ");
        if (key.startsWith("herdr tab list")) {
          return { code: 0, stdout: TAB_LIST(created ? "Jarvis" : null), stderr: "" };
        }
        if (key.startsWith("herdr tab create")) {
          created = true;
          return { code: 0, stdout: "{}", stderr: "" };
        }
        if (key.startsWith("herdr pane list")) return { code: 0, stdout: PANE_LIST, stderr: "" };
        if (key.startsWith("herdr pane split")) return { code: 0, stdout: SPLIT_JSON, stderr: "" };
        return { code: 0, stdout: "", stderr: "" };
      }),
      sleep: vi.fn().mockResolvedValue(undefined),
      readFile: vi.fn().mockResolvedValue(""),
      writeFile: vi.fn().mockResolvedValue(undefined)
    };
    const mux = new HerdrMultiplexer(io, { env: { JARVIS_HERDR_ROOT_TAB: "Jarvis" } });
    const handle = await mux.open({ name: "x", cols: 220, rows: 50, launchLine: "claude" });

    expect(handle).toBe("p_77");
    const flat = io.run.mock.calls.map((c: unknown[]) => [c[0], ...(c[1] as string[])].join(" "));
    expect(flat.some((c) => c.startsWith("herdr tab create --label Jarvis --no-focus"))).toBe(true);
    expect(flat.some((c) => c.startsWith("herdr pane split p_root4"))).toBe(true);
  });

  it("explicit rootPane wins over JARVIS_HERDR_ROOT_TAB (no tab lookup)", async () => {
    const io = makeIo({ "herdr pane split": { code: 0, stdout: SPLIT_JSON } });
    const mux = new HerdrMultiplexer(io, {
      rootPane: "p_51",
      env: { JARVIS_HERDR_ROOT_TAB: "Jarvis" }
    });
    await mux.open({ name: "x", cols: 1, rows: 1, launchLine: "c" });
    const flat = io.run.mock.calls.map((c: unknown[]) => [c[0], ...(c[1] as string[])].join(" "));
    expect(flat.some((c) => c.startsWith("herdr tab list"))).toBe(false);
    expect(flat.some((c) => c.startsWith("herdr pane split p_51"))).toBe(true);
  });
});
