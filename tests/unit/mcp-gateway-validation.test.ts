import { describe, expect, it } from "vitest";

import {
  AssistantToolGateway,
  ConfirmationRegistry,
  SessionTokenRegistry,
  ToolInputValidationError,
  validateToolInput
} from "@jarv1s/ai";
import type { ModuleAssistantToolManifest } from "@jarv1s/module-sdk";
import { tasksModuleManifest } from "@jarv1s/tasks";
import { getBuiltInModuleManifests } from "@jarv1s/module-registry";

describe("tool input validation", () => {
  const schema = {
    type: "object",
    required: ["taskId"],
    properties: { taskId: { type: "string" }, count: { type: "number" } }
  };

  it("accepts valid input", () => {
    expect(validateToolInput(schema, { taskId: "t1", count: 2 })).toEqual({
      taskId: "t1",
      count: 2
    });
  });

  it("rejects a missing required key", () => {
    expect(() => validateToolInput(schema, { count: 2 })).toThrow(ToolInputValidationError);
  });

  it("rejects a wrong declared type", () => {
    expect(() => validateToolInput(schema, { taskId: 5 })).toThrow(ToolInputValidationError);
  });

  it("accepts anything when no schema is declared", () => {
    expect(validateToolInput(undefined, { whatever: true })).toEqual({ whatever: true });
  });

  // #1265 security QA BLOCKING-1(b): the sports follow tools bound their catalog keys with
  // minLength/maxLength/pattern precisely so a model-supplied key cannot be arbitrary. Those
  // keywords were previously parsed by nobody, which would have made the manifest bound decorative
  // — a declared belt that never fires. This is the gateway chokepoint for every module's tool
  // input, so the enforcement lives here rather than in any one module.
  describe("string bounds", () => {
    const bounded = {
      type: "object",
      required: ["key"],
      properties: {
        key: { type: "string", minLength: 1, maxLength: 8, pattern: "^[a-z0-9.]{1,8}$" }
      }
    };

    it("accepts a value inside every bound", () => {
      expect(validateToolInput(bounded, { key: "eng.1" })).toEqual({ key: "eng.1" });
    });

    it("rejects a value over maxLength", () => {
      expect(() => validateToolInput(bounded, { key: "abcdefghij" })).toThrow(
        ToolInputValidationError
      );
    });

    it("rejects a value under minLength", () => {
      expect(() => validateToolInput(bounded, { key: "" })).toThrow(ToolInputValidationError);
    });

    it("rejects a value that does not match the pattern", () => {
      expect(() => validateToolInput(bounded, { key: "../evil" })).toThrow(
        ToolInputValidationError
      );
    });

    // An unanchored pattern must not be satisfied by a matching substring — otherwise
    // "ok/../../etc" would pass a naive `/[a-z]+/.test(...)`.
    it("requires the whole string to match, not a substring", () => {
      const loose = { type: "object", properties: { key: { type: "string", pattern: "[a-z]+" } } };
      expect(() => validateToolInput(loose, { key: "ok/../evil" })).toThrow(
        ToolInputValidationError
      );
    });

    it("leaves non-strings and undeclared bounds alone", () => {
      const mixed = {
        type: "object",
        properties: { n: { type: "number" }, s: { type: "string" } }
      };
      expect(validateToolInput(mixed, { n: 12345678901234, s: "anything at all" })).toEqual({
        n: 12345678901234,
        s: "anything at all"
      });
    });

    // #1265 QA follow-up: compilePattern's catch swallows an unparseable `pattern` rather than
    // throwing (a manifest bug degrades that field to unvalidated instead of failing every call).
    // Nothing lints inputSchema patterns before a built-in tool ships (see #1274 for the
    // install-time lint this is a stopgap for), so this asserts the invariant here instead: every
    // built-in tool's declared pattern must compile the same way input-validation.ts's
    // compilePattern does, or a manifest bug would silently ship a decorative bound.
    it("compiles every built-in tool's declared inputSchema pattern under /u, anchored", () => {
      interface PatternWalkNode {
        readonly pattern?: string;
        readonly properties?: Record<string, PatternWalkNode>;
        readonly items?: PatternWalkNode;
      }

      const collectPatterns = (node: PatternWalkNode | undefined, patterns: string[]): void => {
        if (!node) return;
        if (typeof node.pattern === "string") patterns.push(node.pattern);
        if (node.properties) {
          for (const child of Object.values(node.properties)) collectPatterns(child, patterns);
        }
        if (node.items) collectPatterns(node.items, patterns);
      };

      const manifests = getBuiltInModuleManifests();
      const patterns: string[] = [];
      for (const manifest of manifests) {
        for (const tool of manifest.assistantTools ?? []) {
          collectPatterns(tool.inputSchema as PatternWalkNode | undefined, patterns);
        }
      }

      expect(patterns.length).toBeGreaterThan(0);
      for (const pattern of patterns) {
        expect(() => new RegExp(`^(?:${pattern})$`, "u"), `pattern failed to compile: ${pattern}`)
          .not.toThrow();
      }
    });
  });
});

describe("gateway tool output sanitization", () => {
  const runner = {
    withDataContext: async (_access: unknown, work: (db: unknown) => Promise<unknown>) => work({})
  };

  it("accepts real task list-family output schemas for items-shaped tool results", async () => {
    const listFamilyTools = [
      "tasks.list",
      "tasks.focus",
      "tasks.atRisk",
      "tasks.overdue",
      "tasks.listLists",
      "tasks.listTags"
    ];
    const taskTools = tasksModuleManifest.assistantTools ?? [];
    const tools = listFamilyTools.map((name) => {
      const tool = taskTools.find((candidate) => candidate.name === name);
      if (!tool) throw new Error(`missing ${name}`);
      return {
        ...tool,
        execute: async () => ({ data: { items: [] }, columnOrder: ["id"] })
      } satisfies ModuleAssistantToolManifest;
    });
    const tokens = new SessionTokenRegistry();
    const gateway = new AssistantToolGateway({
      resolveActiveModules: async () => [
        {
          id: "tasks",
          name: "Tasks",
          version: "1.0.0",
          publisher: "Jarv1s",
          lifecycle: "required",
          compatibility: { jarv1s: "*" },
          assistantTools: tools
        }
      ],
      repository: {} as never,
      runner: runner as never,
      tokens,
      confirmations: new ConfirmationRegistry(),
      notifier: { emit: () => {} },
      confirmTimeoutMs: 1000
    });
    const token = tokens.mint({ actorUserId: "u1", chatSessionId: "s1", allowedToolNames: null });

    for (const toolName of listFamilyTools) {
      const res = await gateway.callTool(
        token,
        toolName,
        toolName === "tasks.listTags" ? { listId: "l1" } : {}
      );

      expect(res.ok).toBe(true);
      if (!res.ok) throw new Error(`expected ${toolName} ok`);
      expect((res.data as { text: string }).text).toContain("items");
    }
  });

  it("drops undeclared output fields before rendering a tool result", async () => {
    const tokens = new SessionTokenRegistry();
    const gateway = new AssistantToolGateway({
      resolveActiveModules: async () => [
        {
          id: "example",
          name: "Example",
          version: "1.0.0",
          publisher: "Jarv1s",
          lifecycle: "optional",
          compatibility: { jarv1s: "*" },
          assistantTools: [
            {
              name: "example.safe",
              description: "Safe output.",
              permissionId: "example.view",
              risk: "read",
              outputSchema: {
                type: "object",
                properties: { visible: { type: "string" } },
                required: ["visible"]
              },
              execute: async () => ({
                data: { visible: "ok", secret: "SECRET", nested: { token: "TOKEN" } }
              })
            }
          ]
        }
      ],
      repository: {} as never,
      runner: runner as never,
      tokens,
      confirmations: new ConfirmationRegistry(),
      notifier: { emit: () => {} },
      confirmTimeoutMs: 1000
    });
    const token = tokens.mint({ actorUserId: "u1", chatSessionId: "s1", allowedToolNames: null });

    const res = await gateway.callTool(token, "example.safe", {});

    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error("expected ok");
    const text = (res.data as { text: string }).text;
    expect(text).toContain("visible");
    expect(text).toContain("ok");
    expect(text).not.toContain("SECRET");
    expect(text).not.toContain("TOKEN");
    expect(text).not.toContain("secret");
    expect(text).not.toContain("nested");
  });

  it("drops undeclared nested fields under declared output fields", async () => {
    const tokens = new SessionTokenRegistry();
    const gateway = new AssistantToolGateway({
      resolveActiveModules: async () => [
        {
          id: "example",
          name: "Example",
          version: "1.0.0",
          publisher: "Jarv1s",
          lifecycle: "optional",
          compatibility: { jarv1s: "*" },
          assistantTools: [
            {
              name: "example.nested-safe",
              description: "Nested safe output.",
              permissionId: "example.view",
              risk: "read",
              outputSchema: {
                type: "object",
                properties: {
                  messages: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        id: { type: "string" },
                        text: { type: "string" },
                        author: {
                          type: "object",
                          properties: { displayName: { type: "string" } },
                          required: ["displayName"]
                        }
                      },
                      required: ["id", "text", "author"]
                    }
                  }
                },
                required: ["messages"]
              },
              execute: async () => ({
                data: {
                  messages: [
                    {
                      id: "m1",
                      text: "hello",
                      author: { displayName: "Ada", email: "ada@example.test", token: "TOKEN" },
                      privateNote: "SECRET"
                    }
                  ]
                }
              })
            }
          ]
        }
      ],
      repository: {} as never,
      runner: runner as never,
      tokens,
      confirmations: new ConfirmationRegistry(),
      notifier: { emit: () => {} },
      confirmTimeoutMs: 1000
    });
    const token = tokens.mint({ actorUserId: "u1", chatSessionId: "s1", allowedToolNames: null });

    const res = await gateway.callTool(token, "example.nested-safe", {});

    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error("expected ok");
    const text = (res.data as { text: string }).text;
    expect(text).toContain("messages");
    expect(text).toContain("hello");
    expect(text).toContain("Ada");
    expect(text).not.toContain("SECRET");
    expect(text).not.toContain("TOKEN");
    expect(text).not.toContain("privateNote");
    expect(text).not.toContain("email");
  });

  it("fails closed when a declared scalar output field receives an object", async () => {
    const tokens = new SessionTokenRegistry();
    const gateway = new AssistantToolGateway({
      resolveActiveModules: async () => [
        {
          id: "example",
          name: "Example",
          version: "1.0.0",
          publisher: "Jarv1s",
          lifecycle: "optional",
          compatibility: { jarv1s: "*" },
          assistantTools: [
            {
              name: "example.scalar-object-leak",
              description: "Scalar object leak probe.",
              permissionId: "example.view",
              risk: "read",
              outputSchema: {
                type: "object",
                properties: { visible: { type: "string" } },
                required: ["visible"]
              },
              execute: async () => ({ data: { visible: { secret: "SECRET" } } })
            }
          ]
        }
      ],
      repository: {} as never,
      runner: runner as never,
      tokens,
      confirmations: new ConfirmationRegistry(),
      notifier: { emit: () => {} },
      confirmTimeoutMs: 1000
    });
    const token = tokens.mint({ actorUserId: "u1", chatSessionId: "s1", allowedToolNames: null });

    const res = await gateway.callTool(token, "example.scalar-object-leak", {});

    expect(res).toEqual({ ok: false, error: "Tool example.scalar-object-leak failed" });
    if (res.ok) {
      expect((res.data as { text: string }).text).not.toContain("SECRET");
    }
  });

  it("fails closed when a nullable scalar output field receives an object", async () => {
    const tokens = new SessionTokenRegistry();
    const gateway = new AssistantToolGateway({
      resolveActiveModules: async () => [
        {
          id: "example",
          name: "Example",
          version: "1.0.0",
          publisher: "Jarv1s",
          lifecycle: "optional",
          compatibility: { jarv1s: "*" },
          assistantTools: [
            {
              name: "example.nullable-scalar-object-leak",
              description: "Nullable scalar object leak probe.",
              permissionId: "example.view",
              risk: "read",
              outputSchema: {
                type: "object",
                properties: { visible: { anyOf: [{ type: "string" }, { type: "null" }] } },
                required: ["visible"]
              },
              execute: async () => ({ data: { visible: { secret: "SECRET" } } })
            }
          ]
        }
      ],
      repository: {} as never,
      runner: runner as never,
      tokens,
      confirmations: new ConfirmationRegistry(),
      notifier: { emit: () => {} },
      confirmTimeoutMs: 1000
    });
    const token = tokens.mint({ actorUserId: "u1", chatSessionId: "s1", allowedToolNames: null });

    const res = await gateway.callTool(token, "example.nullable-scalar-object-leak", {});

    expect(res).toEqual({ ok: false, error: "Tool example.nullable-scalar-object-leak failed" });
    if (res.ok) {
      expect((res.data as { text: string }).text).not.toContain("SECRET");
    }
  });

  it("fails closed when required output fields are missing", async () => {
    const tokens = new SessionTokenRegistry();
    const gateway = new AssistantToolGateway({
      resolveActiveModules: async () => [
        {
          id: "example",
          name: "Example",
          version: "1.0.0",
          publisher: "Jarv1s",
          lifecycle: "optional",
          compatibility: { jarv1s: "*" },
          assistantTools: [
            {
              name: "example.invalid-output",
              description: "Invalid output.",
              permissionId: "example.view",
              risk: "read",
              outputSchema: {
                type: "object",
                properties: { visible: { type: "string" } },
                required: ["visible"]
              },
              execute: async () => ({ data: { other: "value" } })
            }
          ]
        }
      ],
      repository: {} as never,
      runner: runner as never,
      tokens,
      confirmations: new ConfirmationRegistry(),
      notifier: { emit: () => {} },
      confirmTimeoutMs: 1000
    });
    const token = tokens.mint({ actorUserId: "u1", chatSessionId: "s1", allowedToolNames: null });

    const res = await gateway.callTool(token, "example.invalid-output", {});

    expect(res).toEqual({ ok: false, error: "Tool example.invalid-output failed" });
  });

  it("caps rendered tool output before returning it to the model", async () => {
    const tokens = new SessionTokenRegistry();
    const gateway = new AssistantToolGateway({
      resolveActiveModules: async () => [
        {
          id: "example",
          name: "Example",
          version: "1.0.0",
          publisher: "Jarv1s",
          lifecycle: "optional",
          compatibility: { jarv1s: "*" },
          assistantTools: [
            {
              name: "example.large-output",
              description: "Large output.",
              permissionId: "example.view",
              risk: "read",
              outputSchema: {
                type: "object",
                properties: { visible: { type: "string" } },
                required: ["visible"]
              },
              execute: async () => ({ data: { visible: "x".repeat(20_000) } })
            }
          ]
        }
      ],
      repository: {} as never,
      runner: runner as never,
      tokens,
      confirmations: new ConfirmationRegistry(),
      notifier: { emit: () => {} },
      confirmTimeoutMs: 1000
    });
    const token = tokens.mint({ actorUserId: "u1", chatSessionId: "s1", allowedToolNames: null });

    const res = await gateway.callTool(token, "example.large-output", {});

    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error("expected ok");
    const text = (res.data as { text: string }).text;
    expect(text.length).toBeLessThanOrEqual(16_000);
    expect(text).toContain("[truncated tool result]");
  });
});
