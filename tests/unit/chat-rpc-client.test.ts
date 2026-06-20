/**
 * Unit tests for the api-side RPC client (#342, Lane A): length-prefixed framing encode/decode,
 * id-matching over one connection, the §3.6 mutual challenge-response hello, §5.6 bootId-change
 * reconciliation, malformed-frame-closes vs bad_request-stays-open (§3.7), and the §3.1 realpath
 * rejection of a socket outside /run/jarv1s.
 *
 * The hello + round-trip tests run against a tiny in-process Unix-socket FAKE SERVER that speaks the
 * frozen wire protocol. Because the realpath guard (§3.1) requires the socket to live under
 * /run/jarv1s — which is not writable in a unit-test sandbox — those tests construct the
 * RpcConnection with the guard relaxed by pointing it at a real temp socket and asserting the guard
 * separately. The pure framing/error tests need no socket at all.
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
  MAX_FRAME_BYTES,
  FRAME_HEADER_BYTES,
  HELLO_PROOF_TAG_CLIENT,
  HELLO_PROOF_TAG_SERVER,
  type RpcFrame
} from "../../packages/chat/src/live/rpc-contract.js";
import {
  RpcConnection,
  mapRpcError,
  SOCKET_ALLOWED_DIR
} from "../../packages/chat/src/live/chat-engine-rpc-client.js";
import { CliChatUnavailableError } from "../../packages/chat/src/live/errors.js";

// ──────────────────────────────────────────────────────────────────────────────
// §3.2 framing encode/decode
// ──────────────────────────────────────────────────────────────────────────────

describe("rpc framing (§3.2)", () => {
  it("round-trips a frame through encode → decode", () => {
    const frame: RpcFrame = {
      t: "req",
      id: 7,
      method: "submit",
      sessionKey: "u1",
      params: { text: "hi" }
    };
    const buf = encodeFrame(frame);
    expect(buf.readUInt32BE(0)).toBe(buf.length - FRAME_HEADER_BYTES);

    const decoded = decodeFrame(buf);
    expect(decoded.kind).toBe("frame");
    if (decoded.kind !== "frame") throw new Error("unreachable");
    expect(JSON.parse(decoded.body.toString("utf8"))).toEqual(frame);
    expect(decoded.consumed).toBe(buf.length);
  });

  it("round-trips multi-line transcript text without delimiter ambiguity", () => {
    const text = 'line one\nline two\n\twith tabs\n{"json":true}\nend';
    const frame: RpcFrame = {
      t: "ok",
      id: 1,
      bootId: "boot-a",
      result: { records: [{ kind: "reply", text }], offset: 42, complete: true }
    };
    const decoded = decodeFrame(encodeFrame(frame));
    if (decoded.kind !== "frame") throw new Error("expected a frame");
    const parsed = JSON.parse(decoded.body.toString("utf8")) as {
      result: { records: { text: string }[] };
    };
    expect(parsed.result.records[0]?.text).toBe(text);
  });

  it("returns incomplete until the full prefix + body are buffered (fragmentation)", () => {
    const buf = encodeFrame({
      t: "kill",
      id: 1,
      bootId: "b",
      result: undefined
    } as unknown as RpcFrame);
    // Only the first 2 header bytes → incomplete.
    expect(decodeFrame(buf.subarray(0, 2)).kind).toBe("incomplete");
    // Header present but body truncated → incomplete.
    expect(decodeFrame(buf.subarray(0, FRAME_HEADER_BYTES + 1)).kind).toBe("incomplete");
    // Whole frame → frame.
    expect(decodeFrame(buf).kind).toBe("frame");
  });

  it("decodes two concatenated frames one at a time", () => {
    const a = encodeFrame({ t: "req", id: 1, method: "isAlive", sessionKey: "u", params: {} });
    const b = encodeFrame({ t: "req", id: 2, method: "kill", sessionKey: "u", params: {} });
    let buf = Buffer.concat([a, b]);

    const first = decodeFrame(buf);
    if (first.kind !== "frame") throw new Error("expected first frame");
    expect(JSON.parse(first.body.toString("utf8")).id).toBe(1);
    buf = buf.subarray(first.consumed);

    const second = decodeFrame(buf);
    if (second.kind !== "frame") throw new Error("expected second frame");
    expect(JSON.parse(second.body.toString("utf8")).id).toBe(2);
    expect(buf.subarray(second.consumed).length).toBe(0);
  });

  it("reports oversize when the declared length exceeds MAX_FRAME_BYTES (§3.7 → close)", () => {
    const header = Buffer.allocUnsafe(FRAME_HEADER_BYTES);
    header.writeUInt32BE(MAX_FRAME_BYTES + 1, 0);
    const decoded = decodeFrame(header);
    expect(decoded.kind).toBe("oversize");
    if (decoded.kind === "oversize") expect(decoded.declaredLength).toBe(MAX_FRAME_BYTES + 1);
  });

  it("encodeFrame throws on an un-framable oversize body", () => {
    const huge = "x".repeat(MAX_FRAME_BYTES + 10);
    expect(() =>
      encodeFrame({ t: "submit", id: 1, bootId: "b", result: { huge } } as unknown as RpcFrame)
    ).toThrow();
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// §4.7 error mapping
// ──────────────────────────────────────────────────────────────────────────────

describe("rpc error mapping (§4.7)", () => {
  it("maps unavailable + not_launched to a retryable CliChatUnavailableError", () => {
    expect(mapRpcError("unavailable", "down")).toBeInstanceOf(CliChatUnavailableError);
    expect(mapRpcError("not_launched", "no engine")).toBeInstanceOf(CliChatUnavailableError);
  });

  it("maps bad_request + internal to a plain Error", () => {
    expect(mapRpcError("bad_request", "bad offset")).toBeInstanceOf(Error);
    expect(mapRpcError("bad_request", "bad offset")).not.toBeInstanceOf(CliChatUnavailableError);
    expect(mapRpcError("internal", "boom")).not.toBeInstanceOf(CliChatUnavailableError);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// §3.1 realpath rejection of an out-of-dir socket path
// ──────────────────────────────────────────────────────────────────────────────

describe("rpc socket realpath guard (§3.1)", () => {
  it("exposes the allowed dir", () => {
    expect(SOCKET_ALLOWED_DIR).toBe("/run/jarv1s");
  });

  it("rejects (CliChatUnavailableError, no connect) a socket path outside /run/jarv1s", async () => {
    const conn = new RpcConnection({
      socketPath: "/tmp/evil/cli-runner.sock",
      rpcSecret: "secret",
      reconnectMinMs: 1,
      reconnectMaxMs: 2
    });
    await expect(conn.ensureConnected()).rejects.toBeInstanceOf(CliChatUnavailableError);
    conn.close();
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// §3.6 hello + §3.4 id-matching + §5.6 bootId — against an in-process fake server
// ──────────────────────────────────────────────────────────────────────────────

const HMAC = (secret: string, msg: string): string =>
  createHmac("sha256", secret).update(msg, "utf8").digest("hex");

interface FakeServerOpts {
  /** Override the bootId returned for the Nth (0-based) ok response. Lets a test flip bootId mid-stream. */
  readonly bootIdFor?: (callIndex: number) => string;
  /** If set, the server returns a wrong serverProof (imposter) so the client must abort the hello. */
  readonly imposter?: boolean;
  /** Per-request handler → the `result` to return (or a thrown {code,message} for an err frame). */
  readonly onRequest?: (req: { method: string; id: number; params: unknown }) => unknown;
}

/**
 * A minimal in-process cli-runner server speaking the frozen protocol: it performs the server side of
 * the §3.6 hello, then answers each RpcRequest with an RpcOk (or RpcErr) carrying a bootId.
 */
function startFakeServer(
  socketPath: string,
  secret: string,
  opts: FakeServerOpts = {}
): Promise<Server> {
  let callIndex = 0;
  const server = createServer((sock: Socket) => {
    let buf: Buffer<ArrayBufferLike> = Buffer.alloc(0);
    let handshook = false;
    let clientNonce = "";

    const send = (frame: unknown): void => {
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
            const serverNonce = randomBytes(32).toString("hex");
            const serverProof = opts.imposter
              ? "00".repeat(32)
              : HMAC(secret, HELLO_PROOF_TAG_SERVER + clientNonce);
            send({ t: "hello-challenge", serverProof, serverNonce });
            (sock as unknown as { _serverNonce: string })._serverNonce = serverNonce;
          } else if (frame.t === "hello-response") {
            const serverNonce = (sock as unknown as { _serverNonce: string })._serverNonce;
            const expected = HMAC(secret, HELLO_PROOF_TAG_CLIENT + serverNonce);
            if (frame.clientProof !== expected) {
              sock.destroy();
              return;
            }
            handshook = true;
          }
          continue;
        }

        // Post-handshake: answer the request.
        const bootId = opts.bootIdFor ? opts.bootIdFor(callIndex) : "boot-fixed";
        callIndex += 1;
        try {
          const result = opts.onRequest
            ? opts.onRequest({ method: frame.method, id: frame.id, params: frame.params })
            : { ok: true };
          send({ t: "ok", id: frame.id, bootId, result });
        } catch (e) {
          const err = e as { code?: string; message?: string };
          send({
            t: "err",
            id: frame.id,
            bootId,
            error: { code: err.code ?? "internal", message: err.message ?? "err" }
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

describe("RpcConnection hello + id-matching + bootId (in-process socket)", () => {
  const servers: Server[] = [];
  const conns: RpcConnection[] = [];

  afterEach(async () => {
    for (const c of conns.splice(0)) c.close();
    await Promise.all(servers.splice(0).map((s) => new Promise<void>((r) => s.close(() => r()))));
  });

  function tmpSocket(): string {
    return join(mkdtempSync(join(tmpdir(), "jarv1s-rpc-")), "cli-runner.sock");
  }

  /**
   * The §3.1 realpath guard requires the socket under /run/jarv1s, which is not writable in a unit
   * sandbox. The guard is verified independently in the realpath test above; here we subclass to relax
   * it so the socket-backed tests can bind a temp socket and exercise the hello + framing + bootId.
   */
  class TestConn extends RpcConnection {
    protected async assertSocketUnderRunDir(): Promise<void> {
      // Intentionally skipped for socket-backed tests (guard covered separately).
    }
  }

  it("completes the §3.6 hello with the correct secret and round-trips submit (id-matched)", async () => {
    const secret = "shared-secret";
    const socketPath = tmpSocket();
    const server = await startFakeServer(socketPath, secret, {
      onRequest: ({ method, params }) => {
        if (method === "submit") {
          expect((params as { text: string }).text).toBe("hello");
          return { ok: true };
        }
        return { ok: true };
      }
    });
    servers.push(server);
    const conn = new TestConn({
      socketPath,
      rpcSecret: secret,
      reconnectMinMs: 1,
      reconnectMaxMs: 2
    });
    conns.push(conn);

    const res = await conn.submit("u1", { text: "hello" });
    expect(res).toEqual({ ok: true });
  });

  it("aborts the hello (no token sent) when the server proof is wrong (imposter peer, §3.6)", async () => {
    const secret = "shared-secret";
    const socketPath = tmpSocket();
    const server = await startFakeServer(socketPath, secret, { imposter: true });
    servers.push(server);
    const conn = new TestConn({
      socketPath,
      rpcSecret: secret,
      reconnectMinMs: 1,
      reconnectMaxMs: 2
    });
    conns.push(conn);

    // The client verifies serverProof BEFORE replying; a mismatch closes and the connect retries
    // forever against the imposter, so ensureConnected never resolves — assert it times out pending.
    const settled = await Promise.race([
      conn
        .ensureConnected()
        .then(() => "connected")
        .catch(() => "rejected"),
      new Promise<string>((r) => setTimeout(() => r("pending"), 150))
    ]);
    expect(settled).toBe("pending");
  });

  it("matches out-of-order responses by id over one connection (§3.4)", async () => {
    const secret = "s";
    const socketPath = tmpSocket();
    const server = await startFakeServer(socketPath, secret, {
      onRequest: ({ method }) => (method === "isAlive" ? { alive: true } : { ok: true })
    });
    servers.push(server);
    const conn = new TestConn({
      socketPath,
      rpcSecret: secret,
      reconnectMinMs: 1,
      reconnectMaxMs: 2
    });
    conns.push(conn);

    const [a, b] = await Promise.all([conn.isAlive("u1"), conn.kill("u2")]);
    expect(a).toEqual({ alive: true });
    expect(b).toEqual({ ok: true });
  });

  it("fires reconciliation on a §5.6 bootId change", async () => {
    const secret = "s";
    const socketPath = tmpSocket();
    let reconciles = 0;
    // First response carries boot-1; every later response carries boot-2 (silent restart).
    const server = await startFakeServer(socketPath, secret, {
      bootIdFor: (i) => (i === 0 ? "boot-1" : "boot-2")
    });
    servers.push(server);
    const conn = new TestConn({
      socketPath,
      rpcSecret: secret,
      reconnectMinMs: 1,
      reconnectMaxMs: 2,
      onReconcile: async () => {
        reconciles += 1;
      }
    });
    conns.push(conn);

    // First call connects (reconcile #1 fires on connect) and records boot-1.
    await conn.isAlive("u1");
    const afterConnect = reconciles;
    // Second call returns boot-2 → bootId change → reconcile fires again.
    await conn.isAlive("u1");
    // Give the async reconcile microtask a tick to run.
    await new Promise((r) => setTimeout(r, 20));
    expect(reconciles).toBeGreaterThan(afterConnect);
  });

  it("rejects an in-flight call with CliChatUnavailableError when the server returns unavailable (§4.7)", async () => {
    const secret = "s";
    const socketPath = tmpSocket();
    const server = await startFakeServer(socketPath, secret, {
      onRequest: () => {
        throw { code: "unavailable", message: "multiplexer down" };
      }
    });
    servers.push(server);
    const conn = new TestConn({
      socketPath,
      rpcSecret: secret,
      reconnectMinMs: 1,
      reconnectMaxMs: 2
    });
    conns.push(conn);

    await expect(conn.submit("u1", { text: "x" })).rejects.toBeInstanceOf(CliChatUnavailableError);
  });
});
