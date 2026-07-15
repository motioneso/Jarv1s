import { randomBytes } from "node:crypto";

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import type { AccessContext, DataContextRunner } from "@jarv1s/db";
import { handleRouteError as handleModuleRouteError } from "@jarv1s/module-sdk";

import type { AiRepository } from "./repository.js";
import { assertInstanceAdmin } from "./routes.js";
import {
  hasTerminalPassword,
  setTerminalPassword,
  verifyTerminalPassword
} from "./terminal-password-repository.js";

// #1059 — owner-gated terminal control plane: password/status/ticket HTTP routes plus a WS
// relay bridging the browser to a cli-runner PTY over a Unix-domain-socket RPC connection
// (TerminalRpcClient, Task 5). Every route re-runs the FULL admin gate — this is a
// security-critical surface (an authenticated owner shell) and RLS/admin checks apply to
// admins too (Hard Invariant: no admin private-data bypass is a config-only power, and this
// tool must still be gated per-request, not just at page-load).
//
// Structural typing, not a real @jarv1s/chat import: packages/ai/package.json intentionally does
// NOT depend on @jarv1s/chat. Adding that dependency was tried and empirically reverted — it
// creates real cycles (@jarv1s/ai -> @jarv1s/chat -> @jarv1s/ai, plus two more via connectors/
// tasks), caught by `scripts/check-package-deps.ts`. Instead this file defines a LOCAL interface
// matching TerminalRpcClient's public shape, and the actual class is injected via
// `connectTerminalRpc` by the composition root (packages/module-registry, which already declares
// both @jarv1s/ai and @jarv1s/chat as dependencies with no cycle — the same pattern already used
// for ChatEngineFactory/resolveChatEngineFactory). packages/ai never imports @jarv1s/chat.
export interface TerminalRpcHandle {
  open(cols: number, rows: number): Promise<string>;
  write(terminalId: string, bytes: Buffer): void;
  resize(terminalId: string, cols: number, rows: number): void;
  kill(terminalId: string): void;
  onData(callback: (terminalId: string, bytes: Buffer) => void): void;
  onExit(callback: (terminalId: string, code: number) => void): void;
  close(): void;
}

export interface TerminalRpcConnectOptions {
  readonly socketPath: string;
  readonly secret?: string;
}

export interface TerminalRoutesDependencies {
  readonly resolveAccessContext: (request: FastifyRequest) => Promise<AccessContext>;
  readonly dataContext: DataContextRunner;
  readonly repository: AiRepository;
  // Optional: when absent (e.g. this deployment/test run has no cli-runner wired up), the WS
  // handler still runs the full auth+ticket gate and then closes with 1011 ("backend
  // unavailable") rather than crashing — a graceful-degradation diagnostic, not a crash vector.
  readonly connectTerminalRpc?: (options: TerminalRpcConnectOptions) => Promise<TerminalRpcHandle>;
}

// Single-use, in-memory ticket bridge: the HTTP password-verify step and the WS upgrade are two
// separate requests (a WS upgrade handshake can't carry a POST body), so a short-lived ticket
// carries "this caller just re-proved the terminal password" across that boundary. Module-level
// Map is correct for this single-instance owner tool: it intentionally does NOT survive a
// process restart and is NOT shared across replicas (#1059) — acceptable because this is a
// diagnostic/admin tool, not a distributed-systems primitive.
const tickets = new Map<string, number>(); // ticket (64 hex chars) -> expiry epoch ms
const TICKET_TTL_MS = 30_000;

/** Opportunistically drop expired tickets so the Map doesn't grow unbounded over a long uptime. */
function sweepExpiredTickets(now: number): void {
  for (const [ticket, expiry] of tickets) {
    if (expiry < now) tickets.delete(ticket);
  }
}

/**
 * Single-use ticket consumption: delete-on-first-lookup, even if the ticket is expired. This is
 * deliberate — if we only deleted valid tickets, a leaked/observed expired ticket string would
 * still "test positive for existence" indefinitely via repeated attempts. Deleting unconditionally
 * on first lookup means a ticket can be consumed (successfully or not) exactly once, ever.
 */
function consumeTicket(ticket: string | undefined): boolean {
  if (!ticket) return false;
  const expiry = tickets.get(ticket);
  tickets.delete(ticket);
  if (expiry === undefined) return false;
  return expiry >= Date.now();
}

export function registerTerminalRoutes(
  server: FastifyInstance,
  dependencies: TerminalRoutesDependencies
): void {
  server.get("/api/ai/terminal/status", async (request, reply) => {
    try {
      const accessContext = await dependencies.resolveAccessContext(request);
      return await dependencies.dataContext.withDataContext(accessContext, async (scopedDb) => {
        await assertInstanceAdmin(dependencies.repository, scopedDb, accessContext.actorUserId);
        return { passwordSet: await hasTerminalPassword(scopedDb) };
      });
    } catch (error) {
      return handleRouteError(error, reply);
    }
  });

  server.post("/api/ai/terminal/password", async (request, reply) => {
    // #1059 [N1] — `currentPassword` is optional on the wire: read it here (before the admin
    // gate, same as `password`) but only ENFORCE it below once we know a password already
    // exists. First-set stays frictionless (nothing to prove yet); OVERWRITE requires proving
    // the CURRENT password first, or an attacker at an already-unlocked admin session could
    // silently replace the terminal password and unlock — defeating the step-up's promise that
    // it survives a shoulder-surfed open session (spec 2026-07-14-cli-provider-terminal-design.md:57-60).
    const body = request.body as { password?: unknown; currentPassword?: unknown };
    if (typeof body.password !== "string" || body.password.length < 8) {
      return reply.code(400).send({ message: "Password must be at least 8 characters." });
    }
    const password = body.password;

    try {
      const accessContext = await dependencies.resolveAccessContext(request);
      return await dependencies.dataContext.withDataContext(accessContext, async (scopedDb) => {
        await assertInstanceAdmin(dependencies.repository, scopedDb, accessContext.actorUserId);

        // #1059 [N1] — OVERWRITE re-auth gate. First-set (alreadySet === false) skips this
        // entirely: there is no current secret to prove possession of, and the UI's set-password
        // form never renders once passwordSet is true, so this path only fires against a direct
        // POST. Never log/echo either the attempted or stored password/hash (Hard Invariant:
        // secrets never escape) — mirrors the ticket route's verify comment above.
        const alreadySet = await hasTerminalPassword(scopedDb);
        if (alreadySet) {
          const currentPassword = body.currentPassword;
          const verified =
            typeof currentPassword === "string" &&
            (await verifyTerminalPassword(scopedDb, currentPassword));
          if (!verified) {
            return reply.code(401).send({ message: "Current terminal password is incorrect." });
          }
        }

        await setTerminalPassword(scopedDb, password);
        return { ok: true };
      });
    } catch (error) {
      return handleRouteError(error, reply);
    }
  });

  server.post("/api/ai/terminal/ticket", async (request, reply) => {
    const body = request.body as { password?: unknown };

    try {
      const accessContext = await dependencies.resolveAccessContext(request);
      return await dependencies.dataContext.withDataContext(accessContext, async (scopedDb) => {
        await assertInstanceAdmin(dependencies.repository, scopedDb, accessContext.actorUserId);

        // Constant-time verify (better-auth scrypt compare) — never log/echo the attempt or the
        // stored hash (Hard Invariant: secrets never escape).
        const verified =
          typeof body.password === "string" &&
          (await verifyTerminalPassword(scopedDb, body.password));
        if (!verified) {
          return reply.code(401).send({ message: "Incorrect terminal password." });
        }

        sweepExpiredTickets(Date.now());
        const ticket = randomBytes(32).toString("hex");
        tickets.set(ticket, Date.now() + TICKET_TTL_MS);
        return { ticket };
      });
    } catch (error) {
      return handleRouteError(error, reply);
    }
  });

  server.get<{ Querystring: { ticket?: string } }>(
    "/api/ai/terminal",
    { websocket: true },
    // #1059 — @fastify/websocket v11 passes the ws.WebSocket directly as the first arg (NOT
    // `connection.socket` — that was the pre-v8 API and would be a silent runtime bug here).
    async (socket, request) => {
      // Step 1: full admin gate, defense-in-depth (a valid ticket alone is never sufficient —
      // re-checking here means a ticket minted while admin, then later demoted before use, is
      // still rejected).
      const authed = await dependencies
        .resolveAccessContext(request)
        .then((accessContext) =>
          dependencies.dataContext.withDataContext(accessContext, async (scopedDb) => {
            await assertInstanceAdmin(dependencies.repository, scopedDb, accessContext.actorUserId);
          })
        )
        .then(
          () => true,
          () => false
        );

      // Step 2: ticket check. consumeTicket() unconditionally deletes on first lookup (single-use,
      // even for an expired/absent ticket) BEFORE we branch on the result, so a ticket can never
      // be replayed regardless of the outcome of this specific attempt.
      const ticketValid = consumeTicket(request.query.ticket);

      // Distinct close codes are what make this gate independently testable without a live
      // cli-runner: 1008 proves auth/ticket failed; 1011 (below) proves auth+ticket PASSED and
      // only the backend dial failed.
      if (!authed || !ticketValid) {
        socket.close(1008, "unauthorized");
        return;
      }

      // Step 3: only now attempt the backend. Reading the env vars directly here (not crashing
      // at boot if unset) mirrors packages/chat/src/live/runtime.ts:176-178 and keeps this route
      // a graceful diagnostic rather than a hard dependency of API boot.
      if (!dependencies.connectTerminalRpc) {
        socket.close(1011, "terminal backend unavailable");
        return;
      }

      // #1059 — `client` starts undefined so the catch below can tell "connect() itself threw"
      // (nothing to clean up) apart from "connect() succeeded but open() then threw" (the
      // Unix-socket RPC connection to the cli-runner is live and must be closed here, or it's
      // orphaned — the WS never reaches Step 4's `socket.on("close")` handler that would
      // otherwise close it).
      let client: TerminalRpcHandle | undefined;
      let terminalId: string;
      try {
        client = await dependencies.connectTerminalRpc({
          socketPath: process.env.JARVIS_CLI_RUNNER_SOCKET ?? "/run/jarv1s/cli-runner.sock",
          secret: process.env.JARVIS_CLI_RUNNER_RPC_SECRET
        });
        terminalId = await client.open(80, 24);
      } catch {
        try {
          client?.close();
        } catch {
          // Best-effort: the RPC connection is already unusable if close() itself throws, and
          // we're about to close the WS regardless — nothing else to do with this error.
        }
        socket.close(1011, "terminal backend unavailable");
        return;
      }

      // Step 4: bridge bytes both ways. PTY output -> binary WS frames; WS text frames are JSON
      // resize control messages, WS binary frames are keystrokes.
      client.onData((_terminalId, bytes) => socket.send(bytes));
      client.onExit(() => socket.close(1000, "exit"));

      socket.on("message", (raw: Buffer, isBinary: boolean) => {
        if (!isBinary) {
          try {
            const message = JSON.parse(raw.toString("utf8")) as {
              type?: string;
              cols?: number;
              rows?: number;
            };
            if (message?.type === "resize" && message.cols && message.rows) {
              client.resize(terminalId, message.cols, message.rows);
            }
            return;
          } catch {
            // Not JSON — fall through and treat as raw keystroke data.
          }
        }
        client.write(terminalId, Buffer.isBuffer(raw) ? raw : Buffer.from(raw));
      });

      socket.on("close", () => {
        client.kill(terminalId);
        client.close();
      });
    }
  );
}

function handleRouteError(error: unknown, reply: FastifyReply) {
  return handleModuleRouteError(error, reply, {
    // resolveAccessContext throws AccountPendingApprovalError/AccountDeactivatedError (packages/
    // auth/src/index.ts) for an authenticated-but-not-yet-approved or deactivated actor. Neither
    // is an HttpError instance and neither message is in module-sdk's generic 401 allowlist, so
    // without this mapper they'd fall through to a scrubbed 500 — actively unhelpful for what is,
    // security-wise, just "not authorized" (403). Mirrors the identical mapper already in
    // packages/settings/src/routes-serializers.ts (that module hits this same case via its own
    // admin-only routes) — not duplicating logic, just the same shared-error-code convention.
    mappers: [
      (e, r) => {
        if (e instanceof Error) {
          const code = (e as Error & { code?: string }).code;
          if (code === "account_pending_approval" || code === "account_deactivated") {
            return r.code(403).send({ error: e.message, code });
          }
        }
        return undefined;
      }
    ],
    invalidRequestMessage: "Terminal request is invalid"
  });
}
