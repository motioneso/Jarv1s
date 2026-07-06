/**
 * §3.6 connection auth hello — server side of the MUTUAL challenge-response. The
 * shared secret `JARVIS_CLI_RUNNER_RPC_SECRET` is NEVER sent on the wire; both sides
 * prove knowledge of it over exchanged nonces (HMAC-SHA256).
 *
 * Server flow:
 *   1. receive `RpcHello { clientNonce }`
 *   2. send `RpcHelloChallenge { serverProof = HMAC(secret,"S"+clientNonce), serverNonce }`
 *   3. receive `RpcHelloResponse { clientProof }` and CONSTANT-TIME compare it to
 *      HMAC(secret,"C"+serverNonce); on mismatch (or an unset secret, or a malformed
 *      first frame) the caller CLOSES the connection with no error frame (§3.7).
 *
 * Proofs and nonces are never logged (§6.4).
 */

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import {
  HELLO_PROOF_TAG_CLIENT,
  HELLO_PROOF_TAG_SERVER,
  type RpcHandshakeFrame,
  type RpcHello,
  type RpcHelloChallenge,
  type RpcHelloResponse
} from "@jarv1s/chat/live";

/** HMAC-SHA256(secret, tag + nonce) → hex. */
function proof(secret: string, tag: string, nonce: string): string {
  return createHmac("sha256", secret)
    .update(tag + nonce)
    .digest("hex");
}

/** Random 32-byte hex nonce. */
export function newNonce(): string {
  return randomBytes(32).toString("hex");
}

/** Constant-time hex-string compare (lengths must match; mismatched length ⇒ false). */
function constantTimeEqualHex(a: string, b: string): boolean {
  const ba = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

export interface HelloServerState {
  /** Waiting for the client's first `hello` frame. */
  phase: "await-hello" | "await-response" | "done";
  serverNonce: string;
}

export type HelloStep =
  | { readonly kind: "send"; readonly frame: RpcHelloChallenge }
  | { readonly kind: "authenticated" }
  | { readonly kind: "close" };

/**
 * Drive one handshake frame on the SERVER. Returns the next action:
 *  - `send`          — reply with the challenge frame (after a valid `hello`)
 *  - `authenticated` — the client's proof verified; switch to request/response framing
 *  - `close`         — malformed frame, wrong proof, or unset secret ⇒ close, no error frame
 *
 * An unset/empty secret always closes (a server with no secret must never authenticate).
 */
export function stepHelloServer(
  state: HelloServerState,
  frame: RpcHandshakeFrame,
  secret: string | undefined
): HelloStep {
  if (!secret) return { kind: "close" };

  if (state.phase === "await-hello") {
    if (frame.t !== "hello") return { kind: "close" };
    const hello = frame as RpcHello;
    if (typeof hello.clientNonce !== "string" || hello.clientNonce.length === 0) {
      return { kind: "close" };
    }
    state.serverNonce = newNonce();
    state.phase = "await-response";
    const challenge: RpcHelloChallenge = {
      t: "hello-challenge",
      serverProof: proof(secret, HELLO_PROOF_TAG_SERVER, hello.clientNonce),
      serverNonce: state.serverNonce
    };
    return { kind: "send", frame: challenge };
  }

  if (state.phase === "await-response") {
    if (frame.t !== "hello-response") return { kind: "close" };
    const response = frame as RpcHelloResponse;
    const expected = proof(secret, HELLO_PROOF_TAG_CLIENT, state.serverNonce);
    if (
      typeof response.clientProof !== "string" ||
      !constantTimeEqualHex(response.clientProof, expected)
    ) {
      return { kind: "close" };
    }
    state.phase = "done";
    return { kind: "authenticated" };
  }

  // No handshake frames expected once done.
  return { kind: "close" };
}

/** A handshake frame is one of the three `t` discriminants (§3.6). */
export function isHandshakeFrame(value: unknown): value is RpcHandshakeFrame {
  if (typeof value !== "object" || value === null) return false;
  const t = (value as { t?: unknown }).t;
  return t === "hello" || t === "hello-challenge" || t === "hello-response";
}
