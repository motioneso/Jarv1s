/**
 * #744 real-RPC regression test — private-chat transcript purge over the ACTUAL socket path.
 *
 * The cycle-3 defect: `ChatEngineRpcClient` never implemented `purgeTranscripts`, and the wire
 * contract had no such verb, so on the split RPC topology the manager's
 * `session.engine.purgeTranscripts?.()` was a SILENT optional-chain no-op — the transcript was
 * never purged, yet the incognito bookkeeping row was deleted, stranding the transcript on disk.
 * The unit suites masked it because their FakeEngine implements `purgeTranscripts` directly.
 *
 * This test refuses that mask: it stands up a REAL Unix-socket server running the production
 * `serveConnection` + `CliChatEngineHost`, and a REAL `RpcConnection` + `ChatEngineRpcClient`
 * client. It drives the manager's real sequence — purge while the server-side engine still owns
 * its exact identity, then kill — and asserts the cli-runner purges before removing neutral state.
 */
import { createServer, type Server } from "node:net";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { TmuxIo } from "../../packages/ai/src/adapters/tmux-bridge.js";
import { CliChatEngineHost } from "../../packages/cli-runner/src/engine-host.js";
import { serveConnection, type ByteChannel } from "../../packages/cli-runner/src/connection.js";
import { TerminalHost } from "../../packages/cli-runner/src/terminal-host.js";
import {
  RpcConnection,
  ChatEngineRpcClient
} from "../../packages/chat/src/live/chat-engine-rpc-client.js";

const NEUTRAL_BASE = "/data/cli-auth/chat";
const RPC_SECRET = "purge-regression-secret";
const BOOT_ID = "boot-purge";

/**
 * A fake TmuxIo that records every `rm` target so the test can assert the transcript purge landed.
 * `find` returns nothing (no codex jsonl candidates), so the ONLY rm from purgePrivateTranscripts
 * is the anthropic `rm -rf <transcriptGlobDir>`.
 */
function makeFakeIo(failTranscriptPurge = false): {
  io: TmuxIo;
  removedDirs: string[];
  state: { failTranscriptPurge: boolean; markerIntact: boolean };
} {
  const removedDirs: string[] = [];
  const state = { failTranscriptPurge, markerIntact: true };
  const run = vi.fn(async (cmd: string, args: readonly string[]) => {
    if (cmd === "rm") {
      removedDirs.push(args[args.length - 1]!);
      const target = args[args.length - 1]!;
      if (target === `${NEUTRAL_BASE}/u1`) state.markerIntact = false;
      return {
        code: state.failTranscriptPurge && target.includes("/.claude/projects/") ? 1 : 0,
        stdout: "",
        stderr: ""
      };
    }
    if (cmd === "find") return { code: 0, stdout: "", stderr: "" };
    // tmux (kill-session/has-session), mkdir, ls → benign ok/no-op.
    return { code: 0, stdout: "", stderr: "" };
  });
  const io: TmuxIo = {
    run: run as unknown as TmuxIo["run"],
    readFile: vi.fn().mockResolvedValue(""),
    writeFile: vi.fn().mockResolvedValue(undefined),
    sleep: vi.fn().mockResolvedValue(undefined)
  };
  return { io, removedDirs, state };
}

/** Subclass to relax the §3.1 realpath-under-/run/jarv1s guard (not writable in the sandbox). */
class TestConn extends RpcConnection {
  protected async assertSocketUnderRunDir(): Promise<void> {
    // Intentionally skipped — the guard is covered by chat-rpc-client.test.ts.
  }
}

function tmpSocket(): string {
  return join(mkdtempSync(join(tmpdir(), "jarv1s-purge-")), "cli-runner.sock");
}

describe("#744 purgeTranscripts over the real RPC path", () => {
  const servers: Server[] = [];
  const conns: RpcConnection[] = [];

  afterEach(async () => {
    for (const c of conns.splice(0)) c.close();
    await Promise.all(servers.splice(0).map((s) => new Promise<void>((r) => s.close(() => r()))));
  });

  it("purges through the resident RPC engine before kill removes neutral state", async () => {
    const { io, removedDirs } = makeFakeIo();
    const host = new CliChatEngineHost({
      io,
      neutralBase: NEUTRAL_BASE,
      singleUser: true,
      cliPresent: async () => true,
      launchTimeoutMs: 2_000
    });

    const socketPath = tmpSocket();
    const server = createServer((socket) => {
      socket.on("error", () => {});
      serveConnection(socket as unknown as ByteChannel, {
        host,
        bootId: BOOT_ID,
        secret: RPC_SECRET,
        // #1059 — ConnectionDeps now requires terminalHost; this suite never touches the
        // terminal RPC path, so a plain never-opened instance satisfies the type.
        terminalHost: new TerminalHost({ homeBase: "/tmp", toolsBinDir: "/usr/bin" })
      });
    });
    await new Promise<void>((resolve, reject) => {
      server.on("error", reject);
      server.listen(socketPath, () => resolve());
    });
    servers.push(server);

    const conn = new TestConn({
      socketPath,
      rpcSecret: RPC_SECRET,
      reconnectMinMs: 1,
      reconnectMaxMs: 2
    });
    conns.push(conn);
    const engine = new ChatEngineRpcClient("anthropic", "u1", conn);
    await engine.launch({
      neutralDir: "/api-path-ignored",
      personaPath: "/api-path-ignored/persona.md",
      personaText: "persona"
    });

    await engine.purgeTranscripts();
    await engine.kill();

    // Claude encodes the neutral cwd /data/cli-auth/chat/u1 → -data-cli-auth-chat-u1 and stores
    // transcripts under ~/.claude/projects/<encoded>. The purge MUST have rm -rf'd exactly that.
    const purgedTranscriptDir = removedDirs.some((dir) =>
      dir.endsWith("/.claude/projects/-data-cli-auth-chat-u1")
    );
    expect(purgedTranscriptDir).toBe(true);
    expect(removedDirs.findIndex((dir) => dir.includes("/.claude/projects/"))).toBeLessThan(
      removedDirs.findIndex((dir) => dir === `${NEUTRAL_BASE}/u1`)
    );
  });

  it("preserves neutral markers over RPC when purge fails", async () => {
    const { io, removedDirs, state } = makeFakeIo(true);
    const host = new CliChatEngineHost({
      io,
      neutralBase: NEUTRAL_BASE,
      singleUser: true,
      cliPresent: async () => true,
      launchTimeoutMs: 2_000
    });
    const socketPath = tmpSocket();
    const server = createServer((socket) => {
      socket.on("error", () => {});
      serveConnection(socket as unknown as ByteChannel, {
        host,
        bootId: BOOT_ID,
        secret: RPC_SECRET,
        // #1059 — ConnectionDeps now requires terminalHost; this suite never touches the
        // terminal RPC path, so a plain never-opened instance satisfies the type.
        terminalHost: new TerminalHost({ homeBase: "/tmp", toolsBinDir: "/usr/bin" })
      });
    });
    await new Promise<void>((resolve, reject) => {
      server.on("error", reject);
      server.listen(socketPath, () => resolve());
    });
    servers.push(server);
    const conn = new TestConn({ socketPath, rpcSecret: RPC_SECRET });
    conns.push(conn);
    const engine = new ChatEngineRpcClient("anthropic", "u1", conn);
    await engine.launch({
      neutralDir: "/api-path-ignored",
      personaPath: "/api-path-ignored/persona.md",
      personaText: "persona"
    });

    await expect(engine.purgeTranscripts()).rejects.toThrow();
    await engine.kill({ preserveNeutralDir: true });

    expect(removedDirs).not.toContain(`${NEUTRAL_BASE}/u1`);
    expect(state.markerIntact).toBe(true);

    // Simulate next boot: engine is gone, original marker dir survives, exact engine-less purge
    // succeeds, and only then may ordinary kill remove the neutral directory.
    state.failTranscriptPurge = false;
    await host.purgeTranscripts("u1");
    await host.kill("u1");
    expect(state.markerIntact).toBe(false);
  });
});
