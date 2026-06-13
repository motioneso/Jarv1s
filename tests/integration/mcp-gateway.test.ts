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
      resolveActiveModules: async () => [exampleToolModule],
      repository,
      runner,
      tokens,
      confirmations,
      notifier: { emit: (chatSessionId, record) => emitted.push({ chatSessionId, record }) },
      // Generous so the approve always lands before the await times out, even under heavy
      // full-suite DB load (vitest runs integration files concurrently). The post-timeout
      // no-op path is covered separately by the 20ms `fastTimeoutGateway` test below.
      confirmTimeoutMs: 30_000
    });
  });

  it("lists only tools that have an execute handler", async () => {
    const names = (await gateway.listToolsForActor(ids.userA)).map((tool) => tool.name);
    expect(names).toContain("example.read");
    expect(names).toContain("example.write");
    expect(names).toContain("example.destroy");
    expect(names).not.toContain("example.declaration-only");
  });

  it("fails closed: a throwing resolveActiveModules rejects listToolsForActor and callTool", async () => {
    let resolverCalls = 0;
    const failing = new AssistantToolGateway({
      resolveActiveModules: async () => {
        resolverCalls += 1;
        throw new Error("resolver/DB unavailable");
      },
      repository,
      runner,
      tokens, // SHARED registry from beforeEach, so the minted token below verifies
      confirmations,
      notifier: { emit: (chatSessionId, record) => emitted.push({ chatSessionId, record }) },
      confirmTimeoutMs: 1000
    });
    // listToolsForActor reaches the resolver directly.
    await expect(failing.listToolsForActor(ids.userA)).rejects.toThrow();
    // callTool: mint a VALID token (allowedToolNames: null) so it clears token verification
    // and proceeds into executableTools → resolver, which throws → reject (not a degraded set).
    const token = tokens.mint({
      actorUserId: ids.userA,
      chatSessionId: "fail-closed",
      allowedToolNames: null
    });
    await expect(failing.callTool(token, "example.read", {})).rejects.toThrow();
    expect(resolverCalls).toBeGreaterThanOrEqual(2); // both surfaces actually invoked the resolver
  });

  it("runs a read tool immediately under the caller's RLS scope", async () => {
    const token = tokens.mint({
      actorUserId: ids.userA,
      chatSessionId: "s1",
      allowedToolNames: null
    });
    const res = await gateway.callTool(token, "example.read", { value: "hi" });

    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error("expected ok");
    const parsed = JSON.parse((res.data as { text: string }).text) as Record<string, unknown>;
    expect(parsed).toMatchObject({ echo: "hi", actor: ids.userA });
    expect(exampleToolCalls).toHaveLength(1);
    expect(emitted).toHaveLength(0);
  });

  it("blocks a write until approved, emits a card, then executes", async () => {
    const token = tokens.mint({
      actorUserId: ids.userA,
      chatSessionId: "s1",
      allowedToolNames: null
    });
    const call = gateway.callTool(token, "example.write", { value: "hello" });

    await tick();
    expect(emitted).toHaveLength(1);
    const card = firstActionRequest();
    expect(card.toolName).toBe("example.write");
    expect(card.summary).toBe('Write the value "hello"');
    expect(exampleToolCalls).toHaveLength(0);

    await gateway.resolveActionRequest(ids.userA, card.actionRequestId, "confirmed");
    const res = await call;

    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error("expected ok");
    const parsed = JSON.parse((res.data as { text: string }).text) as Record<string, unknown>;
    expect(parsed).toMatchObject({ echo: "hello", actor: ids.userA });
    expect(exampleToolCalls).toHaveLength(1);
    expect(emitted.map((entry) => entry.record.kind)).toEqual(["action_request", "action_result"]);
  });

  it("an Approve arriving after the confirm timeout never executes and never marks the row confirmed", async () => {
    // Short timeout so the wait expires before we Approve. confirmTimeoutMs is set per-gateway.
    const fastTimeoutGateway = new AssistantToolGateway({
      resolveActiveModules: async () => [exampleToolModule],
      repository,
      runner,
      tokens,
      confirmations,
      notifier: { emit: (chatSessionId, record) => emitted.push({ chatSessionId, record }) },
      confirmTimeoutMs: 20
    });
    const token = tokens.mint({
      actorUserId: ids.userA,
      chatSessionId: "s-timeout",
      allowedToolNames: null
    });

    const res = await fastTimeoutGateway.callTool(token, "example.write", { value: "late" });
    // The call gave up: timed-out denial, handler never ran.
    expect(res).toEqual({
      ok: false,
      denied: true,
      reason: "Timed out awaiting confirmation — still pending in your drawer."
    });
    expect(exampleToolCalls).toHaveLength(0);

    const card = firstActionRequest();

    // Operator clicks Approve after the timeout — must be a no-op (fails closed).
    await fastTimeoutGateway.resolveActionRequest(ids.userA, card.actionRequestId, "confirmed");

    // The handler still never ran...
    expect(exampleToolCalls).toHaveLength(0);
    // ...and the DB row was NOT flipped to 'confirmed' (no phantom-success divergence).
    const rows = await runner.withDataContext(
      { actorUserId: ids.userA, requestId: "r-timeout-check" },
      (scopedDb) => repository.listAssistantActions(scopedDb)
    );
    const row = rows.find((r) => r.id === card.actionRequestId);
    expect(row?.status).toBe("pending");
  });

  it("returns a denied result without calling the handler", async () => {
    const token = tokens.mint({
      actorUserId: ids.userA,
      chatSessionId: "s1",
      allowedToolNames: null
    });
    const call = gateway.callTool(token, "example.write", { value: "nope" });

    await tick();
    const card = firstActionRequest();

    await gateway.resolveActionRequest(ids.userA, card.actionRequestId, "rejected");
    const res = await call;

    expect(res).toEqual({ ok: false, denied: true, reason: "Denied by user." });
    expect(exampleToolCalls).toHaveLength(0);
  });

  it("blocks destructive tools the same as writes (no run-immediately path)", async () => {
    const token = tokens.mint({
      actorUserId: ids.userA,
      chatSessionId: "s1",
      allowedToolNames: null
    });
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
    const token = tokens.mint({
      actorUserId: ids.userA,
      chatSessionId: "s1",
      allowedToolNames: null
    });
    const res = await gateway.callTool(token, "example.boom", {});

    expect(res).toEqual({ ok: false, error: "Tool example.boom failed" });
    expect(JSON.stringify(res)).not.toContain("SECRET");
    expect(JSON.stringify(res)).not.toContain("postgres://");
  });

  it("acts only as the token's user; input cannot override identity", async () => {
    const token = tokens.mint({
      actorUserId: ids.userB,
      chatSessionId: "s2",
      allowedToolNames: null
    });
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

  it("renders a uniform-list tool result as a Markdown pipe table (end-to-end)", async () => {
    const token = tokens.mint({
      actorUserId: ids.userA,
      chatSessionId: "s-tabular",
      allowedToolNames: null
    });
    const res = await gateway.callTool(token, "example.list", {});

    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error("expected ok");
    const text = (res.data as { text: string }).text;
    expect(text).toContain("| id | name | status |");
    expect(text).toContain("| --- | --- | --- |");
    expect(text).toContain("| a1 | Alpha | active |");
    expect(text).toContain("| a2 | Beta | inactive |");
    expect(text).not.toContain('"items"');
  });

  it("blocks a tool call when allowedToolNames is set and the tool is not in it", async () => {
    const token = tokens.mint({
      actorUserId: ids.userA,
      chatSessionId: "s-allowlist",
      allowedToolNames: new Set(["example.write"])
    });

    const res = await gateway.callTool(token, "example.read", { value: "blocked" });

    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("expected not ok");
    if ("denied" in res) throw new Error("expected error, not denied");
    expect(res.error).toContain("not in session allowlist");
    expect(exampleToolCalls).toHaveLength(0);
  });

  it("allows a tool call when allowedToolNames is null (unrestricted)", async () => {
    const token = tokens.mint({
      actorUserId: ids.userA,
      chatSessionId: "s-unrestricted",
      allowedToolNames: null
    });

    const res = await gateway.callTool(token, "example.read", { value: "allowed" });

    expect(res.ok).toBe(true);
    expect(exampleToolCalls).toHaveLength(1);
  });

  it("listToolsForActor is actor-scoped — a different actor gets a different list", async () => {
    // resolveActiveModules returns the example module ONLY for userA; userB gets nothing.
    // If listToolsForActor ignored its argument (the bug listTools() had), userB would
    // get the same non-empty list and this test would fail — which is exactly the point.
    const scopedGateway = new AssistantToolGateway({
      resolveActiveModules: async (actorUserId) =>
        actorUserId === ids.userA ? [exampleToolModule] : [],
      repository,
      runner,
      tokens,
      confirmations,
      notifier: { emit: () => {} },
      confirmTimeoutMs: 1000
    });

    const aNames = (await scopedGateway.listToolsForActor(ids.userA)).map((tool) => tool.name);
    const bNames = (await scopedGateway.listToolsForActor(ids.userB)).map((tool) => tool.name);

    expect(aNames).toContain("example.read");
    expect(aNames).toContain("example.write");
    expect(bNames).toEqual([]);
  });
});
