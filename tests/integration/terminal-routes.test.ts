import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { OutgoingHttpHeaders } from "node:http";
import type { AddressInfo } from "node:net";
import type { Kysely } from "kysely";
import { WebSocket } from "ws";

import { createApiServer } from "../../apps/api/src/server.js";
import { createDatabase, type JarvisDatabase } from "@jarv1s/db";
import type { TerminalRpcHandle } from "@jarv1s/ai";
import { connectionStrings, resetEmptyFoundationDatabase } from "./test-database.js";

// #1059 — owner-gated terminal control plane: password/status/ticket HTTP routes + a WS relay
// that bridges the browser to a cli-runner PTY. This suite proves the HTTP surface (admin gate,
// password round-trip, ticket minting) via server.inject, and the WS upgrade's auth+ticket gate
// via a REAL `ws` socket (server.inject cannot drive a WebSocket upgrade).
//
// Deliberately OUT of scope here (per task-7-corrections.md §7): the live byte-bridge happy path
// (valid ticket -> real cli-runner PTY -> keystroke/output round-trip) requires an actual
// cli-runner process listening on the terminal socket, which does not exist in this unit/
// integration sandbox. That path is exercised in Task 10's e2e dev UAT against a real container.
// What we CAN and DO prove here: the auth+ticket gate runs and passes BEFORE any backend dial is
// attempted — a valid ticket closes with code 1011 ("terminal backend unavailable", the connect()
// to a nonexistent socket failing) rather than 1008 ("unauthorized"). Distinct close codes make
// that gate-passed proof possible without a running backend.
describe("terminal routes (#1059)", () => {
  let appDb: Kysely<JarvisDatabase>;
  let server: ReturnType<typeof createApiServer>;
  let adminCookie: string;
  let memberCookie: string;
  let baseWsUrl: string;
  const openSockets: WebSocket[] = [];

  beforeAll(async () => {
    await resetEmptyFoundationDatabase();
    appDb = createDatabase({ connectionString: connectionStrings.app, maxConnections: 1 });
    server = createApiServer({ appDb, logger: false });
    await server.ready();
    // Listen on a real ephemeral port — the WS-upgrade gate assertions need an actual TCP
    // socket (server.inject can't simulate a WebSocket handshake).
    await server.listen({ port: 0, host: "127.0.0.1" });
    const address = server.server.address() as AddressInfo;
    baseWsUrl = `ws://127.0.0.1:${address.port}`;

    // First sign-up bootstraps the instance owner (admin); the second is a plain member —
    // mirrors tests/integration/chat-multiplexer-admin.test.ts's harness exactly.
    const owner = await signUp(server, "owner@terminal.test", "Owner");
    adminCookie = owner.cookie;
    const member = await signUp(server, "member@terminal.test", "Member");
    memberCookie = member.cookie;
  });

  afterEach(() => {
    // Ensure no WS client from one `it` block leaks a connection into the next.
    for (const socket of openSockets.splice(0)) {
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
        socket.close();
      }
    }
  });

  afterAll(async () => {
    await Promise.allSettled([server?.close(), appDb?.destroy()]);
  });

  it("non-admin gets 403 on password set", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/api/ai/terminal/password",
      headers: { cookie: memberCookie, "content-type": "application/json" },
      payload: { password: "member-attempt-1" }
    });
    expect(res.statusCode).toBe(403);
  });

  it("denies an unauthenticated status check with 401", async () => {
    const res = await server.inject({ method: "GET", url: "/api/ai/terminal/status" });
    expect(res.statusCode).toBe(401);
  });

  it("status reflects unset then set, and ticket requires the correct terminal password", async () => {
    const before = await server.inject({
      method: "GET",
      url: "/api/ai/terminal/status",
      headers: { cookie: adminCookie }
    });
    expect(before.statusCode).toBe(200);
    expect(before.json<{ passwordSet: boolean }>().passwordSet).toBe(false);

    const rejectedShort = await server.inject({
      method: "POST",
      url: "/api/ai/terminal/password",
      headers: { cookie: adminCookie, "content-type": "application/json" },
      payload: { password: "short" }
    });
    expect(rejectedShort.statusCode).toBe(400);

    const setRes = await server.inject({
      method: "POST",
      url: "/api/ai/terminal/password",
      headers: { cookie: adminCookie, "content-type": "application/json" },
      payload: { password: "correct-terminal-pw-1059" }
    });
    expect(setRes.statusCode).toBe(200);
    expect(setRes.json<{ ok: boolean }>().ok).toBe(true);

    const after = await server.inject({
      method: "GET",
      url: "/api/ai/terminal/status",
      headers: { cookie: adminCookie }
    });
    expect(after.json<{ passwordSet: boolean }>().passwordSet).toBe(true);

    const wrongPw = await server.inject({
      method: "POST",
      url: "/api/ai/terminal/ticket",
      headers: { cookie: adminCookie, "content-type": "application/json" },
      payload: { password: "definitely-wrong" }
    });
    expect(wrongPw.statusCode).toBe(401);

    const rightPw = await server.inject({
      method: "POST",
      url: "/api/ai/terminal/ticket",
      headers: { cookie: adminCookie, "content-type": "application/json" },
      payload: { password: "correct-terminal-pw-1059" }
    });
    expect(rightPw.statusCode).toBe(200);
    const { ticket } = rightPw.json<{ ticket: string }>();
    // randomBytes(32).toString("hex") -> 64 hex chars, single-use, 30s TTL (in-memory Map).
    expect(ticket).toMatch(/^[0-9a-f]{64}$/);
  });

  // #1059 [N1] — OVERWRITE re-auth gate. The prior test already proved first-SET stays
  // frictionless (no currentPassword sent, 200/ok); this test proves overwriting an
  // ALREADY-SET password (left at "correct-terminal-pw-1059" by the prior test) now requires
  // proving possession of that current password first, or a shoulder-surfed/already-unlocked
  // admin session could silently swap the terminal password and unlock (spec
  // 2026-07-14-cli-provider-terminal-design.md:57-60).
  it("overwriting an existing terminal password requires the correct currentPassword", async () => {
    const missingCurrent = await server.inject({
      method: "POST",
      url: "/api/ai/terminal/password",
      headers: { cookie: adminCookie, "content-type": "application/json" },
      payload: { password: "new-terminal-pw-1059" }
    });
    expect(missingCurrent.statusCode).toBe(401);

    const wrongCurrent = await server.inject({
      method: "POST",
      url: "/api/ai/terminal/password",
      headers: { cookie: adminCookie, "content-type": "application/json" },
      payload: { password: "new-terminal-pw-1059", currentPassword: "not-the-current-one" }
    });
    expect(wrongCurrent.statusCode).toBe(401);

    // Old password must still be untouched by the rejected attempts above.
    const oldStillWorks = await server.inject({
      method: "POST",
      url: "/api/ai/terminal/ticket",
      headers: { cookie: adminCookie, "content-type": "application/json" },
      payload: { password: "correct-terminal-pw-1059" }
    });
    expect(oldStillWorks.statusCode).toBe(200);

    const correctCurrent = await server.inject({
      method: "POST",
      url: "/api/ai/terminal/password",
      headers: { cookie: adminCookie, "content-type": "application/json" },
      payload: { password: "new-terminal-pw-1059", currentPassword: "correct-terminal-pw-1059" }
    });
    expect(correctCurrent.statusCode).toBe(200);
    expect(correctCurrent.json<{ ok: boolean }>().ok).toBe(true);

    // The password actually changed: old value no longer mints a ticket, new value does.
    const oldNowFails = await server.inject({
      method: "POST",
      url: "/api/ai/terminal/ticket",
      headers: { cookie: adminCookie, "content-type": "application/json" },
      payload: { password: "correct-terminal-pw-1059" }
    });
    expect(oldNowFails.statusCode).toBe(401);

    const newWorks = await server.inject({
      method: "POST",
      url: "/api/ai/terminal/ticket",
      headers: { cookie: adminCookie, "content-type": "application/json" },
      payload: { password: "new-terminal-pw-1059" }
    });
    expect(newWorks.statusCode).toBe(200);

    // Restore "correct-terminal-pw-1059" so every later `it` in this describe block (which all
    // mint tickets against that literal) keeps passing — this suite shares one server/DB across
    // its without a reset between tests, so this overwrite must be undone before returning.
    const restore = await server.inject({
      method: "POST",
      url: "/api/ai/terminal/password",
      headers: { cookie: adminCookie, "content-type": "application/json" },
      payload: { password: "correct-terminal-pw-1059", currentPassword: "new-terminal-pw-1059" }
    });
    expect(restore.statusCode).toBe(200);
  });

  it("non-admin gets 403 on ticket mint even with no password required yet", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/api/ai/terminal/ticket",
      headers: { cookie: memberCookie, "content-type": "application/json" },
      payload: { password: "whatever" }
    });
    expect(res.statusCode).toBe(403);
  });

  it("WS upgrade with no ticket is refused with close code 1008", async () => {
    const closeCode = await connectAndAwaitClose(
      `${baseWsUrl}/api/ai/terminal`,
      adminCookie,
      openSockets
    );
    expect(closeCode).toBe(1008);
  });

  it("WS upgrade with a bogus ticket is refused with close code 1008", async () => {
    const closeCode = await connectAndAwaitClose(
      `${baseWsUrl}/api/ai/terminal?ticket=not-a-real-ticket`,
      adminCookie,
      openSockets
    );
    expect(closeCode).toBe(1008);
  });

  it("WS upgrade without the admin cookie is refused with close code 1008 even with a valid ticket", async () => {
    const ticketRes = await server.inject({
      method: "POST",
      url: "/api/ai/terminal/ticket",
      headers: { cookie: adminCookie, "content-type": "application/json" },
      payload: { password: "correct-terminal-pw-1059" }
    });
    const { ticket } = ticketRes.json<{ ticket: string }>();

    const closeCode = await connectAndAwaitClose(
      `${baseWsUrl}/api/ai/terminal?ticket=${ticket}`,
      memberCookie,
      openSockets
    );
    expect(closeCode).toBe(1008);
  });

  it("WS upgrade with a valid ticket + admin cookie passes the auth gate (closes 1011, not 1008 — no cli-runner in this sandbox)", async () => {
    const ticketRes = await server.inject({
      method: "POST",
      url: "/api/ai/terminal/ticket",
      headers: { cookie: adminCookie, "content-type": "application/json" },
      payload: { password: "correct-terminal-pw-1059" }
    });
    expect(ticketRes.statusCode).toBe(200);
    const { ticket } = ticketRes.json<{ ticket: string }>();

    const closeCode = await connectAndAwaitClose(
      `${baseWsUrl}/api/ai/terminal?ticket=${ticket}`,
      adminCookie,
      openSockets
    );
    // 1011 = "terminal backend unavailable" (connect() to the cli-runner socket failed because
    // no cli-runner process is listening in this test sandbox). Critically NOT 1008: the
    // auth+ticket gate ran FIRST and accepted this connection before the backend dial was even
    // attempted. Proves the gate; the live byte-bridge itself is Task-10 e2e-only (see file header).
    expect(closeCode).toBe(1011);
  });

  it("a ticket is single-use: replaying it after first use is refused with 1008", async () => {
    const ticketRes = await server.inject({
      method: "POST",
      url: "/api/ai/terminal/ticket",
      headers: { cookie: adminCookie, "content-type": "application/json" },
      payload: { password: "correct-terminal-pw-1059" }
    });
    const { ticket } = ticketRes.json<{ ticket: string }>();

    const firstClose = await connectAndAwaitClose(
      `${baseWsUrl}/api/ai/terminal?ticket=${ticket}`,
      adminCookie,
      openSockets
    );
    expect(firstClose).toBe(1011); // consumed the ticket, passed the gate, backend unavailable

    const secondClose = await connectAndAwaitClose(
      `${baseWsUrl}/api/ai/terminal?ticket=${ticket}`,
      adminCookie,
      openSockets
    );
    expect(secondClose).toBe(1008); // replay of an already-consumed ticket is refused
  });

  it("closes the cli-runner client when connect() succeeds but open() then fails (#1059 leak fix)", async () => {
    // Fake handle whose connect() (i.e. dependencies.connectTerminalRpc resolving to this handle)
    // succeeds but whose open() rejects — the specific connect-ok/open-fail path where the WS
    // handler's backend-open catch previously left this handle's Unix-socket RPC connection
    // orphaned (no `.close()` call) instead of tearing it down before closing the WS with 1011.
    let closeCallCount = 0;
    const fakeHandle: TerminalRpcHandle = {
      open: () => Promise.reject(new Error("simulated pty spawn failure")),
      write: () => {},
      resize: () => {},
      kill: () => {},
      onData: () => {},
      onExit: () => {},
      close: () => {
        closeCallCount += 1;
      }
    };

    // A second, independent server instance (sharing the same appDb/admin as the outer suite)
    // so this test's connectTerminalRpc override doesn't affect the other cases above, which
    // deliberately rely on connectTerminalRpc being absent (asserting the graceful-degradation
    // 1011 path with no cli-runner at all).
    const leakServer = createApiServer({
      appDb,
      logger: false,
      connectTerminalRpc: () => Promise.resolve(fakeHandle)
    });
    await leakServer.ready();
    await leakServer.listen({ port: 0, host: "127.0.0.1" });
    const leakAddress = leakServer.server.address() as AddressInfo;
    const leakWsUrl = `ws://127.0.0.1:${leakAddress.port}`;

    try {
      const ticketRes = await leakServer.inject({
        method: "POST",
        url: "/api/ai/terminal/ticket",
        headers: { cookie: adminCookie, "content-type": "application/json" },
        payload: { password: "correct-terminal-pw-1059" }
      });
      expect(ticketRes.statusCode).toBe(200);
      const { ticket } = ticketRes.json<{ ticket: string }>();

      const closeCode = await connectAndAwaitClose(
        `${leakWsUrl}/api/ai/terminal?ticket=${ticket}`,
        adminCookie,
        openSockets
      );
      // Still 1011 (connect succeeded, only open() failed) — proves the fix didn't change the
      // client-observable close code, only the server-side cleanup.
      expect(closeCode).toBe(1011);
      expect(closeCallCount).toBe(1);
    } finally {
      await leakServer.close();
    }
  });
});

/** Opens a real `ws` client against the given URL and resolves with the socket's close code. */
function connectAndAwaitClose(url: string, cookie: string, registry: WebSocket[]): Promise<number> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url, { headers: { cookie } });
    registry.push(socket);
    socket.on("close", (code) => resolve(code));
    socket.on("error", (err) => {
      // A close frame sometimes surfaces as a socket error depending on timing (e.g. server
      // closes before the client's connection fully upgrades) — but the "close" event above
      // still fires with the real code in that case, so only reject if close never follows.
      setTimeout(() => reject(err), 1000);
    });
  });
}

async function signUp(
  server: ReturnType<typeof createApiServer>,
  email: string,
  name: string
): Promise<{ cookie: string; userId: string }> {
  const res = await server.inject({
    method: "POST",
    url: "/api/auth/sign-up/email",
    headers: { "content-type": "application/json" },
    payload: { name, email, password: "correct horse battery staple" }
  });
  if (res.statusCode !== 200) {
    throw new Error(`sign-up for ${email} failed (${res.statusCode}): ${res.body}`);
  }
  return {
    cookie: cookieHeader(res.headers),
    userId: res.json<{ user: { id: string } }>().user.id
  };
}

function cookieHeader(headers: OutgoingHttpHeaders): string {
  const setCookie = headers["set-cookie"];
  const cookies = Array.isArray(setCookie)
    ? setCookie
    : typeof setCookie === "string" || typeof setCookie === "number"
      ? [String(setCookie)]
      : [];
  return cookies.map((cookie) => cookie.split(";", 1)[0]).join("; ");
}
