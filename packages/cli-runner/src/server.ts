/**
 * CliRunnerServer — binds the private Unix-domain socket (§3.1), runs the startup
 * CLEAN-SLATE sweep BEFORE accepting connections (§4.1.0a/§6.5), and serves each
 * accepted connection through `serveConnection`.
 *
 * Bind hygiene (§3.1): unlink a stale socket path before listen; REFUSE to bind if the
 * path resolves outside the socket dir (`/run/jarv1s` by default). The socket file is
 * created `0600`; the containing dir is `0700` (the root-init chowns/creates it, but we
 * defensively chmod here too).
 */

import { createServer, type Server, type Socket } from "node:net";
import { mkdir, chmod, realpath, unlink, stat } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";

import { serveConnection, type ByteChannel } from "./connection.js";
import type { CliChatEngineHost } from "./engine-host.js";

export interface CliRunnerServerDeps {
  readonly host: CliChatEngineHost;
  /** Absolute socket path (`JARVIS_CLI_RUNNER_SOCKET`, §3.1). */
  readonly socketPath: string;
  /** The directory the socket MUST resolve under (`/run/jarv1s` default, §3.1). */
  readonly socketDir: string;
  /** Shared RPC secret (`JARVIS_CLI_RUNNER_RPC_SECRET`, §3.6). Unset ⇒ all hellos close. */
  readonly secret: string | undefined;
  readonly log?: (msg: string) => void;
}

export class CliRunnerServer {
  /** Fresh per-process bootId, stamped on every response so the api detects a restart (§5.6). */
  readonly bootId: string = randomUUID();
  private server: Server | null = null;

  constructor(private readonly deps: CliRunnerServerDeps) {}

  /** Run the startup sweep, then bind + listen. Resolves once listening. */
  async start(): Promise<void> {
    // (1) CLEAN-SLATE sweep BEFORE accepting connections (§4.1.0a (2) / §6.5).
    await this.deps.host.startupSweep();

    // (2) socket dir hygiene: ensure dir exists `0700`.
    await mkdir(this.deps.socketDir, { recursive: true, mode: 0o700 });
    await chmod(this.deps.socketDir, 0o700).catch(() => undefined);

    // (3) refuse to bind outside the socket dir (§3.1) — realpath the DIR (the socket
    // file doesn't exist yet, so realpath the parent and compare).
    await this.assertSocketUnderDir();

    // (4) unlink a stale socket from an unclean shutdown (§3.1).
    await unlink(this.deps.socketPath).catch(() => undefined);

    const server = createServer((socket: Socket) => this.onConnection(socket));
    this.server = server;

    await new Promise<void>((resolveListen, reject) => {
      server.once("error", reject);
      server.listen(this.deps.socketPath, () => {
        server.off("error", reject);
        resolveListen();
      });
    });

    // (5) lock the socket file down to `0600` (same-UID readers are kept out by the
    // §3.6 hello, but other UIDs are kept out by the perms + private volume, §3.1).
    await chmod(this.deps.socketPath, 0o600).catch(() => undefined);
    this.deps.log?.(`[cli-runner] listening on ${this.deps.socketPath} (boot ${this.bootId})`);
  }

  private onConnection(socket: Socket): void {
    socket.on("error", () => {
      // swallow — serveConnection registers its own close handler.
    });
    const channel: ByteChannel = socket as unknown as ByteChannel;
    serveConnection(channel, {
      host: this.deps.host,
      bootId: this.bootId,
      secret: this.deps.secret
    });
  }

  /**
   * Defend the client/server against a redirected socket path (§3.1): the resolved
   * parent of the socket path MUST be the configured socket dir (realpath both, then
   * prefix-check). Throws if the socket would land outside the dir.
   */
  private async assertSocketUnderDir(): Promise<void> {
    const parent = dirname(resolve(this.deps.socketPath));
    let realParent: string;
    let realDir: string;
    try {
      realParent = await realpath(parent);
    } catch {
      realParent = parent;
    }
    try {
      realDir = await realpath(this.deps.socketDir);
    } catch {
      realDir = resolve(this.deps.socketDir);
    }
    const normalizedDir = realDir.endsWith(sep) ? realDir.slice(0, -1) : realDir;
    if (realParent !== normalizedDir) {
      throw new Error(
        `refusing to bind: socket path ${this.deps.socketPath} resolves outside ${this.deps.socketDir}`
      );
    }
    // Sanity: the dir must be a directory.
    const dirStat = await stat(realDir).catch(() => null);
    if (dirStat && !dirStat.isDirectory()) {
      throw new Error(`refusing to bind: ${this.deps.socketDir} is not a directory`);
    }
  }

  async stop(): Promise<void> {
    const server = this.server;
    this.server = null;
    if (!server) return;
    await new Promise<void>((res) => server.close(() => res()));
    await unlink(this.deps.socketPath).catch(() => undefined);
  }
}
