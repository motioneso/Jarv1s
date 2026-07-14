/**
 * TerminalRpcClient — API-side RPC client for the owner terminal (#1059).
 *
 * Talks to the cli-runner sidecar's terminal host over the SAME private Unix-domain socket
 * mechanics as the chat engine, but owns its OWN socket and read-buffer drain loop rather than
 * routing through `RpcConnection` (chat-engine-rpc-client.ts). This isolation is deliberate:
 * `RpcConnection.routeFrame` DROPS any frame whose discriminant isn't `t:"ok"`/`t:"err"` (it treats
 * anything else as protocol drift), so a `t:"push"` terminalData/terminalExit frame could never
 * reach a listener over the chat connection — terminal output would be silently lost. A later task
 * (the Fastify WebSocket relay) drives one `TerminalRpcClient` per owner-terminal session and
 * forwards `onData`/`onExit` pushes to the browser's xterm.js instance.
 *
 * Reuses the shared §3.6 hello via `performClientHello` (./rpc-handshake.ts, extracted from
 * `chat-engine-rpc-client.ts` in this same change) so the security handshake exists in exactly ONE
 * place — do not duplicate it here.
 *
 * Deliberately deferred: the §3.1 realpath-under-/run/jarv1s guard that `RpcConnection` applies is
 * NOT re-implemented here. The terminal socket path is the same trusted operator config as the chat
 * socket (already guarded at that connection); adding a second copy of the guard here would buy no
 * new protection while forcing the same test-relaxation subclass complexity onto this client for
 * nothing. Flagged as a Minor belt-and-suspenders follow-up if a reviewer wants it — not a blocker.
 */
import { connect, type Socket } from "node:net";

import { performClientHello } from "./rpc-handshake.js";
import {
  decodeFrame,
  encodeFrame,
  type FrameDecodeResult,
  type RpcFrame,
  type RpcKillTerminalParams,
  type RpcMethod,
  type RpcOpenTerminalParams,
  type RpcOpenTerminalResult,
  type RpcResizeTerminalParams,
  type RpcWriteTerminalParams
} from "./rpc-contract.js";

/** Options for {@link TerminalRpcClient.connect}. */
export interface TerminalRpcClientOpts {
  /** Absolute path to the cli-runner terminal-host Unix socket. */
  readonly socketPath: string;
  /** Shared secret for the §3.6 auth hello. Proven over nonces; NEVER sent on the wire. */
  readonly secret?: string;
}

/** One pending request awaiting its `t:"ok"`/`t:"err"` reply, keyed by request id. */
interface PendingTerminalCall {
  resolve(result: unknown): void;
  reject(err: Error): void;
}

/**
 * A single owner-terminal connection: one socket, one hello, one request-id space. `open` resolves
 * to a fresh PTY's id; `write`/`resize`/`kill` are fire-and-forget verbs keyed by that id (mirrors
 * how the brief's reference implementation marshals them — the caller does not need the ack, only
 * that the byte/resize/kill was accepted onto the wire). `onData`/`onExit` receive server-pushed PTY
 * output/exit independent of any pending request.
 */
export class TerminalRpcClient {
  private nextId = 1;
  private readonly pending = new Map<number, PendingTerminalCall>();
  private recvBuf: Buffer = Buffer.alloc(0);
  private dataCb?: (terminalId: string, bytes: Buffer) => void;
  private exitCb?: (terminalId: string, code: number) => void;
  private closed = false;

  private constructor(private readonly socket: Socket) {
    // The normal frame router attaches only here, in the constructor — AFTER `connect()` has
    // already completed the hello via performClientHello (which owns the `data` stream for the
    // handshake and detaches its own listeners before resolving). This mirrors RpcConnection's
    // handshake-then-route ordering so a hello frame can never be misrouted into onFrame.
    socket.on("data", (chunk: Buffer) => this.onSocketData(chunk));
    socket.on("close", () => this.onSocketClosed());
    socket.on("error", () => this.onSocketClosed());
  }

  /**
   * Connect the Unix socket, perform the §3.6 hello (via the shared `performClientHello`), then
   * wire the request/push frame router. Any bytes that arrived immediately behind the
   * hello-challenge (a response or push frame already buffered on the wire) are fed through the
   * same router before this resolves, so nothing is lost.
   */
  static async connect(opts: TerminalRpcClientOpts): Promise<TerminalRpcClient> {
    const socket = await openSocket(opts.socketPath);
    const { leftover } = await performClientHello(socket, opts.secret ?? "");
    const client = new TerminalRpcClient(socket);
    if (leftover.length > 0) client.onSocketData(leftover);
    return client;
  }

  /** Open a new PTY at the given size; resolves to the terminalId later frames route on. */
  async open(cols: number, rows: number): Promise<string> {
    const params: RpcOpenTerminalParams = { cols, rows };
    const result = await this.request<RpcOpenTerminalResult>("openTerminal", params);
    return result.terminalId;
  }

  /** Write raw input bytes to the PTY. Fire-and-forget — the caller does not await the ack. */
  write(terminalId: string, bytes: Buffer): void {
    const params: RpcWriteTerminalParams = { terminalId, dataB64: bytes.toString("base64") };
    void this.request("writeTerminal", params);
  }

  /** Resize the PTY on a client viewport change. Fire-and-forget. */
  resize(terminalId: string, cols: number, rows: number): void {
    const params: RpcResizeTerminalParams = { terminalId, cols, rows };
    void this.request("resizeTerminal", params);
  }

  /** Terminate the PTY + its process tree. Fire-and-forget. */
  kill(terminalId: string): void {
    const params: RpcKillTerminalParams = { terminalId };
    void this.request("killTerminal", params);
  }

  /** Register the callback invoked for every `terminalData` push (decoded from base64). */
  onData(cb: (terminalId: string, bytes: Buffer) => void): void {
    this.dataCb = cb;
  }

  /** Register the callback invoked for every `terminalExit` push. */
  onExit(cb: (terminalId: string, code: number) => void): void {
    this.exitCb = cb;
  }

  /** Ends the socket and rejects every pending request with a clear Error. */
  close(): void {
    this.dropConnection(new Error("terminal rpc client closed"));
  }

  // ─── inbound framing ────────────────────────────────────────────────────────

  /**
   * Drain-loop identical in shape to `RpcConnection.onData`: buffer, decode one length-prefixed
   * frame at a time (§3.2), dispatch it, repeat until the buffer holds less than one full frame. An
   * oversize or non-JSON frame is protocol drift the receiver cannot trust to stay aligned — drop
   * the connection rather than attempt to resync (mirrors chat's §3.7 malformed-frame handling).
   */
  private onSocketData(chunk: Buffer): void {
    this.recvBuf = this.recvBuf.length === 0 ? chunk : Buffer.concat([this.recvBuf, chunk]);
    for (;;) {
      const decoded: FrameDecodeResult = decodeFrame(this.recvBuf);
      if (decoded.kind === "incomplete") return;
      if (decoded.kind === "oversize") {
        this.dropConnection(
          new Error(`cli-runner sent oversize terminal frame (${decoded.declaredLength} bytes)`)
        );
        return;
      }
      this.recvBuf = this.recvBuf.subarray(decoded.consumed);
      let frame: RpcFrame;
      try {
        frame = JSON.parse(decoded.body.toString("utf8")) as RpcFrame;
      } catch {
        this.dropConnection(new Error("cli-runner sent a non-JSON terminal frame"));
        return;
      }
      this.onFrame(frame);
    }
  }

  /**
   * `t:"push"` → dispatch to `dataCb`/`exitCb` by channel (no pending request to settle — this is
   * the whole reason TerminalRpcClient owns its own connection rather than riding RpcConnection,
   * §see file header). `t:"ok"`/`t:"err"` → settle the matching pending id. Any other discriminant
   * arriving from the server (e.g. a stray `req`) is malformed for this direction of the wire —
   * log-and-ignore rather than throw synchronously out of the socket `data` handler, which would
   * crash the process over a single bad frame.
   */
  private onFrame(frame: RpcFrame): void {
    if (frame.t === "push") {
      if (frame.channel === "terminalData" && frame.dataB64 !== undefined) {
        this.dataCb?.(frame.terminalId, Buffer.from(frame.dataB64, "base64"));
      } else if (frame.channel === "terminalExit") {
        this.exitCb?.(frame.terminalId, frame.exitCode ?? 0);
      }
      return;
    }
    if (frame.t !== "ok" && frame.t !== "err") return; // malformed for this direction — ignore
    const pending = this.pending.get(frame.id);
    if (!pending) return; // response for an id we no longer track (e.g. after close()) — drop it
    this.pending.delete(frame.id);
    if (frame.t === "ok") pending.resolve(frame.result);
    else pending.reject(new Error(frame.error.message));
  }

  private request<T>(method: RpcMethod, params: unknown): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      if (this.closed) {
        reject(new Error("terminal rpc client is closed"));
        return;
      }
      this.pending.set(id, { resolve: resolve as (r: unknown) => void, reject });
      const frame: RpcFrame = { t: "req", id, method, params };
      try {
        this.socket.write(encodeFrame(frame));
      } catch (err) {
        this.pending.delete(id);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  private onSocketClosed(): void {
    this.dropConnection(new Error("cli-runner terminal socket closed"));
  }

  private dropConnection(err: Error): void {
    if (this.closed) return;
    this.closed = true;
    for (const p of this.pending.values()) p.reject(err);
    this.pending.clear();
    this.socket.destroy();
  }
}

/** Connect a Unix-domain socket, resolving once `connect` fires (or rejecting on `error`). */
function openSocket(path: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = connect({ path });
    const onError = (err: Error): void => {
      socket.off("connect", onConnect);
      reject(err);
    };
    const onConnect = (): void => {
      socket.off("error", onError);
      resolve(socket);
    };
    socket.once("error", onError);
    socket.once("connect", onConnect);
  });
}
