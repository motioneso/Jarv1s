import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Kysely } from "kysely";

import {
  AiRepository,
  AssistantToolGateway,
  ConfirmationRegistry,
  SessionTokenRegistry,
  type GatewaySessionRecord
} from "@jarv1s/ai";
import { DataContextRunner, createDatabase, type JarvisDatabase } from "@jarv1s/db";

import { connectionStrings, ids, resetFoundationDatabase } from "./test-database.js";
import { exampleToolCalls, exampleToolModule } from "./fixtures/example-tool-module.js";

const tick = () => new Promise((resolve) => setTimeout(resolve, 50));

describe("AssistantToolGateway", () => {
  let appDb: Kysely<JarvisDatabase>;
  let runner: DataContextRunner;
  let repository: AiRepository;
  let tokens: SessionTokenRegistry;
  let confirmations: ConfirmationRegistry;
  let emitted: { chatSessionId: string; record: GatewaySessionRecord }[];
  let gateway: AssistantToolGateway;

  function firstActionRequest(): { actionRequestId: string; toolName: string; summary: string } {
    const entry = emitted[0];
    if (!entry || entry.record.kind !== "action_request") {
      throw new Error("expected an action_request card to have been emitted");
    }
    return entry.record;
  }

  beforeAll(async () => {
    await resetFoundationDatabase();
    appDb = createDatabase({ connectionString: connectionStrings.app, maxConnections: 1 });
    runner = new DataContextRunner(appDb);
    repository = new AiRepository();
  });

  afterAll(async () => {
    await appDb.destroy();
  });

  beforeEach(() => {
    exampleToolCalls.length = 0;
    emitted = [];
    tokens = new SessionTokenRegistry();
    confirmations = new ConfirmationRegistry();
    gateway = new AssistantToolGateway({
      resolveActiveModules: () => [exampleToolModule],
      repository,
      runner,
      tokens,
      confirmations,
      notifier: { emit: (chatSessionId, record) => emitted.push({ chatSessionId, record }) },
      confirmTimeoutMs: 1000
    });
  });

  it("lists only tools that have an execute handler", () => {
    const names = gateway.listTools().map((tool) => tool.name);
    expect(names).toContain("example.read");
    expect(names).toContain("example.write");
    expect(names).toContain("example.destroy");
    expect(names).not.toContain("example.declaration-only");
  });

  it("runs a read tool immediately under the caller's RLS scope", async () => {
    const token = tokens.mint({ actorUserId: ids.userA, chatSessionId: "s1" });
    const res = await gateway.callTool(token, "example.read", { value: "hi" });

    expect(res).toEqual({
      ok: true,
      data: { ok: true, name: "example.read", echo: "hi", actor: ids.userA }
    });
    expect(exampleToolCalls).toHaveLength(1);
    expect(emitted).toHaveLength(0);
  });

  it("blocks a write until approved, emits a card, then executes", async () => {
    const token = tokens.mint({ actorUserId: ids.userA, chatSessionId: "s1" });
    const call = gateway.callTool(token, "example.write", { value: "hello" });

    await tick();
    expect(emitted).toHaveLength(1);
    const card = firstActionRequest();
    expect(card.toolName).toBe("example.write");
    expect(card.summary).toBe('Write the value "hello"');
    expect(exampleToolCalls).toHaveLength(0);

    await gateway.resolveActionRequest(ids.userA, card.actionRequestId, "confirmed");
    const res = await call;

    expect(res).toEqual({
      ok: true,
      data: { ok: true, name: "example.write", echo: "hello", actor: ids.userA }
    });
    expect(exampleToolCalls).toHaveLength(1);
    expect(emitted.map((entry) => entry.record.kind)).toEqual(["action_request", "action_result"]);
  });

  it("returns a denied result without calling the handler", async () => {
    const token = tokens.mint({ actorUserId: ids.userA, chatSessionId: "s1" });
    const call = gateway.callTool(token, "example.write", { value: "nope" });

    await tick();
    const card = firstActionRequest();

    await gateway.resolveActionRequest(ids.userA, card.actionRequestId, "rejected");
    const res = await call;

    expect(res).toEqual({ ok: false, denied: true, reason: "Denied by user." });
    expect(exampleToolCalls).toHaveLength(0);
  });

  it("blocks destructive tools the same as writes (no run-immediately path)", async () => {
    const token = tokens.mint({ actorUserId: ids.userA, chatSessionId: "s1" });
    const call = gateway.callTool(token, "example.destroy", { value: "x" });

    await tick();
    const card = firstActionRequest();
    expect(card.toolName).toBe("example.destroy");
    expect(exampleToolCalls).toHaveLength(0);

    await gateway.resolveActionRequest(ids.userA, card.actionRequestId, "confirmed");
    await call;
    expect(exampleToolCalls.map((entry) => entry.name)).toEqual(["example.destroy"]);
  });

  it("returns a safe error and never leaks internal details", async () => {
    const token = tokens.mint({ actorUserId: ids.userA, chatSessionId: "s1" });
    const res = await gateway.callTool(token, "example.boom", {});

    expect(res).toEqual({ ok: false, error: "Tool example.boom failed" });
    expect(JSON.stringify(res)).not.toContain("SECRET");
    expect(JSON.stringify(res)).not.toContain("postgres://");
  });

  it("acts only as the token's user; input cannot override identity", async () => {
    const token = tokens.mint({ actorUserId: ids.userB, chatSessionId: "s2" });
    const res = await gateway.callTool(token, "example.read", {
      value: "v",
      actorUserId: ids.userA
    });

    expect(res.ok).toBe(true);
    expect(exampleToolCalls[0]?.actorUserId).toBe(ids.userB);
  });

  it("rejects an unknown/revoked token", async () => {
    await expect(gateway.callTool("jst_bogus", "example.read", {})).rejects.toThrow();
  });
});
