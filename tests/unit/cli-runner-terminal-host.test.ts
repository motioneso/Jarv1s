/**
 * TerminalHost (#1059): single-active-session lifecycle manager on top of the
 * TerminalSession PTY primitive. Uses `makeSession` injection so these tests are
 * pure/fast/deterministic — no real PTY spawns, no timers left dangling.
 */
import { describe, it, expect, vi } from "vitest";
import { TerminalHost } from "../../packages/cli-runner/src/terminal-host.js";

function fakeSession(id: string) {
  const listeners: Array<(b: Buffer) => void> = [];
  return {
    id,
    killed: false,
    onData: (cb: (b: Buffer) => void) => listeners.push(cb),
    onExit: (_: (c: number) => void) => {},
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(function (this: any) {
      this.killed = true;
    }),
    _emit: (s: string) => listeners.forEach((l) => l(Buffer.from(s)))
  };
}

describe("TerminalHost (#1059)", () => {
  it("opening a second terminal evicts the first (single active session)", () => {
    const made: any[] = [];
    const host = new TerminalHost({
      homeBase: "/tmp",
      toolsBinDir: "/usr/bin",
      makeSession: (o) => {
        const s = fakeSession(o.id);
        made.push(s);
        return s as any;
      }
    });
    const sink = { data: vi.fn(), exit: vi.fn() };
    host.open({ cols: 80, rows: 24 }, sink);
    host.open({ cols: 80, rows: 24 }, sink);
    expect(made[0].kill).toHaveBeenCalledTimes(1);
    expect(made[1].kill).not.toHaveBeenCalled();
  });

  it("routes PTY output to the sink by terminalId", () => {
    let made: any;
    const host = new TerminalHost({
      homeBase: "/tmp",
      toolsBinDir: "/usr/bin",
      makeSession: (o) => {
        made = fakeSession(o.id);
        return made as any;
      }
    });
    const sink = { data: vi.fn(), exit: vi.fn() };
    const { terminalId } = host.open({ cols: 80, rows: 24 }, sink);
    made._emit("out");
    expect(sink.data).toHaveBeenCalledWith(terminalId, Buffer.from("out"));
  });
});
