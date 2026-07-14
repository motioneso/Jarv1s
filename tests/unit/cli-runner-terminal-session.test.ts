/**
 * TerminalSession (#1059): a thin node-pty wrapper — the cli-runner-side PTY primitive
 * behind the owner terminal. Real-behavior test: spawns an actual `/bin/bash -l` PTY,
 * writes a command, and asserts the echoed output is observed via onData. No mocks —
 * a mocked node-pty wouldn't catch a broken native binding or a wrong pty.spawn signature.
 */
import { describe, it, expect } from "vitest";
import { TerminalSession } from "../../packages/cli-runner/src/terminal-session.js";

describe("TerminalSession (#1059)", () => {
  it("echoes input and reports output", async () => {
    const session = new TerminalSession({
      id: "t-test",
      cols: 80,
      rows: 24,
      homeBase: "/tmp",
      toolsBinDir: "/usr/bin"
    });
    const chunks: string[] = [];
    session.onData((c) => chunks.push(c.toString("utf8")));
    session.write(Buffer.from("echo hello_1059\n"));
    await new Promise((r) => setTimeout(r, 800));
    session.kill();
    expect(chunks.join("")).toContain("hello_1059");
  });

  it("passes raw non-UTF-8 bytes through unmodified (#1059 encoding:null)", async () => {
    // Bytes 0xFF/0xFE are not valid standalone UTF-8. Under node-pty's old default
    // 'utf8' encoding they'd be lossily decoded to U+FFFD before we ever see them
    // (0xFF absent from the stream); under `encoding: null` the exact bytes survive.
    const session = new TerminalSession({
      id: "t-test-binary",
      cols: 80,
      rows: 24,
      homeBase: "/tmp",
      toolsBinDir: "/usr/bin"
    });
    const chunks: Buffer[] = [];
    session.onData((c) => chunks.push(c));
    session.write(Buffer.from("printf '\\377\\376'\n"));
    await new Promise((r) => setTimeout(r, 800));
    session.kill();
    expect(chunks.every((c) => Buffer.isBuffer(c))).toBe(true);
    expect(Buffer.concat(chunks).includes(0xff)).toBe(true);
  });
});
