/**
 * TerminalSession (#1059): a thin node-pty wrapper — the cli-runner-side PTY primitive
 * behind the owner terminal. Real-behavior test: spawns an actual `/bin/bash -l` PTY,
 * writes a command, and asserts the echoed output is observed via onData. No mocks —
 * a mocked node-pty wouldn't catch a broken native binding or a wrong pty.spawn signature.
 */
import { describe, it, expect } from "vitest";
import * as os from "node:os";
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

  it("does not leak server secrets into the shell env (#1059 sanitized env)", async () => {
    // The cli-runner server's own env carries the RPC handshake secret + AES master
    // keys + DB creds. A real PTY here spawns the OWNER's interactive shell — if the
    // raw process.env were spread into it (pre-fix), `env`/printf would echo them
    // straight back to the owner. Assert they never reach the shell's environment.
    const prevConnectorSecret = process.env.JARVIS_CONNECTOR_SECRET_KEY;
    const prevRpcSecret = process.env.JARVIS_CLI_RUNNER_RPC_SECRET;
    process.env.JARVIS_CONNECTOR_SECRET_KEY = "SECRET_CONNECTOR_abc123";
    process.env.JARVIS_CLI_RUNNER_RPC_SECRET = "SECRET_RPC_xyz789";

    let session: TerminalSession | undefined;
    try {
      session = new TerminalSession({
        id: "t-test-secrets",
        cols: 80,
        rows: 24,
        homeBase: os.tmpdir(),
        toolsBinDir: "/usr/bin"
      });
      const chunks: Buffer[] = [];
      session.onData((c) => chunks.push(c));
      session.write(Buffer.from("env; printf END_MARKER_1059\n"));
      await new Promise((r) => setTimeout(r, 800));
      session.kill();

      const output = Buffer.concat(chunks).toString("utf8");
      expect(output).not.toContain("SECRET_CONNECTOR_abc123");
      expect(output).not.toContain("SECRET_RPC_xyz789");
      // Positive controls: the shell actually ran `env` and produced output —
      // otherwise the negative assertions above would pass vacuously.
      expect(output).toContain("END_MARKER_1059");
      expect(output).toContain("HOME=");
    } finally {
      if (prevConnectorSecret === undefined) delete process.env.JARVIS_CONNECTOR_SECRET_KEY;
      else process.env.JARVIS_CONNECTOR_SECRET_KEY = prevConnectorSecret;
      if (prevRpcSecret === undefined) delete process.env.JARVIS_CLI_RUNNER_RPC_SECRET;
      else process.env.JARVIS_CLI_RUNNER_RPC_SECRET = prevRpcSecret;
    }
  });
});
