/**
 * §3.6 mutual challenge-response CLIENT hello — the shared handshake helper (#1059).
 *
 * Extracted from `RpcConnection.performHello` in `chat-engine-rpc-client.ts` so the security
 * handshake exists in exactly ONE place. Before this extraction the owner-terminal client
 * (`terminal-rpc-client.ts`) had nowhere to get the hello from except copy-pasting it — a
 * duplicated security handshake is a review-blocking defect (the two copies WILL drift, and a
 * drifted copy silently weakens whichever one falls behind). Both `RpcConnection` (chat) and
 * `TerminalRpcClient` (owner terminal) now call this one function.
 *
 * Performs the client half of the handshake on an ALREADY-CONNECTED socket:
 *   1. sends `clientNonce`;
 *   2. receives `serverProof` + `serverNonce`, and VERIFIES `serverProof` = HMAC(secret,"S"+clientNonce)
 *      BEFORE sending anything else — a wrong/absent proof aborts (never reveal that we hold the
 *      secret to an imposter peer by continuing the exchange);
 *   3. sends `clientProof` = HMAC(secret,"C"+serverNonce).
 * The shared secret itself is NEVER put on the wire — only HMAC proofs over exchanged nonces.
 *
 * The handshake reader owns the socket's `data` stream for exactly this exchange; the caller's own
 * frame router must not be attached until AFTER this resolves (mirrors the pre-extraction ordering
 * in `RpcConnection.connectOnce`). Because a response (or, for the terminal client, a push) frame
 * may already have arrived on the wire directly behind the hello-challenge, any such bytes are
 * returned as `leftover` for the caller to prepend to its own read buffer before draining it.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { Socket } from "node:net";

import { CliChatUnavailableError } from "./errors.js";
import {
  decodeFrame,
  encodeFrame,
  HELLO_PROOF_TAG_CLIENT,
  HELLO_PROOF_TAG_SERVER,
  type FrameDecodeResult,
  type RpcHelloChallenge
} from "./rpc-contract.js";

/** Width of the random hex nonces exchanged in the auth hello (§3.6) — 32 bytes. */
const NONCE_BYTES = 32;

/**
 * Performs the §3.6 client half of the mutual challenge-response hello on an already-connected
 * socket. Returns any bytes that arrived AFTER the hello-challenge frame so the caller can prepend
 * them to its own read buffer. Throws `CliChatUnavailableError` on the same failure conditions the
 * pre-extraction `performHello` threw (no secret / malformed challenge / server proof mismatch /
 * early close / oversize / bad JSON).
 */
export async function performClientHello(
  socket: Socket,
  rpcSecret: string
): Promise<{ leftover: Buffer }> {
  if (!rpcSecret) {
    socket.destroy();
    throw new CliChatUnavailableError("JARVIS_CLI_RUNNER_RPC_SECRET is not set");
  }
  const clientNonce = randomBytes(NONCE_BYTES).toString("hex");
  const expectedServerProof = hmacHex(rpcSecret, HELLO_PROOF_TAG_SERVER + clientNonce);

  // Read the single hello-challenge frame off the raw stream (before normal frame routing starts).
  const challengePromise = readSingleHandshakeFrame(socket);
  socket.write(encodeFrame({ t: "hello", clientNonce }));

  const { frame: challenge, leftover } = await challengePromise;
  if (!isHelloChallenge(challenge)) {
    socket.destroy();
    throw new CliChatUnavailableError("cli-runner hello: missing or malformed challenge");
  }
  // VERIFY the server's proof BEFORE sending our proof — abort if wrong (§3.6).
  if (!constantTimeHexEqual(challenge.serverProof, expectedServerProof)) {
    socket.destroy();
    throw new CliChatUnavailableError("cli-runner hello: server proof mismatch (imposter peer)");
  }
  const clientProof = hmacHex(rpcSecret, HELLO_PROOF_TAG_CLIENT + challenge.serverNonce);
  socket.write(encodeFrame({ t: "hello-response", clientProof }));
  // The server proceeds straight to request/response (+ push, for the terminal client) framing on
  // success, or closes silently on a bad clientProof (surfaced to the caller as a socket close).
  return { leftover };
}

/**
 * Read exactly one length-prefixed frame off the socket during the handshake, before the caller's
 * normal `data` handler takes over routing. Buffers fragmented reads (§3.2). Resolves with the
 * parsed JSON frame AND any trailing bytes already buffered behind it (`leftover`), or rejects on a
 * malformed/oversize frame or an early close.
 */
function readSingleHandshakeFrame(socket: Socket): Promise<{ frame: unknown; leftover: Buffer }> {
  return new Promise((resolve, reject) => {
    let buf: Buffer = Buffer.alloc(0);
    const onData = (chunk: Buffer): void => {
      buf = buf.length === 0 ? chunk : Buffer.concat([buf, chunk]);
      const decoded: FrameDecodeResult = decodeFrame(buf);
      if (decoded.kind === "incomplete") return;
      cleanup();
      if (decoded.kind === "oversize") {
        reject(new CliChatUnavailableError("cli-runner hello: oversize frame"));
        return;
      }
      const leftover = buf.subarray(decoded.consumed);
      try {
        resolve({ frame: JSON.parse(decoded.body.toString("utf8")) as unknown, leftover });
      } catch (err) {
        reject(new CliChatUnavailableError("cli-runner hello: invalid JSON", { cause: err }));
      }
    };
    const onClose = (): void => {
      cleanup();
      reject(new CliChatUnavailableError("cli-runner closed during hello"));
    };
    const cleanup = (): void => {
      socket.off("data", onData);
      socket.off("error", onClose);
      socket.off("close", onClose);
    };
    socket.on("data", onData);
    socket.on("error", onClose);
    socket.on("close", onClose);
  });
}

function hmacHex(secret: string, message: string): string {
  return createHmac("sha256", secret).update(message, "utf8").digest("hex");
}

/** Constant-time compare of two hex strings of equal expected length (§3.6). */
function constantTimeHexEqual(a: string, b: string): boolean {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  const ba = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  if (ba.length !== bb.length || ba.length === 0) return false;
  return timingSafeEqual(ba, bb);
}

function isHelloChallenge(frame: unknown): frame is RpcHelloChallenge {
  return (
    typeof frame === "object" &&
    frame !== null &&
    (frame as { t?: unknown }).t === "hello-challenge" &&
    typeof (frame as RpcHelloChallenge).serverProof === "string" &&
    typeof (frame as RpcHelloChallenge).serverNonce === "string"
  );
}
