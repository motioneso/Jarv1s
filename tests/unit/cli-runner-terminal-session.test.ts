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
});
