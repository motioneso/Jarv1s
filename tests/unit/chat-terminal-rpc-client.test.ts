/**
 * Unit test for TerminalRpcClient (#1059): resolves `open()` from an RpcOk and routes a
 * `t:"push"` terminalData frame to `onData` — the exact behavior `RpcConnection.routeFrame` cannot
 * provide (it drops any frame whose discriminant isn't `t:"ok"`/`t:"err"`, §3.7), which is why the
 * owner terminal gets its own dedicated connection instead of riding the chat RPC connection.
 *
 * Mirrors the real in-process `net.createServer` Unix-socket fake-server pattern from
 * tests/unit/chat-rpc-client.test.ts (task-5 controller corrections §3) rather than inventing an
 * injectable in-memory paired-channel seam.
 */
import { createHmac, randomBytes } from "node:crypto";
import { createServer, type Server, type Socket } from "node:net";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  decodeFrame,
  encodeFrame,
  HELLO_PROOF_TAG_CLIENT,
  HELLO_PROOF_TAG_SERVER,
  type RpcFrame
} from "../../packages/chat/src/live/rpc-contract.js";
import { TerminalRpcClient } from "../../packages/chat/src/live/terminal-rpc-client.js";

const HMAC = (secret: string, msg: string): string =>
  createHmac("sha256", secret).update(msg, "utf8").digest("hex");

function tmpSocket(): string {
  return join(mkdtempSync(join(tmpdir(), "jarv1s-terminal-rpc-")), "cli-runner-terminal.sock");
}

/**
 * A minimal in-process terminal-host fake server: performs the SERVER half of the §3.6 hello, then
 * on an `openTerminal` request replies with an RpcOk `{terminalId:"t"}` immediately followed by an
 * unsolicited `t:"push"` terminalData frame — the same server-initiated shape a real cli-runner
 * terminal host uses to stream PTY output back to the client.
 */
function startFakeTerminalServer(socketPath: string, secret: string): Promise<Server> {
  const server = createServer((sock: Socket) => {
    let buf: Buffer = Buffer.alloc(0);
    let handshook = false;
    let clientNonce = "";
    let serverNonce = "";

    // Ignore write races (client may destroy the socket on close()); mirrors chat-rpc-client.test.ts.
    sock.on("error", () => {});
    const send = (frame: unknown): void => {
      if (sock.destroyed || !sock.writable) return;
      sock.write(encodeFrame(frame as RpcFrame));
    };

    sock.on("data", (chunk: Buffer) => {
      buf = Buffer.concat([buf, chunk]);
      for (;;) {
        const decoded = decodeFrame(buf);
        if (decoded.kind !== "frame") return;
        buf = buf.subarray(decoded.consumed);
        const frame = JSON.parse(decoded.body.toString("utf8"));

        if (!handshook) {
          if (frame.t === "hello") {
            clientNonce = frame.clientNonce;
            serverNonce = randomBytes(32).toString("hex");
            const serverProof = HMAC(secret, HELLO_PROOF_TAG_SERVER + clientNonce);
            send({ t: "hello-challenge", serverProof, serverNonce });
          } else if (frame.t === "hello-response") {
            const expected = HMAC(secret, HELLO_PROOF_TAG_CLIENT + serverNonce);
            if (frame.clientProof !== expected) {
              sock.destroy();
              return;
            }
            handshook = true;
          }
          continue;
        }

        if (frame.t === "req" && frame.method === "openTerminal") {
          send({ t: "ok", id: frame.id, bootId: "boot-t", result: { terminalId: "t" } });
          send({
            t: "push",
            bootId: "boot-t",
            channel: "terminalData",
            terminalId: "t",
            dataB64: Buffer.from("xyz").toString("base64")
          });
        }
      }
    });
  });
  return new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(socketPath, () => resolve(server));
  });
}

describe("TerminalRpcClient (#1059)", () => {
  const servers: Server[] = [];
  const clients: TerminalRpcClient[] = [];

  afterEach(async () => {
    for (const c of clients.splice(0)) c.close();
    await Promise.all(servers.splice(0).map((s) => new Promise<void>((r) => s.close(() => r()))));
  });

  it("resolves open() from RpcOk and surfaces terminalData pushes via onData", async () => {
    const secret = "test-secret";
    const socketPath = tmpSocket();
    const server = await startFakeTerminalServer(socketPath, secret);
    servers.push(server);

    const client = await TerminalRpcClient.connect({ socketPath, secret });
    clients.push(client);

    const received: Array<{ terminalId: string; bytes: Buffer }> = [];
    client.onData((terminalId, bytes) => {
      received.push({ terminalId, bytes });
    });

    const terminalId = await client.open(80, 24);
    expect(terminalId).toBe("t");

    // The push frame is written by the server right after the RpcOk; give the event loop a short
    // tick to deliver it before asserting (mirrors the reconciliation-tick pattern used elsewhere).
    await new Promise((r) => setTimeout(r, 20));

    expect(received).toHaveLength(1);
    expect(received[0]?.terminalId).toBe("t");
    expect(received[0]?.bytes).toEqual(Buffer.from("xyz"));
  });

  // #1059 [T5] — write/resize/kill are fire-and-forget: the caller never awaits their promise
  // (see the class doc). Before this fix, a promise rejecting AFTER close()/dropConnection (every
  // pending request rejects there, see `dropConnection`) had no handler attached, which is an
  // unhandled rejection under Node's default policy. Proves the `.catch(() => {})` added to all
  // three actually swallows a post-close rejection rather than leaving it unhandled.
  it("write/resize/kill after close() reject internally without raising an unhandledRejection", async () => {
    const secret = "test-secret";
    const socketPath = tmpSocket();
    const server = await startFakeTerminalServer(socketPath, secret);
    servers.push(server);

    const client = await TerminalRpcClient.connect({ socketPath, secret });
    // Deliberately NOT pushed to `clients` — this test closes it manually before the shared
    // afterEach hook runs, so afterEach's `c.close()` isn't exercised twice on the same client.

    const unhandled: unknown[] = [];
    const onUnhandledRejection = (reason: unknown): void => {
      unhandled.push(reason);
    };
    process.on("unhandledRejection", onUnhandledRejection);

    try {
      client.close(); // rejects every pending/future request via dropConnection

      // Fire-and-forget calls AFTER close() — each internally rejects immediately ("terminal rpc
      // client is closed"). Pre-fix, these three void-returned promises had no rejection handler.
      client.write("t", Buffer.from("x"));
      client.resize("t", 80, 24);
      client.kill("t");

      // Let any unhandled rejection surface on the microtask/event-loop queue before asserting.
      await new Promise((r) => setTimeout(r, 20));

      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandledRejection);
    }
  });
});
