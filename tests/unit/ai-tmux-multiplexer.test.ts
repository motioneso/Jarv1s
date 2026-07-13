import { describe, expect, it, vi } from "vitest";
import { TmuxMultiplexer } from "../../packages/ai/src/adapters/tmux-multiplexer.js";

function makeIo() {
  return {
    run: vi.fn().mockResolvedValue({ code: 0, stdout: "", stderr: "" }),
    sleep: vi.fn().mockResolvedValue(undefined),
    readFile: vi.fn().mockResolvedValue(""),
    writeFile: vi.fn().mockResolvedValue(undefined)
  };
}

function calls(io: ReturnType<typeof makeIo>) {
  return io.run.mock.calls.map((c: unknown[]) => [c[0], ...(c[1] as string[])].join(" "));
}

describe("TmuxMultiplexer", () => {
  it("open() creates a detached session and sends the launch line, returning the name as handle", async () => {
    const io = makeIo();
    const mux = new TmuxMultiplexer(io);
    const handle = await mux.open({
      name: "jarv1s-live-x",
      cols: 220,
      rows: 50,
      launchLine: "cd '/n' && claude --tools \"\""
    });

    expect(handle).toBe("jarv1s-live-x");
    const flat = calls(io);
    expect(
      flat.some((c) => c.startsWith("tmux new-session -d -s jarv1s-live-x -x 220 -y 50"))
    ).toBe(true);
    expect(
      flat.some((c) => c.startsWith("tmux send-keys -t jarv1s-live-x") && c.endsWith("Enter"))
    ).toBe(true);
  });

  it("exposes clear, capture, paste, and Enter as separate observed-submit primitives", async () => {
    const io = makeIo();
    io.run.mockImplementation(async (_cmd: string, args: string[]) => ({
      code: 0,
      stdout: args[0] === "capture-pane" ? "pane snapshot" : "",
      stderr: ""
    }));
    const mux = new TmuxMultiplexer(io);

    await mux.clearComposer("jarv1s-live-x");
    await expect(mux.capturePane("jarv1s-live-x")).resolves.toBe("pane snapshot");
    await mux.paste("jarv1s-live-x", "hello");

    const flat = calls(io);
    const pasteIdx = flat.findIndex((c) => c.includes("paste-buffer"));
    expect(pasteIdx).toBeGreaterThanOrEqual(0);
    expect(flat.some((c) => c.includes("send-keys") && c.includes("Enter"))).toBe(false);
    expect(flat.some((c) => c.includes("send-keys") && c.includes("C-u"))).toBe(true);
    expect(flat.some((c) => c.includes("capture-pane"))).toBe(true);
    expect(io.writeFile).toHaveBeenCalledTimes(1); // prompt written to a temp file before paste
    expect(flat.some((c) => c.includes("delete-buffer"))).toBe(true);
    expect(flat.some((c) => c.startsWith("rm -f "))).toBe(true);
    expect(io.sleep).not.toHaveBeenCalled();

    await mux.pressEnter("jarv1s-live-x");
    expect(calls(io).some((c) => c.includes("send-keys") && c.includes("Enter"))).toBe(true);
  });

  it("cleans the tmux buffer and prompt file when paste fails", async () => {
    const io = makeIo();
    io.run.mockImplementation(async (_cmd: string, args: string[]) => ({
      code: args[0] === "paste-buffer" ? 1 : 0,
      stdout: "",
      stderr: "paste failed"
    }));
    const mux = new TmuxMultiplexer(io);

    await expect(mux.paste("jarv1s-live-x", "hello")).rejects.toThrow(/paste-buffer.*failed/);

    const flat = calls(io);
    expect(flat.some((c) => c.includes("delete-buffer"))).toBe(true);
    expect(flat.some((c) => c.startsWith("rm -f "))).toBe(true);
  });

  it("isAlive() maps has-session exit code to a boolean", async () => {
    const io = makeIo();
    io.run.mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" });
    const mux = new TmuxMultiplexer(io);
    expect(await mux.isAlive("jarv1s-live-x")).toBe(true);

    io.run.mockResolvedValueOnce({ code: 1, stdout: "", stderr: "" });
    expect(await mux.isAlive("jarv1s-live-x")).toBe(false);
  });

  it("kill() kills the session", async () => {
    const io = makeIo();
    const mux = new TmuxMultiplexer(io);
    await mux.kill("jarv1s-live-x");
    expect(calls(io).some((c) => c.startsWith("tmux kill-session -t jarv1s-live-x"))).toBe(true);
  });

  it("attachCommand() returns a human-runnable tmux attach line", () => {
    const mux = new TmuxMultiplexer(makeIo());
    expect(mux.attachCommand("jarv1s-live-x")).toBe("tmux attach -t jarv1s-live-x");
  });

  it("open() throws when new-session exits non-zero (e.g. binary missing / name clash)", async () => {
    const io = makeIo();
    io.run.mockResolvedValueOnce({ code: 1, stdout: "", stderr: "duplicate session" });
    const mux = new TmuxMultiplexer(io);
    await expect(
      mux.open({ name: "x", cols: 220, rows: 50, launchLine: "claude" })
    ).rejects.toThrow(/new-session failed/);
  });

  it("open() kills the just-created session if send-keys fails (no orphaned session)", async () => {
    const io = makeIo();
    io.run
      .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }) // new-session ok
      .mockResolvedValueOnce({ code: 1, stdout: "", stderr: "send failed" }); // send-keys fails
    const mux = new TmuxMultiplexer(io);
    await expect(
      mux.open({ name: "jarv1s-live-x", cols: 220, rows: 50, launchLine: "claude" })
    ).rejects.toThrow(/send-keys failed/);
    // The detached session must be torn down so nothing is orphaned.
    expect(calls(io).some((c) => c.startsWith("tmux kill-session -t jarv1s-live-x"))).toBe(true);
  });

  it("redacts a token-bearing launch line echoed back on stderr (open() failure path)", async () => {
    const io = makeIo();
    // tmux echoes the failing command (with the MCP token env-var prefix) back on stderr.
    io.run.mockResolvedValueOnce({
      code: 1,
      stdout: "",
      stderr: "failed to run: JARVIS_MCP_TOKEN=jst_supersecret123 codex --sandbox read-only"
    });
    const mux = new TmuxMultiplexer(io);

    const err = await mux
      .open({
        name: "x",
        cols: 220,
        rows: 50,
        launchLine: "JARVIS_MCP_TOKEN=jst_supersecret123 codex"
      })
      .then(
        () => null,
        (e: unknown) => e as Error
      );

    expect(err).toBeInstanceOf(Error);
    // The token must never reach the Error message (which the route logs server-side).
    expect(err!.message).not.toContain("jst_supersecret123");
    expect(err!.message).not.toContain("JARVIS_MCP_TOKEN=jst_");
    expect(err!.message).toContain("[redacted]");
    expect(err!.message).toMatch(/new-session failed/);
  });
});
