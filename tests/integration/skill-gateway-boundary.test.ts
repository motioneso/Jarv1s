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
import type { ChatSkillDto } from "@jarv1s/shared";

import { composeTurnText } from "../../apps/web/src/chat/skill-autocomplete.js";
import { renderPersona, type PersonaFs } from "../../packages/chat/src/live/persona.js";
import { connectionStrings, ids, resetFoundationDatabase } from "./test-database.js";
import { exampleToolCalls, exampleToolModule } from "./fixtures/example-tool-module.js";

/**
 * #760 Task 6 — proves skill-triggered tool calls get NO special server-side path.
 *
 * Skill invocation is 100% client-side text composition (composeTurnText prepends the skill
 * body to the submitted turn text; see apps/web/src/chat/skill-autocomplete.tsx). By the time
 * that text becomes a tool call, it arrives at AssistantToolGateway.callTool(token, toolName,
 * rawInput) — a signature with no origin/skill field, so there is nowhere for a skill-aware
 * branch to live. These tests reuse the exact confirm-gated and YOLO fixtures from
 * mcp-gateway.test.ts, but with the tool-call value sourced from composeTurnText output, to
 * prove the pipeline treats skill-sourced content identically to plain user text.
 */

const tick = () => new Promise((resolve) => setTimeout(resolve, 50));

function skillFixture(overrides: Partial<ChatSkillDto> = {}): ChatSkillDto {
  return {
    id: "skill-cleanup",
    ownerUserId: ids.userA,
    name: "cleanup",
    description: null,
    frontmatter: {},
    body: "Always confirm before writing or deleting anything on the user's behalf.",
    enabled: true,
    source: "authored",
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    ...overrides
  };
}

function fakePersonaFs(): { fs: PersonaFs; writes: Record<string, string>; calls: string[] } {
  const writes: Record<string, string> = {};
  const calls: string[] = [];
  const fs: PersonaFs = {
    mkdir: async (path: string) => {
      calls.push(`mkdir:${path}`);
    },
    writeFile: async (path: string, content: string) => {
      writes[path] = content;
      calls.push(`writeFile:${path}`);
    }
  };
  return { fs, writes, calls };
}

describe("skill-sourced turns at the gateway boundary (#760 Task 6)", () => {
  let appDb: Kysely<JarvisDatabase>;
  let bootstrapDb: Kysely<JarvisDatabase>;
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
    bootstrapDb = createDatabase({
      connectionString: connectionStrings.bootstrap,
      maxConnections: 1
    });
    runner = new DataContextRunner(appDb);
    repository = new AiRepository();
  });

  afterAll(async () => {
    await bootstrapDb.destroy();
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
      confirmTimeoutMs: 30_000
    });
  });

  it("blocks a skill-sourced write until approved — identical to a plain-text write", async () => {
    const turnText = composeTurnText(skillFixture(), "please write hello for me");
    const token = tokens.mint({
      actorUserId: ids.userA,
      chatSessionId: "s-skill-write",
      allowedToolNames: null
    });

    const call = gateway.callTool(token, "example.write", { value: turnText });
    await tick();

    // Pending, never silently executed — the gateway has no skill-origin field to branch on.
    expect(emitted).toHaveLength(1);
    const card = firstActionRequest();
    expect(card.toolName).toBe("example.write");
    expect(exampleToolCalls).toHaveLength(0);

    await gateway.resolveActionRequest(ids.userA, card.actionRequestId, "confirmed");
    const res = await call;

    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error("expected ok");
    // The composed skill-body-prefixed text flows through unmodified — no stripping/parsing.
    expect(exampleToolCalls).toEqual([
      { name: "example.write", input: { value: turnText }, actorUserId: ids.userA }
    ]);
    expect(emitted.map((entry) => entry.record.kind)).toEqual(["action_request", "action_result"]);
  });

  it("auto-runs a skill-sourced destructive call under YOLO — same audit trail as any other call", async () => {
    const yoloGateway = new AssistantToolGateway({
      resolveActiveModules: async () => [exampleToolModule],
      repository,
      runner,
      tokens,
      confirmations,
      notifier: { emit: (chatSessionId, record) => emitted.push({ chatSessionId, record }) },
      confirmTimeoutMs: 30_000,
      yoloMode: async () => true
    });
    const turnText = composeTurnText(skillFixture(), "clean up the stale draft, delete it");
    const token = tokens.mint({
      actorUserId: ids.userA,
      chatSessionId: "s-skill-yolo",
      allowedToolNames: null
    });

    const result = await yoloGateway.callTool(token, "example.destroy", { value: turnText });
    await tick();

    expect(result.ok).toBe(true);
    expect(exampleToolCalls).toEqual([
      { name: "example.destroy", input: { value: turnText }, actorUserId: ids.userA }
    ]);
    expect(emitted.map((entry) => entry.record.kind)).toEqual(["action_result"]);

    const audit = await runner.withDataContext(
      { actorUserId: ids.userA, requestId: "test:skill-yolo-audit" },
      (scopedDb) => repository.listActionAuditLog(scopedDb, { since: new Date(0), limit: 20 })
    );
    // approval_mode stays plain "yolo" — no separate skill-triggered audit label exists.
    expect(
      audit.some((row) => row.tool_name === "example.destroy" && row.approval_mode === "yolo")
    ).toBe(true);
  });

  it("persona file bytes are byte-identical before and after a skill-sourced turn", async () => {
    const { fs, writes, calls } = fakePersonaFs();
    const persona = "You are Jarvis, {{userName}}'s assistant.";
    const rendered = await renderPersona(fs, {
      userId: ids.userA,
      userName: "Ben",
      provider: "anthropic",
      baseDir: "/skill-persona-test",
      persona
    });
    const before = writes[rendered.personaPath];
    const callsBefore = [...calls];
    expect(before).toBeDefined();

    // Run a full skill-sourced turn through the gateway (confirm-gated write). AssistantToolGateway's
    // dependency surface (repository/runner/tokens/confirmations/notifier/actionPolicy/yoloMode) has
    // no PersonaFs seam at all, so nothing on this path can reach the persona file.
    const turnText = composeTurnText(skillFixture(), "please write hello for me");
    const token = tokens.mint({
      actorUserId: ids.userA,
      chatSessionId: "s-skill-persona",
      allowedToolNames: null
    });
    const call = gateway.callTool(token, "example.write", { value: turnText });
    await tick();
    const card = firstActionRequest();
    await gateway.resolveActionRequest(ids.userA, card.actionRequestId, "confirmed");
    await call;

    // No new mkdir/writeFile occurred as a side effect of the skill-sourced tool call.
    expect(calls).toEqual(callsBefore);

    // Re-rendering the same persona input is idempotent and byte-identical (prompt-cache
    // discipline: skill invocation must never cause persona-file rewrite/drift).
    const renderedAgain = await renderPersona(fs, {
      userId: ids.userA,
      userName: "Ben",
      provider: "anthropic",
      baseDir: "/skill-persona-test",
      persona
    });
    expect(writes[renderedAgain.personaPath]).toBe(before);
  });
});
